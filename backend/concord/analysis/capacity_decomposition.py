"""Task B: where the joint optimum's gain over best response comes from (capacity or congestion).

    python -m concord.analysis.capacity_decomposition --out ../data/robustness/capacity.json

Question. In US-Northeast at the estimated congestion elasticity, the joint optimum (coord_free)
beats every trial's best response (indep) by 1.57x on summed enrollment months, while ~42% of
trials end up slower. Site capacity k_s is each site's historical peak concurrency. Is the gain
from allocating scarce slots at proven sites (capacity), or from congestion between trials?

PRE-REGISTERED METHOD (written and committed before any result of this task was computed)

Scenarios
  primary    US-Northeast, service.Params() defaults (estimated beta, low_history="model",
             universe="registered", time_limit=6.0, ...).
  secondary  Params(region="US", sponsor="Regeneron", as_of="2024-09-01") (portfolio mode: only
             Regeneron trials move, other sponsors' trials are fixed background). Run if time allows.

Settings (all other params at the scenario defaults; all at the estimated beta unless stated)
  peak            default k_s = historical peak concurrency
  unlimited       capacity_unlimited=True (capacity never binds)
  peak+1          capacity_add=1
  1.5x peak       capacity_scale=1.5
  beta=0 at peak  beta=0.0 (no congestion at all; calibration then also has no de-congestion)

Per setting, in-sample (rates fit on full history, as in production):
  run = service.solve(params, cache=False); blocks = service.comparisons(run["T"], movable).
  Reported blocks: coord_free_vs_indep (PRIMARY), coord_free_vs_actual, coord_vs_actual,
  indep_vs_actual, coordination_no_loser_vs_indep; stats ratio, median_speedup, share_slower
  (plus the rest of each compare() block in the JSON).

Per setting, held-out (same machinery as the pitch-blocking holdout task A, defined here so this
task is independent of it):
  split = recruitment.split_alternating(con)   (fixed definition; not changed here)
  rates_h = recruitment.fit_rate_table(con, keep=lambda t: split.get(t) == h) for h in A, B
  for (choose, score) in (A, B), (B, A):
      b_choose = service.build(params, rates=rates_choose)
      run      = service.solve(params, b_choose, cache=False)
      b_score  = service.build(params, rates=rates_score, movable=b_choose.inst.movable)
      T_held   = service.rescore(b_score, run["x"])
      half in-sample = comparisons(run["T"], mv); held-out = comparisons(T_held, mv)
  Aggregation over the two directions: geometric mean of ratio and of median_speedup; arithmetic
  mean of share_slower and share_faster (shares can be 0, so no geometric mean for them).
  Reported side by side: full-history in-sample | half-history in-sample (geo mean) | held-out
  (geo mean). The apples-to-apples optimizer's-curse shrinkage is half in-sample -> held-out.

Decomposition (pre-registered formulas; r = coord_free_vs_indep ratio of the setting named)
  capacity share of the joint-optimum gain = 1 - log(r_unlimited) / log(r_peak)
      PRIMARY on full-history in-sample ratios; also computed on half in-sample and held-out ratios.
      If r_peak <= 1 it is reported as n/a.
  congestion share (secondary) = 1 - log(r_beta0) / log(r_peak), same conventions. The two shares
      come from different counterfactuals and need not add to 1.
  dependence on k_s = historical peak: log(r_setting) / log(r_peak) for peak, peak+1, 1.5x peak,
      unlimited, i.e. the share of the peak gain left as capacity is relaxed; reported for the
      joint optimum vs best response and also for the headline coord_vs_actual and for
      indep_vs_actual (how the pitch numbers move with the capacity assumption).
  Reading rule (fixed now): if capacity share >= 0.8, the gain is called capacity-driven
  ("allocating scarce slots at proven sites"); if <= 0.2, not capacity-driven; otherwise mixed.

Diagnostics (reported, never substituted for the numbers above)
  - unfilled trials: movable trials with T >= core.NO_SITES_T under each allocation; if any
    exist under indep or coord_free, also the coord_free_vs_indep ratio over trials filled under both.
  - dividend concentration: share of the coord_free_vs_indep dividend (sum T_indep - sum T_free over
    movable trials) contributed by the 10% of movable trials with the largest individual gain.
  - capacity binding: sites at capacity (load >= k_s) under indep and coord_free; share of movable
    trials' site slots placed at proven sites (n_hist >= 5 lung trials, the build's "experienced"
    rule) under actual, indep and coord_free.
  - solver: stats per solve (hit_time_limit etc.); and one solver-noise check, the peak setting
    in-sample re-solved with time_limit=12, reported only as a measure of solver noise.

No parameter is tuned; every number that comes out is reported, including ones that weaken the pitch.

POST-AUDIT BUG FIXES (written and committed before the re-run; the method above is otherwise unchanged)

Fix 1 - solver budget no longer depends on wall-clock time. service.solve calls core.coordinate with
  time_limit=6 and the default patience, so how far greedy, local search, exchanges and kicks get
  depends on CPU load: the same code, data and params gave e.g. 1.135 vs 1.075 held-out no-loser and
  1.269 vs 1.162 Regeneron in-sample on two runs. Every solve in this task now goes through solve_det,
  a copy of service.solve that changes only the coordinate() budget to the codebase's own convention
  for counterfactuals (service.RESOLVE: patience=0, max_passes=2, i.e. greedy + 2 local-search passes,
  no exchanges, no kicks), with time_limit raised to 900 s as a safety bound that must never bind.
  Every solve records hit_time_limit; a solve that hits it is flagged as not deterministic.
  This is a weaker search than the 6 s iterated local search, so coord / coord_free numbers can come
  out lower than before; that is accepted, never compensated.
  Checks (context, not substituted for the numbers above):
  - reproducibility: the peak setting (full history + both directions) is solved a second time with
    solve_det; every ratio must match exactly.
  - run-to-run range of the old wall-clock solver: the peak setting of US-Northeast re-run
    WALLCLOCK_REPEATS times with the unchanged service.solve (6 s), reported as min-max beside the
    deterministic numbers, together with the original run and the audit's re-run.

Fix 2 - plausibility screen applied to held-out scoring, as a sensitivity. In-sample builds hold
  trials whose registered allocation takes > 120 months (service.PLAUSIBLE_T_MONTHS) as background
  and exclude them from every number; held-out scoring kept trials that are implausible under the
  score half's rates. Now every held-out (and half in-sample) block is also computed over the
  "screened" set: trials movable in the choose build AND with T_registered <= 120 months under the
  score half's rates (the same screen, applied under both halves). The solve itself is unchanged (the
  screen uses score-half information, so it may only restrict which trials are evaluated, never what
  is chosen). The pre-registered unscreened numbers stay in place; the screened ones are reported
  beside them, with the excluded trials listed (T_registered under both halves, share of the
  held-out registered sum). The screened number is the like-for-like comparison with in-sample
  numbers; where the two differ the report recommends the lower one for the pitch.

Fix 3 - the capacity_scale=1.5 setting is relabelled. service.build computes
  k = max(1, np.round(1.5 * k_peak)), and np.round rounds half to even, so k=1 -> 2, 2 -> 3, 3 -> 4,
  4 -> 6, 5 -> 8: it is at least peak+1 at every site and differs from peak+1 only at sites with
  k_peak >= 4. It is now labelled "round(1.5x peak)" and each setting reports sum k, sum k / peak
  total, median k / k_peak, and the number of sites and slots by which it differs from peak+1.
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
import time
from dataclasses import asdict, replace

import numpy as np

from concord import service
from concord.allocator import core
from concord.model import recruitment as R
from concord.paths import DB_PATH, ROOT

SCENARIOS = {
    "US-Northeast": service.Params(),
    "Regeneron US 2024-09-01": service.Params(region="US", sponsor="Regeneron", as_of="2024-09-01"),
}
SCENARIO_KEYS = {"ne": "US-Northeast", "regeneron": "Regeneron US 2024-09-01"}
R15 = "round(1.5x peak)"  # capacity_scale=1.5: k = max(1, np.round(1.5 k_peak)), half to even (Fix 3)
SETTINGS = [
    ("peak", {}),
    ("unlimited", {"capacity_unlimited": True}),
    ("peak+1", {"capacity_add": 1}),
    (R15, {"capacity_scale": 1.5}),
    ("beta=0 at peak", {"beta": 0.0}),
]
CAPACITY_LADDER = ["peak", "peak+1", R15, "unlimited"]
BLOCKS = ["coord_free_vs_indep", "coord_free_vs_actual", "coord_vs_actual", "indep_vs_actual",
          "coordination_no_loser_vs_indep"]
GEO = ("ratio", "median_speedup")
ARITH = ("share_slower", "share_faster")
PROVEN_N = 5  # the build's "experienced" rule (n_hist >= 5 lung trials)
# Fix 1: deterministic solver budget (service.RESOLVE's patience / max_passes; the time limit is a
# safety bound only and must not bind).
SOLVER = dict(patience=service.RESOLVE["patience"], max_passes=service.RESOLVE["max_passes"], time_limit=900.0)
WALLCLOCK_REPEATS = 2
# Held-out views: pre-registered (unscreened) and the Fix 2 sensitivity (screened under both halves).
HALF_VIEWS = ["in_sample_half", "held_out", "in_sample_half_screened", "held_out_screened"]


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def solve_det(params: service.Params, b: service.Built | None = None) -> dict:
    """service.solve with a wall-clock-independent coordinate() budget (Fix 1). Same allocations,
    same starts and caps; only the solver kwargs differ."""
    b = b or service.build(params)
    inst = b.inst
    background = b.x_actual.copy()
    background[:, inst.movable] = False
    T_act = core.evaluate(inst, b.x_actual)
    x_ind = core.independent(inst, order=b.order, background=b.x_actual)
    x_free, st_free = core.coordinate(inst, x0=background, **SOLVER)
    x_nl, st_nl = core.coordinate(inst.replace(caps=T_act), x0=b.x_actual, **SOLVER)
    T_ind = core.evaluate(inst, x_ind)
    x_nli, st_nli = core.coordinate(inst.replace(caps=T_ind), x0=x_ind, **SOLVER)
    out = {"built": b, "x": {"actual": b.x_actual, "indep": x_ind, "coord_free": x_free, "coord": x_nl,
                             "coord_nl_indep": x_nli},
           "solver": {"coord_free": st_free, "coord": st_nl, "coord_nl_indep": st_nli}}
    out["T"] = {k: core.evaluate(inst, x) for k, x in out["x"].items()}
    hit = [k for k, v in out["solver"].items() if v["hit_time_limit"]]
    if hit:
        log(f"  WARNING: solve hit the {SOLVER['time_limit']} s safety bound ({hit}); not deterministic")
    return out


SOLVE = solve_det  # set to service.solve (cache=False) only for the wall-clock range check


def _solve(params: service.Params, b: service.Built | None = None) -> dict:
    return SOLVE(params, b) if SOLVE is solve_det else service.solve(params, b, cache=False)


def _blocks(T: dict, mv: np.ndarray) -> dict:
    c = service.comparisons(T, mv)
    return {k: c[k] for k in BLOCKS}


def _aggregate(dirs: list[dict]) -> dict:
    """Geometric mean of ratio / median_speedup and arithmetic mean of shares over the directions."""
    out = {}
    for blk in BLOCKS:
        row = {}
        for st in GEO:
            v = [d[blk][st] for d in dirs]
            row[st] = (float(math.exp(np.mean(np.log(v)))) if all(x is not None and x > 0 for x in v) else None)
        for st in ARITH:
            v = [d[blk][st] for d in dirs]
            row[st] = float(np.mean(v)) if all(x is not None for x in v) else None
        row["by_direction_ratio"] = [d[blk]["ratio"] for d in dirs]
        row["by_direction_share_slower"] = [d[blk]["share_slower"] for d in dirs]
        row["by_direction_worst_slowdown_months"] = [d[blk]["worst_slowdown_months"] for d in dirs]
        out[blk] = row
    return out


def _k_summary(k: np.ndarray, k_peak: np.ndarray | None) -> dict:
    """Fix 3: what a capacity setting does to k_s, against the peak setting of the same scenario."""
    d = {"sum_k": int(k.sum()), "median_k": float(np.median(k))}
    if k_peak is not None and len(k_peak) == len(k):
        d["sum_k_over_peak_total"] = float(k.sum() / k_peak.sum())
        d["median_k_over_k_peak"] = float(np.median(k / k_peak))
        p1 = k_peak + 1
        diff = k != p1
        d["sites_differing_from_peak_plus_1"] = int(diff.sum())
        d["slots_over_peak_plus_1"] = int((k - p1)[diff].sum())
        d["min_k_peak_where_differs_from_peak_plus_1"] = int(k_peak[diff].min()) if diff.any() else None
        d["at_least_peak_plus_1_everywhere"] = bool((k >= p1).all())
    return d


def _diagnostics(b: service.Built, X: dict, T: dict, inst: core.Instance) -> dict:
    mv = inst.movable
    unfilled = {k: int((T[k][mv] >= core.NO_SITES_T).sum()) for k in T}
    d = {"unfilled_movable_trials": unfilled}
    if unfilled["indep"] or unfilled["coord_free"]:
        ok = mv & (T["indep"] < core.NO_SITES_T) & (T["coord_free"] < core.NO_SITES_T)
        d["coord_free_vs_indep_ratio_filled_both"] = float(T["indep"][ok].sum() / T["coord_free"][ok].sum())
    gain = (T["indep"] - T["coord_free"])[mv]
    total = float(gain.sum())
    n_top = max(1, int(math.ceil(0.10 * len(gain))))
    top = np.sort(gain)[::-1][:n_top]
    d["dividend_coord_free_vs_indep"] = {
        "total_trial_months": total, "top10pct_trials": n_top,
        "top10pct_share": float(top.sum() / total) if total > 0 else None,
        "largest_single_gain_months": float(gain.max()) if len(gain) else None,
        "trials_T_indep_over_120m": int((T["indep"][mv] > service.PLAUSIBLE_T_MONTHS).sum()),
        "trials_T_free_over_120m": int((T["coord_free"][mv] > service.PLAUSIBLE_T_MONTHS).sum()),
        "sum_T": {k: float(T[k][mv].sum()) for k in T},
    }
    n_hist = np.array([s["n_hist"] for s in b.sites])
    proven = n_hist >= PROVEN_N
    load = {k: X[k].sum(axis=1) for k in X}
    cap = {}
    for k in ("actual", "indep", "coord_free", "coord"):
        slots = X[k][:, mv]
        used = load[k] > 0
        full = load[k] >= inst.k
        cap[k] = {
            "sites_used": int(used.sum()),
            "sites_at_capacity": int(full.sum()),
            "proven_sites_at_capacity": int((full & proven).sum()),
            "movable_slots": int(slots.sum()),
            "share_movable_slots_at_proven_sites": float(slots[proven].sum() / max(slots.sum(), 1)),
        }
    d["capacity"] = {"proven_sites": int(proven.sum()), "sites": int(len(proven)),
                     "proven_capacity_slots": int(inst.k[proven].sum()), **cap}
    return d


def _solver(run: dict) -> dict:
    return {k: {kk: v[kk] for kk in ("objective", "greedy_objective", "kicks", "seconds", "hit_time_limit")}
            for k, v in run["solver"].items()}


def run_setting(base: service.Params, label: str, kw: dict, rates: dict, k_peak: np.ndarray | None = None) -> dict:
    p = replace(base, **kw)
    t0 = time.time()
    full = _solve(p)
    b, inst = full["built"], full["built"].inst
    mv = inst.movable
    res = {"setting": label, "params": asdict(p), "movable_trials": int(mv.sum()),
           "in_sample_full": _blocks(full["T"], mv),
           "diagnostics": _diagnostics(b, full["x"], full["T"], inst),
           "solver_full": _solver(full),
           "k_summary": _k_summary(inst.k, k_peak)}
    log(f"  {label}: in-sample free/indep {res['in_sample_full']['coord_free_vs_indep']['ratio']:.3f}  "
        f"no-loser/reg {res['in_sample_full']['coord_vs_actual']['ratio']:.3f}  ({time.time() - t0:.0f}s)")
    del full, b
    dirs = []
    for choose, score in (("A", "B"), ("B", "A")):
        b_c = service.build(p, rates=rates[choose])
        run = _solve(p, b_c)
        mv_c = b_c.inst.movable
        b_s = service.build(p, rates=rates[score], movable=mv_c)
        T_held = service.rescore(b_s, run["x"])
        # Fix 2: the in-sample plausibility screen, applied under the score half's rates as well.
        implausible = mv_c & (T_held["actual"] > service.PLAUSIBLE_T_MONTHS)
        mv_s = mv_c & ~implausible
        reg_sum = float(T_held["actual"][mv_c].sum())
        excluded = [{"nct_id": b_c.inst.trial_ids[i], "T_registered_choose": float(run["T"]["actual"][i]),
                     "T_registered_score": float(T_held["actual"][i]),
                     "T_indep_choose": float(run["T"]["indep"][i]), "T_indep_score": float(T_held["indep"][i])}
                    for i in np.flatnonzero(implausible)]
        dirs.append({"choose": choose, "score": score, "movable_trials": int(mv_c.sum()),
                     "in_sample_half": _blocks(run["T"], mv_c), "held_out": _blocks(T_held, mv_c),
                     "screened_trials": int(mv_s.sum()),
                     "in_sample_half_screened": _blocks(run["T"], mv_s), "held_out_screened": _blocks(T_held, mv_s),
                     "screen_excluded": excluded,
                     "screen_excluded_share_of_held_out_registered_sum":
                         float(T_held["actual"][implausible].sum() / reg_sum) if reg_sum > 0 else None,
                     "unfilled_held_out": {k: int((T_held[k][mv_c] >= core.NO_SITES_T).sum()) for k in T_held},
                     "solver": _solver(run)})
        d = dirs[-1]
        log(f"  {label}: choose {choose} / score {score}: free/indep in {d['in_sample_half']['coord_free_vs_indep']['ratio']:.3f}"
            f" held {d['held_out']['coord_free_vs_indep']['ratio']:.3f} (screened {d['held_out_screened']['coord_free_vs_indep']['ratio']:.3f}, "
            f"{len(excluded)} excluded); no-loser held {d['held_out']['coord_vs_actual']['ratio']:.3f} "
            f"(screened {d['held_out_screened']['coord_vs_actual']['ratio']:.3f})")
        del b_c, b_s, run
    res["directions"] = dirs
    for view in HALF_VIEWS:
        res[f"{view}_geo"] = _aggregate([d[view] for d in dirs])
    res["seconds"] = round(time.time() - t0, 1)
    return res


def _share(r_num: float | None, r_peak: float | None) -> float | None:
    """1 - log(r_num) / log(r_peak); n/a (None) if r_peak <= 1."""
    if r_num is None or r_peak is None or r_peak <= 1:
        return None
    return float(1 - math.log(r_num) / math.log(r_peak))


def decomposition(settings: dict) -> dict:
    views = {v: (lambda s, blk, v=v: settings[s][v][blk]["ratio"])
             for v in ["in_sample_full"] + [f"{h}_geo" for h in HALF_VIEWS]}
    out = {}
    for view, get in views.items():
        r = {s: get(s, "coord_free_vs_indep") for s in settings}
        cap = _share(r.get("unlimited"), r.get("peak"))
        out[view] = {
            "ratio_peak": r.get("peak"), "ratio_unlimited": r.get("unlimited"), "ratio_beta0": r.get("beta=0 at peak"),
            "capacity_share": cap,
            "congestion_share": _share(r.get("beta=0 at peak"), r.get("peak")),
            "reading": (None if cap is None else "capacity-driven" if cap >= 0.8 else
                        "not capacity-driven" if cap <= 0.2 else "mixed"),
            "remaining_share_of_peak_log_gain": {
                blk: {s: (math.log(get(s, blk)) / math.log(get("peak", blk))
                          if get("peak", blk) and get("peak", blk) > 1 and s in settings else None)
                      for s in CAPACITY_LADDER if s in settings}
                for blk in ("coord_free_vs_indep", "coord_vs_actual", "indep_vs_actual")},
            "ratios_by_capacity": {blk: {s: get(s, blk) for s in CAPACITY_LADDER if s in settings}
                                   for blk in BLOCKS},
        }
    return out


def _rates(con) -> tuple[dict, dict]:
    split = R.split_alternating(con)
    return split, {h: R.fit_rate_table(con, keep=lambda t, h=h: split.get(t) == h, label=f"alternating half {h}")
                   for h in "AB"}


def _ratios(res: dict) -> dict:
    """Every ratio of a run_setting result, flattened (for the reproducibility / range checks)."""
    out = {f"in_sample_full.{blk}": res["in_sample_full"][blk]["ratio"] for blk in BLOCKS}
    for d in res["directions"]:
        for view in HALF_VIEWS:
            for blk in BLOCKS:
                out[f"{d['choose']}->{d['score']}.{view}.{blk}"] = d[view][blk]["ratio"]
    for view in HALF_VIEWS:
        for blk in BLOCKS:
            out[f"{view}_geo.{blk}"] = res[f"{view}_geo"][blk]["ratio"]
    return out


def run_scenario(name: str, repro_check: bool) -> dict:
    base = SCENARIOS[name]
    con = sqlite3.connect(DB_PATH)
    split, rates = _rates(con)
    b0 = service.build(base)
    coverage = R.split_coverage(con, split, site_ids=[s for s, f in zip(b0.inst.site_ids, b0.inst.feasible[:, 0]) if f])
    con.close()
    k_peak = b0.inst.k.copy()
    log(f"{name}: {b0.inst.P} trials, {int(b0.inst.movable.sum())} movable, {b0.inst.S} sites; "
        f"rates A {rates['A']['n_trials']} trials, B {rates['B']['n_trials']} trials")
    out = {"params": asdict(base), "trials": b0.inst.P, "movable_trials": int(b0.inst.movable.sum()),
           "sites": b0.inst.S, "split": "recruitment.split_alternating",
           "split_coverage_candidate_sites": coverage,
           "solver_budget": {**SOLVER, "note": "Fix 1: deterministic (service.RESOLVE patience/max_passes); "
                                               "time_limit is a safety bound that must not bind"},
           "rates_trials": {h: rates[h]["n_trials"] for h in "AB"}, "settings": {}}
    del b0
    for label, kw in SETTINGS:
        out["settings"][label] = run_setting(base, label, kw, rates, k_peak)
    out["any_solve_hit_time_limit"] = any(
        v["hit_time_limit"] for s in out["settings"].values()
        for v in list(s["solver_full"].values()) + [x for d in s["directions"] for x in d["solver"].values()])
    out["decomposition"] = decomposition(out["settings"])
    if repro_check:
        again = run_setting(base, "peak", {}, rates, k_peak)
        a, b = _ratios(out["settings"]["peak"]), _ratios(again)
        diffs = {k: abs(a[k] - b[k]) for k in a if a[k] is not None and b[k] is not None}
        out["reproducibility_check"] = {
            "setting": "peak", "ratios_compared": len(diffs), "max_abs_diff": max(diffs.values()),
            "identical": all(v == 0 for v in diffs.values()) and all((a[k] is None) == (b[k] is None) for k in a)}
        log(f"  reproducibility: {len(diffs)} ratios, max abs diff {out['reproducibility_check']['max_abs_diff']:.3g}")
    return out


def wallclock_range(name: str, repeats: int) -> dict:
    """Fix 1 context: the unchanged service.solve (6 s wall-clock budget) re-run at peak `repeats` times."""
    global SOLVE
    base = SCENARIOS[name]
    con = sqlite3.connect(DB_PATH)
    _, rates = _rates(con)
    con.close()
    SOLVE = service.solve
    try:
        runs = []
        for i in range(repeats):
            r = run_setting(base, "peak", {}, rates, None)
            runs.append({"ratios": _ratios(r), "solver_full": r["solver_full"],
                         "solver_directions": [d["solver"] for d in r["directions"]],
                         "worst_slowdown_held_out_coord_vs_actual":
                             r["held_out_geo"]["coord_vs_actual"]["by_direction_worst_slowdown_months"],
                         "share_slower_full_coord_free_vs_indep": r["in_sample_full"]["coord_free_vs_indep"]["share_slower"],
                         "share_slower_held_coord_free_vs_indep": r["held_out_geo"]["coord_free_vs_indep"]["share_slower"]})
            log(f"  wall-clock repeat {i + 1}/{repeats} done")
    finally:
        SOLVE = solve_det
    keys = runs[0]["ratios"].keys()
    rng = {k: [min(r["ratios"][k] for r in runs), max(r["ratios"][k] for r in runs)] for k in keys
           if all(r["ratios"][k] is not None for r in runs)}
    return {"note": "context only: unchanged service.solve, time_limit=6 s, peak setting", "repeats": repeats,
            "runs": runs, "range": rng}


POST_HOC_TIME_LIMIT = 30.0


def post_hoc(name: str) -> dict:
    """NOT pre-registered; added after seeing results. Every default solve hit the 6 s time limit,
    and the full-history unlimited no-loser solve made no move at all (coord = registered). Re-solve
    peak and unlimited in-sample with a longer time limit to see how much of each number is solver
    budget. Reported beside the pre-registered numbers, never in place of them."""
    out = {"note": "post-hoc solver-budget check, not pre-registered", "time_limit": POST_HOC_TIME_LIMIT}
    for label in ("peak", "unlimited"):
        p = replace(SCENARIOS[name], time_limit=POST_HOC_TIME_LIMIT, **dict(SETTINGS)[label])
        run = service.solve(p, cache=False)
        c = _blocks(run["T"], run["built"].inst.movable)
        out[label] = {"blocks": c, "solver": _solver(run)}
        log(f"  post-hoc {label} (time_limit {POST_HOC_TIME_LIMIT}): free/indep {c['coord_free_vs_indep']['ratio']:.3f} "
            f"no-loser/reg {c['coord_vs_actual']['ratio']:.3f}")
    r_p, r_u = out["peak"]["blocks"]["coord_free_vs_indep"]["ratio"], out["unlimited"]["blocks"]["coord_free_vs_indep"]["ratio"]
    out["capacity_share"] = _share(r_u, r_p)
    return out


def _f(x, fmt="{:.3f}") -> str:
    return "n/a" if x is None else fmt.format(x)


def _row(s: dict, blk: str, st: str = "ratio", fmt: str = "{:.3f}") -> str:
    views = [s["in_sample_full"]] + [s[f"{v}_geo"] for v in HALF_VIEWS]
    return " | ".join(_f(v[blk][st], fmt) for v in views)


def print_tables(result: dict) -> None:
    for name, sc in result["scenarios"].items():
        print(f"\n== {name}: {sc['movable_trials']} movable of {sc['trials']} trials; solver {sc.get('solver_budget')} ==")
        print("columns per block: full | half | held | half screened | held screened")
        for lab, s in sc["settings"].items():
            k = s["k_summary"]
            print(f"\n[{lab}] sum_k {k['sum_k']} (x{_f(k.get('sum_k_over_peak_total'), '{:.3f}')} of peak total; "
                  f"median k/k_peak {_f(k.get('median_k_over_k_peak'), '{:.2f}')}; differs from peak+1 at "
                  f"{k.get('sites_differing_from_peak_plus_1')} sites by {k.get('slots_over_peak_plus_1')} slots)")
            for blk in BLOCKS:
                print(f"  {blk:32s} ratio  {_row(s, blk)}")
                print(f"  {'':32s} median {_row(s, blk, 'median_speedup')}")
                print(f"  {'':32s} slower {_row(s, blk, 'share_slower', '{:.2f}')}")
            for d in s["directions"]:
                ex = d["screen_excluded"]
                h, hs = d["held_out"], d["held_out_screened"]
                print(f"  {d['choose']}->{d['score']}: free/indep held {_f(h['coord_free_vs_indep']['ratio'])} "
                      f"scr {_f(hs['coord_free_vs_indep']['ratio'])}; no-loser held "
                      f"{_f(h['coord_vs_actual']['ratio'])} scr {_f(hs['coord_vs_actual']['ratio'])} "
                      f"(slower {_f(h['coord_vs_actual']['share_slower'], '{:.2f}')}, worst "
                      f"{_f(h['coord_vs_actual']['worst_slowdown_months'], '{:.1f}')} m; scr worst "
                      f"{_f(hs['coord_vs_actual']['worst_slowdown_months'], '{:.1f}')} m); selection held "
                      f"{_f(h['indep_vs_actual']['ratio'])} scr {_f(hs['indep_vs_actual']['ratio'])}; "
                      f"excluded {len(ex)} ({_f(d['screen_excluded_share_of_held_out_registered_sum'], '{:.2f}')} of reg sum)")
            dg = s["diagnostics"]
            dv, cp = dg["dividend_coord_free_vs_indep"], dg["capacity"]
            print(f"  diag: top10% share {_f(dv['top10pct_share'], '{:.2f}')}, largest gain "
                  f"{_f(dv['largest_single_gain_months'], '{:.1f}')}, T_indep>120 {dv['trials_T_indep_over_120m']}; "
                  f"proven-slot share reg/indep/free {cp['actual']['share_movable_slots_at_proven_sites']:.2f}/"
                  f"{cp['indep']['share_movable_slots_at_proven_sites']:.2f}/"
                  f"{cp['coord_free']['share_movable_slots_at_proven_sites']:.2f}; at capacity indep/free "
                  f"{cp['indep']['sites_at_capacity']}/{cp['coord_free']['sites_at_capacity']}, proven "
                  f"{cp['indep']['proven_sites_at_capacity']}/{cp['coord_free']['proven_sites_at_capacity']}"
                  f" (registered {cp['actual']['proven_sites_at_capacity']})")
            print(f"  solver hit time limit: {[v['hit_time_limit'] for v in s['solver_full'].values()]} seconds "
                  f"{[v['seconds'] for v in s['solver_full'].values()]}")
        print()
        for view, d in sc["decomposition"].items():
            print(f"decomposition [{view}]: r_peak {_f(d['ratio_peak'])} r_unl {_f(d['ratio_unlimited'])} "
                  f"r_beta0 {_f(d['ratio_beta0'])} capacity share {_f(d['capacity_share'])} "
                  f"congestion share {_f(d['congestion_share'])} -> {d['reading']}")
            for blk, row in d["remaining_share_of_peak_log_gain"].items():
                print(f"    remaining log-gain {blk}: " + ", ".join(f"{k} {_f(v, '{:.2f}')}" for k, v in row.items()))
        for key in ("reproducibility_check", "any_solve_hit_time_limit"):
            if key in sc:
                print(f"{key}: {sc[key]}")
        if "wallclock_6s_range" in sc:
            w = sc["wallclock_6s_range"]["range"]
            for key in sorted(w):
                if key.startswith(("in_sample_full.", "held_out_geo.", "held_out_screened_geo.", "in_sample_half_geo.")) \
                        or ".held_out.coord_vs_actual" in key:
                    print(f"wall-clock 6 s range {key}: {_f(w[key][0])} - {_f(w[key][1])}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "data" / "robustness" / "capacity.json"))
    ap.add_argument("--scenarios", default="ne,regeneron", help="comma list of: ne, regeneron")
    ap.add_argument("--no-repro-check", action="store_true")
    ap.add_argument("--print-only", action="store_true", help="print tables from an existing --out file")
    ap.add_argument("--post-hoc", action="store_true",
                    help="add the (not pre-registered) solver-budget check to an existing --out file")
    ap.add_argument("--wallclock", type=int, default=0, metavar="N",
                    help="Fix 1 context: write N repeats of the 6 s wall-clock solve at peak to --wallclock-out")
    ap.add_argument("--wallclock-out", default=str(ROOT / "data" / "robustness" / "capacity_wallclock_6s.json"))
    ap.add_argument("--attach-wallclock", action="store_true",
                    help="copy --wallclock-out into --out under each scenario's wallclock_6s_range")
    a = ap.parse_args()
    keys = [s.strip() for s in a.scenarios.split(",") if s.strip()]
    if a.wallclock:
        res = {SCENARIO_KEYS[k]: wallclock_range(SCENARIO_KEYS[k], a.wallclock) for k in keys}
        open(a.wallclock_out, "w", encoding="utf-8").write(json.dumps(res, indent=1))
        return
    if a.attach_wallclock:
        result = json.loads(open(a.out, encoding="utf-8").read())
        for name, w in json.loads(open(a.wallclock_out, encoding="utf-8").read()).items():
            result["scenarios"][name]["wallclock_6s_range"] = w
        open(a.out, "w", encoding="utf-8").write(json.dumps(result, indent=1))
        print_tables(result)
        return
    if a.post_hoc:
        result = json.loads(open(a.out, encoding="utf-8").read())
        for key in keys:
            name = SCENARIO_KEYS[key]
            result["scenarios"][name]["post_hoc_solver_budget"] = post_hoc(name)
            open(a.out, "w", encoding="utf-8").write(json.dumps(result, indent=1))
        return
    if a.print_only:
        print_tables(json.loads(open(a.out, encoding="utf-8").read()))
        return
    names = [SCENARIO_KEYS[k] for k in keys]
    result = {"task": "B: capacity decomposition of the joint optimum",
              "method": "pre-registered in concord/analysis/capacity_decomposition.py docstring, "
                        "with the post-audit bug fixes 1-3 listed there",
              "superseded": "the 6 s wall-clock results of commit 57fe1ab (not reproducible; see Fix 1)",
              "db": str(DB_PATH), "scenarios": {}}
    from pathlib import Path
    path = Path(a.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(names):
        result["scenarios"][name] = run_scenario(name, repro_check=not a.no_repro_check and i == 0)
        path.write_text(json.dumps(result, indent=1))  # write after each scenario
        log(f"-> {path}")
    print_tables(result)


if __name__ == "__main__":
    main()

