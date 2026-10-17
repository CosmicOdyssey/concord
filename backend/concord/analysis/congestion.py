"""Does competition at the same sites slow enrollment? (The premise of the whole thesis.)

    python -m concord.analysis.congestion

Outcome: log per-site-month enrollment rate of each completed lung trial,
    y_t = log( N_t / (tau_t * |S_t|) ),  tau_t = enrollment window (see recruitment.ENROLL_FRACTION).

Exposure, per (trial, site):
    start   number of other lung trials recruiting at the site on t's start date (predetermined;
            the primary measure)
    overlap log(1 + sum_Q o_tQ) over competitors recruiting at the site at t's start, with o from
            the eligibility compiler. This is the allocator's own congestion term: eq. (2) implies
            rate ~ 1/(1 + sum o), i.e. a coefficient of -1 on this regressor.
    avg     time-averaged number of other lung trials active at the site during t's window.
            Mechanically biased negative: a slow trial has a long window and overlaps more
            competitors. Reported as a check only.

Models:
    pooled  trial-level OLS of y_t on the mean exposure over t's sites + controls
    site FE trial-site rows, site fixed effects (within-site: same site in busy vs quiet periods),
            rows weighted 1/|S_t| so each trial counts once
    within  trial-level OLS of y_t on the site-demeaned exposure averaged over t's sites (PRIMARY,
            measure "overlap")
Controls: phase dummies, log site count, industry sponsor, start-year fixed effects.
Standard errors: two-way clustered by trial and site (see V2 below); trial-only CR1 reported beside.

V2 PRE-REGISTERED METHOD (items 2 and 3; written and committed before any V2 number was computed)
==================================================================================================

A. Standard errors. The primary se / ci95 / p of EVERY estimator (pooled, site_fe, within x start,
   overlap, avg; full sample, subsets and parser versions) are two-way clustered by trial and site
   (Cameron, Gelbach and Miller 2011):
       V = V_trial + V_site - V_trial&site,  V_d = adj_d * B M_d B,  B = (X'WX)^-1,
       M_d = sum over clusters c of dimension d of S_c S_c',  S_c = sum of the scores w_i x_i e_i of c,
       adj_d = G_d / (G_d - 1) * (n - 1) / (n - k)   (per dimension, as in the existing CR1 _ols_cluster;
       n = observations, k = columns of X, G_d = clusters of dimension d),
   then negative eigenvalues of V (symmetric eigendecomposition) are clipped to 0; se = sqrt(diag V).
   Membership:
     site_fe (row level): each trial-site row belongs to its trial and its site; the intersection
       clusters are the (trial, site) pairs (unique per row: trial_sites has PRIMARY KEY (nct_id, site_id)).
     pooled and within (trial level): a trial belongs to every site it was registered at
       (multi-membership). "Registered sites" = the (non-anonymized) sites of the trial's rows in that
       estimator's sample: pooled uses all of the sample's rows, within the rows left after the
       singleton-site drop (the rows its exposure is built from). Anonymized sites never enter
       load()'s rows and so are never clusters. The site-cluster score of site s is the sum of the
       scores of all trials registered at s; the intersection term is sum over trials of
       m_t * s_t s_t' with m_t = number of the trial's sites, and G_trial&site = sum_t m_t.
   p = 2 * (1 - Phi(|coef / se|)), ci95 = coef +/- 1.96 se, as before. The old trial-clustered CR1
   numbers (_ols_cluster, unchanged) are reported as se_trial_only / ci95_trial_only / p_trial_only.
   Implemented as _ols_twoway(); unit test: equals the one-way trial-clustered variance when every
   trial has its own site (backend/tests/test_congestion_twoway.py).
B. Point estimates, samples, exposures, outcome and controls are unchanged; the full-sample run must
   reproduce the previous coef and trial-only se of all nine estimators (abs diff < 1e-9, checked
   against the meta written before this change). The default beta remains -coef of the full-sample
   within_overlap (service.congestion_beta reads results.within_overlap.coef / ci95; ci95 is now
   two-way).
C. Subsets (same three estimators on the measure "overlap"; trial-site rows restricted FIRST, then
   every estimator computed exactly as for the full sample: outcome uses trials.n_sites, site_fe drops
   sites with < 2 remaining rows, weights 1/n_sites, within uses the site_fe rows):
     S1p "experienced site, predetermined": keep a row (t, s) only if site s had >= 10 lung trials whose
         start_date is strictly before t's start_date. Count = number of distinct nct_id Q with (Q, s) in
         trial_sites JOIN trials, trials.is_lung = 1 (any status), start_date non-null and
         start_date_Q < start_date_t (ISO date strings). t itself never counts (not strictly before).
     S1  "experienced site, lifetime": site_model.n_hist >= 10 (missing site = 0), as in task F;
         labelled "uses later trials; not predetermined"; kept for comparison only.
     S2  rows of trials with trials.n_sites <= 20.
     S3  all rows; exposure = log(1 + sum of o_tQ over rivals with o_tQ >= 0.8), rivals and o_tQ exactly
         as in load() (sanity: without the threshold the rebuild reproduces load()'s overlap, < 1e-9).
   Multiple comparisons: Bonferroni over the k = 4 subsets, alpha = 0.05:
     bonferroni_ci95 = coef +/- z se with z = Phi^-1(1 - 0.05 / (2 * 4)) = 2.498 (two-way se), for
     within_overlap of each subset.
   Each subset reports within / site_fe / pooled: coef, se, ci95, p (two-way), the trial-only
   counterparts, clusters (trials), n_rows, sites. The full sample is not in "subsets".
D. Parser-version sensitivity (item 3). Versions: v0 = backend/concord/compiler/eligibility.py and
   population.py as of commit b8c576f; v1 = as of c0050f4; v2 = as of 4a87d33 (current). Each version's
   two files are read with `git show <commit>:<path>` into a temporary directory and imported as
   standalone modules under private names (never into the repo or the concord package). For every
   lung trial (trials.is_lung = 1; the same 7,206 trials trial_model holds) criteria =
   extract_criteria(eligibility_text or "") of that version, mask = that version's
   eligible_mask(criteria, pop) with pop = that version's synthetic_population(4000, seed=11) (size and
   seed exactly as _masks), WITHOUT hand-encoded overrides for all versions alike. These masks replace
   _masks() in load(); everything else identical. Report per version the full-sample within_overlap
   (coef, two-way ci95, p, clusters; also trial-only se and the pooled / site_fe overlap coefs) and
   empty_masks = number of the 7,206 lung trials whose mask has no eligible patient (also the count
   among the trials in the within_overlap sample). Reference (not a parser version): v2 WITH the current
   hand-encoded overrides (OVERRIDES.get(nct) or extract_criteria(text)), which must reproduce the
   production trial_model masks (number of differing masks reported) and therefore the production
   results.within_overlap.
E. Decision rule (unchanged from task F, now on two-way CIs). A subset "meets the rule" iff its
   within_overlap 95% CI excludes the full-sample within_overlap point estimate AND it is well powered
   (>= 300 trials AND CI half-width <= 1.5 x the full-sample CI half-width). Whether its Bonferroni CI
   also excludes the full estimate is reported beside. S1 (lifetime) is checked mechanically but is not
   predetermined. Regardless of the outcome the default beta is the full-sample estimate
   (default_beta.source = "full-sample within_overlap"); a subset that meets the rule is flagged for
   review, labelled "subset, not the default", and never used automatically.
Output: the meta key "congestion_test" (also written to data/robustness/congestion_v2.json) keeps
task, n_trials, n_trial_sites, results, primary, model_implied_coef_overlap, verdict (verdict from the
two-way p) and adds se_method, subsets, multiple_comparisons, parser_sensitivity (+ the production
reference), default_beta.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date

import numpy as np

from concord.model.recruitment import ENROLL_FRACTION
from concord.paths import DB_PATH


def _months(a: str, b: str) -> float:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days / 30.44


def load(con: sqlite3.Connection) -> dict:
    trials = {}
    for nct, n, s, e, phases, nsites, cls in con.execute("""
            SELECT nct_id, enrollment, start_date, primary_completion_date, phases, n_sites, sponsor_class
            FROM trials WHERE is_lung=1 AND enrollment_type='ACTUAL' AND enrollment>0
              AND primary_completion_type='ACTUAL' AND start_date IS NOT NULL
              AND primary_completion_date IS NOT NULL AND n_sites>0"""):
        tau = _months(s, e) * ENROLL_FRACTION
        if tau < 1.0:
            continue
        trials[nct] = dict(N=n, start=s, end=e, tau=tau, phases=json.loads(phases), n_sites=nsites,
                           industry=cls == "INDUSTRY", year=int(s[:4]))

    windows = {nct: (s, e) for nct, s, e in con.execute(
        "SELECT nct_id, start_date, COALESCE(primary_completion_date, completion_date) FROM trials "
        "WHERE is_lung=1 AND start_date IS NOT NULL")}
    by_site: dict[str, list[str]] = {}
    for nct, sid in con.execute("""SELECT ts.nct_id, ts.site_id FROM trial_sites ts JOIN sites s USING(site_id)
                                   WHERE s.anonymized=0"""):
        by_site.setdefault(sid, []).append(nct)

    masks = _masks(con)
    rows = []  # (trial, site, exposure_start, exposure_avg, log1p overlap at start)
    for sid, ncts in by_site.items():
        mine = [n for n in ncts if n in trials]
        if not mine:
            continue
        w = [(n, *windows[n]) for n in ncts if n in windows and windows[n][1]]
        for t in mine:
            s0, e0 = trials[t]["start"], trials[t]["end"]
            rivals = [n for n, s1, e1 in w if n != t and s1 <= s0 < e1]
            at_start = len(rivals)
            mt = masks.get(t)
            ov = 0.0
            if mt is not None and mt.sum() > 0:
                ov = sum(float((masks[q] & mt).sum()) for q in rivals if q in masks) / float(mt.sum())
            dur = max((date.fromisoformat(e0) - date.fromisoformat(s0)).days, 1)
            overlap_days = 0
            for n, s1, e1 in w:
                if n == t or not (s1 < e0 and e1 > s0):
                    continue
                lo, hi = max(s0, s1), min(e0, e1)
                overlap_days += (date.fromisoformat(hi) - date.fromisoformat(lo)).days
            rows.append((t, sid, at_start, overlap_days / dur, float(np.log1p(ov))))
    return {"trials": trials, "rows": rows}


def _masks(con: sqlite3.Connection, n_pop: int = 4000) -> dict[str, np.ndarray]:
    from concord.compiler.eligibility import Criterion, eligible_mask
    from concord.compiler.population import synthetic_population
    pop = synthetic_population(n_pop, seed=11)
    return {nct: eligible_mask([Criterion(**c) for c in json.loads(crit)], pop)
            for nct, crit in con.execute("SELECT nct_id, criteria FROM trial_model")}


def _design(trials: dict, ids: list[str]) -> tuple[np.ndarray, list[str]]:
    years = sorted({trials[t]["year"] for t in ids})
    cols, names = [], []
    for ph in ("PHASE1", "PHASE3", "PHASE4"):
        cols.append([float(ph in trials[t]["phases"]) for t in ids]); names.append(f"phase:{ph}")
    cols.append([np.log(trials[t]["n_sites"]) for t in ids]); names.append("log_n_sites")
    cols.append([float(trials[t]["industry"]) for t in ids]); names.append("industry")
    for y in years[1:]:
        cols.append([float(trials[t]["year"] == y) for t in ids]); names.append(f"year:{y}")
    return np.array(cols).T, names


def _ols_cluster(y, X, groups, w=None):
    """Weighted OLS with cluster-robust (CR1) standard errors."""
    w = np.ones(len(y)) if w is None else w
    sw = np.sqrt(w)
    Xw, yw = X * sw[:, None], y * sw
    XtX_inv = np.linalg.pinv(Xw.T @ Xw)
    beta = XtX_inv @ Xw.T @ yw
    u = yw - Xw @ beta
    _, g = np.unique(groups, return_inverse=True)
    G = g.max() + 1
    scores = np.zeros((G, X.shape[1]))
    np.add.at(scores, g, Xw * u[:, None])
    n, k = X.shape
    adj = G / (G - 1) * (n - 1) / max(n - k, 1)
    V = adj * XtX_inv @ (scores.T @ scores) @ XtX_inv
    return beta, np.sqrt(np.clip(np.diag(V), 0, None)), G


def _demean(M: np.ndarray, groups: np.ndarray, w: np.ndarray) -> np.ndarray:
    _, g = np.unique(groups, return_inverse=True)
    sums = np.zeros((g.max() + 1, M.shape[1]))
    np.add.at(sums, g, M * w[:, None])
    wsum = np.bincount(g, weights=w)
    return M - sums[g] / wsum[g][:, None]


def run(con: sqlite3.Connection | None = None) -> dict:
    con = con or sqlite3.connect(DB_PATH)
    d = load(con)
    trials, rows = d["trials"], d["rows"]
    out: dict = {"n_trials": len(trials), "n_trial_sites": len(rows), "results": {}}

    for k, measure in ((2, "start"), (4, "overlap"), (3, "avg")):
        # Pooled, trial level: mean exposure across the trial's (named) sites.
        expo: dict[str, list[float]] = {}
        for r in rows:
            expo.setdefault(r[0], []).append(r[k])
        ids = sorted(expo)
        y = np.array([np.log(trials[t]["N"] / (trials[t]["tau"] * trials[t]["n_sites"])) for t in ids])
        x = np.array([np.mean(expo[t]) for t in ids])
        C, names = _design(trials, ids)
        X = np.column_stack([x, np.ones(len(ids)), C])
        b, se, G = _ols_cluster(y, X, np.array(ids))
        out["results"][f"pooled_{measure}"] = _fmt(b[0], se[0], len(ids), G, x)

        # Site fixed effects, trial-site rows weighted so each trial counts once.
        sub = [r for r in rows if r[0] in trials]
        tid = np.array([r[0] for r in sub])
        sid = np.array([r[1] for r in sub])
        # Keep sites with >= 2 trials: singletons carry no within-site variation.
        _, inv, cnt = np.unique(sid, return_inverse=True, return_counts=True)
        keep = cnt[inv] >= 2
        tid, sid = tid[keep], sid[keep]
        sub = [r for r, kp in zip(sub, keep) if kp]
        yv = np.array([np.log(trials[t]["N"] / (trials[t]["tau"] * trials[t]["n_sites"])) for t in tid])
        xv = np.array([r[k] for r in sub], dtype=float)
        Cv, _ = _design(trials, list(tid))
        w = np.array([1.0 / trials[t]["n_sites"] for t in tid])
        M = _demean(np.column_stack([yv, xv, Cv]), sid, w)
        b, se, G = _ols_cluster(M[:, 0], M[:, 1:], tid, w)
        r = _fmt(b[0], se[0], len(tid), G, xv)
        r["sites"] = int(len(np.unique(sid)))
        out["results"][f"site_fe_{measure}"] = r

        # Within-site at trial level: each site's exposure minus that site's own average, averaged
        # over the trial's sites. Avoids diluting a one-site shock against the whole trial's rate.
        _, g = np.unique(sid, return_inverse=True)
        site_mean = np.bincount(g, weights=xv) / np.bincount(g)
        dev: dict[str, list[float]] = {}
        for t, xd in zip(tid, xv - site_mean[g]):
            dev.setdefault(t, []).append(xd)
        ids = sorted(dev)
        y = np.array([np.log(trials[t]["N"] / (trials[t]["tau"] * trials[t]["n_sites"])) for t in ids])
        x = np.array([np.mean(dev[t]) for t in ids])
        C, _ = _design(trials, ids)
        b, se, G = _ols_cluster(y, np.column_stack([x, np.ones(len(ids)), C]), np.array(ids))
        out["results"][f"within_{measure}"] = _fmt(b[0], se[0], len(ids), G, x)

    primary = out["results"]["within_overlap"]
    out["primary"] = "within_overlap"
    out["model_implied_coef_overlap"] = -1.0
    out["verdict"] = (
        "negative and significant" if primary["coef"] < 0 and primary["p"] < 0.05 else
        "positive and significant" if primary["coef"] > 0 and primary["p"] < 0.05 else "not significant")
    return out


def _fmt(b: float, se: float, n: int, G: int, x: np.ndarray) -> dict:
    from scipy.stats import norm
    z = b / se if se > 0 else 0.0
    return {
        "coef": float(b), "se": float(se), "p": float(2 * norm.sf(abs(z))),
        "ci95": [float(b - 1.96 * se), float(b + 1.96 * se)],
        "pct_per_competitor": float(np.expm1(b) * 100),
        "n_rows": int(n), "clusters": int(G),
        "exposure_mean": float(np.mean(x)), "exposure_p90": float(np.quantile(x, 0.9)),
    }


if __name__ == "__main__":
    res = run()
    con = sqlite3.connect(DB_PATH)
    con.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    con.execute("INSERT OR REPLACE INTO meta VALUES ('congestion_test', ?)", (json.dumps(res),))
    con.commit()
    print(json.dumps(res, indent=2))
