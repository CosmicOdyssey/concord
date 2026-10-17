"""Site scores: explainable, registry-based site enrollment scores (the "Site scores" tab).

A site's score is site_model.lam_eff: historical patients per month per lung trial at that site, from completed
trials on ClinicalTrials.gov (concord.model.recruitment). This module recomputes that fit once, keeping what the
stored table drops, so every score can be shown step by step:

    prior        gamma(alpha, beta), method of moments on trimmed trial-level per-site rates
    data         sum_t n_hat_ts (the site's share of each trial's enrollment from the FINAL E-step of the EM
                 split) and sum_t e_ts (exposure months)
    posterior    shape = alpha + sum n_hat, rate = beta + sum e; mean = shape / rate
                 = w * (sum n_hat / sum e) + (1 - w) * alpha / beta,  w = sum e / (beta + sum e)
    cap          sites with fewer than recruitment.LOW_HISTORY_N fitted trials: min(mean, prior 25th percentile)
    score        lam_eff (equal to site_model.lam_eff; tests check this for every site)
    calibrated   exp(m + b * (log lam_eff - m)): m = mean log score over U.S. non-anonymized fitted sites,
                 b = the industry Phase II/III slope in data/findings/selection_validation.json (omitted when
                 that file is missing; b is never invented)

The fit loop below replicates recruitment.fit() line for line (it does not return the allocations); tests assert
the shape and rate arrays are equal to recruitment.fit(load_history(con)). Nothing here is a forecast for a new
trial: these are historical estimates with their observed-outcome validation.
"""

from __future__ import annotations

import json
import math
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.stats import gamma as gamma_dist

from concord import paths
from concord.model import recruitment as R

US = "United States"
FIT_ITERS = 3  # recruitment.fit's default, which build.py uses
VALIDATION_FILE = "selection_validation.json"
DEPTH_BUCKETS = [("1", 1, 1), ("2", 2, 2), ("3-5", 3, 5), ("6-20", 6, 20), ("21+", 21, None)]
HIST_BIN = 0.2  # log10 units
INTERVAL_Q = (0.1, 0.9)
ONGOING = {"RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION", "ACTIVE_NOT_RECRUITING", "SUSPENDED"}
# Sites considered for the default "open this site" preset; the one with the most fitted trials wins.
PRESET_PATTERNS = ("dana-farber", "dana farber", "memorial sloan")
SORT_KEYS = ("n_fit", "n_hist", "score", "calibrated", "percentile", "facility", "city", "state")

METHOD = (
    "A site's score is the number of patients per month that a lung-cancer trial enrolled at that site, estimated "
    "from completed trials on ClinicalTrials.gov that report actual enrollment and an actual primary completion "
    "date. The registry reports enrollment per trial, not per site, so each trial's enrollment is split across its "
    "registered sites in proportion to the sites' current rates (three rounds of this split). Each site's rate is "
    "then a gamma-Poisson posterior: a prior fitted to all trials, plus the patients allocated to the site over its "
    "exposure months (65% of each trial's start-to-primary-completion time, the assumed enrollment window). Sites "
    "with fewer than 3 fitted trials are capped at the prior's 25th percentile, the same rate used for sites with "
    "no history. The calibrated score shrinks each site's distance from the U.S. average, on the log scale, by the "
    "slope measured when pre-2018 scores were checked against how 2018+ trials actually enrolled. These are "
    "historical, registry-based estimates, not forecasts for a new trial."
)


class NotFound(LookupError):
    pass


@dataclass
class _Fit:
    hist: R.History
    alpha: float
    beta: float
    prior_trials: int  # trials whose per-site rate fed the trimmed moments
    prior_trim: tuple[float, float]
    iters_run: int
    ti: np.ndarray  # per link
    si: np.ndarray
    e: np.ndarray
    n_hat: np.ndarray  # final E-step allocation per link
    lam_estep: np.ndarray  # per site: the rates the final E-step split with
    shape: np.ndarray
    rate: np.ndarray
    sum_e: np.ndarray
    sum_n: np.ndarray
    n_fit: np.ndarray
    mean: np.ndarray
    lam_eff: np.ndarray
    floor: float
    lo: np.ndarray  # posterior 10th percentile
    hi: np.ndarray  # posterior 90th percentile
    sites_per_trial: np.ndarray  # |S_t| = number of registered sites linked to trial t


