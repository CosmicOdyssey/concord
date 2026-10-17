"""F. Attenuation check: is the within-site congestion estimate biased toward zero by noise?

    python -m concord.analysis.congestion_subsets [--out data/robustness/congestion_subsets.json]

PRE-REGISTERED METHOD (written and committed before any subset number was computed)
==================================================================================

Question. The primary premise estimate (concord.analysis.congestion, within_overlap) is about -0.027,
95% CI about [-0.12, 0.07]; the service turns it into the default congestion elasticity
beta = max(0, -coef) = 0.026. Noise in the exposure (sites that run few lung trials, giant trials
whose per-site exposure is diluted, competitor pairs that barely share patients) would attenuate the
coefficient toward 0. Re-estimate on cleaner subsets and see whether the estimate moves.

Data. The private DB copy (CONCORD_DATA_DIR). Trials, rows, outcome, controls and exposures come
from concord.analysis.congestion.load() unchanged; this module imports load, _masks, _design,
_ols_cluster, _demean and _fmt and does not modify congestion.py or the DB meta.

Samples (restrict trial-site rows FIRST, then compute every estimator on the remaining rows exactly
as congestion.run() does for the measure "overlap"):
  full  all rows of load(). Must reproduce congestion.run(): coef and se of all nine estimators
        (pooled / site_fe / within x start / overlap / avg) are recomputed with this module's
        estimator code and asserted equal to congestion.run() on the same DB (abs diff < 1e-9).
  S1    rows at sites with site_model.n_hist >= 10 (site has >= 10 lung trials of any status;
        a site missing from site_model counts as n_hist = 0, i.e. dropped).
  S2    rows of trials with trials.n_sites <= 20 (registered site count, including anonymized
        sites, as stored in the trials table and used in congestion.py's outcome and weights).
  S3    all rows, but the overlap exposure is rebuilt from competitor pairs with eligibility overlap
        o_tQ >= 0.8 only: exposure = log(1 + sum_{Q rival, o_tQ >= 0.8} o_tQ), where
        o_tQ = |E_t & E_Q| / |E_t| on the same synthetic population as congestion._masks
        (n = 4000, seed 11), and rivals are defined exactly as in load() (other lung trials at the
        site with start_Q <= start_t < end_Q). Trials without a mask or with an empty mask get
        exposure 0, as in load(). Sanity check: with no threshold this rebuild must reproduce load()'s
        overlap column (abs diff < 1e-9).
  "Exactly as congestion.run()" means, per sample: outcome y_t = log(N_t / (tau_t * n_sites_t)) with
  n_sites_t from the trials table (not the number of rows left); pooled = trial-level OLS on the mean
  exposure over the trial's remaining rows + controls, SEs clustered by trial; site_fe = drop sites
  with < 2 remaining rows, rows weighted 1/n_sites_t, weighted site demeaning, CR1 SEs clustered by
  trial; within = on the site_fe rows, exposure minus the site's unweighted mean exposure, averaged
  over the trial's rows, trial-level OLS + controls. Controls: phase dummies, log n_sites, industry,
  start-year FE (congestion._design).

Reported per sample, for within_overlap (PRIMARY), site_fe_overlap and pooled_overlap:
  coef, 95% CI (coef +/- 1.96 se), p, number of trials (= clusters), number of trial-site rows
  (pooled: all remaining rows of the sample; site_fe and within: rows after the singleton-site drop),
  sites (site_fe), exposure mean / p90, and the implied beta = max(0, -coef) with CI
  [max(0, -hi), max(0, -lo)] (same mapping as service.congestion_beta). Also whether each CI
  excludes the model-implied -1 (master-doc beta = 1). For S3 also the share of rows with non-zero
  exposure (power diagnostic).

Decision rule (fixed now). Recommend changing the default beta ONLY if a subset's within_overlap
  (a) 95% CI excludes the full-sample within_overlap point estimate, AND
  (b) is well powered: >= 300 trials AND CI half-width <= 1.5 x the full-sample CI half-width.
  Otherwise recommend keeping the default (beta from the full-sample within_overlap).
  Three subsets are tested, so a Bonferroni-adjusted CI (coef +/- 2.394 se, alpha = 0.05/3) is
  reported beside each; a subset that meets the rule at 95% but whose Bonferroni CI still contains
  the full-sample estimate is flagged as weak evidence in the recommendation (the rule still decides).
  If more than one subset meets the rule: if all move in the same direction from the full-sample
  estimate, recommend the beta implied by the one with the smallest se; if they move in opposite
  directions, keep the default. The subsets overlap with the full sample, so (a) is a heuristic
  screen, not a formal test of a difference.
  The recommendation is advice only; this module never writes the DB meta or the default beta.

Interpretation (descriptive, not part of the rule): attenuation would show as subset estimates
more negative than the full sample. Estimates near 0 or positive in the cleaner subsets do not
support attenuation as the explanation for the small full-sample coefficient.

ADDENDUM (post hoc, added after the results audit; NOT part of the pre-registered method)
The output's "post_hoc_descriptive" block records two descriptive facts that the report text relies
on, so that every number in the write-up can be traced to this file. Neither feeds the decision
rule, and no pre-registered number changes:
  moves_vs_full  within_overlap coef of each subset minus the full-sample coef, with the subset's
                 95% CI half-width beside it.
  composition    why the pooled (cross-site) coefficient is negative while the within-site one is
                 not: overlap exposure at low-volume sites (n_hist < 10) vs the rest (row mean and
                 share non-zero); the partial correlation, net of log n_sites, between a trial's
                 outcome y and the share of its rows at low-volume sites; and mean y and mean
                 exposure of the trials that S1 drops (no row at a site with n_hist >= 10) vs those
                 it keeps.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time

import numpy as np
from scipy.stats import norm

from concord.analysis.congestion import _demean, _design, _fmt, _masks, _ols_cluster, load
from concord.analysis.congestion import run as congestion_run
from concord.paths import DB_PATH, ROOT

S1_MIN_SITE_TRIALS = 10
S2_MAX_SITES = 20
S3_MIN_OVERLAP = 0.8
MIN_TRIALS = 300
MAX_HW_RATIO = 1.5
N_SUBSETS = 3
Z95 = 1.96
Z_BONF = float(norm.ppf(1 - 0.05 / N_SUBSETS / 2))  # 2.394
MEASURE_COL = {"start": 2, "avg": 3, "overlap": 4}  # columns of load()'s rows


def _y(trials: dict, t: str) -> float:
    return float(np.log(trials[t]["N"] / (trials[t]["tau"] * trials[t]["n_sites"])))


def estimate(trials: dict, rows: list[tuple[str, str, float]]) -> dict:
    """pooled / site_fe / within for one exposure, on (trial, site, exposure) rows.

    Line-for-line the per-measure block of congestion.run(), with row counts added."""
    out: dict = {}

    # Pooled, trial level: mean exposure across the trial's remaining rows.
    expo: dict[str, list[float]] = {}
    for t, _, x in rows:
        expo.setdefault(t, []).append(x)
    ids = sorted(expo)
    y = np.array([_y(trials, t) for t in ids])
    x = np.array([np.mean(expo[t]) for t in ids])
    C, _ = _design(trials, ids)
    b, se, G = _ols_cluster(y, np.column_stack([x, np.ones(len(ids)), C]), np.array(ids))
    out["pooled"] = {**_fmt(b[0], se[0], len(ids), G, x), "trial_site_rows": len(rows)}

    # Site fixed effects on trial-site rows weighted 1/n_sites, singleton sites dropped.
    sub = [r for r in rows if r[0] in trials]
    tid = np.array([r[0] for r in sub])
    sid = np.array([r[1] for r in sub])
    _, inv, cnt = np.unique(sid, return_inverse=True, return_counts=True)
    keep = cnt[inv] >= 2
    tid, sid = tid[keep], sid[keep]
    sub = [r for r, kp in zip(sub, keep) if kp]
    yv = np.array([_y(trials, t) for t in tid])
    xv = np.array([r[2] for r in sub], dtype=float)
    Cv, _ = _design(trials, list(tid))
    w = np.array([1.0 / trials[t]["n_sites"] for t in tid])
    M = _demean(np.column_stack([yv, xv, Cv]), sid, w)
    b, se, G = _ols_cluster(M[:, 0], M[:, 1:], tid, w)
    r = _fmt(b[0], se[0], len(tid), G, xv)
    r["sites"] = int(len(np.unique(sid)))
    r["trial_site_rows"] = int(len(tid))
    out["site_fe"] = r

    # Within-site at trial level: site-demeaned exposure averaged over the trial's rows.
    _, g = np.unique(sid, return_inverse=True)
    site_mean = np.bincount(g, weights=xv) / np.bincount(g)
    dev: dict[str, list[float]] = {}
    for t, xd in zip(tid, xv - site_mean[g]):
        dev.setdefault(t, []).append(xd)
    ids = sorted(dev)
    y = np.array([_y(trials, t) for t in ids])
    x = np.array([np.mean(dev[t]) for t in ids])
    C, _ = _design(trials, ids)
    b, se, G = _ols_cluster(y, np.column_stack([x, np.ones(len(ids)), C]), np.array(ids))
    out["within"] = {**_fmt(b[0], se[0], len(ids), G, x), "trial_site_rows": int(len(tid))}
    return out


def overlap_pairs(con: sqlite3.Connection, trials: dict, masks: dict) -> dict[tuple[str, str], list[float]]:
    """o_tQ for every rival Q of trial t at site s, with rivals defined exactly as in congestion.load()."""
    windows = {nct: (s, e) for nct, s, e in con.execute(
        "SELECT nct_id, start_date, COALESCE(primary_completion_date, completion_date) FROM trials "
        "WHERE is_lung=1 AND start_date IS NOT NULL")}
    by_site: dict[str, list[str]] = {}
    for nct, sid in con.execute("""SELECT ts.nct_id, ts.site_id FROM trial_sites ts JOIN sites s USING(site_id)
                                   WHERE s.anonymized=0"""):
        by_site.setdefault(sid, []).append(nct)
    out: dict[tuple[str, str], list[float]] = {}
    for sid, ncts in by_site.items():
        mine = [n for n in ncts if n in trials]
        if not mine:
            continue
        w = [(n, *windows[n]) for n in ncts if n in windows and windows[n][1]]
        for t in mine:
            s0 = trials[t]["start"]
            rivals = [n for n, s1, e1 in w if n != t and s1 <= s0 < e1]
            mt = masks.get(t)
            o: list[float] = []
            if mt is not None and mt.sum() > 0:
                denom = float(mt.sum())
                o = [float((masks[q] & mt).sum()) / denom for q in rivals if q in masks]
            out[(t, sid)] = o
    return out


def _ci(c: dict, z: float) -> list[float]:
    return [c["coef"] - z * c["se"], c["coef"] + z * c["se"]]


def _beta(c: dict) -> dict:
    lo, hi = c["ci95"]
    return {"beta": max(0.0, -c["coef"]), "ci95": [max(0.0, -hi), max(0.0, -lo)]}


def _annotate(res: dict) -> dict:
    for c in res.values():
        c["ci95_bonferroni3"] = _ci(c, Z_BONF)
        c["ci_excludes_minus1"] = not (c["ci95"][0] <= -1.0 <= c["ci95"][1])
        c["implied_beta"] = _beta(c)
    return res


def decide(full: dict, subsets: dict[str, dict]) -> dict:
    """Apply the pre-registered rule to the within_overlap estimates."""
    f = full["within"]
    f_hw = Z95 * f["se"]
    checks = {}
    for name, res in subsets.items():
        c = res["within"]
        hw = Z95 * c["se"]
        lo, hi = c["ci95"]
        excl = not (lo <= f["coef"] <= hi)
        blo, bhi = c["ci95_bonferroni3"]
        powered = c["clusters"] >= MIN_TRIALS and hw <= MAX_HW_RATIO * f_hw
        checks[name] = {
            "ci_excludes_full_estimate": bool(excl),
            "trials": int(c["clusters"]), "enough_trials": bool(c["clusters"] >= MIN_TRIALS),
            "ci_half_width": float(hw), "full_ci_half_width": float(f_hw),
            "half_width_ratio": float(hw / f_hw), "precise_enough": bool(hw <= MAX_HW_RATIO * f_hw),
            "well_powered": bool(powered),
            "meets_rule": bool(excl and powered),
            "bonferroni_ci_excludes_full_estimate": bool(not (blo <= f["coef"] <= bhi)),
            "direction_vs_full": "more negative" if c["coef"] < f["coef"] else "less negative or positive",
        }
    hits = [n for n, ch in checks.items() if ch["meets_rule"]]
    if not hits:
        rec = {"change_default_beta": False, "beta": _beta(f)["beta"], "source": "full",
               "reason": "no subset meets the pre-registered rule (CI excludes full estimate AND well powered)"}
    else:
        dirs = {checks[n]["direction_vs_full"] for n in hits}
        if len(dirs) > 1:
            rec = {"change_default_beta": False, "beta": _beta(f)["beta"], "source": "full",
                   "reason": f"subsets {hits} meet the rule but move in opposite directions"}
        else:
            best = min(hits, key=lambda n: subsets[n]["within"]["se"])
            weak = not checks[best]["bonferroni_ci_excludes_full_estimate"]
            rec = {"change_default_beta": True, "beta": _beta(subsets[best]["within"])["beta"], "source": best,
                   "reason": f"{hits} meet the rule; {best} has the smallest se"
                             + ("; WEAK: its Bonferroni CI (3 subsets) still contains the full estimate"
                                if weak else "")}
    return {"checks": checks, "recommendation": rec,
            "rule": {"min_trials": MIN_TRIALS, "max_half_width_ratio": MAX_HW_RATIO, "z95": Z95,
                     "z_bonferroni": Z_BONF, "n_subsets": N_SUBSETS}}


def post_hoc_descriptive(trials: dict, rows: list, k: int, n_hist: dict, full: dict, subsets: dict) -> dict:
    """Descriptive numbers behind the report text (added after the audit; see the docstring ADDENDUM)."""
    f = full["within"]["coef"]
    moves = {n: {"move": float(res["within"]["coef"] - f),
                 "ci_half_width": float(Z95 * res["within"]["se"])} for n, res in subsets.items()}
    big = max(moves, key=lambda n: abs(moves[n]["move"]))

    low = np.array([(n_hist.get(r[1]) or 0) < S1_MIN_SITE_TRIALS for r in rows])
    x = np.array([r[k] for r in rows], dtype=float)
    expo_by_volume = {
        name: {"rows": int(m.sum()), "mean_exposure": float(x[m].mean()),
               "share_nonzero_exposure": float(np.mean(x[m] > 0))}
        for name, m in ((f"n_hist_lt_{S1_MIN_SITE_TRIALS}", low), (f"n_hist_ge_{S1_MIN_SITE_TRIALS}", ~low))}

    by_t: dict[str, list[tuple[bool, float]]] = {}
    for r, lo_ in zip(rows, low):
        by_t.setdefault(r[0], []).append((bool(lo_), float(r[k])))
    ids = sorted(by_t)
    y = np.array([_y(trials, t) for t in ids])
    share_low = np.array([np.mean([a for a, _ in by_t[t]]) for t in ids])
    lns = np.log([trials[t]["n_sites"] for t in ids])
    Z = np.column_stack([np.ones(len(ids)), lns])
    res_ = lambda v: v - Z @ np.linalg.lstsq(Z, v, rcond=None)[0]  # noqa: E731
    pcorr = float(np.corrcoef(res_(y), res_(share_low))[0, 1])

    groups = {"dropped_by_S1": [t for t in ids if all(a for a, _ in by_t[t])],
              "kept_by_S1": [t for t in ids if not all(a for a, _ in by_t[t])]}
    s1_groups = {g: {"trials": len(ts),
                     "mean_y": float(np.mean([_y(trials, t) for t in ts])),
                     "mean_trial_exposure_all_rows": float(np.mean([np.mean([b for _, b in by_t[t]]) for t in ts]))}
                 for g, ts in groups.items()}
    return {
        "note": "added after the results audit; descriptive only, not part of the pre-registered method or rule",
        "moves_vs_full": {"full_within_coef": float(f), "by_subset": moves, "largest": big,
                          "largest_abs_move": float(abs(moves[big]["move"]))},
        "composition": {
            "exposure_by_site_volume": expo_by_volume,
            "partial_corr_y_share_low_volume_rows_given_log_n_sites": pcorr,
            "trials": len(ids),
            "s1_pooled_sample": s1_groups,
        },
    }


def run(con: sqlite3.Connection) -> dict:
    t0 = time.time()
    d = load(con)
    trials, rows = d["trials"], d["rows"]
    k = MEASURE_COL["overlap"]

    # Full sample: reproduce congestion.run() for all nine estimators.
    ref = congestion_run(con)["results"]
    full_all = {m: estimate(trials, [(r[0], r[1], r[c]) for r in rows]) for m, c in MEASURE_COL.items()}
    repro = {}
    for m, res in full_all.items():
        for est, c in res.items():
            rc = ref[f"{est}_{m}"]
            diff = max(abs(c["coef"] - rc["coef"]), abs(c["se"] - rc["se"]))
            repro[f"{est}_{m}"] = diff
            assert diff < 1e-9 and c["n_rows"] == rc["n_rows"] and c["clusters"] == rc["clusters"], (est, m, diff)
    full = _annotate(full_all["overlap"])

    # S1: rows at sites with >= 10 lung trials.
    n_hist = dict(con.execute("SELECT site_id, n_hist FROM site_model"))
    s1_rows = [(r[0], r[1], r[k]) for r in rows if (n_hist.get(r[1]) or 0) >= S1_MIN_SITE_TRIALS]
    # S2: rows of trials with <= 20 registered sites.
    s2_rows = [(r[0], r[1], r[k]) for r in rows if trials[r[0]]["n_sites"] <= S2_MAX_SITES]
    # S3: same rows, exposure from high-overlap competitor pairs only.
    masks = _masks(con)
    pairs = overlap_pairs(con, trials, masks)
    rebuilt = np.array([np.log1p(sum(pairs[(r[0], r[1])])) for r in rows])
    sanity = float(np.max(np.abs(rebuilt - np.array([r[k] for r in rows]))))
    assert sanity < 1e-9, sanity
    s3_x = [float(np.log1p(sum(o for o in pairs[(r[0], r[1])] if o >= S3_MIN_OVERLAP))) for r in rows]
    s3_rows = [(r[0], r[1], x) for r, x in zip(rows, s3_x)]

    subsets = {"S1": _annotate(estimate(trials, s1_rows)),
               "S2": _annotate(estimate(trials, s2_rows)),
               "S3": _annotate(estimate(trials, s3_rows))}
    n_pairs = sum(len(v) for v in pairs.values())
    n_pairs_hi = sum(sum(o >= S3_MIN_OVERLAP for o in v) for v in pairs.values())
    diag = {
        "S1": {"rows_kept": len(s1_rows), "rows_full": len(rows),
               "trials_with_rows": len({r[0] for r in s1_rows})},
        "S2": {"rows_kept": len(s2_rows), "rows_full": len(rows),
               "trials_with_rows": len({r[0] for r in s2_rows})},
        "S3": {"rows": len(rows), "share_rows_nonzero_exposure": float(np.mean(np.array(s3_x) > 0)),
               "share_rows_nonzero_exposure_full": float(np.mean(np.array([r[k] for r in rows]) > 0)),
               "rival_pairs": n_pairs, "rival_pairs_overlap_ge_0.8": n_pairs_hi,
               "share_pairs_kept": float(n_pairs_hi / max(n_pairs, 1)),
               "median_pair_overlap": float(np.median([o for v in pairs.values() for o in v])) if n_pairs else None},
    }
    post_hoc = post_hoc_descriptive(trials, rows, k, n_hist, full, subsets)
    return {
        "task": "F. attenuation check of the within-site congestion estimate",
        "method": "pre-registered in the module docstring of concord.analysis.congestion_subsets",
        "primary": "within_overlap",
        "model_implied_coef_overlap": -1.0,
        "definitions": {"S1": f"rows at sites with site_model.n_hist >= {S1_MIN_SITE_TRIALS}",
                        "S2": f"rows of trials with trials.n_sites <= {S2_MAX_SITES}",
                        "S3": f"exposure = log(1 + sum of o_tQ over rivals with o_tQ >= {S3_MIN_OVERLAP})"},
        "reproduction_max_abs_diff_vs_congestion_run": repro,
        "s3_rebuild_max_abs_diff_no_threshold": sanity,
        "full": full,
        "full_other_measures": {m: full_all[m] for m in ("start", "avg")},
        "subsets": subsets,
        "diagnostics": diag,
        "decision": decide(full, subsets),
        "post_hoc_descriptive": post_hoc,
        "seconds": round(time.time() - t0, 1),
    }


def _row(name: str, res: dict, chk: dict | None) -> str:
    w, fe, p = res["within"], res["site_fe"], res["pooled"]
    f = lambda c: f"{c['coef']:+.4f} [{c['ci95'][0]:+.4f}, {c['ci95'][1]:+.4f}]"  # noqa: E731
    meets = "-" if chk is None else ("YES" if chk["meets_rule"] else "no")
    return (f"{name:5s} within {f(w)} p={w['p']:.3f} trials={w['clusters']} rows={w['trial_site_rows']} | "
            f"site_fe {f(fe)} | pooled {f(p)} | meets={meets}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "data" / "robustness" / "congestion_subsets.json"))
    a = ap.parse_args()
    con = sqlite3.connect(DB_PATH)
    res = run(con)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(res, fh, indent=2)
    print(_row("full", res["full"], None))
    for n in ("S1", "S2", "S3"):
        print(_row(n, res["subsets"][n], res["decision"]["checks"][n]))
    print(json.dumps(res["decision"]["recommendation"], indent=2))
    print(json.dumps(res["diagnostics"], indent=2))
    print(json.dumps(res["post_hoc_descriptive"], indent=2))
    print(f"wrote {a.out} in {res['seconds']} s")


if __name__ == "__main__":
    main()
