"""Hierarchical Poisson–gamma site rates from trial-level enrollment (master doc §4.2, §5).

CT.gov only reports enrollment per trial, so site rates are identified weakly:

    N_t ~ Poisson( sum_{s in S_t} lam_s * e_ts ),   lam_s ~ Gamma(alpha, beta)
    e_ts = tau_t * (f_t / f_ref) / (1 + o_bar * c_ts)

tau_t is the enrollment window in months, f_t the trial's eligible fraction on the
synthetic population, and c_ts the number of other lung trials recruiting at s at the
same time. Dividing out f and congestion makes lam_s the site's *uncongested flow for a
reference-eligibility trial*, which is the lam_s that equation (2) needs.

Fit by EM: the E-step splits each trial's enrollment across its sites in proportion
to lam_s * e_ts; the M-step takes the gamma posterior mean. Empirical-Bayes alpha, beta
come from the method of moments on trial-level per-site rates.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import date

import numpy as np
from scipy.stats import gamma as gamma_dist

ENROLL_FRACTION = 0.65  # share of start->primary-completion spent enrolling (assumption)
# Mean pairwise overlap used to de-congest historical rates. 0 by default: on the
# 2018-cutoff backtest, de-congesting (and dividing out regex-parsed eligibility)
# made held-out predictions worse, so the fit uses raw exposure and both effects
# enter only in the counterfactual allocation. See README "Backtest".
O_BAR = 0.0
MIN_TAU_MONTHS = 1.0


def _months(a: str | None, b: str | None) -> float | None:
    if not a or not b:
        return None
    da, db = date.fromisoformat(a), date.fromisoformat(b)
    return (db - da).days / 30.44


@dataclass
class History:
    trial_ids: list[str]
    N: np.ndarray
    tau: np.ndarray
    start: list[str]
    end: list[str]
    f_rel: np.ndarray
    links: list[tuple[int, int, float]]  # (trial index, site index, exposure e_ts)
    site_ids: list[str]


def load_history(con: sqlite3.Connection, f_lookup: dict[str, float] | None = None, before: str | None = None,
                 after: str | None = None) -> History:
    """Trials with ACTUAL enrollment and ACTUAL primary completion, optionally filtered by start date."""
    q = """SELECT nct_id, enrollment, start_date, primary_completion_date FROM trials
           WHERE is_lung=1 AND enrollment_type='ACTUAL' AND enrollment>0 AND primary_completion_type='ACTUAL'
             AND start_date IS NOT NULL AND primary_completion_date IS NOT NULL AND n_sites>0"""
    rows = []
    for nct, n, s, e in con.execute(q):
        if before and s >= before:
            continue
        if after and s < after:
            continue
        tau = _months(s, e)
        if tau is None or tau < MIN_TAU_MONTHS / ENROLL_FRACTION:
            continue
        rows.append((nct, n, s, e, tau * ENROLL_FRACTION))
    t_index = {r[0]: i for i, r in enumerate(rows)}
    f_lookup = f_lookup or {}
    f_rel = np.array([f_lookup.get(r[0], 1.0) for r in rows])

    # Concurrency c_ts: other lung trials whose [start, primary completion] overlaps t's, at the same site.
    all_windows = {nct: (s, e) for nct, s, e in con.execute(
        "SELECT nct_id, start_date, COALESCE(primary_completion_date, completion_date) FROM trials "
        "WHERE is_lung=1 AND start_date IS NOT NULL")}
    by_site: dict[str, list[str]] = {}
    for nct, sid in con.execute("SELECT nct_id, site_id FROM trial_sites"):
        by_site.setdefault(sid, []).append(nct)

    site_ids: list[str] = []
    s_index: dict[str, int] = {}
    links = []
    for sid, ncts in by_site.items():
        mine = [n for n in ncts if n in t_index]
        if not mine:
            continue
        si = s_index.setdefault(sid, len(site_ids))
        if si == len(site_ids):
            site_ids.append(sid)
        windows = [all_windows[n] for n in ncts if n in all_windows and all_windows[n][1]]
        for nct in mine:
            ti = t_index[nct]
            s0, e0 = rows[ti][2], rows[ti][3]
            c = sum(1 for (s1, e1) in windows if s1 < e0 and e1 > s0) - 1
            e_ts = rows[ti][4] * f_rel[ti] / (1.0 + O_BAR * max(c, 0))
            links.append((ti, si, e_ts))
    return History([r[0] for r in rows], np.array([r[1] for r in rows], float), np.array([r[4] for r in rows]),
                   [r[2] for r in rows], [r[3] for r in rows], f_rel, links, site_ids)


@dataclass
class SiteRates:
    site_ids: list[str]
    shape: np.ndarray  # posterior gamma shape
    rate: np.ndarray  # posterior gamma rate (exposure-months)
    alpha: float
    beta: float

    @property
    def mean(self) -> np.ndarray:
        return self.shape / self.rate

    @property
    def median(self) -> np.ndarray:
        # Posteriors are right-skewed (weak prior, one fast trial can dominate); the
        # median predicts held-out trials better than the mean.
        return gamma_dist.ppf(0.5, self.shape, scale=1.0 / self.rate)

    def lookup(self) -> dict[str, tuple[float, float]]:
        return {s: (a, b) for s, a, b in zip(self.site_ids, self.shape, self.rate)}


def fit(h: History, iters: int = 3) -> SiteRates:
    """Few EM steps on purpose: full convergence drives sites that co-occur with fast trials
    to ~0 (the split is weakly identified) and was no better on the backtest (0.880 vs 0.879)."""
    ti = np.array([l[0] for l in h.links])
    si = np.array([l[1] for l in h.links])
    e = np.array([l[2] for l in h.links])
    S = len(h.site_ids)

    # Empirical Bayes prior from trial-level per-site rates.
    exposure_t = np.bincount(ti, weights=e, minlength=len(h.N))
    ok = exposure_t > 0
    r = h.N[ok] / exposure_t[ok]
    lo, hi = np.quantile(r, [0.05, 0.95])
    trim = (r >= lo) & (r <= hi)  # a few single-site mega-trials and mis-parsed f's dominate raw moments
    rt, et = r[trim], exposure_t[ok][trim]
    mu = float(np.mean(rt))
    noise = float(np.mean(rt / et))  # Poisson part of the spread
    var = float(np.clip(np.var(rt) - noise, mu * mu / 10, mu * mu * 4))  # shape alpha in [0.25, 10]
    alpha, beta = mu * mu / var, mu / var

    lam = np.full(S, mu)
    sum_e = np.bincount(si, weights=e, minlength=S)
    for _ in range(iters):
        w = lam[si] * e
        denom = np.bincount(ti, weights=w, minlength=len(h.N))
        n_hat = h.N[ti] * w / np.maximum(denom[ti], 1e-12)
        shape = alpha + np.bincount(si, weights=n_hat, minlength=S)
        rate = beta + sum_e
        new = shape / rate
        if np.max(np.abs(new - lam) / np.maximum(lam, 1e-9)) < 1e-6:
            lam = new
            break
        lam = new
    return SiteRates(h.site_ids, shape, rate, alpha, beta)


def subset_history(h: History, keep) -> History:
    """History restricted to trials for which keep(nct_id) is True. Site indexing is unchanged, so
    sites with no trials in the subset are simply unseen (no exposure)."""
    idx = [i for i, t in enumerate(h.trial_ids) if keep(t)]
    remap = {old: new for new, old in enumerate(idx)}
    links = [(remap[t], s, e) for t, s, e in h.links if t in remap]
    return History([h.trial_ids[i] for i in idx], h.N[idx], h.tau[idx], [h.start[i] for i in idx],
                   [h.end[i] for i in idx], h.f_rel[idx], links, h.site_ids)


def fit_rate_table(con: sqlite3.Connection, keep=None, label: str = "full history") -> dict:
    """Fit site rates on the history trials for which keep(nct_id) is True (all if None), with the
    same estimator as the build (effective_rates). Used to choose allocations with one set of
    trials and score them with another (concord.service.build(rates=...))."""
    hist = load_history(con)
    if keep is not None:
        hist = subset_history(hist, keep)
    rates = fit(hist)
    n_hist = np.bincount([l[1] for l in hist.links], minlength=len(hist.site_ids))
    lam_eff, unseen = effective_rates(rates, n_hist)
    return {"label": label, "n_trials": len(hist.N),
            "lam_eff": dict(zip(hist.site_ids, map(float, lam_eff))),
            "lam_mean": dict(zip(hist.site_ids, map(float, rates.mean))),
            "n_hist": dict(zip(hist.site_ids, map(int, n_hist))),
            "unseen": float(unseen), "unseen_mean": float(rates.alpha / rates.beta),
            "prior": {"alpha": rates.alpha, "beta": rates.beta}}


def split_alternating(con: sqlite3.Connection) -> dict[str, str]:
    """Two halves of the fit history such that sites have data in both. Trials are taken in start
    order; each goes to the half its sites have seen less of (sum over its sites of count_A -
    count_B), ties alternating. Single-site trials therefore alternate exactly within a site;
    multi-site trials balance their sites in aggregate. Fixed before any holdout result was seen."""
    hist = load_history(con)
    sites_of: dict[int, list[int]] = {}
    for ti, si, _ in hist.links:
        sites_of.setdefault(ti, []).append(si)
    order = sorted(range(len(hist.trial_ids)), key=lambda i: (hist.start[i], hist.trial_ids[i]))
    bal = np.zeros(len(hist.site_ids))
    out = {}
    for k, i in enumerate(order):
        ss = sites_of.get(i, [])
        score = float(bal[ss].sum()) if ss else 0.0
        half = "B" if score > 0 else "A" if score < 0 else ("A" if k % 2 == 0 else "B")
        out[hist.trial_ids[i]] = half
        if ss:
            bal[ss] += 1.0 if half == "A" else -1.0
    return out


def split_time(con: sqlite3.Connection) -> dict[str, str]:
    """A = fit-history trials that started before the median start date, B = the rest."""
    hist = load_history(con)
    cut = sorted(hist.start)[len(hist.start) // 2]
    return {t: ("A" if s < cut else "B") for t, s in zip(hist.trial_ids, hist.start)}


def split_coverage(con: sqlite3.Connection, split: dict[str, str], site_ids=None) -> dict:
    """How many sites (optionally restricted to site_ids) have fit trials in both halves."""
    hist = load_history(con)
    seen: dict[str, set] = {}
    for ti, si, _ in hist.links:
        seen.setdefault(hist.site_ids[si], set()).add(split.get(hist.trial_ids[ti]))
    keys = list(site_ids) if site_ids is not None else list(seen)
    with_hist = [s for s in keys if s in seen]
    both = [s for s in with_hist if {"A", "B"} <= seen[s]]
    return {"sites": len(keys), "sites_with_history": len(with_hist), "sites_in_both_halves": len(both),
            "trials_A": sum(v == "A" for v in split.values()), "trials_B": sum(v == "B" for v in split.values())}


def predict_months(N: float, lam_sum: float) -> float:
    return N / lam_sum if lam_sum > 0 else float("inf")


LOW_HISTORY_N = 3  # sites with fewer lung trials than this are "low history"
LOW_HISTORY_Q = 0.25  # ...and get at most this quantile of the prior


def effective_rates(rates: SiteRates, n_hist: np.ndarray) -> tuple[np.ndarray, float]:
    """Posterior mean, except low-history sites are capped at the prior's 25th percentile, which is
    also the rate for unseen sites. On the backtest this cut industry Phase II/III error from 1.09 to
    0.67 and the bias from -0.92 to -0.09: the raw model's optimism came from sites it barely knew."""
    floor = float(gamma_dist.ppf(LOW_HISTORY_Q, rates.alpha, scale=1.0 / rates.beta))
    lam = np.where(n_hist < LOW_HISTORY_N, np.minimum(rates.mean, floor), rates.mean)
    return lam, floor


