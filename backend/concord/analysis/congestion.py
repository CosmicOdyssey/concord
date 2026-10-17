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

import argparse
import json
import sqlite3
import sys
import time
from bisect import bisect_left
from datetime import date

import numpy as np
from scipy.stats import norm

from concord.model.recruitment import ENROLL_FRACTION
from concord.paths import DB_PATH, ROOT

SE_METHOD = "two-way clustered (trial, site)"
Z95 = 1.96
MEASURE_COL = {"start": 2, "avg": 3, "overlap": 4}  # columns of load()'s rows
# Subsets (V2 section C) and decision rule (section E, thresholds from task F).
S1_MIN_SITE_TRIALS = 10
S2_MAX_SITES = 20
S3_MIN_OVERLAP = 0.8
MIN_TRIALS = 300
MAX_HW_RATIO = 1.5
ALPHA = 0.05
N_SUBSETS = 4
Z_BONF = float(norm.ppf(1 - ALPHA / (2 * N_SUBSETS)))  # 2.498
SUBSET_ROLE = "subset, not the default"


def _months(a: str, b: str) -> float:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days / 30.44


def load(con: sqlite3.Connection, masks: dict[str, np.ndarray] | None = None) -> dict:
    """Trials, trial-site rows and the rival overlaps behind each row.

    masks: eligibility mask per lung trial; default _masks(con) (the production trial_model)."""
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

    masks = _masks(con) if masks is None else masks
    rows = []  # (trial, site, exposure_start, exposure_avg, log1p overlap at start)
    pair_overlaps: dict[tuple[str, str], list[float]] = {}  # o_tQ of each rival Q behind a row
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
            o: list[float] = []
            if mt is not None and mt.sum() > 0:
                denom = float(mt.sum())
                inter = [float((masks[q] & mt).sum()) for q in rivals if q in masks]
                ov = sum(inter) / denom
                o = [c / denom for c in inter]
            pair_overlaps[(t, sid)] = o
            dur = max((date.fromisoformat(e0) - date.fromisoformat(s0)).days, 1)
            overlap_days = 0
            for n, s1, e1 in w:
                if n == t or not (s1 < e0 and e1 > s0):
                    continue
                lo, hi = max(s0, s1), min(e0, e1)
                overlap_days += (date.fromisoformat(hi) - date.fromisoformat(lo)).days
            rows.append((t, sid, at_start, overlap_days / dur, float(np.log1p(ov))))
    return {"trials": trials, "rows": rows, "pair_overlaps": pair_overlaps}


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


def _cr1_meat(codes: np.ndarray, S: np.ndarray, n: int, k: int) -> tuple[np.ndarray, int]:
    """adj * sum_c S_c S_c' over the clusters `codes` (S: one score row per code entry)."""
    _, g = np.unique(codes, return_inverse=True)
    G = int(g.max()) + 1
    if G < 2:
        raise ValueError("two-way clustering needs >= 2 clusters in every dimension")
    agg = np.zeros((G, S.shape[1]))
    np.add.at(agg, g, S)
    return G / (G - 1) * (n - 1) / max(n - k, 1) * (agg.T @ agg), G


def twoway_vcov(scores: np.ndarray, bread: np.ndarray, trial_of_obs: np.ndarray,
                member_obs: np.ndarray, member_site: np.ndarray) -> tuple[np.ndarray, dict]:
    """Two-way (trial, site) cluster-robust variance, CGM (2011), with multi-membership.

    scores        (n, k) per-observation scores w_i x_i e_i
    bread         (X'WX)^-1
    trial_of_obs  (n,) trial id of each observation
    member_obs,   incidence pairs: observation member_obs[j] belongs to site member_site[j]. A
    member_site   trial-site row has one pair; a trial-level observation one pair per site.
    V = V_trial + V_site - V_trial&site, CR1 factor per dimension, negative eigenvalues clipped to 0.
    """
    n, k = scores.shape
    member_obs = np.asarray(member_obs)
    _, t_code = np.unique(trial_of_obs, return_inverse=True)
    _, s_code = np.unique(member_site, return_inverse=True)
    if not np.array_equal(np.unique(member_obs), np.arange(n)):
        raise ValueError("every observation needs at least one site")
    M_t, G_t = _cr1_meat(t_code, scores, n, k)
    S = scores[member_obs]
    M_s, G_s = _cr1_meat(s_code, S, n, k)
    M_ts, G_ts = _cr1_meat(t_code[member_obs].astype(np.int64) * (int(s_code.max()) + 1) + s_code, S, n, k)
    V = bread @ (M_t + M_s - M_ts) @ bread
    V = (V + V.T) / 2
    ev, vec = np.linalg.eigh(V)
    V = (vec * np.clip(ev, 0, None)) @ vec.T
    return V, {"clusters_site": G_s, "clusters_trial_site": G_ts, "negative_eigenvalues_clipped": int((ev < 0).sum())}