def fit_with_allocations(h: R.History, iters: int = FIT_ITERS) -> _Fit:
    """recruitment.fit(h, iters), keeping the final E-step allocations n_hat_ts. The loop body is copied from
    recruitment.fit so the posterior arrays are bitwise equal (tests check this)."""
    ti = np.array([l[0] for l in h.links])
    si = np.array([l[1] for l in h.links])
    e = np.array([l[2] for l in h.links])
    S = len(h.site_ids)

    exposure_t = np.bincount(ti, weights=e, minlength=len(h.N))
    ok = exposure_t > 0
    r = h.N[ok] / exposure_t[ok]
    lo, hi = np.quantile(r, [0.05, 0.95])
    trim = (r >= lo) & (r <= hi)
    rt, et = r[trim], exposure_t[ok][trim]
    mu = float(np.mean(rt))
    noise = float(np.mean(rt / et))
    var = float(np.clip(np.var(rt) - noise, mu * mu / 10, mu * mu * 4))
    alpha, beta = mu * mu / var, mu / var

    lam = np.full(S, mu)
    sum_e = np.bincount(si, weights=e, minlength=S)
    n_hat = np.zeros(len(e))
    lam_estep = lam
    shape = np.full(S, alpha)
    rate = beta + sum_e
    iters_run = 0
    for _ in range(iters):
        lam_estep = lam
        w = lam[si] * e
        denom = np.bincount(ti, weights=w, minlength=len(h.N))
        n_hat = h.N[ti] * w / np.maximum(denom[ti], 1e-12)
        shape = alpha + np.bincount(si, weights=n_hat, minlength=S)
        rate = beta + sum_e
        new = shape / rate
        iters_run += 1
        if np.max(np.abs(new - lam) / np.maximum(lam, 1e-9)) < 1e-6:
            lam = new
            break
        lam = new

    n_fit = np.bincount(si, minlength=S)
    rates = R.SiteRates(h.site_ids, shape, rate, alpha, beta)
    lam_eff, floor = R.effective_rates(rates, n_fit)
    q_lo = gamma_dist.ppf(INTERVAL_Q[0], shape, scale=1.0 / rate)
    q_hi = gamma_dist.ppf(INTERVAL_Q[1], shape, scale=1.0 / rate)
    return _Fit(h, float(alpha), float(beta), int(trim.sum()), (float(lo), float(hi)), iters_run, ti, si, e, n_hat,
                lam_estep, shape, rate, sum_e, np.bincount(si, weights=n_hat, minlength=S), n_fit, shape / rate,
                lam_eff, float(floor), q_lo, q_hi, np.bincount(ti, minlength=len(h.N)))


@dataclass
class _State:
    fit: _Fit
    s_index: dict[str, int]
    sites: dict[str, dict]  # site_id -> sites row (+ site_model lifetime counts)
    trials: dict[str, dict]  # fitted trial metadata
    us_idx: np.ndarray  # fit indices of U.S. non-anonymized fitted sites
    us_sorted: np.ndarray  # sorted lam_eff over us_idx (percentiles)
    m: float
    links_of: dict[int, list[int]]  # site index -> link indices
    stored_max_diff: float  # max |our lam_eff - site_model.lam_eff| over fitted sites
    stored_compared: int
    at_cap: int  # U.S. fitted sites whose score equals the cap (they share one tied value)
    rows: list[dict]  # list rows for U.S. non-anonymized fitted sites (without calibration)


_LOCK = threading.Lock()
_CACHE: dict[tuple, _State] = {}


def _connect() -> sqlite3.Connection:
    db = Path(paths.DB_PATH)
    if not db.is_file():
        raise FileNotFoundError(f"{db} not found: build the database first (scripts/pipeline.sh)")
    con = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def _state() -> _State:
    db = Path(paths.DB_PATH)
    key = (str(db), db.stat().st_mtime if db.exists() else None)
    with _LOCK:
        st = _CACHE.get(key)
        if st is None:
            st = _build()
            _CACHE.clear()
            _CACHE[key] = st
        return st


