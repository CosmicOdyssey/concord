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
SETTINGS = [
    ("peak", {}),
    ("unlimited", {"capacity_unlimited": True}),
    ("peak+1", {"capacity_add": 1}),
    ("1.5x peak", {"capacity_scale": 1.5}),
    ("beta=0 at peak", {"beta": 0.0}),
]
CAPACITY_LADDER = ["peak", "peak+1", "1.5x peak", "unlimited"]
BLOCKS = ["coord_free_vs_indep", "coord_free_vs_actual", "coord_vs_actual", "indep_vs_actual",
          "coordination_no_loser_vs_indep"]
GEO = ("ratio", "median_speedup")
ARITH = ("share_slower", "share_faster")
PROVEN_N = 5  # the build's "experienced" rule (n_hist >= 5 lung trials)
NOISE_TIME_LIMIT = 12.0


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


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
        out[blk] = row
    return out


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


def run_setting(base: service.Params, label: str, kw: dict, rates: dict) -> dict:
    p = replace(base, **kw)
    t0 = time.time()
    full = service.solve(p, cache=False)
    b, inst = full["built"], full["built"].inst
    mv = inst.movable
    res = {"setting": label, "params": asdict(p), "movable_trials": int(mv.sum()),
           "in_sample_full": _blocks(full["T"], mv),
           "diagnostics": _diagnostics(b, full["x"], full["T"], inst),
           "solver_full": _solver(full),
           "k_summary": {"sum_k": int(inst.k.sum()), "median_k": float(np.median(inst.k))}}
    log(f"  {label}: in-sample free/indep {res['in_sample_full']['coord_free_vs_indep']['ratio']:.3f}  "
        f"({time.time() - t0:.0f}s)")
    del full, b
    dirs = []
    for choose, score in (("A", "B"), ("B", "A")):
        b_c = service.build(p, rates=rates[choose])
        run = service.solve(p, b_c, cache=False)
        mv_c = b_c.inst.movable
        b_s = service.build(p, rates=rates[score], movable=mv_c)
        T_held = service.rescore(b_s, run["x"])
        dirs.append({"choose": choose, "score": score, "movable_trials": int(mv_c.sum()),
                     "in_sample_half": _blocks(run["T"], mv_c), "held_out": _blocks(T_held, mv_c),
                     "unfilled_held_out": {k: int((T_held[k][mv_c] >= core.NO_SITES_T).sum()) for k in T_held},
                     "solver": _solver(run)})
        log(f"  {label}: choose {choose} / score {score}: free/indep in {dirs[-1]['in_sample_half']['coord_free_vs_indep']['ratio']:.3f}"
            f" held {dirs[-1]['held_out']['coord_free_vs_indep']['ratio']:.3f}")
        del b_c, b_s, run
    res["directions"] = dirs
    res["in_sample_half_geo"] = _aggregate([d["in_sample_half"] for d in dirs])
    res["held_out_geo"] = _aggregate([d["held_out"] for d in dirs])
    res["seconds"] = round(time.time() - t0, 1)
    return res


def _share(r_num: float | None, r_peak: float | None) -> float | None:
    """1 - log(r_num) / log(r_peak); n/a (None) if r_peak <= 1."""
    if r_num is None or r_peak is None or r_peak <= 1:
        return None
    return float(1 - math.log(r_num) / math.log(r_peak))


def decomposition(settings: dict) -> dict:
    views = {"in_sample_full": lambda s, blk: settings[s]["in_sample_full"][blk]["ratio"],
             "in_sample_half_geo": lambda s, blk: settings[s]["in_sample_half_geo"][blk]["ratio"],
             "held_out_geo": lambda s, blk: settings[s]["held_out_geo"][blk]["ratio"]}
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


def run_scenario(name: str, noise_check: bool) -> dict:
    base = SCENARIOS[name]
    con = sqlite3.connect(DB_PATH)
    split = R.split_alternating(con)
    rates = {h: R.fit_rate_table(con, keep=lambda t, h=h: split.get(t) == h, label=f"alternating half {h}")
             for h in "AB"}
    b0 = service.build(base)
    coverage = R.split_coverage(con, split, site_ids=[s for s, f in zip(b0.inst.site_ids, b0.inst.feasible[:, 0]) if f])
    con.close()
    log(f"{name}: {b0.inst.P} trials, {int(b0.inst.movable.sum())} movable, {b0.inst.S} sites; "
        f"rates A {rates['A']['n_trials']} trials, B {rates['B']['n_trials']} trials")
    out = {"params": asdict(base), "trials": b0.inst.P, "movable_trials": int(b0.inst.movable.sum()),
           "sites": b0.inst.S, "split": "recruitment.split_alternating",
           "split_coverage_candidate_sites": coverage,
           "rates_trials": {h: rates[h]["n_trials"] for h in "AB"}, "settings": {}}
    del b0
    for label, kw in SETTINGS:
        out["settings"][label] = run_setting(base, label, kw, rates)
    out["decomposition"] = decomposition(out["settings"])
    if noise_check:
        p = replace(base, time_limit=NOISE_TIME_LIMIT)
        run = service.solve(p, cache=False)
        c = _blocks(run["T"], run["built"].inst.movable)
        out["solver_noise_check"] = {
            "setting": "peak", "time_limit": NOISE_TIME_LIMIT,
            "coord_free_vs_indep_ratio": c["coord_free_vs_indep"]["ratio"],
            "coord_vs_actual_ratio": c["coord_vs_actual"]["ratio"],
            "default_time_limit_ratio": out["settings"]["peak"]["in_sample_full"]["coord_free_vs_indep"]["ratio"],
            "solver": _solver(run)}
        log(f"  noise check (time_limit {NOISE_TIME_LIMIT}): free/indep {c['coord_free_vs_indep']['ratio']:.3f}")
    return out


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