def _ols_twoway(y, X, trial_ids, member_obs, member_site, w=None):
    """Weighted OLS with two-way (trial, site) clustered standard errors (see twoway_vcov)."""
    w = np.ones(len(y)) if w is None else w
    sw = np.sqrt(w)
    Xw, yw = X * sw[:, None], y * sw
    XtX_inv = np.linalg.pinv(Xw.T @ Xw)
    beta = XtX_inv @ Xw.T @ yw
    u = yw - Xw @ beta
    V, info = twoway_vcov(Xw * u[:, None], XtX_inv, np.asarray(trial_ids), member_obs, np.asarray(member_site))
    return beta, np.sqrt(np.clip(np.diag(V), 0, None)), info


def _demean(M: np.ndarray, groups: np.ndarray, w: np.ndarray) -> np.ndarray:
    _, g = np.unique(groups, return_inverse=True)
    sums = np.zeros((g.max() + 1, M.shape[1]))
    np.add.at(sums, g, M * w[:, None])
    wsum = np.bincount(g, weights=w)
    return M - sums[g] / wsum[g][:, None]


def _y(trials: dict, t: str) -> float:
    return float(np.log(trials[t]["N"] / (trials[t]["tau"] * trials[t]["n_sites"])))


def _fit(y, X, trial_ids, member_obs, member_site, w, x, n_rows: int, trial_site_rows: int) -> dict:
    """Coefficient on X[:, 0] with two-way (primary) and trial-only (CR1) standard errors."""
    b, se1, G = _ols_cluster(y, X, trial_ids, w)
    _, se2, info = _ols_twoway(y, X, trial_ids, member_obs, member_site, w)
    r = _fmt(b[0], se2[0], n_rows, G, x)
    t = _fmt(b[0], se1[0], n_rows, G, x)
    r.update(se_trial_only=t["se"], ci95_trial_only=t["ci95"], p_trial_only=t["p"],
             trial_site_rows=int(trial_site_rows), **info)
    return r


def estimate(trials: dict, rows: list[tuple[str, str, float]]) -> dict:
    """pooled / site_fe / within for one exposure, on (trial, site, exposure) rows."""
    out: dict = {}

    # Pooled, trial level: mean exposure across the trial's (named) sites.
    expo: dict[str, list[float]] = {}
    sites_of: dict[str, list[str]] = {}
    for t, s, x in rows:
        expo.setdefault(t, []).append(x)
        sites_of.setdefault(t, []).append(s)
    ids = sorted(expo)
    y = np.array([_y(trials, t) for t in ids])
    x = np.array([np.mean(expo[t]) for t in ids])
    C, _ = _design(trials, ids)
    mo = np.array([i for i, t in enumerate(ids) for _ in sites_of[t]])
    ms = np.array([s for t in ids for s in sites_of[t]])
    out["pooled"] = _fit(y, np.column_stack([x, np.ones(len(ids)), C]), np.array(ids), mo, ms, None, x,
                         len(ids), len(rows))

    # Site fixed effects, trial-site rows weighted so each trial counts once.
    sub = [r for r in rows if r[0] in trials]
    tid = np.array([r[0] for r in sub])
    sid = np.array([r[1] for r in sub])
    # Keep sites with >= 2 trials: singletons carry no within-site variation.
    _, inv, cnt = np.unique(sid, return_inverse=True, return_counts=True)
    keep = cnt[inv] >= 2
    tid, sid = tid[keep], sid[keep]
    sub = [r for r, kp in zip(sub, keep) if kp]
    yv = np.array([_y(trials, t) for t in tid])
    xv = np.array([r[2] for r in sub], dtype=float)
    Cv, _ = _design(trials, list(tid))
    w = np.array([1.0 / trials[t]["n_sites"] for t in tid])
    M = _demean(np.column_stack([yv, xv, Cv]), sid, w)
    r = _fit(M[:, 0], M[:, 1:], tid, np.arange(len(tid)), sid, w, xv, len(tid), len(tid))
    r["sites"] = int(len(np.unique(sid)))
    out["site_fe"] = r

    # Within-site at trial level: each site's exposure minus that site's own average, averaged
    # over the trial's sites. Avoids diluting a one-site shock against the whole trial's rate.
    _, g = np.unique(sid, return_inverse=True)
    site_mean = np.bincount(g, weights=xv) / np.bincount(g)
    dev: dict[str, list[float]] = {}
    dsites: dict[str, list[str]] = {}
    for t, s, xd in zip(tid, sid, xv - site_mean[g]):
        dev.setdefault(t, []).append(xd)
        dsites.setdefault(t, []).append(s)
    ids = sorted(dev)
    y = np.array([_y(trials, t) for t in ids])
    x = np.array([np.mean(dev[t]) for t in ids])
    C, _ = _design(trials, ids)
    mo = np.array([i for i, t in enumerate(ids) for _ in dsites[t]])
    ms = np.array([s for t in ids for s in dsites[t]])
    r = _fit(y, np.column_stack([x, np.ones(len(ids)), C]), np.array(ids), mo, ms, None, x, len(ids), len(tid))
    r["sites"] = int(len(np.unique(sid)))
    out["within"] = r
    return out


