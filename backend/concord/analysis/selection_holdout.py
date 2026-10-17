"""Optimizer's-curse holdout for the site-selection and clearing gains (task A).

    python -m concord.analysis.selection_holdout --out <abs path>/data/robustness/holdout.json

QUESTION
Every allocation is chosen with site rates fit on the same completed trials that are then used
to score it. An optimizer that picks the "best" sites under noisy rates looks better than it is
(the optimizer's curse). Does the gain survive when allocations are chosen with rates fit on one
half of history and scored with rates fit on the other half?

PRE-REGISTERED METHOD (committed before any result of this script was computed)

Scenarios (all Params fields not named are the defaults: beta = within-site data estimate,
low_history="model", universe="registered", time_limit=6.0 [replaced by deviation 1 below]):
  S1 "US-Northeast"             service.Params()  (US-Northeast, currently recruiting)
  S2 "US_Regeneron_2024-09-01"  service.Params(region="US", sponsor="Regeneron", as_of="2024-09-01")

Splits of the fit history (the trials in recruitment.load_history), fixed definitions in
concord.model.recruitment, not changed here:
  primary   alternating = recruitment.split_alternating(con)
  secondary time        = recruitment.split_time(con)

Rate tables: for each split and half h in {A, B}, recruitment.fit_rate_table(con,
keep=lambda t: split.get(t) == h). Same estimator as production (EM posterior means, low-history
cap via effective_rates), fit only on that half's trials.

Procedure, for each scenario x split x direction (choose A / score B, and choose B / score A):
  1. b_choose = service.build(params, rates=rates[choose]). The movable set
     mv = b_choose.inst.movable is fixed here (flagging under choose-half rates) and reused
     unchanged at scoring. No re-flagging at scoring time.
  2. run = service.solve(params, b_choose, cache=False): all five allocations (actual, indep,
     coord_free, coord, coord_nl_indep) are chosen with choose-half rates, including the
     no-loser caps.
  3. b_score = service.build(params, rates=rates[score], movable=mv).
  4. In-sample T = run["T"]; held-out T = service.rescore(b_score, run["x"]). Every allocation,
     including the registered one, is re-scored with score-half rates.
  5. service.comparisons(T, mv) for both.
Reference: full-data in-sample (the current production numbers) =
service.comparisons(service.solve(params)["T"], movable of the default build).

Comparisons reported (ratio = sum over movable trials of T_base / sum of T_new):
  coord_vs_actual                 HEADLINE: no-loser joint optimum vs registered sites
  indep_vs_actual                 site selection alone (best response vs registered)
  coord_free_vs_indep             joint optimum vs best response
  coord_free_vs_actual            joint optimum vs registered
  coordination_no_loser_vs_indep  pure coordination with no loser vs own best response
plus median_speedup, share_faster, share_slower and worst_slowdown_months from the same blocks
(held-out share_slower shows losers appearing out of sample).

Primary statistic. For each scenario, HEADLINE = geometric mean over the two directions of the
ALTERNATING split of the held-out ratio of coord_vs_actual. In-sample analog = geometric mean of
the two in-sample ratios. S1 is the market headline; S2 is the Regeneron portfolio view. Whatever
the held-out alternating headline is, it replaces the in-sample 1.28x as THE headline.

Summaries per scenario x split x comparison: geometric mean over the two directions of ratio and
of median_speedup (in-sample and held-out); arithmetic mean over directions of share_faster and
share_slower; max over directions of worst_slowdown_months; retained share of the log gain =
log(held-out geomean) / log(in-sample geomean) (descriptive). The time split is summarised the
same way and reported separately as secondary.

Secondary uncertainty (descriptive only): per direction and comparison, a 95% percentile
bootstrap over movable trials (2000 resamples, seed 0) of the in-sample and held-out ratio. It
reflects which trials are in the instance, not rate-estimation noise.

Diagnostics (reported, never used to change anything):
  - recruitment.split_coverage for each scenario's instance sites and its candidate sites
    (feasible for some trial);
  - n movable per direction, and its overlap with the full-data movable set;
  - Spearman rank correlation of choose-half vs score-half site rates (inst.lam) over candidate
    sites;
  - instance movable trials that are themselves in the fit history, by half (S2 can contain trials
    that have since completed);
  - per allocation, the number of movable trials at core.NO_SITES_T and above
    service.PLAUSIBLE_T_MONTHS, in-sample and held-out; movable trials that score-half rates would
    have flagged;
  - solver stats (seconds, hit_time_limit).

Rules. No re-flagging at scoring time; no trimming (very long held-out times stay in); no tuning
of any parameter; the solver runs at the default time_limit [replaced by deviation 1 below]. After
results are seen only bugs may be fixed, each listed as a deviation with its reason.

Interpretation, fixed in advance:
  - held-out headline > 1: the no-loser gain survives out of sample at that size; <= 1: it does
    not survive.
  - held-out numbers are conservative in one way (allocations chosen with half the data) and noisy
    in another (scored with half the data); both caveats travel with the number.

BUG FIX AFTER RESULTS (deviation 1; written and committed before the fixed run, see git log)
"The solver runs at the default time_limit" made the result depend on wall-clock time. In the
pre-registered run (commit 12b8404) every US-Northeast solve stopped at the 6 s deadline with 0
iterated-local-search kicks, part-way through greedy / local search / exchanges, so the allocations,
and every number built on them, changed from run to run with CPU load (an audit rerun moved the
held-out headline between 1.07x and 1.11x and the half-data in-sample one between 1.24x and 1.30x).
Fix: every solve runs with Params.time_limit = SOLVER_TIME_LIMIT, a safety cap that is never meant
to bind, so core.coordinate stops on its own rule (40 kicks without improvement, seed 0). With no
deadline hit the run is deterministic. The choice of this budget over a smaller fixed one
(patience=0 / max_passes, the service.RESOLVE style) was made before any fixed result was seen, on
two grounds: it is the solver's own definition of done, and more search can only sharpen the
optimizer's curse this script tests, so it is the conservative choice for the held-out number.
The smaller budget and the old 6 s wall-clock procedure are reported as post-hoc sensitivities
(selection_holdout_posthoc.py, P2). Each solve records hit_time_limit; the output carries
"deterministic": true only if no solve hit the cap. Nothing else in the method changes.
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import subprocess
import sys
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr

from concord import service
from concord.allocator import core
from concord.model import recruitment as R

SCENARIOS: dict[str, dict] = {
    "US-Northeast": {},
    "US_Regeneron_2024-09-01": {"region": "US", "sponsor": "Regeneron", "as_of": "2024-09-01"},
}
SPLITS = {"alternating": R.split_alternating, "time": R.split_time}
PRIMARY_SPLIT = "alternating"
HEADLINE = "coord_vs_actual"
# (base, new) allocation for each comparison block in service.comparisons
PAIRS = {
    "coord_vs_actual": ("actual", "coord"),
    "indep_vs_actual": ("actual", "indep"),
    "coord_free_vs_indep": ("indep", "coord_free"),
    "coord_free_vs_actual": ("actual", "coord_free"),
    "coordination_no_loser_vs_indep": ("indep", "coord_nl_indep"),
}
COMPARISONS = list(PAIRS)
DIRECTIONS = (("A", "B"), ("B", "A"))
N_BOOT = 2000
BOOT_SEED = 0
# Deviation 1 (bug fix, see docstring): a safety cap, not a budget. The solver stops on patience.
SOLVER_TIME_LIMIT = 3600.0


def scenario_params(name: str, **kw) -> service.Params:
    """Params for a scenario: defaults except the scenario fields and the deterministic solver budget."""
    return service.Params(**{**SCENARIOS[name], "time_limit": SOLVER_TIME_LIMIT, **kw})


def _con() -> sqlite3.Connection:
    return sqlite3.connect(service.DB_PATH)


def rate_tables(con: sqlite3.Connection) -> dict:
    """{split: {"split": {nct: half}, "A": table, "B": table}} for every pre-registered split."""
    out = {}
    for name, fn in SPLITS.items():
        split = fn(con)
        out[name] = {"split": split}
        for h in ("A", "B"):
            out[name][h] = R.fit_rate_table(con, keep=lambda t, s=split, h=h: s.get(t) == h,
                                            label=f"{name} half {h}")
    return out


def choose_and_score(params: service.Params, rates_choose: dict, rates_score: dict) -> dict:
    """Steps 1-4 of the method: choose every allocation with one rate table, score with another."""
    b_choose = service.build(params, rates=rates_choose)
    mv = b_choose.inst.movable.copy()
    run = service.solve(params, b_choose, cache=False)
    b_score = service.build(params, rates=rates_score, movable=mv)
    assert b_score.inst.trial_ids == b_choose.inst.trial_ids and b_score.inst.site_ids == b_choose.inst.site_ids
    return {"b_choose": b_choose, "b_score": b_score, "run": run, "mv": mv,
            "T_in": run["T"], "T_out": service.rescore(b_score, run["x"])}


def bootstrap_ratio(base: np.ndarray, new: np.ndarray, mv: np.ndarray) -> list[float] | None:
    b, n = base[mv], new[mv]
    if len(b) < 2:
        return None
    rng = np.random.default_rng(BOOT_SEED)
    idx = rng.integers(0, len(b), size=(N_BOOT, len(b)))
    r = b[idx].sum(axis=1) / n[idx].sum(axis=1)
    return [float(np.percentile(r, 2.5)), float(np.percentile(r, 97.5))]


def _gm(xs) -> float | None:
    xs = list(xs)
    if not xs or any(x is None or x <= 0 for x in xs):
        return None
    return float(math.exp(sum(math.log(x) for x in xs) / len(xs)))


def _mean(xs) -> float | None:
    xs = [x for x in xs if x is not None]
    return float(np.mean(xs)) if xs else None


def tail_counts(T: dict[str, np.ndarray], mv: np.ndarray) -> dict:
    return {k: {"no_sites": int((t[mv] >= core.NO_SITES_T).sum()),
                "above_plausible": int((t[mv] > service.PLAUSIBLE_T_MONTHS).sum())} for k, t in T.items()}


def _solver(run: dict) -> dict:
    return {k: {"seconds": v["seconds"], "hit_time_limit": v["hit_time_limit"], "kicks": v["kicks"]}
            for k, v in run["solver"].items()}


def _all_solver_stats(res: dict) -> list[dict]:
    """Every solve's stats in one scenario result (full data and every split direction)."""
    out = list(res["full_data"]["solver"].values())
    for s in res["splits"].values():
        for d in s["directions"].values():
            out += list(d["diagnostics"]["solver"].values())
    return out