def _build() -> _State:
    con = _connect()
    try:
        h = R.load_history(con)
        f = fit_with_allocations(h)
        s_index = {s: i for i, s in enumerate(h.site_ids)}
        stored = {r["site_id"]: r for r in con.execute(
            "SELECT site_id, lam_eff, n_hist, n_hist_industry FROM site_model")}
        sites: dict[str, dict] = {}
        for r in con.execute("SELECT site_id, facility, city, state, zip, country, anonymized, is_amc FROM sites"):
            d = dict(r)
            sm = stored.get(d["site_id"])
            d["n_hist"] = int(sm["n_hist"]) if sm else 0
            d["n_hist_industry"] = int(sm["n_hist_industry"]) if sm else 0
            sites[d["site_id"]] = d
        fitted = set(h.trial_ids)
        trials: dict[str, dict] = {}
        for r in con.execute("SELECT nct_id, title, acronym, status, phases, sponsor, sponsor_class FROM trials "
                             "WHERE is_lung=1"):
            if r["nct_id"] in fitted:
                d = dict(r)
                d["phases"] = json.loads(d["phases"] or "[]")
                trials[d["nct_id"]] = d
    finally:
        con.close()

    diffs = [abs(float(f.lam_eff[i]) - float(stored[s]["lam_eff"])) for s, i in s_index.items() if s in stored]
    us_idx = np.array([i for s, i in s_index.items()
                       if s in sites and sites[s]["country"] == US and not sites[s]["anonymized"]], dtype=int)
    us_idx.sort()
    us_sorted = np.sort(f.lam_eff[us_idx])
    m = float(np.mean(np.log(f.lam_eff[us_idx])))
    links_of: dict[int, list[int]] = {}
    for k, s in enumerate(f.si.tolist()):
        links_of.setdefault(s, []).append(k)

    at_cap = int(np.sum(f.lam_eff[us_idx] == f.floor))
    st = _State(f, s_index, sites, trials, us_idx, us_sorted, m, links_of,
                max(diffs) if diffs else float("nan"), len(diffs), at_cap, [])
    st.rows = [_row(st, int(i)) for i in us_idx]
    return st


def _percentile(st: _State, score: float) -> float:
    """Mid-rank percentile of a score among U.S. fitted sites (ties share one value)."""
    n = len(st.us_sorted)
    below = int(np.searchsorted(st.us_sorted, score, side="left"))
    upto = int(np.searchsorted(st.us_sorted, score, side="right"))
    return 100.0 * (below + 0.5 * (upto - below)) / n


def _percentile_status(is_us: bool, n_fit: int, capped: bool) -> str:
    """Whether a site gets a percentile. Only U.S. sites with at least one fitted trial whose score was not lowered
    by the low-history cap do: every capped site ties at the cap value (the prior's 25th percentile), which sits
    above the median of the sites with deep history, so a percentile would rank a 1-2 trial site above them; a
    site with no fitted trial is not among the U.S. fitted sites at all."""
    if not is_us:
        return "outside_us"
    if n_fit == 0:
        return "no_fitted_trials"
    if capped:
        return "tied_at_cap"
    return "ok"


def _row(st: _State, i: int) -> dict:
    f = st.fit
    sid = f.hist.site_ids[i]
    s = st.sites.get(sid, {})
    low = bool(f.n_fit[i] < R.LOW_HISTORY_N)
    capped = bool(low and f.mean[i] > f.floor)
    status = _percentile_status(True, int(f.n_fit[i]), capped)
    return {
        "site_id": sid, "facility": s.get("facility"), "city": s.get("city"), "state": s.get("state"),
        "is_amc": bool(s.get("is_amc")), "n_hist": int(s.get("n_hist", 0)), "n_fit": int(f.n_fit[i]),
        "score": float(f.lam_eff[i]), "posterior_mean": float(f.mean[i]),
        "interval": [float(f.lo[i]), float(f.hi[i])], "low_history": low, "capped": capped,
        "percentile": _percentile(st, float(f.lam_eff[i])) if status == "ok" else None,
        "percentile_status": status,
    }


# ---------- calibration (observed-outcome validation) ----------

def _fmt(x: float, d: int = 2) -> str:
    return f"{x:.{d}f}"