def _fmt(b: float, se: float, n: int, G: int, x: np.ndarray) -> dict:
    z = b / se if se > 0 else 0.0
    return {
        "coef": float(b), "se": float(se), "p": float(2 * norm.sf(abs(z))),
        "ci95": [float(b - Z95 * se), float(b + Z95 * se)],
        "pct_per_competitor": float(np.expm1(b) * 100),
        "n_rows": int(n), "clusters": int(G),
        "exposure_mean": float(np.mean(x)), "exposure_p90": float(np.quantile(x, 0.9)),
    }


# ---------------------------------------------------------------------------------------- subsets

def prior_lung_trials(con: sqlite3.Connection, trials: dict, rows: list) -> list[int]:
    """Per row (t, s): lung trials at s (any status) that started strictly before t (S1p)."""
    starts: dict[str, list[str]] = {}
    for sid, s in con.execute("""SELECT ts.site_id, t.start_date FROM trial_sites ts JOIN trials t USING(nct_id)
                                 WHERE t.is_lung=1 AND t.start_date IS NOT NULL"""):
        starts.setdefault(sid, []).append(s)
    for v in starts.values():
        v.sort()
    return [bisect_left(starts.get(r[1], []), trials[r[0]]["start"]) for r in rows]


def subset_rows(con: sqlite3.Connection, d: dict) -> tuple[dict, dict]:
    """(trial, site, overlap exposure) rows of each subset, and diagnostics."""
    trials, rows, pairs = d["trials"], d["rows"], d["pair_overlaps"]
    k = MEASURE_COL["overlap"]
    prior = prior_lung_trials(con, trials, rows)
    n_hist = dict(con.execute("SELECT site_id, n_hist FROM site_model"))
    s3_x = [float(np.log1p(sum(o for o in pairs[(r[0], r[1])] if o >= S3_MIN_OVERLAP))) for r in rows]
    rebuilt = np.array([np.log1p(sum(pairs[(r[0], r[1])])) for r in rows])
    sanity = float(np.max(np.abs(rebuilt - np.array([r[k] for r in rows]))))
    assert sanity < 1e-9, sanity
    out = {
        "S1p": [(r[0], r[1], r[k]) for r, c in zip(rows, prior) if c >= S1_MIN_SITE_TRIALS],
        "S1": [(r[0], r[1], r[k]) for r in rows if (n_hist.get(r[1]) or 0) >= S1_MIN_SITE_TRIALS],
        "S2": [(r[0], r[1], r[k]) for r in rows if trials[r[0]]["n_sites"] <= S2_MAX_SITES],
        "S3": [(r[0], r[1], x) for r, x in zip(rows, s3_x)],
    }
    lifetime = np.array([(n_hist.get(r[1]) or 0) >= S1_MIN_SITE_TRIALS for r in rows])
    predet = np.array([c >= S1_MIN_SITE_TRIALS for c in prior])
    n_pairs = sum(len(v) for v in pairs.values())
    diag = {key: {"rows_kept": len(v), "rows_full": len(rows), "trials_with_rows": len({r[0] for r in v})}
            for key, v in out.items()}
    diag["S1p"]["rows_also_in_S1"] = int((predet & lifetime).sum())
    diag["S1p"]["rows_in_S1_not_S1p"] = int((lifetime & ~predet).sum())
    diag["S3"].update(
        share_rows_nonzero_exposure=float(np.mean(np.array(s3_x) > 0)),
        share_rows_nonzero_exposure_full=float(np.mean(np.array([r[k] for r in rows]) > 0)),
        rival_pairs=n_pairs,
        rival_pairs_overlap_ge_threshold=sum(sum(o >= S3_MIN_OVERLAP for o in v) for v in pairs.values()),
        rebuild_max_abs_diff_no_threshold=sanity)
    return out, diag