# Allocations of the run, kept for --save-alloc (an output, not part of the method): key
# "<scenario>.full" or "<scenario>.<split>.<choose>-><score>", then ".<allocation>" (site, trial) index pairs,
# ".movable" trial indices and ".shape" (S, P).
_ALLOC: dict[str, np.ndarray] = {}


def keep_alloc(key: str, X: dict[str, np.ndarray], mv: np.ndarray) -> None:
    for k, x in X.items():
        _ALLOC[f"{key}.{k}"] = np.argwhere(x).astype(np.int32)
    _ALLOC[f"{key}.movable"] = np.flatnonzero(mv).astype(np.int32)
    _ALLOC[f"{key}.shape"] = np.array(next(iter(X.values())).shape, dtype=np.int32)


def load_alloc(path) -> dict[str, dict]:
    """{key: {"x": {allocation: bool (S, P)}, "movable": bool (P,)}} from a --save-alloc file."""
    z = np.load(path)
    out: dict[str, dict] = {}
    for k in z.files:
        if not k.endswith(".shape"):
            continue
        key = k[: -len(".shape")]
        S, P = (int(v) for v in z[k])
        mv = np.zeros(P, dtype=bool)
        mv[z[f"{key}.movable"]] = True
        X = {}
        for f in z.files:
            name = f.rsplit(".", 1)
            if name[0] != key or name[1] in ("shape", "movable"):
                continue
            x = np.zeros((S, P), dtype=bool)
            idx = z[f]
            if len(idx):
                x[idx[:, 0], idx[:, 1]] = True
            X[name[1]] = x
        out[key] = {"x": X, "movable": mv}
    return out