def validation() -> dict | None:
    """The observed-outcome check (analysis/selection_validation.py output), with a plain reading. None when the
    file is missing or has no industry Phase II/III slope."""
    path = Path(paths.FINDINGS_DIR) / VALIDATION_FILE
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    ind, allt = doc.get("industry_phase2_3") or {}, doc.get("primary") or {}
    if not isinstance(ind.get("slope"), (int, float)) or not isinstance(ind.get("ci95"), list):
        return None

    def block(r: dict) -> dict | None:
        if not isinstance(r.get("slope"), (int, float)):
            return None
        return {"label": r.get("label"), "n": r.get("n"), "slope": r["slope"], "se": r.get("se"),
                "ci95": r.get("ci95"), "p": r.get("p"),
                "overstatement": (1.0 / r["slope"]) if r["slope"] > 0 else None}

    b_ind, b_all = block(ind), block(allt)
    return {
        "source": f"data/findings/{VALIDATION_FILE}",
        "script": "backend/concord/analysis/selection_validation.py",
        "cutoff": doc.get("cutoff"), "fit_trials": (doc.get("rates") or {}).get("n_trials"),
        "outcome": doc.get("outcome"), "score": doc.get("score"), "controls": doc.get("controls"),
        "industry_phase2_3": b_ind, "all_trials": b_all, "reading": _reading(b_ind, b_all),
        "interpretation": doc.get("interpretation"),
    }


def _reading(b_ind: dict, b_all: dict | None) -> str:
    """Plain reading of the slopes. Built from whichever blocks exist and what they show, so the wording stays
    right if the analysis is re-run (one block, a slope above 1, an interval that includes zero)."""
    blocks = [("industry Phase II/III trials", b_ind)] + ([("all trials", b_all)] if b_all else [])
    parts = []
    with_signal = [lbl for lbl, b in blocks if isinstance(b.get("ci95"), list) and b["ci95"][0] > 0]
    if len(with_signal) == len(blocks):
        lead = ("Both slopes are above zero and their 95% intervals exclude zero" if len(blocks) == 2
                else "The slope is above zero and its 95% interval excludes zero")
        parts.append(f"{lead}, so the scores carry real signal about how the site lists sponsors registered went on "
                     f"to enroll.")
    else:
        missing = [lbl for lbl, _ in blocks if lbl not in with_signal]
        parts.append(f"The 95% interval for {' and '.join(missing)} includes zero, so the signal in the scores is "
                     f"not established there.")
    if b_ind["slope"] < 1:
        below = [b for _, b in blocks if b["slope"] < 1]
        who = "Both slopes are" if len(below) == 2 else "The industry Phase II/III slope is"
        tail = f" ({_fmt(b_all['slope'])} across all trials)" if b_all else ""
        parts.append(f"{who} below 1: a difference of 1 in log score between two site lists went with about "
                     f"{_fmt(b_ind['slope'])} in observed log enrollment rate for industry Phase II/III trials{tail}.")
        if b_ind["overstatement"]:
            all_x = (f" (about {b_all['overstatement']:.0f}x across all trials)"
                     if b_all and b_all["slope"] < 1 and b_all["overstatement"] else "")
            b = b_ind["slope"]
            parts.append(f"So differences in log score are overstated about {b_ind['overstatement']:.0f}x{all_x}. "
                         f"That is on the log scale, not a division of ratios: a raw score ratio R between two site "
                         f"lists went with an observed ratio of about R^{_fmt(b)} (10x raw, about {10 ** b:.1f}x "
                         f"observed). The calibrated score shrinks each site's log distance from the U.S. average "
                         f"by the measured slope.")
    else:
        parts.append(f"The industry Phase II/III slope is {_fmt(b_ind['slope'])}, not below 1, so on this check the "
                     f"raw scores do not overstate differences between site lists.")
    return " ".join(parts)


def _calibration(st: _State, v: dict | None) -> dict | None:
    if v is None:
        return None
    b = v["industry_phase2_3"]
    return {"m": st.m, "geo_mean": math.exp(st.m), "b": b["slope"], "b_ci": b["ci95"], "b_n": b["n"],
            "b_label": b["label"], "source": v["source"],
            "formula": "calibrated = exp(m + b * (log score - m))"}


def _calibrated(score: float, cal: dict | None, b: float | None = None) -> float | None:
    if cal is None:
        return None
    b = cal["b"] if b is None else b
    return math.exp(cal["m"] + b * (math.log(score) - cal["m"]))


