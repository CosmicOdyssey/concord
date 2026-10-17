"""Build a regional clearing instance from the DB and run the three allocations.

Scope (master doc §6): currently recruiting industry Phase II/III lung trials with
at least one site in the region. Each trial's regional target is its enrollment
target scaled by the share of its sites that sit in the region.

Allocations compared:
  actual       what sponsors registered on CT.gov (evaluated under the same model)
  independent  each trial's best response, ignoring the others (§4.4 baseline)
  coordinated  the clearing solution
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

from concord.allocator import core
from concord.compiler.eligibility import Criterion, eligible_fraction, eligible_mask
from concord.compiler.population import synthetic_population
from concord.paths import DB_PATH

REGIONS: dict[str, list[str] | None] = {
    "US-Northeast": ["Connecticut", "Maine", "Massachusetts", "New Hampshire", "Rhode Island", "Vermont",
                     "New Jersey", "New York", "Pennsylvania"],
    "US-Midwest": ["Illinois", "Indiana", "Michigan", "Ohio", "Wisconsin", "Iowa", "Kansas", "Minnesota", "Missouri",
                   "Nebraska", "North Dakota", "South Dakota"],
    "US-South": ["Delaware", "District of Columbia", "Florida", "Georgia", "Maryland", "North Carolina",
                 "South Carolina", "Virginia", "West Virginia", "Alabama", "Kentucky", "Mississippi", "Tennessee",
                 "Arkansas", "Louisiana", "Oklahoma", "Texas"],
    "US-West": ["Arizona", "Colorado", "Idaho", "Montana", "Nevada", "New Mexico", "Utah", "Wyoming", "Alaska",
                "California", "Hawaii", "Oregon", "Washington"],
    "US": None,
}
INSTANCE_FILTER = """t.is_lung=1 AND t.status='RECRUITING' AND t.sponsor_class='INDUSTRY'
                     AND (t.phases LIKE '%PHASE2%' OR t.phases LIKE '%PHASE3%')"""

# Tufts CSDD (Aug 2024), industry averages; illustrative conversion only.
DIRECT_COST_PER_DAY = 40_000
LOST_SALES_PER_DAY = 800_000
DAYS_PER_MONTH = 30.44
# Model times above this are treated as parse/estimate failures, flagged for review and
# excluded from the trimmed headline (real Phase II/III enrollment rarely runs past 10 years).
PLAUSIBLE_T_MONTHS = 120.0


@dataclass
class Params:
    region: str = "US-Northeast"
    activation_lag: float = 6.0  # months, same for all sites so the dividend comes only from congestion
    overlap_scale: float = 1.0  # sensitivity: multiplies every o_PQ
    capacity_scale: float = 1.0  # sensitivity: multiplies every k_s
    max_trials: int | None = None
    time_limit: float = 8.0
    calibrate: bool = True  # de-congest site rates so the actual allocation reproduces history
    f_clip: tuple[float, float] = (0.1, 4.0)  # regex eligibility is noisy (see backtest); bound its effect

    def key(self) -> tuple:
        return (self.region, self.activation_lag, self.overlap_scale, self.capacity_scale, self.max_trials,
                self.time_limit, self.calibrate, tuple(self.f_clip))


@dataclass
class Built:
    params: Params
    inst: core.Instance
    trials: list[dict]
    sites: list[dict]
    criteria: list[list[Criterion]]
    masks: np.ndarray  # (P, n_pop) eligibility masks
    x_actual: np.ndarray
    order: list[int] = field(default_factory=list)


def _con() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError("data/concord.db missing: run the crawler, normalize and model build first")
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


@lru_cache(maxsize=1)
def population() -> dict:
    return synthetic_population(20_000)


def overlap_matrix(masks: np.ndarray) -> np.ndarray:
    m = masks.astype(np.float32)
    inter = m @ m.T
    size = np.maximum(m.sum(axis=1), 1.0)
    return inter / size[:, None]  # o[P, Q] = Pr[e_Q | e_P]


def build(params: Params) -> Built:
    con = _con()
    states = REGIONS[params.region]
    region_sql = "s.country='United States'" + (
        f" AND s.state IN ({','.join('?' * len(states))})" if states else "")
    args = states or []

    trows = con.execute(f"""
        SELECT t.nct_id, t.title, t.acronym, t.sponsor, t.phases, t.enrollment, t.n_sites, t.start_date,
               tm.f_rel, tm.criteria, COUNT(*) AS n_region
        FROM trials t JOIN trial_model tm USING(nct_id)
        JOIN trial_sites ts USING(nct_id) JOIN sites s USING(site_id)
        WHERE {INSTANCE_FILTER} AND {region_sql}
        GROUP BY t.nct_id ORDER BY t.start_date""", args).fetchall()
    if params.max_trials:
        trows = trows[: params.max_trials]
    trial_ids = [r["nct_id"] for r in trows]

    # Site universe: every named site in the region with industry lung-trial history, plus any site
    # an instance trial actually uses (anonymized pseudo-sites only appear in the actual allocation).
    srows = con.execute(f"""
        SELECT s.*, sm.lam_mean AS lam, sm.lam AS lam_median, sm.shape, sm.rate, sm.n_hist, sm.n_hist_industry, sm.k_hist, sm.fitted
        FROM sites s JOIN site_model sm USING(site_id)
        WHERE {region_sql} AND (sm.n_hist_industry > 0 OR s.site_id IN (
            SELECT site_id FROM trial_sites WHERE nct_id IN ({','.join('?' * len(trial_ids))})))
        """, args + trial_ids).fetchall()
    site_ids = [r["site_id"] for r in srows]
    s_idx = {s: i for i, s in enumerate(site_ids)}
    t_idx = {t: i for i, t in enumerate(trial_ids)}

    x_actual = np.zeros((len(site_ids), len(trial_ids)), dtype=bool)
    for nct, sid in con.execute(
            f"SELECT nct_id, site_id FROM trial_sites WHERE nct_id IN ({','.join('?' * len(trial_ids))})", trial_ids):
        if sid in s_idx:
            x_actual[s_idx[sid], t_idx[nct]] = True

    pop = population()
    criteria = [[Criterion(**c) for c in json.loads(r["criteria"])] for r in trows]
    masks = np.array([eligible_mask(c, pop) for c in criteria])
    f = np.array([eligible_fraction(c, pop) for c in criteria])
    f_ref = json.loads(con.execute("SELECT value FROM meta WHERE key='f_ref'").fetchone()[0])
    f_rel = np.clip(f / f_ref, *params.f_clip)

    n_region = x_actual.sum(axis=0)
    N = np.array([max(1.0, (r["enrollment"] or 0) * n / max(r["n_sites"], 1)) for r, n in zip(trows, n_region)])
    anonymized = np.array([bool(r["anonymized"]) for r in srows])
    feasible = np.repeat(~anonymized[:, None], len(trial_ids), axis=1)
    k = np.maximum.reduce([np.array([r["k_hist"] for r in srows]), x_actual.sum(axis=1), np.ones(len(srows), int)])
    k = np.maximum(1, np.round(k * params.capacity_scale)).astype(int)

    lam = np.array([r["lam"] for r in srows])  # posterior mean: expected rate is what eq. (3) sums
    o = np.clip(overlap_matrix(masks) * params.overlap_scale, 0, 1)
    if params.calibrate:
        # Fitted rates are realized rates, already slowed by the congestion of their day. Assume
        # today's registered allocation reflects that congestion: scale each busy site's flow by
        # (1 + its mean status-quo load) so the actual allocation reproduces the historical rate.
        # Idle sites get no boost, which favors the status quo (conservative for the dividend).
        b_load = x_actual.astype(float) @ (o - np.diag(np.diag(o))).T
        busy = x_actual.sum(axis=1)
        mean_load = np.where(busy > 0, (b_load * x_actual).sum(axis=1) / np.maximum(busy, 1), 0.0)
        lam = lam * (1.0 + mean_load)
    inst = core.Instance(
        lam=lam,
        a=np.full(len(srows), params.activation_lag),
        k=k, f=f_rel, N=N, n_max=np.maximum(n_region, 1), w=np.ones(len(trial_ids)),
        o=o,
        feasible=feasible, site_ids=site_ids, trial_ids=trial_ids,
    )
    trials = [{
        "nct_id": r["nct_id"], "title": r["title"], "acronym": r["acronym"], "sponsor": r["sponsor"],
        "phases": json.loads(r["phases"]), "enrollment": r["enrollment"], "n_sites_total": r["n_sites"],
        "n_sites_region": int(n), "target_region": round(float(nr), 1), "f": float(fi), "f_rel": float(fr),
        "criteria": [c.to_dict() for c in cr],
    } for r, n, nr, fi, fr, cr in zip(trows, n_region, N, f, f_rel, criteria)]
    sites = [{
        "site_id": r["site_id"], "facility": r["facility"], "city": r["city"], "state": r["state"],
        "country": r["country"], "lat": r["lat"], "lon": r["lon"], "is_amc": bool(r["is_amc"]),
        "anonymized": bool(r["anonymized"]), "lam_hist": r["lam"], "lam_flow": float(lf), "lam_ci": _gamma_ci(r["shape"], r["rate"]),
        "fitted": bool(r["fitted"]), "n_hist": r["n_hist"], "k": int(kk),
    } for r, kk, lf in zip(srows, k, inst.lam)]
    con.close()
    return Built(params, inst, trials, sites, criteria, masks, x_actual, order=list(range(len(trial_ids))))


def _gamma_ci(shape: float, rate: float) -> list[float]:
    from scipy.stats import gamma
    return [float(gamma.ppf(q, shape, scale=1.0 / rate)) for q in (0.1, 0.9)]


_cache: dict[tuple, dict] = {}


def clear(params: Params) -> dict:
    if params.key() in _cache:
        return _cache[params.key()]
    b = build(params)
    inst = b.inst
    x_ind = core.independent(inst, order=b.order)
    x_coord, stats = core.coordinate(inst, x0=None, time_limit=params.time_limit)
    T_act, T_ind, T_coord = (core.evaluate(inst, x) for x in (b.x_actual, x_ind, x_coord))
    summary = core.summarize(inst, x_ind, x_coord)
    vs_actual = core.summarize(inst, b.x_actual, x_coord)
    ok = (T_ind <= PLAUSIBLE_T_MONTHS) & (T_coord <= PLAUSIBLE_T_MONTHS)
    trimmed_div = float(inst.w[ok] @ (T_ind[ok] - T_coord[ok]))
    robust = {
        "median_T_indep": float(np.median(T_ind)), "median_T_coord": float(np.median(T_coord)),
        "median_T_actual": float(np.median(T_act[T_act < core.NO_SITES_T])),
        "median_speedup": float(np.median(T_ind / T_coord)),
        "share_trials_faster": float(np.mean(T_coord < T_ind - 1e-9)),
        "share_trials_slower": float(np.mean(T_coord > T_ind + 1e-9)),
        "trimmed_trials": int(ok.sum()), "flagged_trials": int((~ok).sum()),
        "trimmed_dividend_trial_months": trimmed_div,
        "trimmed_poa": float((inst.w[ok] @ T_ind[ok]) / max(inst.w[ok] @ T_coord[ok], 1e-9)),
        "plausible_T_cap_months": PLAUSIBLE_T_MONTHS,
    }
    div_days = trimmed_div * DAYS_PER_MONTH

    for t, ta, ti, tc, p in zip(b.trials, T_act, T_ind, T_coord, range(inst.P)):
        t.update(T_actual=_m(ta), T_indep=_m(ti), T_coord=_m(tc),
                 flagged=bool(max(ti, tc) > PLAUSIBLE_T_MONTHS),
                 sites_indep=int(x_ind[:, p].sum()), sites_coord=int(x_coord[:, p].sum()))
    for s, i in zip(b.sites, range(inst.S)):
        s.update(load_actual=int(b.x_actual[i].sum()), load_indep=int(x_ind[i].sum()),
                 load_coord=int(x_coord[i].sum()))

    result = {
        "params": params.__dict__,
        "counts": {"trials": inst.P, "sites": inst.S,
                   "sites_used_actual": int(b.x_actual.any(axis=1).sum()),
                   "sites_used_indep": int(x_ind.any(axis=1).sum()),
                   "sites_used_coord": int(x_coord.any(axis=1).sum())},
        "summary": {**summary,
                    "poa_vs_actual": vs_actual["poa"],
                    "dividend_vs_actual_trial_months": vs_actual["dividend_trial_months"],
                    "robust": robust,
                    "dividend_days": div_days,
                    "dollars_direct": div_days * DIRECT_COST_PER_DAY,
                    "dollars_lost_sales": div_days * LOST_SALES_PER_DAY,
                    "dollars_note": "Trimmed dividend x Tufts CSDD 2024 industry averages (~$40K/day direct "
                                    "Phase II/III cost; ~$800K/day lost sales for a launched drug). Regional "
                                    "slices of trials, not whole trials. Illustrative only.",
                    "solver": stats},
        "trials": b.trials,
        "sites": b.sites,
        "assignments": {
            "actual": _pairs(b.x_actual, inst), "indep": _pairs(x_ind, inst), "coord": _pairs(x_coord, inst)},
    }
    _cache[params.key()] = {"result": result, "built": b, "x_coord": x_coord}
    return _cache[params.key()]


def _m(t: float) -> float | None:
    return None if t >= core.NO_SITES_T else round(float(t), 2)


def _pairs(x: np.ndarray, inst: core.Instance) -> list[list[str]]:
    s, p = np.nonzero(x)
    return [[inst.site_ids[i], inst.trial_ids[j]] for i, j in zip(s, p)]


# Counterfactual re-solves: deterministic warm start (no kicks, fixed passes), compared against
# the same procedure run on the unchanged market so solver progress is not credited to the change.
RESOLVE = dict(patience=0, max_passes=2, time_limit=60.0)


def _reference(params: Params) -> np.ndarray:
    run = clear(params)
    if "x_ref" not in run:
        run["x_ref"], _ = core.coordinate(run["built"].inst, x0=run["x_coord"], **RESOLVE)
    return run["x_ref"]


def price_tags(params: Params, nct_id: str) -> dict:
    """Months of enrollment each eligibility criterion of one trial costs (§4.5), by dropping
    it, recomputing f and overlaps, and re-solving from the cleared allocation."""
    run = clear(params)
    b, x0 = run["built"], run["x_coord"]
    inst = b.inst
    p = inst.trial_ids.index(nct_id)
    pop = population()
    T_ref = core.evaluate(inst, _reference(params))
    base_obj, base_T = float(inst.w @ T_ref), T_ref[p]
    f_ref_scale = inst.f[p] / max(eligible_fraction(b.criteria[p], pop), 1e-9)
    out = []
    for c in b.criteria[p]:
        f_new = eligible_fraction(b.criteria[p], pop, drop=c.id)
        mask = eligible_mask(b.criteria[p], pop, drop=c.id)
        masks = b.masks.copy()
        masks[p] = mask
        o = np.clip(overlap_matrix(masks) * params.overlap_scale, 0, 1)
        f = inst.f.copy()
        f[p] = f_new * f_ref_scale
        relaxed = core.Instance(inst.lam, inst.a, inst.k, f, inst.N, inst.n_max, inst.w, o, inst.feasible,
                                inst.site_ids, inst.trial_ids)
        x, _ = core.coordinate(relaxed, x0=x0, **RESOLVE)
        T = core.evaluate(relaxed, x)
        out.append({**c.to_dict(), "pool_multiplier": round(f_new / max(eligible_fraction(b.criteria[p], pop), 1e-9), 2),
                    "months_saved_trial": round(float(base_T - T[p]), 2),
                    "months_saved_portfolio": round(base_obj - float(inst.w @ T), 2)})
    # Dropping one of several OR'ed alternatives (e.g. "ALK or ROS1") narrows the pool; it is not a
    # relaxable restriction, so it gets no price tag.
    alternatives = [r["label"] for r in out if r["pool_multiplier"] < 1.0]
    out = [r for r in out if r["pool_multiplier"] >= 1.0]
    out.sort(key=lambda r: -r["months_saved_trial"])
    return {"nct_id": nct_id, "T_coord": _m(base_T), "criteria": out, "alternatives_not_priced": alternatives,
            "note": "Criteria from rule-based parsing of CT.gov text; synthetic population. Not clinical advice."}


def slot_values(params: Params, top: int = 12) -> list[dict]:
    """Portfolio months saved by one more concurrent-trial slot at the busiest full sites."""
    run = clear(params)
    b, x0 = run["built"], run["x_coord"]
    inst = b.inst
    base_obj = float(inst.w @ core.evaluate(inst, _reference(params)))
    full = np.flatnonzero(x0.sum(axis=1) >= inst.k)
    full = full[np.argsort(-inst.lam[full])][:top]
    out = []
    for s in full:
        k = inst.k.copy()
        k[s] += 1
        more = core.Instance(inst.lam, inst.a, k, inst.f, inst.N, inst.n_max, inst.w, inst.o, inst.feasible,
                             inst.site_ids, inst.trial_ids)
        x, _ = core.coordinate(more, x0=x0, **RESOLVE)
        out.append({**b.sites[s], "months_saved": round(base_obj - float(more.w @ core.evaluate(more, x)), 2)})
    out.sort(key=lambda r: -r["months_saved"])
    return out