def _per_trial(b: service.Built, T_in: dict, T_out: dict | None = None) -> dict:
    r = lambda t: [round(float(v), 3) for v in t]
    out = {"nct_id": list(b.inst.trial_ids), "movable": [bool(m) for m in b.inst.movable],
           "T_in_sample": {k: r(t) for k, t in T_in.items()}}
    if T_out is not None:
        out["T_held_out"] = {k: r(t) for k, t in T_out.items()}
    return out


def coverage(con: sqlite3.Connection, split: dict, b: service.Built) -> dict:
    cand = b.inst.feasible.any(axis=1)
    return {"instance_sites": R.split_coverage(con, split, site_ids=b.inst.site_ids),
            "candidate_sites": R.split_coverage(con, split, site_ids=[s for s, c in zip(b.inst.site_ids, cand) if c])}


def direction_result(con, params, tabs: dict, split_name: str, choose: str, score: str, mv_full: np.ndarray,
                     full_trial_ids: list[str]) -> dict:
    t0 = time.monotonic()
    d = choose_and_score(params, tabs[choose], tabs[score])
    b_c, b_s, mv, T_in, T_out = d["b_choose"], d["b_score"], d["mv"], d["T_in"], d["T_out"]
    assert b_c.inst.trial_ids == full_trial_ids
    cand = b_c.inst.feasible.any(axis=1)
    rho = spearmanr(b_c.inst.lam[cand], b_s.inst.lam[cand]) if cand.sum() > 2 else None
    split = tabs["split"]
    in_hist = [t for t, m in zip(b_c.inst.trial_ids, mv) if m and t in split]
    return {
        "choose": choose, "score": score,
        "rates_choose": {k: tabs[choose][k] for k in ("label", "n_trials", "unseen", "unseen_mean", "prior")},
        "rates_score": {k: tabs[score][k] for k in ("label", "n_trials", "unseen", "unseen_mean", "prior")},
        "n_movable": int(mv.sum()),
        "n_movable_also_movable_full_data": int((mv & mv_full).sum()),
        "n_movable_full_data": int(mv_full.sum()),
        "in_sample": service.comparisons(T_in, mv),
        "held_out": service.comparisons(T_out, mv),
        "bootstrap_ci95": {c: {"in_sample": bootstrap_ratio(T_in[a], T_in[n], mv),
                               "held_out": bootstrap_ratio(T_out[a], T_out[n], mv)} for c, (a, n) in PAIRS.items()},
        "diagnostics": {
            "spearman_rate_choose_vs_score_candidate_sites": (
                {"rho": float(rho.statistic), "p": float(rho.pvalue), "n_sites": int(cand.sum())} if rho is not None
                else None),
            "movable_trials_in_fit_history": {"A": sum(split[t] == "A" for t in in_hist),
                                              "B": sum(split[t] == "B" for t in in_hist)},
            "tail_counts_in_sample": tail_counts(T_in, mv),
            "tail_counts_held_out": tail_counts(T_out, mv),
            "movable_that_score_rates_would_flag": int((b_s.flagged & mv).sum()),
            "solver": _solver(d["run"]),
            "seconds": round(time.monotonic() - t0, 1),
        },
        "per_trial": _per_trial(b_c, T_in, T_out),
        "_x": (d["run"]["x"], mv),  # popped by run_scenario; saved with --save-alloc, never in the JSON
    }