SUBSET_INFO = {
    "S1p": {"label": "Experienced sites (predetermined)", "predetermined": True,
            "definition": f"rows at sites with >= {S1_MIN_SITE_TRIALS} lung trials (any status) whose start date "
                          "is strictly before the focal trial's start date"},
    "S1": {"label": "Experienced sites (lifetime count)", "predetermined": False,
           "definition": f"rows at sites with site_model.n_hist >= {S1_MIN_SITE_TRIALS} lung trials over all time; "
                         "uses later trials; not predetermined"},
    "S2": {"label": f"Trials with <= {S2_MAX_SITES} sites", "predetermined": True,
           "definition": f"rows of trials with <= {S2_MAX_SITES} registered sites (trials.n_sites)"},
    "S3": {"label": f"High-overlap competitors only (o >= {S3_MIN_OVERLAP})", "predetermined": True,
           "definition": f"all rows; exposure = log(1 + sum of eligibility overlaps o_tQ >= {S3_MIN_OVERLAP})"},
}


def _bonf(c: dict) -> list[float]:
    return [c["coef"] - Z_BONF * c["se"], c["coef"] + Z_BONF * c["se"]]


def decide(full_within: dict, subsets: dict) -> dict:
    """Pre-registered rule (section E) on the within_overlap estimates; never changes the default."""
    f = full_within
    f_hw = Z95 * f["se"]
    checks = {}
    for key, sub in subsets.items():
        c = sub["within"]
        hw = Z95 * c["se"]
        lo, hi = c["ci95"]
        blo, bhi = _bonf(c)
        excl = not (lo <= f["coef"] <= hi)
        powered = c["clusters"] >= MIN_TRIALS and hw <= MAX_HW_RATIO * f_hw
        checks[key] = {
            "ci_excludes_full_estimate": bool(excl),
            "trials": int(c["clusters"]), "enough_trials": bool(c["clusters"] >= MIN_TRIALS),
            "ci_half_width": float(hw), "full_ci_half_width": float(f_hw), "half_width_ratio": float(hw / f_hw),
            "well_powered": bool(powered), "meets_rule": bool(excl and powered),
            "bonferroni_ci_excludes_full_estimate": bool(not (blo <= f["coef"] <= bhi)),
            "bonferroni_ci_excludes_zero": bool(blo > 0 or bhi < 0),
            "ci_excludes_zero": bool(lo > 0 or hi < 0),
            "direction_vs_full": "more negative" if c["coef"] < f["coef"] else "less negative or positive",
            "predetermined": SUBSET_INFO[key]["predetermined"],
        }
    hits = [k for k, ch in checks.items() if ch["meets_rule"]]
    return {
        "checks": checks, "subsets_meeting_rule": hits, "default_changed": False,
        "action": ("flag for review: " + ", ".join(hits) + " meet(s) the rule; the default stays the full-sample "
                   "estimate and subset estimates are labelled '" + SUBSET_ROLE + "'") if hits else
                  "no subset meets the rule; the default stays the full-sample estimate",
        "rule": {"ci": "two-way 95% CI of within_overlap excludes the full-sample point estimate",
                 "min_trials": MIN_TRIALS, "max_half_width_ratio": MAX_HW_RATIO, "z95": Z95,
                 "z_bonferroni": Z_BONF, "k": N_SUBSETS},
    }


def _short(c: dict) -> dict:
    keys = ("coef", "se", "ci95", "p", "clusters", "n_rows", "trial_site_rows", "se_trial_only",
            "ci95_trial_only", "p_trial_only", "clusters_site")
    return {k: c[k] for k in keys if k in c}