def backtest(con: sqlite3.Connection, cutoff: str = "2018-01-01", f_lookup: dict[str, float] | None = None) -> dict:
    """Fit on trials that started before `cutoff`; predict enrollment duration for trials that
    started after it. Model: effective_rates (posterior mean, low-history sites capped). Variant
    "raw": posterior mean with the prior for unseen sites. Baseline: median per-site-month rate."""
    train = load_history(con, f_lookup, before=cutoff)
    rates = fit(train)
    test = load_history(con, f_lookup, after=cutoff)
    n_hist = np.bincount([l[1] for l in train.links], minlength=len(train.site_ids))
    lam_eff, unseen = effective_rates(rates, n_hist)
    models = {
        "model": (dict(zip(rates.site_ids, lam_eff)), unseen),
        "raw": (dict(zip(rates.site_ids, rates.mean)), rates.alpha / rates.beta),
    }

    per_trial_e: dict[int, list[tuple[int, float]]] = {}
    for ti, si, e in test.links:
        per_trial_e.setdefault(ti, []).append((si, e))
    train_exposure = np.bincount([l[0] for l in train.links], weights=[l[2] for l in train.links],
                                 minlength=len(train.N))
    naive_rate = float(np.median(train.N[train_exposure > 0] / train_exposure[train_exposure > 0]))
    kind = {n: (c == "INDUSTRY" and ("PHASE2" in ph or "PHASE3" in ph), "PHASE3" in ph) for n, c, ph in
            con.execute("SELECT nct_id, sponsor_class, phases FROM trials")}

    # bias[name][subset] = list of log(pred / actual); > 0 means predicted too slow.
    bias = {m: {"all": [], "industry_p23": [], "industry_p3": []} for m in (*models, "naive")}
    pred_log_rate, true_log_rate, known_share = [], [], []
    for i in range(len(test.N)):
        sites = per_trial_e.get(i, [])
        if not sites:
            continue
        scale = [(e / test.tau[i]) for _, e in sites]
        truth = test.tau[i]
        ind23, p3 = kind.get(test.trial_ids[i], (False, False))
        known_share.append(np.mean([test.site_ids[si] in models["model"][0] for si, _ in sites]))
        sums = {name: sum(lk.get(test.site_ids[si], dflt) * sc for (si, _), sc in zip(sites, scale))
                for name, (lk, dflt) in models.items()}
        sums["naive"] = naive_rate * sum(scale)
        for name, lam_sum in sums.items():
            b = float(np.log(predict_months(test.N[i], lam_sum) / truth))
            bias[name]["all"].append(b)
            if ind23:
                bias[name]["industry_p23"].append(b)
                if p3:
                    bias[name]["industry_p3"].append(b)
        if ind23:
            pred_log_rate.append(np.log(sums["model"] / sum(scale)))
            true_log_rate.append(np.log(test.N[i] / truth / sum(scale)))

    def summ(name: str) -> dict:
        return {sub: {"median_abs_log_error": float(np.median(np.abs(v))), "median_signed_log_bias": float(np.median(v)),
                      "n": len(v)} for sub, v in bias[name].items() if v}

    em, en = np.abs(bias["model"]["all"]), np.abs(bias["naive"]["all"])
    return {
        "cutoff": cutoff,
        "train_trials": len(train.N),
        "test_trials": int(len(em)),
        "median_abs_log_error_model": float(np.median(em)),
        "median_abs_log_error_naive": float(np.median(en)),
        "model_beats_naive_share": float(np.mean(em < en)),
        "median_share_of_test_sites_seen_in_train": float(np.median(known_share)),
        "by_model": {name: summ(name) for name in bias},
        # Slope of log actual on log predicted per-site rate (industry Ph II/III). Below 1 would mean
        # predicted differences between site mixes are exaggerated (selection optimism).
        "calibration_slope_industry_p23": _slope(pred_log_rate, true_log_rate),
        "level_log_bias_industry_p23": float(np.median(bias["model"]["industry_p23"])),
        "low_history_rule": {"n_below": LOW_HISTORY_N, "prior_quantile": LOW_HISTORY_Q, "rate": unseen},
        "note": "abs log error of predicted vs actual enrollment duration; exp(0.69)=2x off",
    }


def _slope(x: list[float], y: list[float]) -> dict:
    x, y = np.asarray(x), np.asarray(y)
    if len(x) < 10:
        return {"slope": 1.0, "n": int(len(x))}
    xc = x - x.mean()
    b = float(xc @ (y - y.mean()) / (xc @ xc))
    resid = y - y.mean() - b * xc
    se = float(np.sqrt(resid @ resid / (len(x) - 2) / (xc @ xc)))
    return {"slope": b, "se": se, "n": int(len(x)), "mean_log_pred": float(x.mean())}


def to_json(rates: SiteRates) -> str:
    return json.dumps({"alpha": rates.alpha, "beta": rates.beta})