def summarize(dirs: list[dict]) -> dict:
    out = {}
    for c in COMPARISONS:
        row = {}
        for side in ("in_sample", "held_out"):
            blocks = [d[side][c] for d in dirs]
            row[side] = {
                "ratio_geomean": _gm(b["ratio"] for b in blocks),
                "median_speedup_geomean": _gm(b["median_speedup"] for b in blocks),
                "share_faster_mean": _mean(b["share_faster"] for b in blocks),
                "share_slower_mean": _mean(b["share_slower"] for b in blocks),
                "worst_slowdown_months_max": max((b["worst_slowdown_months"] or 0.0) for b in blocks),
                "ratio_by_direction": [b["ratio"] for b in blocks],
            }
        i, h = row["in_sample"]["ratio_geomean"], row["held_out"]["ratio_geomean"]
        row["retained_log_share"] = (math.log(h) / math.log(i)) if i and h and abs(math.log(i)) > 1e-9 else None
        out[c] = row
    return out


def run_scenario(con, name: str, params: service.Params, tables: dict, splits: list[str]) -> dict:
    t0 = time.monotonic()
    full = service.solve(params)
    b_full = full["built"]
    mv_full = b_full.inst.movable.copy()
    res = {"params": asdict(params),
           "full_data": {"n_movable": int(mv_full.sum()), "n_trials": b_full.inst.P, "n_sites": b_full.inst.S,
                         "candidate_sites": int(b_full.inst.feasible.any(axis=1).sum()),
                         "in_sample": service.comparisons(full["T"], mv_full),
                         "tail_counts_in_sample": tail_counts(full["T"], mv_full),
                         "solver": _solver(full), "per_trial": _per_trial(b_full, full["T"])},
           "splits": {}}
    keep_alloc(f"{name}.full", full["x"], mv_full)
    print(f"[{name}] full data: {int(mv_full.sum())} movable / {b_full.inst.P} trials, "
          f"{b_full.inst.S} sites ({time.monotonic() - t0:.0f}s)", flush=True)
    for sp in splits:
        tabs = tables[sp]
        dirs = {}
        for choose, score in DIRECTIONS:
            dirs[f"{choose}->{score}"] = direction_result(con, params, tabs, sp, choose, score, mv_full,
                                                          list(b_full.inst.trial_ids))
            keep_alloc(f"{name}.{sp}.{choose}->{score}", *dirs[f"{choose}->{score}"].pop("_x"))
            print(f"[{name}] {sp} {choose}->{score} done ({dirs[f'{choose}->{score}']['diagnostics']['seconds']}s)",
                  flush=True)
        res["splits"][sp] = {"coverage": coverage(con, tabs["split"], b_full), "directions": dirs,
                             "summary": summarize(list(dirs.values()))}
    return res


