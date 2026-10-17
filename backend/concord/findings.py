"""Assemble the findings page content (data/findings/findings.json).

    python -m concord.findings

The findings page renders this file and nothing else, so every claim it makes is written here,
next to the number it rests on. Sources, in order of preference:
  congestion   DB meta "congestion_test" (live), plus its parser-version / subset fields when present,
               else the recorded runs listed in RECORDED_PARSER_RUNS
  allocation   data/findings/sources/holdout_final.json (final rerun of task A's script at the current
               beta), else data/findings/sources/holdout_taskA_provisional.json (task A on earlier inputs)
  implication  DB meta "backtest" and site history counts

Rule for the whole app: no view shows a predicted speedup, time-to-fill or ratio as a product claim.
The ratios here are research results, labelled with how they were measured.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

from concord.paths import DB_PATH, FINDINGS_DIR

SOURCES = FINDINGS_DIR / "sources"
OUT = FINDINGS_DIR / "findings.json"

# Earlier runs of the same pre-registered congestion regression, recorded in the README (section 1).
# Trial-clustered SEs. Used only until the re-estimate with parser-version sensitivity is merged.
RECORDED_PARSER_RUNS = [
    {"parser_version": "v0", "commit": "b8c576f",
     "description": "'Key Exclusion Criteria' headers not recognized (exclusions read as requirements)",
     "coef": -0.136, "ci95": [-0.2595, -0.0125], "p": 0.031},
    {"parser_version": "v1", "commit": "c0050f4",
     "description": "headers fixed; 646 trials with contradictory criteria (empty eligibility)",
     "coef": -0.0265, "ci95": [-0.1206, 0.0676], "p": 0.58},
    {"parser_version": "v2", "commit": "4a87d33", "description": "contradictions fixed (3 empty trials left)",
     "coef": -0.0871, "ci95": [-0.2077, 0.0335], "p": 0.157},
]

COMPARISONS = [
    ("indep_vs_actual", "Site selection alone", "each trial's best response vs its registered sites"),
    ("coord_free_vs_indep", "Coordination", "joint optimum vs each trial's best response (losers allowed)"),
    ("coord_vs_actual", "Coordination capped at registered times", "vs registered sites"),
    ("coordination_no_loser_vs_indep", "Coordination capped at best-response times", "vs each trial's best response"),
]


def _meta(con, key):
    row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else None


def _x(v, d=2):
    return "—" if v is None else f"{v:.{d}f}x"


def _ci(lo, hi, d=3):
    return f"[{lo:+.{d}f}, {hi:+.{d}f}]"


def congestion(con) -> dict:
    test = _meta(con, "congestion_test") or {}
    w = test.get("results", {}).get("within_overlap")
    if not w:
        return {"id": "congestion", "title": "Congestion", "status": "missing", "headline": "Not computed.",
                "tables": [], "caveats": [], "sources": []}
    beta, lo, hi = -w["coef"], max(0.0, -w["ci95"][1]), max(0.0, -w["ci95"][0])
    se_method = test.get("se_method", "clustered by trial")
    rows = [["Assumed in the original model", "-1", "", "", "beta = 1.0"],
            ["Within site, all sites (default)", f"{w['coef']:+.3f}", _ci(*w["ci95"]), f"{w['p']:.2f}",
             f"beta = {beta:.3f} (95% CI {lo:.3f} to {hi:.3f})"]]
    p = test.get("results", {}).get("pooled_overlap")
    if p:
        rows.append(["Pooled across sites (confounded by site type)", f"{p['coef']:+.3f}", _ci(*p["ci95"]),
                     f"{p['p']:.3g}", ""])
    subsets = test.get("subsets") or {}
    sub_rows = []
    for key, s in subsets.items():
        sw = s.get("within") or {}
        if "coef" in sw:
            sub_rows.append([s.get("label", key), f"{sw['coef']:+.3f}", _ci(*sw["ci95"]), f"{sw['p']:.2f}",
                             "subset, not the default"])
    parser_rows, parser_source = [], ""
    ps = test.get("parser_sensitivity")
    if ps:
        parser_source = "re-estimated per parser version, same regression"
        for v in ps:
            wo = v.get("within_overlap", {})
            ci = _ci(*wo["ci95"]) if "ci95" in wo else ""
            if wo.get("twoway_estimable") is False:  # two-way variance negative before clipping
                ci += " (trial-clustered)"
            parser_rows.append([f"{v.get('parser_version')} ({v.get('commit')})", v.get("description", ""),
                                f"{wo.get('coef', float('nan')):+.3f}", ci, str(v.get("empty_masks", ""))])
        parser_notes = [f"{v['parser_version']}: {v['ci_note']}." for v in ps if v.get("ci_note")]
    else:
        parser_source = "recorded runs of the same regression (README section 1); trial-clustered SEs"
        parser_notes = []
        for v in RECORDED_PARSER_RUNS:
            parser_rows.append([f"{v['parser_version']} ({v['commit']})", v["description"], f"{v['coef']:+.3f}",
                                _ci(*v["ci95"]), ""])
        parser_rows.append(["current (with hand-encoded demo trials)", "v2 parser plus hand-encoded eligibility",
                            f"{w['coef']:+.3f}", _ci(*w["ci95"]), ""])
    tables = [{"id": "estimates", "title": "Coefficient on log(1 + overlapping competitors at the site)",
               "columns": ["Estimate", "Coefficient", "95% CI", "p", "Implied beta"], "rows": rows,
               "highlight_row": 1,
               "notes": [f"Standard errors: {se_method}."] + ([test["se_note"]] if test.get("se_note") else [])}]
    if sub_rows:
        mc = test.get("multiple_comparisons", {}).get("note", "")
        tables.append({"id": "subsets", "title": "Subset estimates (not the default)",
                       "columns": ["Subset", "Coefficient", "95% CI", "p", ""], "rows": sub_rows,
                       "notes": [mc] if mc else []})
    tables.append({"id": "parser", "title": "Beta under each eligibility-parser version",
                   "columns": ["Parser", "What changed", "Coefficient", "95% CI", "Empty eligibility"],
                   "rows": parser_rows, "notes": [parser_source] + parser_notes})
    pooled_caveat = "Across sites, busier sites are slower per trial, but that is confounded with site type."
    if p and p["ci95"][0] <= 0 <= p["ci95"][1]:
        pooled_caveat = (f"Across sites, busier sites are slower per trial (pooled {p['coef']:+.3f}), but with "
                         f"{se_method} SEs its 95% CI includes 0 (p {p['p']:.2f}), and the comparison is "
                         "confounded with site type.")
    return {
        "id": "congestion",
        "title": "Competing trials barely slow each other within a site",
        "status": "final" if ps else "provisional",
        "headline": (f"Within the same site, the congestion elasticity is about {beta:.2f} (95% CI {lo:.2f} to "
                     f"{hi:.2f}), against the 1.0 our original model assumed."),
        "chart": {"type": "ci", "reference": {"label": "assumed in original model", "value": 1.0},
                  "items": [{"label": "within-site beta (default)", "estimate": beta, "lo": lo, "hi": hi}]},
        "tables": tables,
        "caveats": [
            "Measured at the resolution of public registry data: trial-level enrollment, registered site lists.",
            "The estimate moved with each fix to the eligibility parser; the parser table shows by how much.",
            pooled_caveat,
            "Subset estimates (for example sites with many earlier lung trials) are reported separately and are "
            "never used as the default.",
        ],
        "sources": [{"label": "analysis/congestion.py (DB meta congestion_test)", "path": "backend/concord/analysis/congestion.py"},
                    {"label": "subset checks", "path": "data/robustness/congestion_subsets_maskfix.json"},
                    {"label": "two-way SEs, subsets, parser versions", "path": "data/robustness/congestion_v2.json"}],
    }


def _allocation_source():
    for name, status, label in (
            ("holdout_final.json", "final", "Final rerun of task A's pre-registered script at the current beta"),
            ("holdout_taskA_provisional.json", "provisional",
             "Task A on earlier inputs (beta 0.026, before hand-encoded eligibility); final rerun pending")):
        p = SOURCES / name
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8")), status, label, f"data/findings/sources/{name}"
    return None, "missing", "", ""


def allocation() -> dict:
    d, status, label, path = _allocation_source()
    if d is None:
        return {"id": "allocation", "title": "Allocation", "status": "missing", "headline": "Not computed.",
                "tables": [], "caveats": [], "sources": []}
    tables, survive = [], {}
    for scen_key, scen in d["scenarios"].items():
        rows = []
        for key, name, detail in COMPARISONS:
            full = scen["full_data"]["in_sample"].get(key, {}).get("ratio")
            cells = [f"{name} ({detail})", _x(full)]
            for split in ("alternating", "time"):
                sm = scen["splits"][split]["summary"].get(key, {})
                ins, ho = sm.get("in_sample", {}), sm.get("held_out", {})
                dirs = ho.get("ratio_by_direction") or []
                cells += [_x(ins.get("ratio_geomean")),
                          _x(ho.get("ratio_geomean")) + (f" ({' / '.join(_x(x) for x in dirs)})" if dirs else "")]
                if split == "time":
                    cells.append("—" if ho.get("share_slower_mean") is None else f"{ho['share_slower_mean']:.0%}")
                    survive.setdefault(key, {})[scen_key] = ho.get("ratio_geomean")
            rows.append(cells)
        n = scen["full_data"].get("n_movable")
        tables.append({"id": f"allocation-{scen_key}", "title": f"{scen_key.replace('_', ' ')} ({n} trials)",
                       "columns": ["Comparison", "In-sample (all history)", "Alternating split: in-sample",
                                   "Alternating split: held-out (by direction)", "Time split: in-sample",
                                   "Time split: held-out (by direction)", "Time split: share slower held-out"],
                       "rows": rows, "notes": ["Ratio = total trial-months, baseline / alternative, under the model."]})
    ne = survive.get("coord_free_vs_indep", {}).get("US-Northeast")
    sel = survive.get("indep_vs_actual", {}).get("US-Northeast")
    headline = (f"Coordination gains don't survive a time split: choosing with older trials and scoring with newer ones, "
                f"the joint optimum is {_x(ne)} each trial's best response in US-Northeast. Site selection alone "
                f"(each trial's best response vs its registered sites) is {_x(sel)} on the same split, scored by the "
                f"same model rather than by observed enrollment.")
    return {
        "id": "allocation",
        "title": "Allocation gains from coordination don't survive a time split",
        "status": status,
        "headline": headline,
        "tables": tables,
        "caveats": [
            label + ".",
            "Held-out means: allocations chosen with site rates fit on one half of history, scored with rates fit on "
            "the other half. Scores still come from our enrollment model, not observed enrollment.",
            "Ratios above are research results. No product view in this app shows a predicted speedup.",
        ],
        "sources": [{"label": "task A holdout output", "path": path},
                    {"label": "task A script", "path": "backend/concord/analysis/selection_holdout.py"}],
    }


def implication(con) -> dict:
    bt = _meta(con, "backtest") or {}
    m = bt.get("by_model", {}).get("model", {}).get("industry_p23", {})
    nv = bt.get("by_model", {}).get("naive", {}).get("industry_p23", {})
    n_sites = con.execute("SELECT COUNT(*) FROM site_model sm JOIN sites s USING(site_id) "
                          "WHERE s.country='United States' AND s.anonymized=0 AND sm.n_hist>0").fetchone()[0]
    few = con.execute("SELECT COUNT(*) FROM site_model sm JOIN sites s USING(site_id) "
                      "WHERE s.country='United States' AND s.anonymized=0 AND sm.n_hist>0 AND sm.n_hist<3").fetchone()[0]
    rows = []
    if m and nv:
        rows.append(["Typical miss predicting a held-out trial's enrollment time (industry Phase II/III)",
                     f"{2.718281828 ** m['median_abs_log_error']:.1f}x (site model)",
                     f"{2.718281828 ** nv['median_abs_log_error']:.1f}x (naive median rate)"])
    rows.append(["U.S. sites with fewer than 3 lung trials of history", f"{few:,} of {n_sites:,}", f"{few / n_sites:.0%}"])
    rows.append(["Site-level enrollment counts in the public registry", "0", "registry reports enrollment per trial only"])
    return {
        "id": "implication",
        "title": "Site-level enrollment data is the binding constraint",
        "status": "final",
        "headline": ("Optimizing site selection needs site-level enrollment data, which is private today. Public "
                     "registry data identifies site performance only weakly."),
        "tables": [{"id": "data-limits", "title": "What public data supports",
                    "columns": ["Measure", "Value", "Context"], "rows": rows, "notes": []}],
        "caveats": ["Typical miss = exp(median absolute log error) on held-out trials (fit before 2018, predict after)."],
        "sources": [{"label": "model/recruitment.py backtest (DB meta backtest)", "path": "backend/concord/model/recruitment.py"}],
    }


def build() -> dict:
    con = sqlite3.connect(DB_PATH)
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rule": "No view shows a predicted speedup, time-to-fill or ratio as a product claim. Numbers on this page "
                "are research findings, labelled with how they were measured.",
        "findings": [congestion(con), allocation(), implication(con)],
    }
    con.close()
    return out


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = build()
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    for f in data["findings"]:
        print(f"[{f['status']}] {f['title']}: {f['headline']}")


if __name__ == "__main__":
    main()
