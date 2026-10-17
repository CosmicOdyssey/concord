"""Build frontend/src/fixtures/congestion_v2.sample.json: the live /api/congestion-test response
plus the fields of the congestion_test v2 contract filled with PLACEHOLDER numbers, for the
dev-only rendering check in item4.js. Usage: python item4_fixture.py <out.json>"""
import json
import sys
import urllib.request

out = sys.argv[1]
live = json.load(urllib.request.urlopen("http://localhost:8000/api/congestion-test", timeout=30))

W = 1.18  # placeholder: two-way CIs a bit wider than trial-only
d = {
    "_fixture": "FIXTURE for frontend rendering checks only (docs/qa/browser-qa/item4.js). The keys follow the "
                "congestion_test v2 contract; se_method/two-way/subset/parser/default_beta numbers are PLACEHOLDERS, "
                "not results. Never serve or cite them.",
}
d.update({k: live[k] for k in ("n_trials", "n_trial_sites", "primary", "model_implied_coef_overlap")})
d["task"] = "congestion v2 contract sample (fixture)"
d["verdict"] = "FIXTURE: placeholder numbers"
d["se_method"] = "two-way clustered (trial, site)"
res = {}
for k, r in live["results"].items():
    se2 = r["se"] * W
    res[k] = {**r,
              "se": se2, "ci95": [r["coef"] - 1.96 * se2, r["coef"] + 1.96 * se2], "p": min(1.0, r["p"] * 1.4),
              "se_trial_only": r["se"], "ci95_trial_only": r["ci95"], "p_trial_only": r["p"]}
d["results"] = res
wo = res["within_overlap"]


def fit(coef, se, p, clusters, n_rows):
    return {"coef": coef, "se": se, "ci95": [round(coef - 1.96 * se, 4), round(coef + 1.96 * se, 4)], "p": p,
            "clusters": clusters, "n_rows": n_rows}


d["subsets"] = {
    "S1_experienced_sites": {
        "label": "S1 experienced sites [fixture]",
        "definition": "Sites with >= 10 lung trials started before the focal trial (placeholder numbers)",
        "within": fit(-0.121, 0.060, 0.044, 1650, 1650),
        "site_fe": fit(-0.031, 0.048, 0.52, 1650, 30110),
        "pooled": fit(-0.142, 0.031, 0.0001, 2100, 2100),
        "is_default": False,
    },
    "S2_small_trials": {
        "label": "S2 trials with <= 20 sites [fixture]",
        "definition": "Trials with at most 20 registered sites (placeholder numbers)",
        "within": fit(-0.041, 0.081, 0.61, 1890, 1890),
        "site_fe": fit(0.012, 0.055, 0.83, 1890, 9800),
        "pooled": fit(-0.090, 0.033, 0.006, 2400, 2400),
        "is_default": False,
    },
    "S3_high_overlap": {
        "label": "S3 overlap >= 0.8 [fixture]",
        "definition": "Exposure counts only competitor pairs with eligibility overlap >= 0.8 (placeholder numbers)",
        "within": fit(-0.075, 0.070, 0.28, 2730, 2730),
        "site_fe": fit(0.008, 0.044, 0.86, 2730, 52873),
        "pooled": fit(-0.101, 0.029, 0.0005, 3003, 3003),
        "is_default": False,
    },
}
k = len(d["subsets"])
z = 2.394  # two-sided normal quantile for alpha 0.05 / 3
d["multiple_comparisons"] = {
    "method": "Bonferroni", "k": k, "alpha": 0.05,
    "note": "fixture placeholder: with three subsets, a subset is significant only if its Bonferroni interval excludes zero",
    "bonferroni_ci95": {key: [round(s["within"]["coef"] - z * s["within"]["se"], 4),
                              round(s["within"]["coef"] + z * s["within"]["se"], 4)] for key, s in d["subsets"].items()},
}
d["parser_sensitivity"] = [
    {"parser_version": "v1", "commit": "b8c576f",
     "description": "[fixture] Key Exclusion Criteria headers not recognized",
     "within_overlap": {"coef": -0.136, "ci95": [-0.271, -0.001], "p": 0.048, "clusters": 2730}, "empty_masks": 12},
    {"parser_version": "v2", "commit": "c0050f4",
     "description": "[fixture] headers fixed; contradictory criteria left 646 empty eligibility masks",
     "within_overlap": {"coef": -0.027, "ci95": [-0.148, 0.094], "p": 0.66, "clusters": 2730}, "empty_masks": 646},
    {"parser_version": "v3", "commit": "4a87d33",
     "description": "[fixture] contradictory compiled criteria removed (current parser)",
     "within_overlap": {"coef": wo["coef"], "ci95": wo["ci95"], "p": wo["p"], "clusters": wo["clusters"]},
     "empty_masks": 3},
]
d["default_beta"] = {"value": -wo["coef"], "source": "full-sample within_overlap",
                     "ci95": [-wo["ci95"][1], -wo["ci95"][0]],
                     "note": "subset estimates are reported separately and are not used as the default"}

with open(out, "w", encoding="utf-8", newline="\n") as f:
    json.dump(d, f, indent=1)
    f.write("\n")
print("wrote", out)