# ---------- endpoints ----------

def _regions() -> dict[str, list[str] | None]:
    from concord.service import REGIONS  # the app's region definitions
    return REGIONS


def list_sites(region: str = "US", state: str | None = None, q: str | None = None, min_trials: int = 1,
               sort: str = "-n_fit", limit: int = 50, offset: int = 0) -> dict:
    regions = _regions()
    if region not in regions:
        raise ValueError(f"unknown region {region}; one of {list(regions)}")
    key = sort.lstrip("-")
    if key not in SORT_KEYS:
        raise ValueError(f"sort must be one of {list(SORT_KEYS)}, optionally prefixed with - for descending")
    desc = sort.startswith("-")
    if limit < 1 or limit > 500 or offset < 0:
        raise ValueError("limit must be 1-500 and offset >= 0")
    st = _state()
    cal = _calibration(st, validation())
    states = regions[region]
    want_state = (state or "").strip().lower()
    needle = (q or "").strip().lower()
    rows = []
    for r in st.rows:
        if states is not None and r["state"] not in states:
            continue
        if want_state and (r["state"] or "").lower() != want_state:
            continue
        if r["n_fit"] < max(1, min_trials):
            continue
        if needle and needle not in f"{r['facility'] or ''} {r['city'] or ''} {r['state'] or ''}".lower():
            continue
        rows.append(r)
    sort_val = "score" if key in ("calibrated", "percentile") else key  # same order as the score
    if key in ("facility", "city", "state"):
        rows.sort(key=lambda r: ((r[key] or "").lower(), (r["facility"] or "").lower(), r["site_id"]), reverse=desc)
    else:
        rows.sort(key=lambda r: ((r["facility"] or "").lower(), r["site_id"]))
        rows.sort(key=lambda r: r[sort_val], reverse=desc)  # stable: ties stay alphabetical
    page = [{**r, "calibrated": _calibrated(r["score"], cal)} for r in rows[offset:offset + limit]]
    return {"total": len(rows), "offset": offset, "limit": limit, "sort": sort,
            "filters": {"region": region, "state": state, "q": q, "min_trials": max(1, min_trials)},
            "calibration": cal, "cap": st.fit.floor, "rows": page}


def _not_fit_reason(r: sqlite3.Row) -> str:
    """Why a lung trial at the site is not in the fit (the load_history filters, in order)."""
    ongoing = (r["status"] or "") in ONGOING
    if not r["enrollment"] or r["enrollment"] <= 0:
        return "Withdrawn or no participants enrolled"
    if r["enrollment_type"] != "ACTUAL" or r["primary_completion_type"] != "ACTUAL" or not r["primary_completion_date"]:
        if ongoing:
            return "Still recruiting or ongoing: no actual enrollment and primary completion yet"
        if r["enrollment_type"] != "ACTUAL":
            return "Enrollment reported only as an estimate"
        return "Primary completion date not reported as actual"
    if not r["start_date"]:
        return "No start date"
    if not r["n_sites"]:
        return "Trial record lists no sites (n_sites = 0)"
    tau = R._months(r["start_date"], r["primary_completion_date"])
    if tau is None or tau < R.MIN_TAU_MONTHS / R.ENROLL_FRACTION:
        return "Enrollment window under 1 month"
    return "Other (not in the fit history)"


