"""Export the data behind the research and pricing figures (run with the backend venv).

    backend/.venv/Scripts/python scripts/figures/export_figure_data.py

Reads the committed analysis outputs and the backend modules directly (no running server needed) and writes
data/work/figures/figure_data.json for scripts/figures/make_figures.py.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from concord import paths, site_scores, terms, terms_spread  # noqa: E402
from concord.analysis import selection_validation as SV  # noqa: E402

OUT = ROOT / "data" / "work" / "figures" / "figure_data.json"


def load(p: str) -> dict:
    return json.loads((ROOT / p).read_text(encoding="utf-8"))


def holdout() -> dict:
    h = load("data/robustness/holdout.json")["scenarios"]["US-Northeast"]
    cal = load("data/findings/selection_calibrated.json")
    out = {}
    for comp, name in (("coord_free_vs_indep", "Coordination\n(joint optimum vs best response)"),
                       ("indep_vs_actual", "Site selection\n(best response vs registered sites)")):
        out[name] = {"in_sample": h["full_data"]["in_sample"][comp]["ratio"],
                     "held_out_alternating": h["splits"]["alternating"]["summary"][comp]["held_out"]["ratio_geomean"],
                     "held_out_time": h["splits"]["time"]["summary"][comp]["held_out"]["ratio_geomean"]}
    for label, res in cal["results"].items():
        b = cal["b_values"][label]
        if abs(b - 1.0) < 1e-9:
            continue
        ne = res["US-Northeast"]
        comp = "indep_vs_actual"
        out[f"Site selection, scores calibrated\nto observed enrollment (b = {b:.2f})"] = {
            "in_sample": ne["full_data"]["in_sample"][comp]["ratio"],
            "held_out_alternating": ne["splits"]["alternating"]["summary"][comp]["held_out"]["ratio_geomean"],
            "held_out_time": ne["splits"]["time"]["summary"][comp]["held_out"]["ratio_geomean"]}
    return out


def congestion() -> dict:
    c = load("data/robustness/congestion_v2.json")
    rows = []

    def add(label, r, group):
        lo, hi = r["ci95"]  # the published interval (two-way clustered, as on the Findings page)
        rows.append({"label": label, "group": group, "elasticity": -r["coef"], "lo": -hi, "hi": -lo, "p": r.get("p")})

    add("Within the same site (default)", c["results"]["within_overlap"], "main")
    add("Site fixed effects", c["results"]["site_fe_overlap"], "main")
    add("Pooled across sites (confounded)", c["results"]["pooled_overlap"], "main")
    for k, s in c["subsets"].items():
        add(s["label"], s["within"], "subset")
    for p in c["parser_sensitivity"]:
        add(f"Eligibility parser {p['parser_version']}", p["within_overlap"], "parser")
    return {"rows": rows, "assumed": -c["model_implied_coef_overlap"], "n_trial_sites": c["n_trial_sites"]}


def validation() -> dict:
    con = sqlite3.connect(paths.DB_PATH)
    hist = SV.load_history(con)
    start = dict(zip(hist.trial_ids, hist.start))
    rates = SV.fit_rate_table(con, keep=lambda t: start.get(t, "9999") < SV.CUTOFF, label="pre-cutoff")
    meta = {n: (json.loads(ph or "[]"), cls) for n, ph, cls in con.execute("SELECT nct_id, phases, sponsor_class FROM trials")}
    con.close()
    sites_of: dict[int, list[str]] = {}
    for ti, si, _ in hist.links:
        sites_of.setdefault(ti, []).append(hist.site_ids[si])
    rows = []
    for i, nct in enumerate(hist.trial_ids):
        if hist.start[i] < SV.CUTOFF or i not in sites_of:
            continue
        ss = sites_of[i]
        lam = np.array([rates["lam_eff"].get(s, rates["unseen"]) if rates["n_hist"].get(s, 0) > 0 else rates["unseen"]
                        for s in ss])
        phases, cls = meta.get(nct, ([], None))
        rows.append(dict(y=float(np.log(hist.N[i] / (hist.tau[i] * len(ss)))), score=float(np.log(lam.mean())),
                         n_sites=len(ss), year=int(hist.start[i][:4]), phases=phases, industry=cls == "INDUSTRY"))

    def partial(sub):
        # Frisch-Waugh-Lovell: residualize outcome and score on the controls; the slope of one on the other is the
        # published coefficient on the score.
        years = sorted({r["year"] for r in sub})
        C = [[1.0] * len(sub)]
        C += [[float(ph in r["phases"]) for r in sub] for ph in ("PHASE1", "PHASE3", "PHASE4")]
        C += [[float(np.log(r["n_sites"])) for r in sub]]
        C += [[float(r["year"] == y) for r in sub] for y in years[1:]]
        C = np.array(C).T
        y = np.array([r["y"] for r in sub])
        x = np.array([r["score"] for r in sub])
        res = lambda v: v - C @ np.linalg.lstsq(C, v, rcond=None)[0]
        ry, rx = res(y), res(x)
        slope = float((rx @ ry) / (rx @ rx))
        return {"x": rx.round(4).tolist(), "y": ry.round(4).tolist(), "slope": slope, "n": len(sub)}

    ind23 = [r for r in rows if r["industry"] and ({"PHASE2", "PHASE3"} & set(r["phases"]))]
    v = load("data/findings/selection_validation.json")
    return {"all": {**partial(rows), "ci95": v["primary"]["ci95"], "published": v["primary"]["slope"]},
            "industry": {**partial(ind23), "ci95": v["industry_phase2_3"]["ci95"], "published": v["industry_phase2_3"]["slope"]}}


def scores() -> dict:
    s = site_scores.summary()
    return {"histogram": s["histogram"], "buckets": s["buckets"], "prior": s["prior"], "us": s["us"],
            "heterogeneity": s.get("heterogeneity"), "validation": s.get("validation")}


def pricing() -> dict:
    nct = "NCT05800015"
    a, b = terms.sites(nct)["default_pair"]
    dist = terms_spread.locality_distribution(nct, a, b, None)
    cmp_ = terms.compare(nct, a, b)
    anchored = []
    for t in terms.trials():
        n = t["nct_id"]
        try:
            site = terms.sites(n)["default_pair"][0]
            bud = terms.budget(n, site)
        except Exception as e:  # noqa: BLE001
            print("skip", n, e)
            continue
        sh = {x["id"]: x for x in bud["anchoring"]["shares"]}
        anchored.append({"nct": n, "title": t.get("short_title") or n, "added": bool(t.get("import")),
                         "total": bud["totals"]["per_participant"],
                         "public": sh["public"]["amount"], "standard": sh["standard"]["amount"], "open": sh["open"]["amount"]})
    return {"distribution": dist, "compare_summary": cmp_["summary"],
            "compare_sites": {"a": cmp_["a"]["site"]["label"], "b": cmp_["b"]["site"]["label"],
                              "a_loc": cmp_["a"].get("locality"), "b_loc": cmp_["b"].get("locality")},
            "compare_totals": {"a": cmp_["a"]["totals"]["per_participant"], "b": cmp_["b"]["totals"]["per_participant"]},
            "anchored": anchored}


def main() -> None:
    data = {"holdout": holdout(), "congestion": congestion(), "validation": validation(), "scores": scores(),
            "pricing": pricing()}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1, default=str), encoding="utf-8")
    print("->", OUT)


if __name__ == "__main__":
    main()