def multiple_comparisons(full_within: dict, subsets: dict) -> dict:
    f = full_within["coef"]
    b = {k: _bonf(s["within"]) for k, s in subsets.items()}
    ex0 = [k for k, (lo, hi) in b.items() if lo > 0 or hi < 0]
    exf = [k for k, (lo, hi) in b.items() if not (lo <= f <= hi)]
    names = lambda ks: ", ".join(ks) if ks else "none"  # noqa: E731
    note = (f"{N_SUBSETS} subsets were tested, so each subset's within-site CI is also shown at the Bonferroni "
            f"level (alpha {ALPHA}/{N_SUBSETS}, z = {Z_BONF:.2f}); at that level the CIs that exclude zero: "
            f"{names(ex0)}; that exclude the full-sample estimate {f:+.3f}: {names(exf)}.")
    return {"method": "Bonferroni", "k": N_SUBSETS, "alpha": ALPHA, "z": Z_BONF, "estimator": "within_overlap",
            "se_method": SE_METHOD, "note": note, "bonferroni_ci95": b}


# ------------------------------------------------------------------------------ parser sensitivity

def within_sample(rows: list) -> set[str]:
    """Trials in the within / site_fe sample: a row at a site with >= 2 rows."""
    n_at: dict[str, int] = {}
    for r in rows:
        n_at[r[1]] = n_at.get(r[1], 0) + 1
    return {r[0] for r in rows if n_at[r[1]] >= 2}


def parser_sensitivity(con: sqlite3.Connection, production_masks: dict[str, np.ndarray]) -> tuple[list, dict]:
    """Full-sample within_overlap under each historical parser (section D), and the production reference."""
    from concord.analysis import parser_versions as pv
    from concord.compiler.overrides import OVERRIDES

    def one(masks: dict) -> dict:
        d = load(con, masks=masks)
        res = estimate(d["trials"], [(r[0], r[1], r[4]) for r in d["rows"]])
        w = res["within"]
        sample = within_sample(d["rows"])
        assert len(sample) == w["clusters"], (len(sample), w["clusters"])
        return {"within_overlap": _short(w),
                "site_fe_overlap": _short(res["site_fe"]), "pooled_overlap": _short(res["pooled"]),
                "empty_masks": int(sum(1 for m in masks.values() if not m.any())),
                "empty_masks_analysis_trials": int(sum(1 for t in sample if t in masks and not masks[t].any())),
                "lung_trials_compiled": len(masks)}

    out = []
    for v in pv.VERSIONS:
        mods = pv.load_version(v["commit"])
        masks = pv.compile_masks(con, mods)
        out.append({**v, "overrides": False, "source_matches_working_tree": pv.source_matches_working_tree(v["commit"]),
                    **one(masks)})
    cur = pv.VERSIONS[-1]
    masks = pv.compile_masks(con, pv.load_version(cur["commit"]), overrides=OVERRIDES)
    differ = sum(1 for n, m in masks.items() if n not in production_masks or not np.array_equal(m, production_masks[n]))
    differ += sum(1 for n in production_masks if n not in masks)
    ref = {"parser_version": f"{cur['parser_version']}+overrides", "commit": cur["commit"],
           "description": f"production: {cur['parser_version']} plus the hand-encoded overrides "
                          f"({len(OVERRIDES)} trials); reference, not a parser version",
           "overrides": True, "n_overrides": len(OVERRIDES),
           "masks_differing_from_trial_model": int(differ), **one(masks)}
    return out, ref


# ------------------------------------------------------------------------------------------- run

