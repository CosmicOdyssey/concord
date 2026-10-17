"""POST-HOC checks on the optimizer's-curse holdout (task A). Exploratory.

    python -m concord.analysis.selection_holdout_posthoc --holdout <abs>/data/robustness/holdout.json \
        --alloc <abs>/data/robustness/holdout_alloc.npz --replicate <abs>/holdout_replicate.json \
        --wallclock-run1 <abs>/data/robustness/holdout_wallclock_run1.json \
        --wallclock-run2 <abs>/data/robustness/holdout_posthoc_wallclock_run1.json \
        --out <abs>/data/robustness/holdout_posthoc.json

These checks were defined AFTER pre-registered results were seen. They qualify the pre-registered
numbers; they never replace the pre-registered headline (held-out alternating geomean of
coord_vs_actual), whichever way they point.

HISTORY
  Round 1 (commit 91344bd, defined after the first pre-registered run 12b8404): P1, P2, P3.
  Round 2 (this revision, defined after an audit of round 1 and committed BEFORE the fixed run of
  selection_holdout.py (deviation 1: deterministic solver budget) and before any of P2a/P2b/P4 was
  run): P2 replaced, P3 label corrected, P4 added. P1 is unchanged.
  Round-1 errors this revision corrects:
  - Round-1 P2 reran the 6 s wall-clock procedure once and concluded that half-data numbers
    "reproduce within 0.01". An audit rerun three more times and got held-out headlines of 1.07x to
    1.11x and half-data in-sample ones of 1.24x to 1.30x, so that conclusion was wrong: NE solves
    stopped at the clock with 0 kicks and the result moved with CPU load.
  - Round-1 P3 said sites with no fit history "get the same floor rate in every half, so the
    holdout cannot test any gain from moving trials off them". Wrong: each half refits its own
    prior, so the floor (prior 25th percentile) differs between halves and moves relative to the
    rates of sites with history. The holdout re-values floor sites; P4 measures by how much.

P1. Tail sensitivity (no re-solve; reads the per-trial arrays saved in holdout.json). Unchanged.
    The pre-registered ratio is a ratio of sums, and a few movable trials have registered times
    above service.PLAUSIBLE_T_MONTHS under score-half rates (the build would have flagged them had
    the score half chosen the movable set). For each scenario x split x direction, recompute
    service.compare for every comparison (a) over movable trials excluding those with held-out
    registered T > PLAUSIBLE_T_MONTHS, held-out and in-sample on the same trials; and (b) the
    geometric mean of per-trial speedups T_base / T_new over all movable trials, in-sample and
    held-out. Also (c) the share of the held-out dividend (sum T_base - T_new) that comes from the
    5 trials with the largest gains. Summaries: geometric mean over the two directions, as in the
    pre-registered method.

P2. Solver determinism and search effort (replaces round-1 P2).
  P2a Determinism. selection_holdout.py is run twice with identical code and data (the result and
      a replicate). Report, per scenario, the max absolute difference over every per-trial T
      (in-sample and held-out, every allocation, full data and every split direction) and over the
      summary ratios. JSON stores T rounded to 0.001, so "identical" means max diff <= 0.0011.
  P2b Search effort (exploratory). The same choose/score procedure at two other solver budgets,
      next to the primary (solver run to its own patience rule, deviation 1):
      LOW       patience=0, no wall-clock stop: greedy, local search to a local optimum, exchanges,
                no kicks. Deterministic. Solved with solve_budget below, a copy of service.solve
                that passes the budget to core.coordinate; checked by re-solving one case
                (Regeneron, alternating A->B) at the primary budget with solve_budget and
                requiring the primary allocations exactly.
      WALLCLOCK the pre-registered 6 s procedure (time_limit=6.0, as in commit 12b8404). Not
                deterministic, so it is replicated: run 1 = the pre-registered result
                (holdout_wallclock_run1.json, every split), run 2 = round-1 P2 (full data and
                alternating only), runs 3..(2+N_WALL) new, N_WALL = 3. Reported as median and
                range over runs, per comparison, of full-data in-sample and of the split geomeans
                in-sample and held-out.
      Run order: primary and replicate first, then LOW, then the WALLCLOCK runs one at a time with
      no other solve of this task running.

P3. Slot composition (label corrected; no longer claims floor sites are untested). For every
    allocation of the primary run (full data and every split direction), the share of movable
    trials' site slots at sites with 0, 1-2 (low history: rate capped at that table's floor) and
    >= 3 fit-history trials, counted on the full history, on the choose half and on the score half.
    Sites with 0 or 1-2 trials in a half are valued at (or below) that half's floor.

P4. Floor re-valuation (new). The low-history floor is the prior's 25th percentile, refit in each
    half. Diagnostics, per scenario x split x half (and the full-data table for reference):
      floor = table["unseen"];
      m = median of the uncapped posterior mean (table["lam_mean"]) over the scenario's candidate
          sites (feasible for some trial in the full-data build) with >= 1 fit-history trial in
          that half;
      relative floor = floor / m.
    Re-valuation factor of a direction = relative floor (choose half) / relative floor (score half):
    how much more the chooser valued floor sites, relative to sites with history, than the scorer.
    Sensitivity (exploratory): score the SAME primary allocations with a floor-aligned score table:
    the score half's table with its floor replaced by f' = m_score x relative floor (choose half),
    applied exactly as recruitment.effective_rates does (sites with < LOW_HISTORY_N trials in the
    half get min(lam_mean, f'), unseen sites get f'); sites with >= LOW_HISTORY_N trials keep their
    rates. service.build(params, rates=aligned, movable=mv) and service.rescore, as in the method.
    It answers: what is held out if floor sites keep the relative value the chooser gave them, so
    that only re-ranking among sites with history is tested. It is reported next to, never instead
    of, the pre-registered held-out number, which re-values floor sites by the factor above.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from concord import service
from concord.allocator import core
from concord.analysis import selection_holdout as H
from concord.model import recruitment as R

TOP_K = 5
CLASSES = (("0", 0, 0), ("1-2", 1, R.LOW_HISTORY_N - 1), (f">={R.LOW_HISTORY_N}", R.LOW_HISTORY_N, 10 ** 9))
IDENTICAL_TOL = 0.0011
LOW_BUDGET = dict(patience=0, time_limit=H.SOLVER_TIME_LIMIT)
PRIMARY_BUDGET = dict(time_limit=H.SOLVER_TIME_LIMIT)
WALLCLOCK_TIME_LIMIT = 6.0
N_WALL = 3
CHECK_CASE = ("US_Regeneron_2024-09-01", "alternating", "A", "B")


def _arr(d: dict) -> dict[str, np.ndarray]:
    return {k: np.array(v, dtype=float) for k, v in d.items()}


# ---------------------------------------------------------------- P1 (unchanged)

def _geo_speedup(base: np.ndarray, new: np.ndarray, m: np.ndarray) -> float | None:
    return float(np.exp(np.mean(np.log(base[m] / new[m])))) if m.any() else None


def _top_share(base: np.ndarray, new: np.ndarray, m: np.ndarray) -> float | None:
    gain = (base - new)[m]
    tot = gain.sum()
    return float(np.sort(gain)[::-1][:TOP_K].sum() / tot) if abs(tot) > 1e-9 else None


def p1_direction(d: dict) -> dict:
    pt = d["per_trial"]
    mv = np.array(pt["movable"], dtype=bool)
    T_in, T_out = _arr(pt["T_in_sample"]), _arr(pt["T_held_out"])
    keep = mv & (T_out["actual"] <= service.PLAUSIBLE_T_MONTHS)
    out = {"n_movable": int(mv.sum()), "n_excluded": int((mv & ~keep).sum()), "comparisons": {}}
    for c, (a, n) in H.PAIRS.items():
        out["comparisons"][c] = {
            "excl_in_sample": service.compare(T_in[a], T_in[n], keep),
            "excl_held_out": service.compare(T_out[a], T_out[n], keep),
            "geo_speedup_in_sample": _geo_speedup(T_in[a], T_in[n], mv),
            "geo_speedup_held_out": _geo_speedup(T_out[a], T_out[n], mv),
            "top5_share_of_held_out_dividend": _top_share(T_out[a], T_out[n], mv),
        }
    return out


def p1(hold: dict) -> dict:
    res = {}
    for name, sc in hold["scenarios"].items():
        res[name] = {}
        for sp, s in sc["splits"].items():
            dirs = {dn: p1_direction(d) for dn, d in s["directions"].items()}
            summ = {}
            for c in H.COMPARISONS:
                g = lambda key, sub=None: H._gm((v["comparisons"][c][key][sub] if sub else v["comparisons"][c][key])
                                                for v in dirs.values())
                summ[c] = {"excl_in_sample_ratio": g("excl_in_sample", "ratio"),
                           "excl_held_out_ratio": g("excl_held_out", "ratio"),
                           "excl_held_out_median_speedup": g("excl_held_out", "median_speedup"),
                           "excl_held_out_share_slower": H._mean(v["comparisons"][c]["excl_held_out"]["share_slower"]
                                                                 for v in dirs.values()),
                           "geo_speedup_in_sample": g("geo_speedup_in_sample"),
                           "geo_speedup_held_out": g("geo_speedup_held_out"),
                           "top5_share_of_held_out_dividend_mean": H._mean(
                               v["comparisons"][c]["top5_share_of_held_out_dividend"] for v in dirs.values())}
            res[name][sp] = {"directions": dirs, "summary": summ}
    return res


# ---------------------------------------------------------------- P2a determinism

def _pt_arrays(res: dict):
    """(label, array) for every per-trial T array of one scenario result."""
    yield "full.in", res["full_data"]["per_trial"]["T_in_sample"]
    for sp, s in res["splits"].items():
        for dn, d in s["directions"].items():
            yield f"{sp}.{dn}.in", d["per_trial"]["T_in_sample"]
            yield f"{sp}.{dn}.out", d["per_trial"]["T_held_out"]


def _ratios(res: dict):
    for c in H.COMPARISONS:
        yield f"full.{c}", res["full_data"]["in_sample"][c]["ratio"]
        for sp, s in res["splits"].items():
            for side in ("in_sample", "held_out"):
                yield f"{sp}.{side}.{c}", s["summary"][c][side]["ratio_geomean"]


def p2a(hold: dict, rep: dict) -> dict:
    out = {}
    for name, res in hold["scenarios"].items():
        r2 = rep["scenarios"][name]
        a1, a2 = dict(_pt_arrays(res)), dict(_pt_arrays(r2))
        dT = max(float(np.max(np.abs(np.array(a1[k][al]) - np.array(a2[k][al])))) if a1[k][al] else 0.0
                 for k in a1 for al in a1[k])
        r1, rr = dict(_ratios(res)), dict(_ratios(r2))
        dR = max(abs((r1[k] or 0) - (rr[k] or 0)) for k in r1)
        out[name] = {"max_abs_diff_T_months": dT, "max_abs_diff_summary_ratio": dR,
                     "identical": bool(dT <= IDENTICAL_TOL and dR <= 1e-9),
                     "result_deterministic_flag": hold.get("deterministic"),
                     "replicate_deterministic_flag": rep.get("deterministic")}
    return out


# ---------------------------------------------------------------- P2b search effort

def solve_budget(b: service.Built, **budget) -> dict:
    """service.solve with a solver budget passed to every core.coordinate call (copy of its logic)."""
    inst = b.inst
    background = b.x_actual.copy()
    background[:, inst.movable] = False
    T_act = core.evaluate(inst, b.x_actual)
    x_ind = core.independent(inst, order=b.order, background=b.x_actual)
    x_free, st_free = core.coordinate(inst, x0=background, **budget)
    x_nl, st_nl = core.coordinate(inst.replace(caps=T_act), x0=b.x_actual, **budget)
    T_ind = core.evaluate(inst, x_ind)
    x_nli, st_nli = core.coordinate(inst.replace(caps=T_ind), x0=x_ind, **budget)
    out = {"built": b, "x": {"actual": b.x_actual, "indep": x_ind, "coord_free": x_free, "coord": x_nl,
                             "coord_nl_indep": x_nli},
           "solver": {"coord_free": st_free, "coord": st_nl, "coord_nl_indep": st_nli}}
    out["T"] = {k: core.evaluate(inst, x) for k, x in out["x"].items()}
    return out


def _choose_score_budget(params, rc: dict, rs: dict, budget: dict | None) -> dict:
    """H.choose_and_score, with solve_budget when a budget is given (else service.solve, as in the method)."""
    if budget is None:
        return H.choose_and_score(params, rc, rs)
    b_c = service.build(params, rates=rc)
    mv = b_c.inst.movable.copy()
    run = solve_budget(b_c, **budget)
    b_s = service.build(params, rates=rs, movable=mv)
    return {"b_choose": b_c, "b_score": b_s, "run": run, "mv": mv, "T_in": run["T"],
            "T_out": service.rescore(b_s, run["x"])}


def effort_run(tables: dict, params_of, budget: dict | None, splits=tuple(H.SPLITS), label: str = "") -> dict:
    """Full data + every split direction at one budget. Returns the same summary shape as holdout.json."""
    out = {}
    for name in H.SCENARIOS:
        params = params_of(name)
        t0 = time.monotonic()
        if budget is None:
            full = service.solve(params, cache=False)
        else:
            full = solve_budget(service.build(params), **budget)
        mv_full = full["built"].inst.movable
        res = {"full_data": {"in_sample": service.comparisons(full["T"], mv_full), "solver": H._solver(full)},
               "splits": {}}
        for sp in splits:
            tabs = tables[sp]
            dirs = {}
            for choose, score in H.DIRECTIONS:
                d = _choose_score_budget(params, tabs[choose], tabs[score], budget)
                dirs[f"{choose}->{score}"] = {"in_sample": service.comparisons(d["T_in"], d["mv"]),
                                              "held_out": service.comparisons(d["T_out"], d["mv"]),
                                              "solver": H._solver(d["run"])}
            res["splits"][sp] = {"directions": dirs, "summary": H.summarize(list(dirs.values()))}
        print(f"[P2b {label}] {name} ({time.monotonic() - t0:.0f}s)", flush=True)
        out[name] = res
    return out


def _effort_summary(res_by_scen: dict) -> dict:
    """{scenario: {comparison: {"full": r, "<split>_in": g, "<split>_out": g}}}."""
    out = {}
    for name, res in res_by_scen.items():
        out[name] = {}
        for c in H.COMPARISONS:
            row = {"full": res["full_data"]["in_sample"][c]["ratio"]}
            for sp, s in res["splits"].items():
                row[f"{sp}_in"] = s["summary"][c]["in_sample"]["ratio_geomean"]
                row[f"{sp}_out"] = s["summary"][c]["held_out"]["ratio_geomean"]
                row[f"{sp}_out_by_direction"] = s["summary"][c]["held_out"]["ratio_by_direction"]
                row[f"{sp}_in_by_direction"] = s["summary"][c]["in_sample"]["ratio_by_direction"]
            out[name][c] = row
    return out


def _round1_p2_summary(post1: dict) -> dict:
    """Round-1 P2 rerun (run 2): full data and alternating split only."""
    out = {}
    for name, r in post1["P2_P3_replicate_and_composition"].items():
        out[name] = {}
        for c in H.COMPARISONS:
            dirs = [r["alternating"][dn]["run2"] for dn in ("A->B", "B->A")]
            out[name][c] = {"full": r["full_data"]["run2"][c]["ratio"],
                            "alternating_in": r["alternating_summary"][c]["run2_in"],
                            "alternating_out": r["alternating_summary"][c]["run2_held_out"],
                            "alternating_in_by_direction": [d["in_sample"][c]["ratio"] for d in dirs],
                            "alternating_out_by_direction": [d["held_out"][c]["ratio"] for d in dirs]}
    return out


def _dist(vals: list) -> dict | None:
    v = [x for x in vals if x is not None]
    if not v:
        return None
    return {"n": len(v), "median": float(np.median(v)), "min": float(min(v)), "max": float(max(v)), "runs": v}


def wallclock_distribution(runs: list[dict]) -> dict:
    out = {}
    for name in H.SCENARIOS:
        out[name] = {}
        for c in H.COMPARISONS:
            keys = sorted({k for r in runs for k in r.get(name, {}).get(c, {}) if not k.endswith("by_direction")})
            out[name][c] = {k: _dist([r.get(name, {}).get(c, {}).get(k) for r in runs]) for k in keys}
            for sp in H.SPLITS:
                for side in ("in", "out"):
                    k = f"{sp}_{side}_by_direction"
                    vals = [r.get(name, {}).get(c, {}).get(k) for r in runs]
                    vals = [v for v in vals if v]
                    if vals:
                        out[name][c][k] = [_dist([v[i] for v in vals]) for i in range(2)]
    return out


def check_solve_budget(tables: dict, alloc: dict) -> dict:
    name, sp, choose, score = CHECK_CASE
    params = H.scenario_params(name)
    d = _choose_score_budget(params, tables[sp][choose], tables[sp][score], PRIMARY_BUDGET)
    ref = alloc[f"{name}.{sp}.{choose}->{score}"]["x"]
    same = {k: bool(np.array_equal(d["run"]["x"][k], ref[k])) for k in ref}
    return {"case": f"{name} {sp} {choose}->{score}", "allocations_equal": same, "ok": all(same.values())}


# ---------------------------------------------------------------- P3 composition

def composition(x: np.ndarray, mv: np.ndarray, n_hist: np.ndarray) -> dict:
    slots = x[:, mv]
    per_site = slots.sum(axis=1)
    tot = max(int(per_site.sum()), 1)
    return {lab: round(float(per_site[(n_hist >= lo) & (n_hist <= hi)].sum() / tot), 4) for lab, lo, hi in CLASSES}


def _n_hist(table: dict, site_ids: list[str]) -> np.ndarray:
    return np.array([table["n_hist"].get(s, 0) for s in site_ids])


def p3(tables: dict, full_table: dict, alloc: dict, site_ids: dict) -> dict:
    out = {}
    for name in H.SCENARIOS:
        ids = site_ids[name]
        a = alloc[f"{name}.full"]
        out[name] = {"full_data": {"full_history": {k: composition(x, a["movable"], _n_hist(full_table, ids))
                                                    for k, x in a["x"].items()}}}
        for sp in H.SPLITS:
            tabs = tables[sp]
            for choose, score in H.DIRECTIONS:
                dn = f"{choose}->{score}"
                a = alloc[f"{name}.{sp}.{dn}"]
                out[name][f"{sp}.{dn}"] = {
                    basis: {k: composition(x, a["movable"], nh) for k, x in a["x"].items()}
                    for basis, nh in (("full_history", _n_hist(full_table, ids)),
                                      ("choose_half", _n_hist(tabs[choose], ids)),
                                      ("score_half", _n_hist(tabs[score], ids)))}
    return out


# ---------------------------------------------------------------- P4 floor re-valuation

def floor_stats(table: dict, cand_ids: list[str]) -> dict:
    vals = [table["lam_mean"][s] for s in cand_ids if table["n_hist"].get(s, 0) >= 1]
    m = float(np.median(vals)) if vals else None
    return {"floor": table["unseen"], "median_uncapped_candidate_rate": m, "n_sites_with_history": len(vals),
            "relative_floor": (table["unseen"] / m) if m else None}


def aligned_table(score: dict, new_floor: float) -> dict:
    """The score table with its floor replaced, applied as recruitment.effective_rates does."""
    lam_eff = {s: (min(lm, new_floor) if score["n_hist"].get(s, 0) < R.LOW_HISTORY_N else lm)
               for s, lm in score["lam_mean"].items()}
    return {**score, "lam_eff": lam_eff, "unseen": float(new_floor), "label": score["label"] + " (floor aligned)"}


def p4(tables: dict, full_table: dict, alloc: dict, hold: dict) -> dict:
    out = {}
    for name in H.SCENARIOS:
        params = H.scenario_params(name)
        b_full = service.build(params)
        cand_ids = [s for s, c in zip(b_full.inst.site_ids, b_full.inst.feasible.any(axis=1)) if c]
        res = {"full_table": floor_stats(full_table, cand_ids), "n_candidate_sites": len(cand_ids), "splits": {}}
        for sp in H.SPLITS:
            tabs = tables[sp]
            fs = {h: floor_stats(tabs[h], cand_ids) for h in ("A", "B")}
            dirs = {}
            for choose, score in H.DIRECTIONS:
                dn = f"{choose}->{score}"
                a = alloc[f"{name}.{sp}.{dn}"]
                X, mv = a["x"], a["movable"]
                rel_c, rel_s = fs[choose]["relative_floor"], fs[score]["relative_floor"]
                f_new = fs[score]["median_uncapped_candidate_rate"] * rel_c
                b_s = service.build(params, rates=tabs[score], movable=mv)
                b_al = service.build(params, rates=aligned_table(tabs[score], f_new), movable=mv)
                T_out, T_al = service.rescore(b_s, X), service.rescore(b_al, X)
                ref = np.array(hold["scenarios"][name]["splits"][sp]["directions"][dn]["per_trial"]["T_held_out"]["coord"])
                dirs[dn] = {"revaluation_factor": rel_c / rel_s, "aligned_floor": f_new,
                            "score_floor": tabs[score]["unseen"],
                            "check_max_abs_diff_vs_holdout_json": float(np.max(np.abs(T_out["coord"] - ref))),
                            "held_out": service.comparisons(T_out, mv),
                            "held_out_floor_aligned": service.comparisons(T_al, mv)}
            summ = {}
            for c in H.COMPARISONS:
                summ[c] = {side: H._gm(d[side][c]["ratio"] for d in dirs.values())
                           for side in ("held_out", "held_out_floor_aligned")}
                summ[c]["by_direction"] = {dn: {side: d[side][c]["ratio"] for side in ("held_out", "held_out_floor_aligned")}
                                           for dn, d in dirs.items()}
            res["splits"][sp] = {"floor_stats": fs, "directions": dirs, "summary": summ}
        out[name] = res
    return out


# ---------------------------------------------------------------- main

def _f(x) -> str:
    return "-" if x is None else f"{x:.3f}"


def main() -> None:
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--alloc", required=True, help="--save-alloc output of the primary run")
    ap.add_argument("--replicate", help="a second holdout.json from identical code (P2a)")
    ap.add_argument("--wallclock-run1", help="the pre-registered 6 s result (holdout.json of commit 12b8404)")
    ap.add_argument("--wallclock-run2", help="round-1 holdout_posthoc.json (its P2 rerun)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--skip", action="append", default=[], choices=["P2b_low", "P2b_wallclock"])
    a = ap.parse_args()
    hold = json.loads(Path(a.holdout).read_text())
    alloc = H.load_alloc(a.alloc)
    con = H._con()
    tables = H.rate_tables(con)
    full_table = R.fit_rate_table(con)
    site_ids = {name: service.build(H.scenario_params(name)).inst.site_ids for name in H.SCENARIOS}
    out = {"post_hoc": True, "note": "exploratory; never replaces the pre-registered headline",
           "holdout_method_commit": hold.get("method_commit"), "posthoc_commit": H._git_head(),
           "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
           "P1_tail_sensitivity": p1(hold),
           "P3_composition": p3(tables, full_table, alloc, site_ids)}
    out["P4_floor"] = p4(tables, full_table, alloc, hold)
    if a.replicate:
        out["P2a_determinism"] = p2a(hold, json.loads(Path(a.replicate).read_text()))
    p2b = {"primary": _effort_summary(hold["scenarios"])}
    path = Path(a.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    if "P2b_low" not in a.skip:
        p2b["solve_budget_check"] = check_solve_budget(tables, alloc)
        p2b["low"] = _effort_summary(effort_run(tables, lambda n: H.scenario_params(n), LOW_BUDGET, label="low"))
    out["P2b_search_effort"] = p2b
    path.write_text(json.dumps(out, indent=1))  # checkpoint before the slow wall-clock runs
    if "P2b_wallclock" not in a.skip:
        runs = []
        if a.wallclock_run1:
            runs.append(_effort_summary(json.loads(Path(a.wallclock_run1).read_text())["scenarios"]))
        if a.wallclock_run2:
            runs.append(_round1_p2_summary(json.loads(Path(a.wallclock_run2).read_text())))
        for i in range(N_WALL):
            runs.append(_effort_summary(effort_run(
                tables, lambda n: H.scenario_params(n, time_limit=WALLCLOCK_TIME_LIMIT), None,
                label=f"wallclock {i + 1}/{N_WALL}")))
        p2b["wallclock_runs"] = runs
        p2b["wallclock_distribution"] = wallclock_distribution(runs)
    path.write_text(json.dumps(out, indent=1))

    for name, r in out["P1_tail_sensitivity"].items():
        for sp, s in r.items():
            for c, v in s["summary"].items():
                print(f"P1 {name:24s} {sp:11s} {c:31s} excl in {_f(v['excl_in_sample_ratio'])} "
                      f"out {_f(v['excl_held_out_ratio'])} | geo-speedup in {_f(v['geo_speedup_in_sample'])} "
                      f"out {_f(v['geo_speedup_held_out'])} | top5 share {_f(v['top5_share_of_held_out_dividend_mean'])}")
    if "P2a_determinism" in out:
        print("P2a", out["P2a_determinism"])
    for lab in ("primary", "low"):
        for name, r in p2b.get(lab, {}).items():
            for c, v in r.items():
                print(f"P2b {lab:8s} {name:24s} {c:31s} full {_f(v['full'])} | alt {_f(v.get('alternating_in'))}"
                      f" -> {_f(v.get('alternating_out'))} | time {_f(v.get('time_in'))} -> {_f(v.get('time_out'))}")
    for name, r in p2b.get("wallclock_distribution", {}).items():
        for c, v in r.items():
            cells = " | ".join(f"{k} med {_f(d['median'])} [{_f(d['min'])}, {_f(d['max'])}] n={d['n']}"
                               for k, d in v.items() if isinstance(d, dict) and d)
            print(f"P2b wall {name:24s} {c:31s} {cells}")
    for name, r in out["P4_floor"].items():
        print(f"P4 {name} full-table floor {r['full_table']}")
        for sp, s in r["splits"].items():
            print(f"P4 {name} {sp} floors A {s['floor_stats']['A']} B {s['floor_stats']['B']}")
            for dn, d in s["directions"].items():
                print(f"P4 {name} {sp} {dn} revaluation x{d['revaluation_factor']:.2f} check {d['check_max_abs_diff_vs_holdout_json']:.4f}")
            for c, v in s["summary"].items():
                print(f"P4 {name:24s} {sp:11s} {c:31s} held-out {_f(v['held_out'])} floor-aligned "
                      f"{_f(v['held_out_floor_aligned'])} by dir {v['by_direction']}")
    print("->", path)


if __name__ == "__main__":
    main()