def site_detail(site_id: str) -> dict:
    st = _state()
    f = st.fit
    s = st.sites.get(site_id)
    if s is None or s["anonymized"]:
        raise NotFound(f"unknown site {site_id}")
    v = validation()
    cal = _calibration(st, v)
    i = st.s_index.get(site_id)
    prior_mean = f.alpha / f.beta
    if i is None:  # no fitted trials: the score is the unseen-site rate
        shape, rate, sum_n, sum_e, n_fit, lam = f.alpha, f.beta, 0.0, 0.0, 0, f.floor
        mean = prior_mean
        lo, hi = (float(gamma_dist.ppf(q, f.alpha, scale=1.0 / f.beta)) for q in INTERVAL_Q)
    else:
        shape, rate, sum_n, sum_e = float(f.shape[i]), float(f.rate[i]), float(f.sum_n[i]), float(f.sum_e[i])
        n_fit, lam, mean, lo, hi = int(f.n_fit[i]), float(f.lam_eff[i]), float(f.mean[i]), float(f.lo[i]), float(f.hi[i])
    low = n_fit < R.LOW_HISTORY_N
    weight = sum_e / (f.beta + sum_e)

    trials = []
    h = f.hist
    for k in st.links_of.get(i, []) if i is not None else []:
        t = int(f.ti[k])
        nct = h.trial_ids[t]
        meta = st.trials.get(nct, {})
        N, S, tau, e = float(h.N[t]), int(f.sites_per_trial[t]), float(h.tau[t]), float(f.e[k])
        trials.append({
            "nct_id": nct, "title": meta.get("title"), "acronym": meta.get("acronym"), "status": meta.get("status"),
            "sponsor": meta.get("sponsor"), "sponsor_class": meta.get("sponsor_class"),
            "phases": meta.get("phases", []), "start": h.start[t], "primary_completion": h.end[t],
            "enrollment": N, "n_sites": S, "window_months": tau, "n_hat": float(f.n_hat[k]),
            "share": float(f.n_hat[k]) / N, "equal_split": N / S, "exposure": e, "trial_rate": N / (tau * S),
        })
    trials.sort(key=lambda r: (r["start"], r["nct_id"]), reverse=True)

    con = _connect()
    try:
        rows = con.execute("""SELECT t.nct_id, t.status, t.enrollment, t.enrollment_type, t.primary_completion_type,
                                     t.start_date, t.primary_completion_date, t.n_sites
                              FROM trial_sites ts JOIN trials t USING(nct_id)
                              WHERE ts.site_id=? AND t.is_lung=1""", (site_id,)).fetchall()
    finally:
        con.close()
    fitted = {r["nct_id"] for r in trials}
    reasons: dict[str, list[str]] = {}
    for r in rows:
        if r["nct_id"] not in fitted:
            reasons.setdefault(_not_fit_reason(r), []).append(r["nct_id"])
    not_fit = sorted(({"reason": k, "n": len(v_), "examples": sorted(v_)[-5:]} for k, v_ in reasons.items()),
                     key=lambda d: -d["n"])

    is_us = s["country"] == US
    applied = bool(low and mean > f.floor)
    pct_status = _percentile_status(is_us, n_fit, applied)
    pct = _percentile(st, lam) if pct_status == "ok" else None
    calibrated = None
    if cal is not None:
        b_lo, b_hi = cal["b_ci"]
        # m is the U.S. mean, so for a site outside the U.S. the calibrated value is relative to the U.S. average.
        calibrated = {**cal, "value": _calibrated(lam, cal), "relative_to_us_mean": not is_us,
                      "range_over_b_ci": sorted([_calibrated(lam, cal, b_lo), _calibrated(lam, cal, b_hi)])}
    return {
        "site": {k: s[k] for k in ("site_id", "facility", "city", "state", "zip", "country")}
                | {"is_amc": bool(s["is_amc"]), "in_us_list": bool(is_us and n_fit > 0)},
        "history": {"n_hist": s["n_hist"], "n_hist_industry": s["n_hist_industry"], "n_fit": n_fit,
                    "n_not_fit": sum(d["n"] for d in not_fit), "not_fit": not_fit},
        "prior": {"alpha": f.alpha, "beta": f.beta, "mean": prior_mean, "p25": f.floor,
                  "p10": float(gamma_dist.ppf(INTERVAL_Q[0], f.alpha, scale=1.0 / f.beta)),
                  "p90": float(gamma_dist.ppf(INTERVAL_Q[1], f.alpha, scale=1.0 / f.beta)),
                  "trials_used": f.prior_trials, "trim": list(f.prior_trim)},
        "data": {"sum_n_hat": sum_n, "sum_exposure": sum_e, "data_rate": (sum_n / sum_e) if sum_e > 0 else None,
                 "data_weight": weight},
        "posterior": {"shape": shape, "rate": rate, "mean": mean, "p10": lo, "p90": hi},
        "cap": {"low_history": low, "threshold": R.LOW_HISTORY_N, "quantile": R.LOW_HISTORY_Q, "cap_value": f.floor,
                "applied": applied, "value": lam},
        "score": lam,
        "percentile": pct,
        "percentile_status": pct_status,
        "us_fitted_sites": int(len(st.us_idx)),
        "us_at_cap": st.at_cap,
        "calibrated": calibrated,
        "trials": trials,
        "method": {"iters": f.iters_run, "enroll_fraction": R.ENROLL_FRACTION},
    }


