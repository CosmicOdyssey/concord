"""Build a clearing instance from the DB and compare allocations under stated assumptions.

Scope (master doc §6): industry Phase II/III lung trials recruiting in a U.S. region,
either today (status RECRUITING) or on a past date (`as_of`: start <= date < primary
completion), so a sponsor's historical portfolio can be cleared. Each trial's regional
target is its enrollment target scaled by the share of its sites in the region.

Allocations, all evaluated under the same model:
  actual        registered CT.gov site lists (the observed baseline; headline comparison)
  indep         each trial's best response ignoring the others (master doc §4.4)
  coord_free    joint optimum, no participation constraint
  coord         joint optimum subject to no trial doing worse than under `actual`
  coord_nl_indep  joint optimum subject to no trial doing worse than its own best response
                (`indep`). This isolates coordination from better site selection, which a
                single sponsor can already buy; it is the market-design number.

Model choices that came out of trying to break the result (README "Robustness"):
  beta          congestion elasticity from the within-site regression, not the assumed 1
  level         site rates scaled by the backtest bias for industry Phase II/III trials
  f             eligibility enters only relative to the instance median (backtest: its
                absolute level does not predict enrollment)
  flagged       trials with implausible model times are held fixed at their registered
                sites as background congestion and excluded from every number
  universe      "registered" (default): trials can only be reassigned among sites that some
                instance trial actually registered, so the result cannot come from "discovering"
                sites whose public-data rates are noise (the optimizer's curse); "history": any
                site in the region with industry lung-trial history (expansion to idle sites)
  rate_cap_q    site rates winsorized at this quantile of sites with >= 5 lung trials
  low_history   "model" (default): fitted rates with low-history sites capped at the prior's
                25th percentile, the variant that wins the backtest; "prior": raw posterior
                means (the optimistic variant); "exclude": model rates, and low-history sites
                cannot be added as candidates
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass, field
from functools import lru_cache

import numpy as np
from scipy.stats import gamma as gamma_dist

from concord.allocator import core
from concord.compiler.eligibility import Criterion, eligible_fraction, eligible_mask
from concord.compiler.overrides import OVERRIDES
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
BASE_FILTER = """t.is_lung=1 AND t.sponsor_class='INDUSTRY' AND (t.phases LIKE '%PHASE2%' OR t.phases LIKE '%PHASE3%')"""

# Tufts CSDD (Aug 2024), industry averages; illustrative conversion only.
DIRECT_COST_PER_DAY = 40_000
LOST_SALES_PER_DAY = 800_000
DAYS_PER_MONTH = 30.44
# Model times above this under the registered allocation are treated as parse/estimate
# failures: the trial is held fixed as background and excluded from every reported number.
PLAUSIBLE_T_MONTHS = 120.0
FALLBACK_BETA = 1.0  # master doc eq. (2), used only if the congestion test has not been run


@dataclass
class Params:
    region: str = "US-Northeast"
    as_of: str | None = None  # YYYY-MM-DD; None = currently recruiting
    sponsor: str | None = None  # portfolio mode: only this sponsor's trials move
    beta: float | None = None  # None = within-site estimate from concord.analysis.congestion
    # Raw posteriors put barely-known sites near the prior mean (median 0.34 for 1-trial sites vs
    # 0.04 for 21+), so an optimizer flocks to them. The default model caps them (see backtest).
    low_history: str = "model"  # "model" | "prior" | "exclude"
    universe: str = "registered"  # "registered" | "history"
    rate_cap_q: float = 0.95
    # 0 because backtest-calibrated rates are measured over windows that already include site
    # activation; a positive lag double counts it. With lag 0 every ratio is invariant to the level.
    activation_lag: float = 0.0
    overlap_scale: float = 1.0
    capacity_scale: float = 1.0
    max_trials: int | None = None
    time_limit: float = 6.0
    calibrate: bool = True  # de-congest busy sites so the registered allocation reproduces history
    level: bool = True  # scale rates by the backtest bias
    f_clip: tuple[float, float] = (0.25, 4.0)

    def key(self) -> tuple:
        d = asdict(self)
        d["f_clip"] = tuple(self.f_clip)
        return tuple(sorted(d.items()))


@dataclass
class Built:
    params: Params
    inst: core.Instance
    trials: list[dict]
    sites: list[dict]
    criteria: list[list[Criterion]]
    masks: np.ndarray  # (P, n_pop) eligibility masks
    x_actual: np.ndarray
    flagged: np.ndarray  # (P,) bool
    assumptions: dict
    order: list[int] = field(default_factory=list)


def _con() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError("data/concord.db missing: run scripts/pipeline.sh first")
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def _meta(con: sqlite3.Connection, key: str):
    row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else None


@lru_cache(maxsize=1)
def population() -> dict:
    return synthetic_population(20_000)


def overlap_matrix(masks: np.ndarray) -> np.ndarray:
    m = masks.astype(np.float32)
    inter = m @ m.T
    size = np.maximum(m.sum(axis=1), 1.0)
    return inter / size[:, None]  # o[P, Q] = Pr[e_Q | e_P]


def congestion_beta(con: sqlite3.Connection) -> dict:
    test = _meta(con, "congestion_test")
    if not test:
        return {"beta": FALLBACK_BETA, "source": "assumed (congestion test not run)"}
    r = test["results"]["within_overlap"]
    return {"beta": max(0.0, -r["coef"]), "ci95": [max(0.0, -r["ci95"][1]), max(0.0, -r["ci95"][0])],
            "p": r["p"], "source": "within-site regression, concord.analysis.congestion"}


def build(params: Params) -> Built:
    con = _con()
    states = REGIONS[params.region]
    region_sql = "s.country='United States'" + (f" AND s.state IN ({','.join('?' * len(states))})" if states else "")
    args: list = list(states or [])
    if params.as_of:
        # Recruiting on the date = inside the enrollment window (same definition as the backtest),
        # not merely before primary completion, which includes follow-up.
        from concord.model.recruitment import ENROLL_FRACTION
        when = (f"t.status NOT IN ('WITHDRAWN') AND t.start_date <= ? AND julianday(t.start_date) + {ENROLL_FRACTION} * "
                "(julianday(COALESCE(t.primary_completion_date, t.completion_date, '2100-01-01')) - "
                "julianday(t.start_date)) > julianday(?)")
        when_args = [params.as_of, params.as_of]
    else:
        when, when_args = "t.status='RECRUITING'", []

    trows = con.execute(f"""
        SELECT t.nct_id, t.title, t.acronym, t.sponsor, t.phases, t.enrollment, t.n_sites, t.start_date,
               t.primary_completion_date, t.primary_completion_type, t.enrollment_type,
               tm.criteria, COUNT(*) AS n_region
        FROM trials t JOIN trial_model tm USING(nct_id)
        JOIN trial_sites ts USING(nct_id) JOIN sites s USING(site_id)
        WHERE {BASE_FILTER} AND {when} AND {region_sql}
        GROUP BY t.nct_id ORDER BY t.start_date""", when_args + args).fetchall()
    if params.max_trials:
        trows = trows[: params.max_trials]
    trial_ids = [r["nct_id"] for r in trows]
    if not trial_ids:
        raise ValueError("no trials match this region / date")
    ph = ",".join("?" * len(trial_ids))

    srows = con.execute(f"""
        SELECT s.*, sm.lam_eff, sm.lam_mean, sm.shape, sm.rate, sm.n_hist, sm.n_hist_industry, sm.k_hist, sm.fitted
        FROM sites s JOIN site_model sm USING(site_id)
        WHERE {region_sql} AND (sm.n_hist_industry > 0 OR s.site_id IN (
            SELECT site_id FROM trial_sites WHERE nct_id IN ({ph})))""", args + trial_ids).fetchall()
    site_ids = [r["site_id"] for r in srows]
    s_idx = {s: i for i, s in enumerate(site_ids)}
    t_idx = {t: i for i, t in enumerate(trial_ids)}
    x_actual = np.zeros((len(site_ids), len(trial_ids)), dtype=bool)
    for nct, sid in con.execute(f"SELECT nct_id, site_id FROM trial_sites WHERE nct_id IN ({ph})", trial_ids):
        if sid in s_idx:
            x_actual[s_idx[sid], t_idx[nct]] = True

    # Eligibility: hand-encoded where we have it, rule-based parse otherwise. Only relative f is used.
    pop = population()
    criteria, provenance = [], []
    for r in trows:
        if r["nct_id"] in OVERRIDES:
            criteria.append(OVERRIDES[r["nct_id"]]); provenance.append("hand-encoded")
        else:
            criteria.append([Criterion(**c) for c in json.loads(r["criteria"])]); provenance.append("rule-based parse")
    masks = np.array([eligible_mask(c, pop) for c in criteria])
    f = np.array([eligible_fraction(c, pop) for c in criteria])
    f_rel = np.clip(f / np.median(f), *params.f_clip)
    o = np.clip(overlap_matrix(masks) * params.overlap_scale, 0, 1)

    beta_info = congestion_beta(con) if params.beta is None else {"beta": params.beta, "source": "user setting"}
    beta = beta_info["beta"]
    from concord.model.recruitment import LOW_HISTORY_N
    bt = _meta(con, "backtest") or {}
    variant = "raw" if params.low_history == "prior" else "model"
    level_bias = (bt.get("by_model", {}).get(variant, {}).get("industry_p23", {})
                  .get("median_signed_log_bias", 0.0)) if params.level else 0.0
    col = "lam_mean" if params.low_history == "prior" else "lam_eff"
    lam = np.array([r[col] for r in srows]) * np.exp(level_bias)
    n_hist = np.array([r["n_hist"] for r in srows])
    low = n_hist < LOW_HISTORY_N
    anonymized = np.array([bool(r["anonymized"]) for r in srows])
    feasible = ~anonymized
    if params.low_history == "exclude":
        feasible = feasible & ~low
    if params.universe == "registered":
        # Market mode: any site some instance trial registered. Portfolio mode: the sponsor's own
        # registered network, so internal clearing never pushes into other sponsors' sites.
        own = (np.array([params.sponsor.lower() in (r["sponsor"] or "").lower() for r in trows])
               if params.sponsor else np.ones(len(trows), dtype=bool))
        feasible = feasible & x_actual[:, own].any(axis=1)
    experienced = n_hist >= 5
    if params.rate_cap_q < 1 and experienced.sum() >= 20:
        lam = np.minimum(lam, np.quantile(lam[experienced], params.rate_cap_q))
    feasible = np.repeat(feasible[:, None], len(trial_ids), axis=1)

    if params.calibrate:
        # Fitted rates are realized rates, already slowed by the congestion of their day. Scale each
        # busy site's flow so the registered allocation reproduces its historical rate. Idle sites
        # get no boost, which favors the status quo (conservative for the dividend).
        od = o - np.diag(np.diag(o))
        load = x_actual.astype(float) @ od.T
        busy = x_actual.sum(axis=1)
        mean_g = np.where(busy > 0, ((1 + load) ** (-beta) * x_actual).sum(axis=1) / np.maximum(busy, 1), 1.0)
        lam = lam / mean_g

    n_region = x_actual.sum(axis=0)
    N = np.array([max(1.0, (r["enrollment"] or 0) * n / max(r["n_sites"], 1)) for r, n in zip(trows, n_region)])
    k = np.maximum.reduce([np.array([r["k_hist"] for r in srows]), x_actual.sum(axis=1), np.ones(len(srows), int)])
    k = np.maximum(1, np.round(k * params.capacity_scale)).astype(int)

    inst = core.Instance(lam=lam, a=np.full(len(srows), params.activation_lag), k=k, f=f_rel, N=N,
                         n_max=np.maximum(n_region, 1), w=np.ones(len(trial_ids)), o=o, feasible=feasible,
                         site_ids=site_ids, trial_ids=trial_ids, beta=beta)

    # Flag before solving: implausible time under the registered allocation. (A low eligible fraction
    # alone is not a flag: biomarker-selected trials legitimately have one, and f is clipped anyway.)
    T0 = core.evaluate(inst, x_actual)
    flagged = T0 > PLAUSIBLE_T_MONTHS
    movable = ~flagged
    if params.sponsor:
        movable &= np.array([params.sponsor.lower() in (r["sponsor"] or "").lower() for r in trows])
    inst = inst.replace(movable=movable, w=movable.astype(float))

    trials = [{
        "nct_id": r["nct_id"], "title": r["title"], "acronym": r["acronym"], "sponsor": r["sponsor"],
        "phases": json.loads(r["phases"]), "enrollment": r["enrollment"], "n_sites_total": r["n_sites"],
        "n_sites_region": int(n), "target_region": round(float(nr), 1), "f": float(fi), "f_rel": float(fr),
        "criteria": [c.to_dict() for c in cr], "eligibility_source": pv,
        "realized_window_months": _realized(r),
        "flagged": bool(fl), "movable": bool(mv),
    } for r, n, nr, fi, fr, cr, pv, fl, mv in zip(trows, n_region, N, f, f_rel, criteria, provenance, flagged,
                                                     movable)]
    sites = [{
        "site_id": r["site_id"], "facility": r["facility"], "city": r["city"], "state": r["state"],
        "country": r["country"], "lat": r["lat"], "lon": r["lon"], "is_amc": bool(r["is_amc"]),
        "anonymized": bool(r["anonymized"]), "lam_hist": r["lam_eff"], "lam_raw": r["lam_mean"], "lam_flow": float(lf),
        "lam_ci": _gamma_ci(r["shape"], r["rate"]), "fitted": bool(r["fitted"]), "n_hist": r["n_hist"],
        "low_history": bool(lw), "k": int(kk),
    } for r, kk, lf, lw in zip(srows, k, inst.lam, low)]
    assumptions = {"beta": beta_info, "level_log_bias": level_bias, "level_factor": float(np.exp(level_bias)),
                   "low_history": params.low_history, "low_history_n": LOW_HISTORY_N,
                   "universe": params.universe, "rate_cap_q": params.rate_cap_q,
                   "candidate_sites": int(feasible[:, 0].sum()),
                   "activation_lag_months": params.activation_lag, "f_clip": list(params.f_clip),
                   "plausible_T_cap_months": PLAUSIBLE_T_MONTHS}
    con.close()
    return Built(params, inst, trials, sites, criteria, masks, x_actual, flagged, assumptions,
                 order=list(range(len(trial_ids))))


def _realized(r) -> float | None:
    """Realized enrollment window for trials that have finished enrolling (same definition as the fit)."""
    if r["enrollment_type"] != "ACTUAL" or r["primary_completion_type"] != "ACTUAL" or not r["primary_completion_date"]:
        return None
    from datetime import date
    from concord.model.recruitment import ENROLL_FRACTION
    d = (date.fromisoformat(r["primary_completion_date"]) - date.fromisoformat(r["start_date"])).days / 30.44
    return round(d * ENROLL_FRACTION, 2)


def _gamma_ci(shape: float, rate: float) -> list[float]:
    return [float(gamma_dist.ppf(q, shape, scale=1.0 / rate)) for q in (0.1, 0.9)]


def compare(base: np.ndarray, new: np.ndarray, mask: np.ndarray) -> dict:
    """Movable trials only: dividend, PoA-style ratio, per-trial distribution."""
    b, n = base[mask], new[mask]
    ratio = b / n
    return {
        "trials": int(mask.sum()),
        "dividend_trial_months": float((b - n).sum()),
        "ratio": float(b.sum() / n.sum()) if n.sum() > 0 else None,
        "median_speedup": float(np.median(ratio)) if len(ratio) else None,
        "share_faster": float(np.mean(n < b - 1e-6)) if len(b) else None,
        "share_slower": float(np.mean(n > b + 1e-6)) if len(b) else None,
        "worst_slowdown_months": float(np.max(n - b)) if len(b) else None,
        "median_T_base": float(np.median(b)) if len(b) else None,
        "median_T_new": float(np.median(n)) if len(n) else None,
    }


_cache: dict[tuple, dict] = {}


def solve(params: Params, b: Built | None = None) -> dict:
    """All four allocations for one parameter setting (cached)."""
    if params.key() in _cache:
        return _cache[params.key()]
    b = b or build(params)
    inst = b.inst
    background = b.x_actual.copy()
    background[:, inst.movable] = False

    T_act = core.evaluate(inst, b.x_actual)
    x_ind = core.independent(inst, order=b.order, background=b.x_actual)
    x_free, st_free = core.coordinate(inst, x0=background, time_limit=params.time_limit)
    # No-loser: every trial, background included, capped at its registered-allocation time.
    capped = inst.replace(caps=T_act)
    x_nl, st_nl = core.coordinate(capped, x0=b.x_actual, time_limit=params.time_limit)
    T_ind = core.evaluate(inst, x_ind)
    x_nli, st_nli = core.coordinate(inst.replace(caps=T_ind), x0=x_ind, time_limit=params.time_limit)
    out = {"built": b, "x": {"actual": b.x_actual, "indep": x_ind, "coord_free": x_free, "coord": x_nl,
                             "coord_nl_indep": x_nli},
           "solver": {"coord_free": st_free, "coord": st_nl, "coord_nl_indep": st_nli}}
    out["T"] = {k: core.evaluate(inst, x) for k, x in out["x"].items()}
    _cache[params.key()] = out
    return out


def clear(params: Params) -> dict:
    run = solve(params)
    if "result" in run:
        return run
    b, inst, T, X = run["built"], run["built"].inst, run["T"], run["x"]
    mv = inst.movable
    n_reg = b.x_actual.sum(axis=0)

    head = compare(T["actual"], T["coord"], mv)
    div_days = head["dividend_trial_months"] * DAYS_PER_MONTH
    bg = ~mv
    summary = {
        "headline": "coord vs actual, no trial worse off",
        "coord_vs_actual": head,
        "coordination_no_loser_vs_indep": compare(T["indep"], T["coord_nl_indep"], mv),
        "coord_free_vs_actual": compare(T["actual"], T["coord_free"], mv),
        "coord_free_vs_indep": compare(T["indep"], T["coord_free"], mv),
        "indep_vs_actual": compare(T["actual"], T["indep"], mv),
        "background_trials": int(bg.sum()),
        "background_worse_under_coord_free": int((T["coord_free"][bg] > T["actual"][bg] + 1e-6).sum()),
        "site_counts": {k: {"max_excess_over_registered": int((X[k][:, mv].sum(axis=0) - n_reg[mv]).max(initial=0)),
                            "total_sites": int(X[k][:, mv].sum())} for k in X},
        "calibration_check": _calibration_check(b, T["actual"]),
        "assumptions": b.assumptions,
        "dividend_days": div_days,
        "dollars_direct": div_days * DIRECT_COST_PER_DAY,
        "dollars_lost_sales": div_days * LOST_SALES_PER_DAY,
        "dollars_note": "No-loser dividend vs registered sites x Tufts CSDD 2024 industry averages (~$40K/day "
                        "direct Phase II/III cost; ~$800K/day lost sales for a launched drug). Regional slices "
                        "of trials, not whole trials. Illustrative only.",
        "solver": run["solver"],
    }
    for p, t in enumerate(b.trials):
        t.update({f"T_{k}": _m(T[k][p]) for k in X})
        t.update({f"sites_{k}": int(X[k][:, p].sum()) for k in X})
    for i, s in enumerate(b.sites):
        s.update({f"load_{k}": int(X[k][i].sum()) for k in X})
    run["result"] = {
        "params": asdict(b.params),
        "counts": {"trials": inst.P, "movable_trials": int(mv.sum()), "flagged_trials": int(b.flagged.sum()),
                   "sites": inst.S, **{f"sites_used_{k}": int(X[k].any(axis=1).sum()) for k in X}},
        "summary": summary,
        "trials": b.trials,
        "sites": b.sites,
        "assignments": {k: _pairs(x, inst) for k, x in X.items()},
    }
    return run


def _calibration_check(b: Built, T_act: np.ndarray) -> dict:
    con = _con()
    from datetime import date
    durs = [(date.fromisoformat(e) - date.fromisoformat(s)).days / 30.44 for s, e in con.execute(f"""
        SELECT start_date, primary_completion_date FROM trials t WHERE {BASE_FILTER} AND t.phases LIKE '%PHASE3%'
          AND status='COMPLETED' AND primary_completion_type='ACTUAL' AND start_date IS NOT NULL
          AND primary_completion_date IS NOT NULL""")]
    con.close()
    p3 = np.array(["PHASE3" in t["phases"] for t in b.trials]) & b.inst.movable
    from concord.model.recruitment import ENROLL_FRACTION
    # Same trials, realized: only available for past `as_of` instances (trials that have finished).
    real = np.array([t["realized_window_months"] or np.nan for t in b.trials])
    ok = b.inst.movable & np.isfinite(real) & (T_act < core.NO_SITES_T)
    same = {"n": int(ok.sum())}
    if ok.sum() >= 5:
        lr = np.log(T_act[ok] / real[ok])
        same.update(median_model=float(np.median(T_act[ok])), median_realized=float(np.median(real[ok])),
                    median_log_ratio=float(np.median(lr)), median_abs_log_ratio=float(np.median(np.abs(lr))))
    return {
        "same_trials_model_vs_realized": same,
        "model_median_T_actual_phase3": float(np.median(T_act[p3])) if p3.any() else None,
        "model_median_T_actual_all": float(np.median(T_act[b.inst.movable])) if b.inst.movable.any() else None,
        "phase3_trials_in_instance": int(p3.sum()),
        "real_completed_phase3_median_enrollment_window": float(np.median(durs) * ENROLL_FRACTION),
        "real_completed_phase3_median_start_to_primary_completion": float(np.median(durs)),
        "real_n": len(durs),
    }


def _m(t: float) -> float | None:
    return None if t >= core.NO_SITES_T else round(float(t), 2)


def _pairs(x: np.ndarray, inst: core.Instance) -> list[list[str]]:
    s, p = np.nonzero(x)
    return [[inst.site_ids[i], inst.trial_ids[j]] for i, j in zip(s, p)]


def robustness(params: Params) -> dict:
    """Try to break the result: congestion elasticity x low-history rule, headline and unconstrained."""
    con = _con()
    bi = congestion_beta(con)
    con.close()
    betas = [("data estimate", bi["beta"])]
    if "ci95" in bi:
        betas += [("CI lower", bi["ci95"][0]), ("CI upper", bi["ci95"][1])]
    betas += [("assumed (master doc)", 1.0)]
    rows = []
    for bl, beta in betas:
        for lh, uni in (("model", "registered"), ("model", "history"), ("prior", "history"), ("exclude", "history")):
            p = Params(**{**asdict(params), "beta": beta, "low_history": lh, "universe": uni})
            r = clear(p)["result"]["summary"]
            rows.append({"beta_label": bl, "beta": beta, "low_history": lh, "universe": uni,
                         "coord_vs_actual": r["coord_vs_actual"], "coord_free_vs_actual": r["coord_free_vs_actual"],
                         "coordination_no_loser_vs_indep": r["coordination_no_loser_vs_indep"],
                         "indep_vs_actual": r["indep_vs_actual"],
                         "coord_free_vs_indep": r["coord_free_vs_indep"]})
    return {"params": asdict(params), "rows": rows}


# Counterfactual re-solves: deterministic warm start (no kicks, fixed passes), compared against
# the same procedure run on the unchanged market so solver progress is not credited to the change.
RESOLVE = dict(patience=0, max_passes=2, time_limit=60.0)


def _reference(params: Params) -> np.ndarray:
    run = clear(params)
    if "x_ref" not in run:
        run["x_ref"], _ = core.coordinate(run["built"].inst, x0=run["x"]["coord_free"], **RESOLVE)
    return run["x_ref"]


def price_tags(params: Params, nct_id: str) -> dict:
    """Months of enrollment each eligibility criterion of one trial costs (§4.5), by dropping
    it, recomputing f and overlaps, and re-solving from the unconstrained cleared allocation."""
    run = clear(params)
    b, x0 = run["built"], run["x"]["coord_free"]
    inst = b.inst
    p = inst.trial_ids.index(nct_id)
    pop = population()
    T_ref = core.evaluate(inst, _reference(params))
    base_obj, base_T = float(inst.w @ T_ref), T_ref[p]
    f_base = max(eligible_fraction(b.criteria[p], pop), 1e-9)
    out = []
    for c in b.criteria[p]:
        f_new = eligible_fraction(b.criteria[p], pop, drop=c.id)
        masks = b.masks.copy()
        masks[p] = eligible_mask(b.criteria[p], pop, drop=c.id)
        f = inst.f.copy()
        f[p] = np.clip(inst.f[p] * f_new / f_base, *params.f_clip)
        relaxed = inst.replace(f=f, o=np.clip(overlap_matrix(masks) * params.overlap_scale, 0, 1))
        x, _ = core.coordinate(relaxed, x0=x0, **RESOLVE)
        T = core.evaluate(relaxed, x)
        out.append({**c.to_dict(), "pool_multiplier": round(f_new / f_base, 2),
                    "months_saved_trial": round(float(base_T - T[p]), 2),
                    "months_saved_portfolio": round(base_obj - float(inst.w @ T), 2)})
    # Dropping one of several OR'ed alternatives (e.g. "ALK or ROS1") narrows the pool; it is not a
    # relaxable restriction, so it gets no price tag.
    alternatives = [r["label"] for r in out if r["pool_multiplier"] < 1.0]
    out = [r for r in out if r["pool_multiplier"] >= 1.0]
    out.sort(key=lambda r: -r["months_saved_trial"])
    return {"nct_id": nct_id, "T_coord": _m(base_T), "criteria": out, "alternatives_not_priced": alternatives,
            "eligibility_source": b.trials[p]["eligibility_source"],
            "note": "Synthetic population; congestion elasticity from data. Not clinical advice."}


def slot_values(params: Params, top: int = 12) -> list[dict]:
    """Portfolio months saved by one more concurrent-trial slot at the busiest full sites."""
    run = clear(params)
    b, x0 = run["built"], run["x"]["coord_free"]
    inst = b.inst
    base_obj = float(inst.w @ core.evaluate(inst, _reference(params)))
    full = np.flatnonzero(x0.sum(axis=1) >= inst.k)
    full = full[np.argsort(-inst.lam[full])][:top]
    out = []
    for s in full:
        k = inst.k.copy()
        k[s] += 1
        more = inst.replace(k=k)
        x, _ = core.coordinate(more, x0=x0, **RESOLVE)
        out.append({**b.sites[s], "months_saved": round(base_obj - float(more.w @ core.evaluate(more, x)), 2)})
    out.sort(key=lambda r: -r["months_saved"])
    return out
