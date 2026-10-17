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
            rows weighted 1/|S_t| so each trial counts once, SEs clustered by trial
Controls: phase dummies, log site count, industry sponsor, start-year fixed effects.
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
