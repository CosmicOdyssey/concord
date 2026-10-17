"""POST-HOC checks on the optimizer's-curse holdout (task A). Exploratory.

    python -m concord.analysis.selection_holdout_posthoc --holdout <abs>/data/robustness/holdout.json \
        --out <abs>/data/robustness/holdout_posthoc.json

These checks were defined AFTER the pre-registered results (selection_holdout.py, commit 12b8404)
were seen, because those results raised three questions. They are written down here and committed
before being run. They qualify the pre-registered numbers; they never replace the pre-registered
headline (held-out alternating geomean of coord_vs_actual), whichever way they point.

P1. Tail sensitivity (no re-solve; reads the per-trial arrays saved in holdout.json).
    The pre-registered ratio is a ratio of sums, and a few movable trials have registered times
    above service.PLAUSIBLE_T_MONTHS under score-half rates (the build would have flagged them had
    the score half chosen the movable set). For each scenario x split x direction, recompute
    service.compare for every comparison (a) over movable trials excluding those with held-out
    registered T > PLAUSIBLE_T_MONTHS, held-out and in-sample on the same trials; and (b) the
    geometric mean of per-trial speedups T_base / T_new over all movable trials, in-sample and
    held-out. Also (c) the share of the held-out dividend (sum T_base - T_new) that comes from the
    5 trials with the largest gains. Summaries: geometric mean over the two directions, as in the
    pre-registered method.

P2. Solver-timing replicate. The solver stops at a wall-clock time limit on a shared CPU; in the
    pre-registered run the Regeneron full-data no-loser solve made 0 ILS kicks and gave 1.162x vs
    1.269x in the production grid. Rerun, with identical code and parameters, the full-data
    reference and the alternating split (both directions) once, for both scenarios, and report the
    pre-registered statistics of run 1 (from holdout.json) and run 2 side by side. Run 1 stays the
    result; the difference measures solver noise only.

P3. Slot composition. Sites with no fit history get the same floor rate (prior 25th percentile)
    in every half, so a gain from moving trials off such sites is not tested by the holdout. For
    every allocation of the P2 runs, report the share of movable trials' site slots at sites with
    0, 1-2 (capped) and >= 3 fit-history trials, counted on the full history, on the choose half
    and on the score half.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np

from concord import service
from concord.analysis import selection_holdout as H
from concord.model import recruitment as R

TOP_K = 5
CLASSES = (("0", 0, 0), ("1-2", 1, R.LOW_HISTORY_N - 1), (f">={R.LOW_HISTORY_N}", R.LOW_HISTORY_N, 10 ** 9))


def _arr(d: dict) -> dict[str, np.ndarray]:
    return {k: np.array(v, dtype=float) for k, v in d.items()}


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


def composition(x: np.ndarray, mv: np.ndarray, n_hist: np.ndarray) -> dict:
    slots = x[:, mv]
    per_site = slots.sum(axis=1)
    tot = max(int(per_site.sum()), 1)
    return {lab: round(float(per_site[(n_hist >= lo) & (n_hist <= hi)].sum() / tot), 4) for lab, lo, hi in CLASSES}


def _n_hist(table: dict, site_ids: list[str]) -> np.ndarray:
    return np.array([table["n_hist"].get(s, 0) for s in site_ids])


def p2_p3(con, hold: dict, tables: dict, full_table: dict) -> dict:
    res = {}
    for name, kw in H.SCENARIOS.items():
        params = service.Params(**kw)
        t0 = time.monotonic()
        full = service.solve(params)
        b = full["built"]
        mv_full = b.inst.movable.copy()
        nh_full = _n_hist(full_table, b.inst.site_ids)
        r1 = hold["scenarios"][name]
        out = {"full_data": {
            "run1": {c: r1["full_data"]["in_sample"][c] for c in H.COMPARISONS},
            "run2": service.comparisons(full["T"], mv_full),
            "run1_solver": r1["full_data"]["solver"], "run2_solver": H._solver(full),
            "composition_full_history": {k: composition(x, mv_full, nh_full) for k, x in full["x"].items()}},
            "alternating": {}}
        print(f"[{name}] full data rerun ({time.monotonic() - t0:.0f}s)", flush=True)
        tabs = tables["alternating"]
        dirs2 = []
        for choose, score in H.DIRECTIONS:
            dn = f"{choose}->{score}"
            d = H.choose_and_score(params, tabs[choose], tabs[score])
            mv, X = d["mv"], d["run"]["x"]
            ids = d["b_choose"].inst.site_ids
            run2 = {"in_sample": service.comparisons(d["T_in"], mv), "held_out": service.comparisons(d["T_out"], mv)}
            dirs2.append(run2)
            r1d = r1["splits"]["alternating"]["directions"][dn]
            out["alternating"][dn] = {
                "run1": {s: r1d[s] for s in ("in_sample", "held_out")}, "run2": run2,
                "run1_solver": r1d["diagnostics"]["solver"], "run2_solver": H._solver(d["run"]),
                "composition": {
                    basis: {k: composition(x, mv, nh) for k, x in X.items()}
                    for basis, nh in (("full_history", _n_hist(full_table, ids)),
                                      ("choose_half", _n_hist(tabs[choose], ids)),
                                      ("score_half", _n_hist(tabs[score], ids)))}}
            print(f"[{name}] alternating {dn} rerun ({time.monotonic() - t0:.0f}s)", flush=True)
        s1 = r1["splits"]["alternating"]["summary"]
        s2 = H.summarize(dirs2)
        out["alternating_summary"] = {c: {"run1_in": s1[c]["in_sample"]["ratio_geomean"],
                                          "run2_in": s2[c]["in_sample"]["ratio_geomean"],
                                          "run1_held_out": s1[c]["held_out"]["ratio_geomean"],
                                          "run2_held_out": s2[c]["held_out"]["ratio_geomean"]} for c in H.COMPARISONS}
        res[name] = out
    return res


def main() -> None:
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--skip-rerun", action="store_true", help="P1 only")
    a = ap.parse_args()
    hold = json.loads(Path(a.holdout).read_text())
    out = {"post_hoc": True, "note": "exploratory; never replaces the pre-registered headline",
           "holdout_method_commit": hold.get("method_commit"), "posthoc_commit": H._git_head(),
           "generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "P1_tail_sensitivity": p1(hold)}
    if not a.skip_rerun:
        con = H._con()
        tables = H.rate_tables(con)
        full_table = R.fit_rate_table(con)
        out["P2_P3_replicate_and_composition"] = p2_p3(con, hold, tables, full_table)
    path = Path(a.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1))
    for name, r in out["P1_tail_sensitivity"].items():
        for sp, s in r.items():
            for c, v in s["summary"].items():
                f = lambda x: "-" if x is None else f"{x:.3f}"
                print(f"P1 {name:24s} {sp:11s} {c:31s} excl in {f(v['excl_in_sample_ratio'])} "
                      f"out {f(v['excl_held_out_ratio'])} (med {f(v['excl_held_out_median_speedup'])}, slower "
                      f"{f(v['excl_held_out_share_slower'])}) | geo-speedup in {f(v['geo_speedup_in_sample'])} "
                      f"out {f(v['geo_speedup_held_out'])} | top5 share {f(v['top5_share_of_held_out_dividend_mean'])}")
    if "P2_P3_replicate_and_composition" in out:
        for name, r in out["P2_P3_replicate_and_composition"].items():
            for c in H.COMPARISONS:
                fd = r["full_data"]
                s = r["alternating_summary"][c]
                print(f"P2 {name:24s} {c:31s} full {fd['run1'][c]['ratio']:.3f}/{fd['run2'][c]['ratio']:.3f} | "
                      f"alt in {s['run1_in']:.3f}/{s['run2_in']:.3f} | alt out {s['run1_held_out']:.3f}/"
                      f"{s['run2_held_out']:.3f}")
            print(f"P3 {name} full-data composition {r['full_data']['composition_full_history']}")
    print("->", path)


if __name__ == "__main__":
    main()