def summary() -> dict:
    st = _state()
    f = st.fit
    v = validation()
    cal = _calibration(st, v)
    lam = f.lam_eff[st.us_idx]
    nf = f.n_fit[st.us_idx]
    mean = f.mean[st.us_idx]
    buckets = []
    for label, lo, hi in DEPTH_BUCKETS:
        k = (nf >= lo) & (nf <= (hi if hi is not None else nf.max()))
        n = int(k.sum())
        buckets.append({
            "label": label, "lo": lo, "hi": hi, "sites": n,
            "median_score": float(np.median(lam[k])) if n else None,
            "median_posterior_mean": float(np.median(mean[k])) if n else None,
            "capped": int((k & (nf < R.LOW_HISTORY_N) & (mean > f.floor)).sum()),
            "low_history": lo < R.LOW_HISTORY_N,
        })
    x = np.log10(lam)
    start = math.floor(x.min() / HIST_BIN) * HIST_BIN
    nbins = int(math.ceil((x.max() - start) / HIST_BIN + 1e-9))
    idx = np.clip(((x - start) / HIST_BIN).astype(int), 0, nbins - 1)
    low = nf < R.LOW_HISTORY_N
    hist = [{"lo": round(start + j * HIST_BIN, 6), "hi": round(start + (j + 1) * HIST_BIN, 6),
             "low_history": int(((idx == j) & low).sum()), "history_3plus": int(((idx == j) & ~low).sum())}
            for j in range(nbins)]

    preset, basis = None, None
    for r in st.rows:
        name = (r["facility"] or "").lower()
        if any(p in name for p in PRESET_PATTERNS) and (preset is None or r["n_fit"] > preset["n_fit"]):
            preset = r
            basis = "most fitted trials among the Dana-Farber and Memorial Sloan Kettering sites"
    if preset is None and st.rows:
        preset = max(st.rows, key=lambda r: r["n_fit"])
        basis = "most fitted trials among U.S. sites"

    states: dict[str, int] = {}
    for r in st.rows:
        if r["state"]:
            states[r["state"]] = states.get(r["state"], 0) + 1
    prior_q = {f"p{int(q * 100)}": float(gamma_dist.ppf(q, f.alpha, scale=1.0 / f.beta)) for q in (0.1, 0.5, 0.9)}
    return {
        "method": METHOD,
        "prior": {"alpha": f.alpha, "beta": f.beta, "mean": f.alpha / f.beta, "p25": f.floor, **prior_q,
                  "trials_used": f.prior_trials, "trim": list(f.prior_trim)},
        "fit": {"history_trials": len(f.hist.N), "fitted_sites": len(f.hist.site_ids), "links": len(f.e),
                "iters": f.iters_run, "enroll_fraction": R.ENROLL_FRACTION, "low_history_n": R.LOW_HISTORY_N,
                "low_history_q": R.LOW_HISTORY_Q, "min_window_months": R.MIN_TAU_MONTHS},
        "us": {"sites": int(len(st.us_idx)), "low_history": int(low.sum()),
               "capped": int((low & (mean > f.floor)).sum()), "at_cap": st.at_cap,
               "cap_percentile": _percentile(st, f.floor), "median_score": float(np.median(lam)),
               "m": st.m, "geo_mean": math.exp(st.m)},
        "buckets": buckets,
        "histogram": {"bin_log10": HIST_BIN, "bins": hist},
        "validation": v,
        "calibration": cal,
        "consistency": {"compared": st.stored_compared, "max_abs_diff": st.stored_max_diff,
                        "against": "site_model.lam_eff"},
        "regions": list(_regions()),
        "region_states": _regions(),
        "states": [{"state": k, "sites": n} for k, n in sorted(states.items())],
        "preset": {"site_id": preset["site_id"], "facility": preset["facility"], "n_fit": preset["n_fit"],
                   "basis": basis}
        if preset else None,
    }
