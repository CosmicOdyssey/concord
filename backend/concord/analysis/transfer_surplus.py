"""Task C: transfer surplus of the joint optimum.

    python -m concord.analysis.transfer_surplus --out ../data/robustness/transfers.json

Question. The joint optimum (coord_free) has fewer total enrollment months than registered sites
and than every trial's best response, but some trials are slower under it. If winners gain more
than losers lose, priority credits paid by winners to losers (in proportion to months lost) could
leave every trial no worse off. How big is the net surplus, in-sample and held-out? No auction is
implemented; this only totals gains and losses and checks a simple compensation rule.

PRE-REGISTERED METHOD (written and committed before any result of this task was computed)

Scenarios (estimated beta, all other params at service.Params defaults)
  primary    US-Northeast, service.Params().
  secondary  Params(region="US", sponsor="Regeneron", as_of="2024-09-01") (portfolio mode: only
             Regeneron trials move; other sponsors' trials are fixed background).
Capacity
  peak       default k_s = historical peak concurrency (PRIMARY).
  unlimited  capacity_unlimited=True (contrast: task B found the joint optimum's gain over best
             response is almost all capacity, so the surplus should mostly vanish here).

Solver. Deterministic, exactly as task B's Fix 1: the allocations of service.solve, with
  core.coordinate(patience=0, max_passes=2, time_limit=900) (service.RESOLVE: greedy + 2 local-search
  passes, no exchanges, no kicks); the 900 s limit is a safety bound that must not bind (every solve
  records hit_time_limit). Reason: task B showed that service.solve's 6 s wall-clock budget gives
  different allocations under different CPU load, so its numbers are not reproducible. This is a
  departure from the brief's "run = service.solve(params, b_choose, cache=False)"; the allocation
  definitions, starts and caps are unchanged. Context only (never in place of the numbers above):
  one run of the unchanged service.solve (6 s) for US-Northeast at peak (full history and both
  directions), with --wallclock-context.

Allocations (service.solve definitions)
  actual         registered CT.gov site lists           (baseline 1)
  indep          each trial's best response            (baseline 2)
  coord_free     joint optimum, losers allowed          (the NEW allocation; PRIMARY)
  coord          no-loser vs registered                 (secondary: best found WITHOUT transfers, vs actual)
  coord_nl_indep no-loser vs best response              (secondary: best found WITHOUT transfers, vs indep)
Comparisons: coord_free vs actual, coord_free vs indep (PRIMARY pair); coord vs actual and
  coord_nl_indep vs indep (the no-transfer alternatives, scored the same way).

Quantities for one comparison (base, new) on one vector of T (months), weights w_i = 1
  M  = movable trials of the build that CHOSE the allocations (inst.movable); Bg = the other trials
       (background: held at registered sites; affected only through congestion).
  delta_i = T_base_i - T_new_i (positive = gain), EPS = 1e-6 months.
  winners = #{i in M: delta_i > EPS}; losers = #{i in M: delta_i < -EPS}; also counted at a
       material threshold of 1 month.
  G    = sum_{i in M} max(delta_i, 0)            gains of winning trials (trial-months)
  L    = sum_{i in M} max(-delta_i, 0)           losses of losing movable trials
  L_bg = sum_{i in Bg} max(-delta_i, 0)          losses of background trials whose T rises
         (split into flagged-implausible background, T_registered > 120 months under the same rates,
         and the rest, which in portfolio mode are other sponsors' trials); G_bg (background gains)
         is reported as context and NOT credited to S.
  S    = G - L - L_bg                            NET SURPLUS (PRIMARY), and S/G.
  Check: G - L must equal service.compare(T_base, T_new, M)["dividend_trial_months"] (asserted).
  Scale: S / sum_{i in M} T_base_i (surplus as a share of baseline trial-months).
  Unfilled trials (T >= core.NO_SITES_T under base or new) are counted; if any, S is also reported
  without them (the pre-registered S keeps them).

Compensation (ex ante; computed only if S > 0)
  credit_i  = max(-delta_i, 0) for every losing trial, movable or background (months lost);
  payment_i = max(delta_i, 0) * (L + L_bg) / G for every winning movable trial.
  Sum of credits = sum of payments = L + L_bg (budget balanced), and net_i = delta_i + credit_i -
  payment_i >= 0 for every trial by construction. Reported: share of gains winners keep
  1 - (L + L_bg)/G (= S/G), total credits, largest single credit and payment. If S <= 0 no scheme is
  reported ("no surplus") and the shortfall -S is.

In-sample: rates fit on full history (the DB), allocations chosen and scored with them.

Held-out: alternating split, recruitment.split_alternating (fixed definition). For (choose, score)
  in (A, B), (B, A):
    rates_h = recruitment.fit_rate_table(con, keep=lambda t: split.get(t) == h)
    b_c = service.build(params, rates=rates_choose); run = deterministic solve on b_c
    b_s = service.build(params, rates=rates_score, movable=b_c.inst.movable)
    T_held = service.rescore(b_s, run["x"])
  (a) half in-sample: the quantities above on run["T"] (choose rates): context for shrinkage.
  (b) held-out: the quantities above on T_held, with M = b_c.inst.movable.
  (c) EX POST test of the ex-ante scheme: credits and payments from the half in-sample deltas
      (a), realized deltas from T_held. Realized net_i = delta_held_i + credit_i - payment_i for
      every trial (background trials never pay; they hold a credit only if they lost in (a)).
      Reported: trials with realized net < -EPS (PRIMARY ex post count; movable and background
      separately), trials with realized net < -1 month, total shortfall (sum of negative realized
      nets), largest shortfall, and realized total surplus = sum over all trials of realized net
      (= sum of delta_held over all trials, since transfers balance). If S <= 0 in (a), there is no
      scheme and (c) is n/a.
  Aggregation over the two directions: arithmetic mean of G, L, L_bg, S and of counts; the mean
  S/G is mean S / mean G.
  Sensitivity (task B's Fix 2, reported beside, never in place): screened set M_s = M minus trials
  with T_registered > 120 months under the score half's rates. Held-out quantities and ex post
  counts restricted to M_s (background unchanged); ex-ante transfers unchanged.

Reading rules (fixed now)
  - PRIMARY number: US-Northeast at peak, coord_free vs indep, held-out mean S (trial-months) and S/G;
    coord_free vs actual reported beside it with equal prominence.
  - "Positive surplus" (the condition task G uses) means held-out S > 0 in BOTH directions for
    US-Northeast at peak vs best response. If in-sample S > 0 but this fails, it is reported as
    "positive in-sample only".
  - Value of transfers: S(coord_free vs base) - S(no-loser allocation vs the same base), i.e. coord
    vs actual and coord_nl_indep vs indep, in-sample and held-out. Positive means the joint optimum
    plus transfers beats the best allocation found without transfers. Reported as is.
  - The ex-ante scheme "holds out of sample" only if no movable trial has realized net < -1 month in
    either direction; otherwise the count, shortfall and largest shortfall are the result.
No parameter is tuned; every number is reported, including ones that weaken the pitch.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from dataclasses import asdict, replace
from pathlib import Path

import numpy as np

from concord import service
from concord.allocator import core
from concord.model import recruitment as R
from concord.paths import DB_PATH, ROOT

EPS = 1e-6  # months
MATERIAL = 1.0  # months
PLAUSIBLE = service.PLAUSIBLE_T_MONTHS
UNFILLED = core.NO_SITES_T * (1 - 1e-9)
SCENARIOS = {
    "US-Northeast": service.Params(),
    "Regeneron US 2024-09-01": service.Params(region="US", sponsor="Regeneron", as_of="2024-09-01"),
}
SCENARIO_KEYS = {"ne": "US-Northeast", "regeneron": "Regeneron US 2024-09-01"}
CAPACITIES = [("peak", {}), ("unlimited", {"capacity_unlimited": True})]
# (new, base); the first two are the joint optimum (PRIMARY), the last two the no-transfer alternatives.
COMPARISONS = [("coord_free", "indep"), ("coord_free", "actual"), ("coord", "actual"), ("coord_nl_indep", "indep")]
NO_TRANSFER = {"indep": "coord_nl_indep", "actual": "coord"}
PER_TRIAL = {("coord_free", "indep"), ("coord_free", "actual")}
# Task B Fix 1: deterministic coordinate() budget (service.RESOLVE); time_limit is a safety bound only.
SOLVER = dict(patience=service.RESOLVE["patience"], max_passes=service.RESOLVE["max_passes"], time_limit=900.0)


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def key(comp: tuple[str, str]) -> str:
    return f"{comp[0]}_vs_{comp[1]}"


# ----------------------------------------------------------------------------------------- solving

def solve_det(params: service.Params, b: service.Built | None = None) -> dict:
    """service.solve with a wall-clock-independent coordinate() budget (task B Fix 1): same
    allocations, starts and caps; only the solver kwargs differ."""
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


def solve_wallclock(params: service.Params, b: service.Built | None = None) -> dict:
    """Context only: the unchanged service.solve (6 s wall-clock budget, not reproducible)."""
    return service.solve(params, b, cache=False)


def _solver(run: dict) -> dict:
    return {k: {kk: v[kk] for kk in ("objective", "greedy_objective", "kicks", "seconds", "hit_time_limit")}
            for k, v in run["solver"].items()}


# ----------------------------------------------------------------------------------------- surplus

def _f(x) -> float | None:
    return None if x is None else float(x)


def surplus(T: dict, comp: tuple[str, str], M: np.ndarray, Bg: np.ndarray, T_reg: np.ndarray) -> dict:
    """G, L, L_bg, S for one comparison on one T. M: movable trials counted as winners/losers;
    Bg: background trials whose losses count in L_bg. T_reg: registered-allocation T under the same
    rates (flags implausible background)."""
    new, base = comp
    Tb, Tn = T[base], T[new]
    delta = Tb - Tn
    gain, loss = np.maximum(delta, 0.0), np.maximum(-delta, 0.0)
    flag_bg = Bg & (T_reg > PLAUSIBLE)
    G, L = float(gain[M].sum()), float(loss[M].sum())
    L_bg = float(loss[Bg].sum())
    S = G - L - L_bg
    div = service.compare(Tb, Tn, M)["dividend_trial_months"] if M.any() else 0.0
    assert abs((G - L) - div) <= 1e-6 * max(1.0, abs(div)), (G - L, div)
    base_sum = float(Tb[M].sum())
    unf = ((Tb >= UNFILLED) | (Tn >= UNFILLED)) & (M | Bg)
    out = {
        "trials_counted": int(M.sum()), "background_counted": int(Bg.sum()),
        "G": G, "L": L, "L_bg": L_bg, "L_bg_flagged_implausible": float(loss[flag_bg].sum()),
        "L_bg_other": float(loss[Bg & ~flag_bg].sum()), "G_bg_context": float(gain[Bg].sum()),
        "S": S, "S_over_G": S / G if G > 0 else None, "S_movable_only": G - L,
        "S_over_base_months": S / base_sum if base_sum > 0 else None, "base_months": base_sum,
        "winners": int((M & (delta > EPS)).sum()), "losers": int((M & (delta < -EPS)).sum()),
        "winners_material": int((M & (delta >= MATERIAL)).sum()), "losers_material": int((M & (delta <= -MATERIAL)).sum()),
        "background_losers": int((Bg & (delta < -EPS)).sum()),
        "background_losers_material": int((Bg & (delta <= -MATERIAL)).sum()),
        "largest_gain": float(gain[M].max()) if M.any() else 0.0,
        "largest_loss": float(max(loss[M].max() if M.any() else 0.0, loss[Bg].max() if Bg.any() else 0.0)),
        "unfilled_trials": int(unf.sum()),
    }
    if unf.any():
        keep_M, keep_B = M & ~unf, Bg & ~unf
        out["S_without_unfilled"] = float(gain[keep_M].sum() - loss[keep_M].sum() - loss[keep_B].sum())
    out["compensation"] = scheme_summary(delta, M, Bg, out)
    return out


def scheme(delta: np.ndarray, M: np.ndarray, Bg: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """Ex-ante credits (to every loser, movable or background) and payments (by movable winners),
    or None if there is no surplus."""
    gain, loss = np.maximum(delta, 0.0), np.maximum(-delta, 0.0)
    part = M | Bg
    G = float(gain[M].sum())
    owed = float(loss[part].sum())
    if G - owed <= 0 or G <= 0:
        return None
    credit = np.where(part, loss, 0.0)
    payment = np.where(M, gain * owed / G, 0.0)
    return credit, payment


def scheme_summary(delta: np.ndarray, M: np.ndarray, Bg: np.ndarray, s: dict) -> dict:
    sc = scheme(delta, M, Bg)
    if sc is None:
        return {"exists": False, "shortfall": -s["S"]}
    credit, payment = sc
    net = delta + credit - payment
    part = M | Bg
    assert (net[part] >= -1e-6).all() and abs(credit.sum() - payment.sum()) <= 1e-6 * max(1.0, credit.sum())
    return {"exists": True, "share_of_gains_winners_keep": 1 - (s["L"] + s["L_bg"]) / s["G"],
            "total_credits": float(credit.sum()), "total_payments": float(payment.sum()),
            "largest_credit": float(credit.max()), "largest_payment": float(payment.max()),
            "trials_receiving_credit": int((credit > EPS).sum()), "trials_paying": int((payment > EPS).sum())}


def ex_post(delta_in: np.ndarray, delta_held: np.ndarray, M: np.ndarray, Bg: np.ndarray,
            M_eval: np.ndarray | None = None) -> tuple[dict, np.ndarray | None]:
    """Credits/payments from in-sample deltas, realized deltas held-out. M_eval: movable trials to
    evaluate (screened sensitivity); transfers are always computed over M. Returns (summary, net)."""
    sc = scheme(delta_in, M, Bg)
    if sc is None:
        return {"scheme": False}, None
    credit, payment = sc
    net = delta_held + credit - payment
    Me = M if M_eval is None else M_eval
    part = Me | Bg
    neg = np.minimum(net, 0.0)
    return {
        "scheme": True,
        "worse_off_movable": int((Me & (net < -EPS)).sum()), "worse_off_background": int((Bg & (net < -EPS)).sum()),
        "worse_off_movable_material": int((Me & (net <= -MATERIAL)).sum()),
        "worse_off_background_material": int((Bg & (net <= -MATERIAL)).sum()),
        "movable_evaluated": int(Me.sum()),
        "shortfall_total": float(-neg[part].sum()), "shortfall_movable": float(-neg[Me].sum()),
        "largest_shortfall": float(-neg[part].min()) if part.any() else 0.0,
        "realized_total_surplus": float(net[part].sum()),
        "realized_total_surplus_movable": float(net[Me].sum()),
    }, net


def _delta(T: dict, comp: tuple[str, str]) -> np.ndarray:
    return T[comp[1]] - T[comp[0]]


def _value_of_transfers(blocks: dict) -> dict:
    """S(joint optimum vs base) - S(no-loser allocation vs the same base)."""
    out = {}
    for base, nl in NO_TRANSFER.items():
        a, b = blocks[key(("coord_free", base))], blocks[key((nl, base))]
        out[f"vs_{base}"] = {"S_joint_optimum": a["S"], "S_no_loser": b["S"], "difference": a["S"] - b["S"]}
    return out


def analyze(T: dict, M: np.ndarray) -> dict:
    Bg = ~M
    blocks = {key(c): surplus(T, c, M, Bg, T["actual"]) for c in COMPARISONS}
    blocks["value_of_transfers"] = _value_of_transfers(blocks)
    return blocks


def _per_trial(ids: list[str], M: np.ndarray, T: dict, comp, T_held: dict | None = None, net_held=None) -> list:
    d = _delta(T, comp)
    sc = scheme(d, M, ~M)
    rows = []
    for i, t in enumerate(ids):
        r = {"nct_id": t, "movable": bool(M[i]), "T_base": round(float(T[comp[1]][i]), 3),
             "T_new": round(float(T[comp[0]][i]), 3), "delta": round(float(d[i]), 3)}
        if sc is not None:
            r["credit"], r["payment"] = round(float(sc[0][i]), 3), round(float(sc[1][i]), 3)
        if T_held is not None:
            r["delta_held"] = round(float(_delta(T_held, comp)[i]), 3)
            r["T_registered_held"] = round(float(T_held["actual"][i]), 3)
        if net_held is not None:
            r["realized_net_held"] = round(float(net_held[i]), 3)
        if M[i] or abs(d[i]) > EPS or (T_held is not None and abs(_delta(T_held, comp)[i]) > EPS):
            rows.append(r)
    return rows


# ----------------------------------------------------------------------------------------- running

def run_setting(p: service.Params, rates: dict, solve) -> dict:
    t0 = time.time()
    full = solve(p, None)
    b, inst = full["built"], full["built"].inst
    M = inst.movable.copy()
    res = {"params": asdict(p), "trials": inst.P, "movable_trials": int(M.sum()),
           "in_sample_full": analyze(full["T"], M), "solver_full": _solver(full),
           "per_trial_in_sample_full": {key(c): _per_trial(inst.trial_ids, M, full["T"], c) for c in COMPARISONS
                                        if c in PER_TRIAL}}
    pf = res["in_sample_full"]["coord_free_vs_indep"]
    log(f"  full: free vs indep G {pf['G']:.1f} L {pf['L']:.1f} L_bg {pf['L_bg']:.2f} S {pf['S']:.1f} "
        f"({time.time() - t0:.0f}s)")
    del full, b
    dirs = []
    for choose, score in (("A", "B"), ("B", "A")):
        b_c = service.build(p, rates=rates[choose])
        run = solve(p, b_c)
        M_c = b_c.inst.movable.copy()
        b_s = service.build(p, rates=rates[score], movable=M_c)
        T_held = service.rescore(b_s, run["x"])
        Ms = M_c & (T_held["actual"] <= PLAUSIBLE)
        d = {"choose": choose, "score": score, "movable_trials": int(M_c.sum()), "screened_trials": int(Ms.sum()),
             "screen_excluded": [b_c.inst.trial_ids[i] for i in np.flatnonzero(M_c & ~Ms)],
             "in_sample_half": analyze(run["T"], M_c), "held_out": analyze(T_held, M_c),
             "held_out_screened": {key(c): surplus(T_held, c, Ms, ~M_c, T_held["actual"]) for c in COMPARISONS},
             "ex_post": {}, "ex_post_screened": {}, "per_trial": {}, "solver": _solver(run)}
        d["held_out_screened"]["value_of_transfers"] = _value_of_transfers(d["held_out_screened"])
        for c in COMPARISONS:
            d_in, d_held = _delta(run["T"], c), _delta(T_held, c)
            d["ex_post"][key(c)], net = ex_post(d_in, d_held, M_c, ~M_c)
            d["ex_post_screened"][key(c)], _ = ex_post(d_in, d_held, M_c, ~M_c, Ms)
            if c in PER_TRIAL:
                d["per_trial"][key(c)] = _per_trial(b_c.inst.trial_ids, M_c, run["T"], c, T_held, net)
        h, ep = d["held_out"]["coord_free_vs_indep"], d["ex_post"]["coord_free_vs_indep"]
        log(f"  {choose}->{score}: free vs indep half S {d['in_sample_half']['coord_free_vs_indep']['S']:.1f}; held "
            f"G {h['G']:.1f} L {h['L']:.1f} L_bg {h['L_bg']:.2f} S {h['S']:.1f}; ex post worse off "
            f"{ep.get('worse_off_movable')} ({time.time() - t0:.0f}s)")
        dirs.append(d)
        del b_c, b_s, run
    res["directions"] = dirs
    res["held_out_mean"] = _mean([d["held_out"] for d in dirs])
    res["held_out_screened_mean"] = _mean([d["held_out_screened"] for d in dirs])
    res["in_sample_half_mean"] = _mean([d["in_sample_half"] for d in dirs])
    res["ex_post_mean"] = _mean_ex_post([d["ex_post"] for d in dirs])
    res["ex_post_screened_mean"] = _mean_ex_post([d["ex_post_screened"] for d in dirs])
    res["seconds"] = round(time.time() - t0, 1)
    return res


MEAN_KEYS = ["G", "L", "L_bg", "L_bg_flagged_implausible", "L_bg_other", "G_bg_context", "S", "S_movable_only",
             "winners", "losers", "winners_material", "losers_material", "background_losers", "unfilled_trials"]
EX_POST_KEYS = ["worse_off_movable", "worse_off_background", "worse_off_movable_material",
                "worse_off_background_material", "shortfall_total", "shortfall_movable", "largest_shortfall",
                "realized_total_surplus", "realized_total_surplus_movable"]


def _mean(blocks: list[dict]) -> dict:
    out = {}
    for c in COMPARISONS:
        k = key(c)
        row = {m: float(np.mean([b[k][m] for b in blocks])) for m in MEAN_KEYS}
        row["S_over_G"] = row["S"] / row["G"] if row["G"] > 0 else None
        row["S_by_direction"] = [b[k]["S"] for b in blocks]
        row["positive_both_directions"] = all(b[k]["S"] > 0 for b in blocks)
        out[k] = row
    out["value_of_transfers"] = {
        vb: {m: float(np.mean([b["value_of_transfers"][vb][m] for b in blocks]))
             for m in ("S_joint_optimum", "S_no_loser", "difference")}
        for vb in blocks[0]["value_of_transfers"]}
    return out


def _mean_ex_post(blocks: list[dict]) -> dict:
    out = {}
    for c in COMPARISONS:
        k = key(c)
        rows = [b[k] for b in blocks]
        if not all(r.get("scheme") for r in rows):
            out[k] = {"scheme_in_both_directions": False, "by_direction": rows}
            continue
        out[k] = {"scheme_in_both_directions": True, **{m: float(np.mean([r[m] for r in rows])) for m in EX_POST_KEYS},
                  "worse_off_movable_by_direction": [r["worse_off_movable"] for r in rows],
                  "worse_off_movable_material_by_direction": [r["worse_off_movable_material"] for r in rows],
                  "holds_out_of_sample": all(r["worse_off_movable_material"] == 0 for r in rows)}
    return out


def _rates(con) -> dict:
    split = R.split_alternating(con)
    return {h: R.fit_rate_table(con, keep=lambda t, h=h: split.get(t) == h, label=f"alternating half {h}")
            for h in "AB"}


def run_scenario(name: str, solve=solve_det, capacities=CAPACITIES) -> dict:
    base = SCENARIOS[name]
    con = sqlite3.connect(DB_PATH)
    rates = _rates(con)
    con.close()
    out = {"params": asdict(base), "rates_trials": {h: rates[h]["n_trials"] for h in "AB"}, "settings": {}}
    for label, kw in capacities:
        log(f"{name} [{label}]")
        out["settings"][label] = run_setting(replace(base, **kw), rates, solve)
    out["any_solve_hit_time_limit"] = any(
        v["hit_time_limit"] for s in out["settings"].values()
        for v in list(s["solver_full"].values()) + [x for d in s["directions"] for x in d["solver"].values()])
    return out


def reading(result: dict) -> dict:
    ne = result["scenarios"].get("US-Northeast", {}).get("settings", {}).get("peak")
    if not ne:
        return {}
    full = ne["in_sample_full"]["coord_free_vs_indep"]
    held = ne["held_out_mean"]["coord_free_vs_indep"]
    pos = held["positive_both_directions"]
    ep = ne["ex_post_mean"]["coord_free_vs_indep"]
    return {
        "primary": "US-Northeast peak, coord_free vs indep, held-out mean S",
        "S_in_sample_full": full["S"], "S_held_out_mean": held["S"], "S_over_G_held_out_mean": held["S_over_G"],
        "positive_surplus": ("yes" if pos else "positive in-sample only" if full["S"] > 0 else "no"),
        "ex_ante_scheme_holds_out_of_sample": ep.get("holds_out_of_sample"),
        "value_of_transfers_held_out_mean": ne["held_out_mean"]["value_of_transfers"],
    }


# ----------------------------------------------------------------------------------------- printing

def _fmt(x, f="{:.1f}") -> str:
    return "n/a" if x is None else f.format(x)


def table_rows(result: dict) -> list[list[str]]:
    """scenario x capacity x comparison x view: G, L, L_bg, S, S/G, winners, losers, ex-post worse off."""
    rows = []
    for name, sc in result["scenarios"].items():
        for cap, s in sc["settings"].items():
            for c in COMPARISONS:
                k = key(c)
                views = [("in-sample full", s["in_sample_full"][k], None)]
                for d in s["directions"]:
                    views.append((f"half in-sample {d['choose']}", d["in_sample_half"][k], None))
                    views.append((f"held-out {d['choose']}->{d['score']}", d["held_out"][k], d["ex_post"][k]))
                views.append(("held-out mean", s["held_out_mean"][k], s["ex_post_mean"][k]))
                for d in s["directions"]:
                    views.append((f"held-out screened {d['choose']}->{d['score']}", d["held_out_screened"][k],
                                  d["ex_post_screened"][k]))
                for v, b, ep in views:
                    if ep is None:
                        epx = "0 (by construction)" if v == "in-sample full" or v.startswith("half") else "n/a"
                        if b.get("compensation", {}).get("exists") is False:
                            epx = "no scheme"
                    elif "scheme" in ep:
                        epx = (f"{ep['worse_off_movable']} ({ep['worse_off_movable_material']} >= 1 m); bg "
                               f"{ep['worse_off_background']}" if ep["scheme"] else "no scheme")
                    else:
                        epx = (f"{ep['worse_off_movable']:.1f} ({ep['worse_off_movable_material']:.1f} >= 1 m)"
                               if ep.get("scheme_in_both_directions") else "no scheme in both")
                    rows.append([name, cap, f"{c[0]} vs {c[1]}", v, _fmt(b["G"]), _fmt(b["L"]), _fmt(b["L_bg"], "{:.2f}"),
                                 _fmt(b["S"]), _fmt(b["S_over_G"], "{:.3f}"), _fmt(b["winners"], "{:g}"),
                                 _fmt(b["losers"], "{:g}"), epx])
    return rows


def print_tables(result: dict) -> None:
    cols = ["scenario", "capacity", "comparison", "view", "G", "L", "L_bg", "S", "S/G", "winners", "losers",
            "ex-post worse off"]
    print(" | ".join(cols))
    for r in table_rows(result):
        print(" | ".join(r))
    for name, sc in result["scenarios"].items():
        for cap, s in sc["settings"].items():
            print(f"\n{name} [{cap}] value of transfers (S joint optimum - S no-loser):")
            for v, blk in (("in-sample full", s["in_sample_full"]), ("held-out mean", s["held_out_mean"]),
                           ("held-out screened mean", s["held_out_screened_mean"])):
                vt = blk["value_of_transfers"]
                print(f"  {v}: " + "; ".join(f"{b}: {x['S_joint_optimum']:.1f} - {x['S_no_loser']:.1f} = "
                                              f"{x['difference']:.1f}" for b, x in vt.items()))
            for c in COMPARISONS[:2]:
                ep = s["ex_post_mean"][key(c)]
                if ep.get("scheme_in_both_directions"):
                    print(f"  ex post {key(c)}: shortfall {ep['shortfall_total']:.1f} (largest {ep['largest_shortfall']:.1f}),"
                          f" realized surplus {ep['realized_total_surplus']:.1f}, holds: {ep['holds_out_of_sample']}")
    print("\nreading:", json.dumps(result.get("reading", {}), indent=1))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "data" / "robustness" / "transfers.json"))
    ap.add_argument("--scenarios", default="ne,regeneron", help="comma list of: ne, regeneron")
    ap.add_argument("--wallclock-context", action="store_true",
                    help="add one run of the unchanged 6 s service.solve for US-Northeast at peak (context only)")
    ap.add_argument("--print-only", action="store_true")
    a = ap.parse_args()
    path = Path(a.out)
    if a.print_only:
        print_tables(json.loads(path.read_text(encoding="utf-8")))
        return
    if a.wallclock_context:
        result = json.loads(path.read_text(encoding="utf-8"))
        w = run_scenario("US-Northeast", solve=solve_wallclock, capacities=CAPACITIES[:1])
        result["wallclock_6s_context"] = {"note": "context only: unchanged service.solve (6 s, not reproducible)",
                                          **w}
        path.write_text(json.dumps(result, indent=1), encoding="utf-8")
        return
    result = {"task": "C: transfer surplus of the joint optimum",
              "method": "pre-registered in concord/analysis/transfer_surplus.py docstring",
              "db": str(DB_PATH), "solver_budget": SOLVER, "eps_months": EPS, "material_months": MATERIAL,
              "scenarios": {}}
    path.parent.mkdir(parents=True, exist_ok=True)
    for k in [s.strip() for s in a.scenarios.split(",") if s.strip()]:
        name = SCENARIO_KEYS[k]
        result["scenarios"][name] = run_scenario(name)
        result["reading"] = reading(result)
        path.write_text(json.dumps(result, indent=1), encoding="utf-8")
        log(f"-> {path}")
    print_tables(result)


if __name__ == "__main__":
    main()