def run(con: sqlite3.Connection | None = None, with_parser_sensitivity: bool = True) -> dict:
    t0 = time.time()
    con = con or sqlite3.connect(DB_PATH)
    production_masks = _masks(con)
    d = load(con, masks=production_masks)
    trials, rows = d["trials"], d["rows"]
    out: dict = {"task": "congestion test v2: two-way clustered SEs, predetermined subsets, parser sensitivity",
                 "n_trials": len(trials), "n_trial_sites": len(rows), "se_method": SE_METHOD, "results": {}}

    for measure in ("start", "overlap", "avg"):
        k = MEASURE_COL[measure]
        res = estimate(trials, [(r[0], r[1], r[k]) for r in rows])
        for est in ("pooled", "site_fe", "within"):
            out["results"][f"{est}_{measure}"] = res[est]

    primary = out["results"]["within_overlap"]
    out["primary"] = "within_overlap"
    out["model_implied_coef_overlap"] = -1.0
    out["verdict"] = (
        "negative and significant" if primary["coef"] < 0 and primary["p"] < 0.05 else
        "positive and significant" if primary["coef"] > 0 and primary["p"] < 0.05 else "not significant")

    srows, diag = subset_rows(con, d)
    subsets = {}
    for key, rs in srows.items():
        res = estimate(trials, rs)
        subsets[key] = {"label": SUBSET_INFO[key]["label"], "definition": SUBSET_INFO[key]["definition"],
                        "role": SUBSET_ROLE, "is_default": False, "predetermined": SUBSET_INFO[key]["predetermined"],
                        "within": res["within"], "site_fe": res["site_fe"], "pooled": res["pooled"],
                        "bonferroni_ci95_within": _bonf(res["within"]), "diagnostics": diag[key]}
    out["subsets"] = subsets
    out["subset_decision"] = decide(primary, subsets)
    for key, ch in out["subset_decision"]["checks"].items():
        subsets[key]["decision"] = ch
    out["multiple_comparisons"] = multiple_comparisons(primary, subsets)

    if with_parser_sensitivity:
        out["parser_sensitivity"], out["parser_sensitivity_reference"] = parser_sensitivity(con, production_masks)

    lo, hi = primary["ci95"]
    out["default_beta"] = {
        "value": -primary["coef"], "source": "full-sample within_overlap", "ci95": [-hi, -lo],
        "ci95_scale": "beta = -coef; service.congestion_beta clips both at 0", "se_method": SE_METHOD,
        "note": "subset estimates are reported separately and are not used as the default",
        "subsets_meeting_rule": out["subset_decision"]["subsets_meeting_rule"]}
    out["seconds"] = round(time.time() - t0, 1)
    return out


def reproduction_check(new: dict, prev: dict | None) -> dict:
    """Section B: coef and trial-only se of all nine estimators vs the previously stored meta."""
    if not prev:
        return {"compared": False}
    diffs = {}
    for key, r in new["results"].items():
        p = prev["results"].get(key)
        if p is None:
            continue
        diffs[key] = max(abs(r["coef"] - p["coef"]), abs(r["se_trial_only"] - p.get("se_trial_only", p["se"])),
                         float(r["n_rows"] != p["n_rows"]), float(r["clusters"] != p["clusters"]))
    return {"compared": True, "estimators": len(diffs), "max_abs_diff": max(diffs.values()) if diffs else None,
            "by_estimator": diffs}


def _line(name: str, c: dict) -> str:
    ci = lambda v: f"[{v[0]:+.4f}, {v[1]:+.4f}]"  # noqa: E731
    return (f"{name:16s} {c['coef']:+.4f}  2way {ci(c['ci95'])} p={c['p']:.3f}  "
            f"trial-only {ci(c['ci95_trial_only'])} p={c['p_trial_only']:.3f}  "
            f"trials={c['clusters']} sites={c.get('clusters_site')} rows={c.get('trial_site_rows')}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "data" / "robustness" / "congestion_v2.json"))
    a = ap.parse_args()
    con = sqlite3.connect(DB_PATH)
    prev = con.execute("SELECT value FROM meta WHERE key='congestion_test'").fetchone() \
        if con.execute("SELECT 1 FROM sqlite_master WHERE name='meta'").fetchone() else None
    res = run(con)
    res["reproduction_vs_previous_meta"] = rep = reproduction_check(res, json.loads(prev[0]) if prev else None)
    assert not rep["compared"] or rep["max_abs_diff"] < 1e-9, rep
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(res, fh, indent=2)
    con.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    con.execute("INSERT OR REPLACE INTO meta VALUES ('congestion_test', ?)", (json.dumps(res),))
    con.commit()
    for key, c in res["results"].items():
        print(_line(key, c))
    for key, s in res["subsets"].items():
        print(_line(key, s["within"]), "bonf", [round(v, 4) for v in s["bonferroni_ci95_within"]],
              "meets" if s["decision"]["meets_rule"] else "-")
    for v in res.get("parser_sensitivity", []) + [res.get("parser_sensitivity_reference")]:
        if v:
            print(_line(v["parser_version"], v["within_overlap"]), "empty", v["empty_masks"])
    print(json.dumps({k: res[k] for k in ("multiple_comparisons", "default_beta")}, indent=2))
    print(json.dumps(res["subset_decision"]["action"]), json.dumps(rep["max_abs_diff"]))
    print(f"wrote {a.out} and meta congestion_test of {DB_PATH} in {res['seconds']} s")


if __name__ == "__main__":
    main()