def print_tables(result: dict) -> None:
    for name, sc in result["scenarios"].items():
        print(f"\n== {name}: {sc['movable_trials']} movable of {sc['trials']} trials ==")
        print(f"{'setting':16s} | free/indep full | half | held | slower full/held || "
              f"no-loser/reg full | half | held || selection full | half | held || free/reg full | held || "
              f"coord-NL/indep full | held")
        for lab, s in sc["settings"].items():
            fu, ha, ho = s["in_sample_full"], s["in_sample_half_geo"], s["held_out_geo"]
            print(f"{lab:16s} | {_f(fu['coord_free_vs_indep']['ratio'])} | {_f(ha['coord_free_vs_indep']['ratio'])} | "
                  f"{_f(ho['coord_free_vs_indep']['ratio'])} | {_f(fu['coord_free_vs_indep']['share_slower'], '{:.2f}')}/"
                  f"{_f(ho['coord_free_vs_indep']['share_slower'], '{:.2f}')} || "
                  f"{_f(fu['coord_vs_actual']['ratio'])} | {_f(ha['coord_vs_actual']['ratio'])} | "
                  f"{_f(ho['coord_vs_actual']['ratio'])} || {_f(fu['indep_vs_actual']['ratio'])} | "
                  f"{_f(ha['indep_vs_actual']['ratio'])} | {_f(ho['indep_vs_actual']['ratio'])} || "
                  f"{_f(fu['coord_free_vs_actual']['ratio'])} | {_f(ho['coord_free_vs_actual']['ratio'])} || "
                  f"{_f(fu['coordination_no_loser_vs_indep']['ratio'])} | {_f(ho['coordination_no_loser_vs_indep']['ratio'])}")
            print(f"{'':16s}   medians free/indep {_f(fu['coord_free_vs_indep']['median_speedup'])} / held "
                  f"{_f(ho['coord_free_vs_indep']['median_speedup'])}; by direction held "
                  f"{[round(v, 3) for v in ho['coord_free_vs_indep']['by_direction_ratio']]}")
        for view, d in sc["decomposition"].items():
            print(f"decomposition [{view}]: r_peak {_f(d['ratio_peak'])} r_unl {_f(d['ratio_unlimited'])} "
                  f"r_beta0 {_f(d['ratio_beta0'])} capacity share {_f(d['capacity_share'])} "
                  f"congestion share {_f(d['congestion_share'])} -> {d['reading']}")
        if "solver_noise_check" in sc:
            n = sc["solver_noise_check"]
            print(f"solver noise: free/indep {n['coord_free_vs_indep_ratio']:.3f} at {n['time_limit']}s vs "
                  f"{n['default_time_limit_ratio']:.3f} at default")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "data" / "robustness" / "capacity.json"))
    ap.add_argument("--scenarios", default="ne,regeneron", help="comma list of: ne, regeneron")
    ap.add_argument("--no-noise-check", action="store_true")
    ap.add_argument("--print-only", action="store_true", help="print tables from an existing --out file")
    ap.add_argument("--post-hoc", action="store_true",
                    help="add the (not pre-registered) solver-budget check to an existing --out file")
    a = ap.parse_args()
    if a.post_hoc:
        result = json.loads(open(a.out, encoding="utf-8").read())
        for key in [s.strip() for s in a.scenarios.split(",") if s.strip()]:
            name = SCENARIO_KEYS[key]
            result["scenarios"][name]["post_hoc_solver_budget"] = post_hoc(name)
            open(a.out, "w", encoding="utf-8").write(json.dumps(result, indent=1))
        return
    if a.print_only:
        print_tables(json.loads(open(a.out, encoding="utf-8").read()))
        return
    names = [SCENARIO_KEYS[s.strip()] for s in a.scenarios.split(",") if s.strip()]
    result = {"task": "B: capacity decomposition of the joint optimum",
              "method": "pre-registered in concord/analysis/capacity_decomposition.py docstring",
              "db": str(DB_PATH), "scenarios": {}}
    from pathlib import Path
    path = Path(a.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(names):
        result["scenarios"][name] = run_scenario(name, noise_check=not a.no_noise_check and i == 0)
        path.write_text(json.dumps(result, indent=1))  # write after each scenario
        log(f"-> {path}")
    print_tables(result)


if __name__ == "__main__":
    main()
