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


def predict_months(N: float, lam_sum: float) -> float:
    return N / lam_sum if lam_sum > 0 else float("inf")


def backtest(con: sqlite3.Connection, cutoff: str = "2018-01-01", f_lookup: dict[str, float] | None = None) -> dict:
    """Fit on trials that started before `cutoff`; predict enrollment duration for trials that
    started after it. Baseline: median per-site-month rate x number of sites."""
    train = load_history(con, f_lookup, before=cutoff)
    rates = fit(train)
    test = load_history(con, f_lookup, after=cutoff)
    lk = dict(zip(rates.site_ids, rates.median))
    prior_mean = float(gamma_dist.ppf(0.5, rates.alpha, scale=1.0 / rates.beta))

    per_trial_e: dict[int, list[tuple[int, float]]] = {}
    for ti, si, e in test.links:
        per_trial_e.setdefault(ti, []).append((si, e))
    exposure = np.array([sum(e for _, e in per_trial_e.get(i, [])) for i in range(len(test.N))])
    train_exposure = np.bincount([l[0] for l in train.links], weights=[l[2] for l in train.links],
                                 minlength=len(train.N))
    naive_rate = float(np.median(train.N[train_exposure > 0] / train_exposure[train_exposure > 0]))

    errs_model, errs_naive, known_share = [], [], []
    for i in range(len(test.N)):
        sites = per_trial_e.get(i, [])
        if not sites:
            continue
        # Rate per enrollment-month: sum of site flows x (exposure / tau) congestion+eligibility scaling.
        scale = [(e / test.tau[i]) for _, e in sites]
        lam_sum = sum(lk.get(test.site_ids[si], prior_mean) * sc for (si, _), sc in zip(sites, scale))
        naive_sum = naive_rate * sum(scale)
        truth = test.tau[i]
        errs_model.append(abs(np.log(predict_months(test.N[i], lam_sum) / truth)))
        errs_naive.append(abs(np.log(predict_months(test.N[i], naive_sum) / truth)))
        known_share.append(np.mean([test.site_ids[si] in lk for si, _ in sites]))

    em, en = np.array(errs_model), np.array(errs_naive)
    return {
        "cutoff": cutoff,
        "train_trials": len(train.N),
        "test_trials": int(len(em)),
        "median_abs_log_error_model": float(np.median(em)),
        "median_abs_log_error_naive": float(np.median(en)),
        "model_beats_naive_share": float(np.mean(em < en)),
        "median_share_of_test_sites_seen_in_train": float(np.median(known_share)),
        "note": "abs log error of predicted vs actual enrollment duration; exp(0.69)=2x off",
    }


def to_json(rates: SiteRates) -> str:
    return json.dumps({"alpha": rates.alpha, "beta": rates.beta})
