"""Post hoc, not pre-registered: re-score task A's saved holdout allocations with CALIBRATED site rates.

    python -m concord.analysis.selection_calibrated

Why: the observed-outcome check (analysis/selection_validation.py) found that registry-based site scores carry
signal but overstate differences between site lists: the slope of actual on predicted log per-site
enrollment rate is 0.33 for industry Phase II/III trials (0.16 for all trials), not 1. The holdout's site-selection
gain (best response vs registered sites) is scored with uncalibrated rates, so it is likely overstated.

Method (fixed before running; no allocation is re-solved, only the scoring rates change):
- Calibrated rate: lam_cal = exp(m + b * (log lam - m)), applied to every site rate and the unseen rate of a rate
  table, where m = mean log lam_eff over U.S. non-anonymized sites with at least one fitted trial in that table.
- b: the industry Phase II/III slope from data/findings/selection_validation.json (primary), the all-trials slope
  (sensitivity), and b = 1 (no calibration; must reproduce data/robustness/holdout.json exactly, a check of this
  pipeline).
- Allocations: data/robustness/holdout_alloc.npz from the final rerun of task A's script. For each case the
  instance is rebuilt with service.build(params, rates=calibrated table, movable=saved movable trials) and the saved
  allocations are re-scored with service.rescore. Full data: full-history rates. Split directions: in-sample = the
  choosing half's rates, held-out = the scoring half's rates, both calibrated. Summaries use task A's summarize().
Caveat: b was estimated on trial-level scores (mean site score of a registered list). Applying it to each site's
rate assumes the overstatement is the same at site level.
"""

from __future__ import annotations

import json
import math
import sqlite3
import sys
import time

import numpy as np

from concord import service
from concord.analysis.selection_holdout import DIRECTIONS, SCENARIOS, SPLITS, load_alloc, rate_tables, scenario_params, \
    summarize
from concord.model import recruitment as R
from concord.paths import DATA_DIR, DB_PATH, FINDINGS_DIR, ROOT

ALLOC = ROOT / "data" / "robustness" / "holdout_alloc.npz"
HOLDOUT = ROOT / "data" / "robustness" / "holdout.json"
OUT = FINDINGS_DIR / "selection_calibrated.json"


def us_sites(con) -> set[str]:
    return {s for (s,) in con.execute("SELECT site_id FROM sites WHERE country='United States' AND anonymized=0")}


def calibrate(table: dict, b: float, us: set[str]) -> dict:
    logs = [math.log(v) for s, v in table["lam_eff"].items() if table["n_hist"].get(s, 0) > 0 and s in us and v > 0]
    m = float(np.mean(logs))
    f = lambda v: math.exp(m + b * (math.log(v) - m))
    out = dict(table)
    out["lam_eff"] = {s: f(v) for s, v in table["lam_eff"].items()}
    out["unseen"] = f(table["unseen"])
    out["label"] = f"{table['label']}, calibrated b={b:.3f}"
    out["calibration"] = {"b": b, "m": m, "n_sites_for_m": len(logs)}
    return out


def score_case(params, table_in, table_out, X, mv) -> dict:
    b_in = service.build(params, rates=table_in, movable=mv)
    res = {"in_sample": service.comparisons(service.rescore(b_in, X), mv)}
    if table_out is not None:
        b_out = service.build(params, rates=table_out, movable=mv)
        assert b_out.inst.site_ids == b_in.inst.site_ids and b_out.inst.trial_ids == b_in.inst.trial_ids
        res["held_out"] = service.comparisons(service.rescore(b_out, X), mv)
    return res


def run(con, bs: dict[str, float]) -> dict:
    t0 = time.monotonic()
    us = us_sites(con)
    alloc = load_alloc(ALLOC)
    full_table = R.fit_rate_table(con)
    tables = rate_tables(con)
    out = {"method": "see backend/concord/analysis/selection_calibrated.py docstring (post hoc)",
           "allocations": "data/robustness/holdout_alloc.npz", "b_values": bs, "results": {}}
    for label, b in bs.items():
        res_b = {}
        for name in SCENARIOS:
            params = scenario_params(name)
            full_key = f"{name}.full"
            fa = alloc[full_key]
            scen = {"full_data": score_case(params, calibrate(full_table, b, us), None, fa["x"], fa["movable"]),
                    "n_movable": int(fa["movable"].sum()), "splits": {}}
            for sp in SPLITS:
                dirs = []
                for c, s in DIRECTIONS:
                    a = alloc[f"{name}.{sp}.{c}->{s}"]
                    dirs.append(score_case(params, calibrate(tables[sp][c], b, us), calibrate(tables[sp][s], b, us),
                                           a["x"], a["movable"]))
                scen["splits"][sp] = {"summary": summarize(dirs)}
            res_b[name] = scen
            print(f"[{label}] {name} done ({time.monotonic() - t0:.0f}s)", flush=True)
        out["results"][label] = res_b
    return out


def check_reproduction(out: dict, label: str) -> dict:
    """b = 1 must reproduce the final holdout's ratios (same allocations, same rates)."""
    ref = json.loads(HOLDOUT.read_text(encoding="utf-8"))
    worst = 0.0
    for name, scen in out["results"][label].items():
        r = ref["scenarios"][name]
        for comp, blk in scen["full_data"]["in_sample"].items():
            worst = max(worst, abs(blk["ratio"] - r["full_data"]["in_sample"][comp]["ratio"]))
        for sp, v in scen["splits"].items():
            for comp, row in v["summary"].items():
                for side in ("in_sample", "held_out"):
                    a, bref = row[side]["ratio_geomean"], r["splits"][sp]["summary"][comp][side]["ratio_geomean"]
                    if a is not None and bref is not None:
                        worst = max(worst, abs(a - bref))
    return {"max_abs_ratio_difference": worst, "reproduces": worst < 1e-6}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    val = json.loads((FINDINGS_DIR / "selection_validation.json").read_text(encoding="utf-8"))
    bs = {"uncalibrated (b = 1, reproduction check)": 1.0,
          "industry Phase II/III slope (primary)": val["industry_phase2_3"]["slope"],
          "all-trials slope (sensitivity)": val["primary"]["slope"]}
    con = sqlite3.connect(DB_PATH)
    out = run(con, bs)
    con.close()
    out["reproduction_check"] = check_reproduction(out, "uncalibrated (b = 1, reproduction check)")
    out["validation_source"] = {"industry_phase2_3": val["industry_phase2_3"], "all_trials": val["primary"]}
    OUT.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print("reproduction check:", out["reproduction_check"])
    for label in bs:
        for name, scen in out["results"][label].items():
            fd = scen["full_data"]["in_sample"]
            alt = scen["splits"]["alternating"]["summary"]
            tim = scen["splits"]["time"]["summary"]
            for comp in ("indep_vs_actual", "coord_free_vs_indep"):
                print(f"{label[:28]:28s} {name[:14]:14s} {comp:20s} full {fd[comp]['ratio']:.3f} | alt held-out "
                      f"{alt[comp]['held_out']['ratio_geomean']:.3f} | time held-out {tim[comp]['held_out']['ratio_geomean']:.3f}")
    print("->", OUT)


if __name__ == "__main__":
    main()