def _git_head() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True,
                              cwd=Path(__file__).parent).stdout.strip()
    except Exception:
        return None


def headline(out: dict) -> dict:
    h = {}
    for name, res in out["scenarios"].items():
        if PRIMARY_SPLIT not in res["splits"]:
            continue
        s = res["splits"][PRIMARY_SPLIT]["summary"][HEADLINE]
        h[name] = {"held_out_ratio": s["held_out"]["ratio_geomean"],
                   "in_sample_half_data_ratio": s["in_sample"]["ratio_geomean"],
                   "full_data_in_sample_ratio": res["full_data"]["in_sample"][HEADLINE]["ratio"],
                   "held_out_by_direction": s["held_out"]["ratio_by_direction"],
                   "held_out_median_speedup": s["held_out"]["median_speedup_geomean"],
                   "held_out_share_slower": s["held_out"]["share_slower_mean"],
                   "survives": (s["held_out"]["ratio_geomean"] or 0) > 1.0}
    return h


def _fmt(block: dict | None) -> str:
    if not block or block.get("ratio") is None:
        return "-"
    return f"{block['ratio']:.3f} (med {block['median_speedup']:.2f}, slower {block['share_slower']:.0%})"


def print_tables(out: dict) -> None:
    for name, res in out["scenarios"].items():
        print(f"\n== {name} ==  ratio (median speedup, share slower)")
        for c in COMPARISONS:
            cells = [_fmt(res["full_data"]["in_sample"][c])]
            for sp in SPLITS:
                if sp not in res["splits"]:
                    continue
                s = res["splits"][sp]["summary"][c]
                for side in ("in_sample", "held_out"):
                    x = s[side]
                    cells.append(f"{x['ratio_geomean']:.3f} (med {x['median_speedup_geomean']:.2f}, "
                                 f"slower {x['share_slower_mean']:.0%})" if x["ratio_geomean"] else "-")
            print(f"{c:32s} | " + " | ".join(cells))
    print("\nHEADLINE (alternating, held-out, geomean of directions):")
    f = lambda v: "-" if v is None else f"{v:.3f}"
    for name, h in out["headline"].items():
        print(f"  {name}: held-out {f(h['held_out_ratio'])}x | half-data in-sample {f(h['in_sample_half_data_ratio'])}x"
              f" | full-data in-sample {f(h['full_data_in_sample_ratio'])}x | by direction "
              f"{', '.join(f(r) for r in h['held_out_by_direction'])}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output JSON path (absolute)")
    ap.add_argument("--scenario", action="append", choices=list(SCENARIOS), help="default: all")
    ap.add_argument("--split", action="append", choices=list(SPLITS), help="default: all")
    ap.add_argument("--save-alloc", help="also save every allocation to this .npz (absolute path)")
    a = ap.parse_args()
    t0 = time.monotonic()
    con = _con()
    tables = rate_tables(con)
    splits = a.split or list(SPLITS)
    out = {"task": "A: optimizer's curse holdout", "method": "see concord/analysis/selection_holdout.py docstring",
           "method_commit": _git_head(), "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
           "primary_split": PRIMARY_SPLIT, "headline_comparison": HEADLINE,
           "rate_tables": {sp: {h: {k: tables[sp][h][k] for k in ("label", "n_trials", "unseen", "unseen_mean", "prior")}
                                for h in ("A", "B")} for sp in SPLITS},
           "split_coverage_all_sites": {sp: R.split_coverage(con, tables[sp]["split"]) for sp in SPLITS},
           "scenarios": {}}
    out["solver_budget"] = {"time_limit_safety_cap_s": SOLVER_TIME_LIMIT, "patience": "core.coordinate default",
                            "seed": "core.coordinate default", "note": "deviation 1 (bug fix): no wall-clock stop"}
    for name in a.scenario or list(SCENARIOS):
        out["scenarios"][name] = run_scenario(con, name, scenario_params(name), tables, splits)
    out["headline"] = headline(out)
    hits = [n for n, res in out["scenarios"].items() for v in _all_solver_stats(res) if v["hit_time_limit"]]
    out["deterministic"] = not hits
    if hits:
        print(f"WARNING: {len(hits)} solves hit the {SOLVER_TIME_LIMIT:.0f} s safety cap ({sorted(set(hits))}); "
              "this run is NOT deterministic", flush=True)
    out["seconds"] = round(time.monotonic() - t0, 1)
    path = Path(a.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1))
    if a.save_alloc:
        np.savez_compressed(a.save_alloc, **_ALLOC)
        print("allocations ->", a.save_alloc)
    print_tables(out)
    print("->", path)


if __name__ == "__main__":
    main()
