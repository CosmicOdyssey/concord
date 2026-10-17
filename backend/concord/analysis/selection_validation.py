"""Observed-outcome check of the site-rate scores (no solver, no allocation).

    python -m concord.analysis.selection_validation

For completed lung trials that started in 2018 or later, score each trial's REGISTERED site list with site
rates fit only on trials that started before 2018 (recruitment.fit_rate_table, same estimator as the app),
then regress the trial's actual log enrollment rate on that score.

    y_t     = log( N_t / (tau_t * |S_t|) )            actual per-site-month enrollment rate
    score_t = log( mean_{s in S_t} lam_s )             predicted per-site rate from pre-2018 trials
    y_t ~ score_t + phase dummies + log |S_t| + start-year fixed effects, HC1 robust SEs

A slope near 1 means the registry-based site rates are calibrated on observed outcomes; a slope near 0 means
they carry no signal about how the site lists sponsors actually chose went on to enroll. This checks the
rate scores against observed enrollment; it does not test whether choosing different sites would have been
faster. Sites unseen before 2018 get the estimator's unseen rate. Read-only: writes only the output JSON.
"""

from __future__ import annotations

import json
import sqlite3
import sys

import numpy as np
from scipy.stats import norm

from concord.model.recruitment import fit_rate_table, load_history
from concord.paths import DB_PATH, FINDINGS_DIR

CUTOFF = "2018-01-01"


def _ols_hc1(y, X):
    XtX_inv = np.linalg.pinv(X.T @ X)
    b = XtX_inv @ X.T @ y
    u = y - X @ b
    n, k = X.shape
    meat = (X * u[:, None]).T @ (X * u[:, None])
    V = XtX_inv @ meat @ XtX_inv * n / max(n - k, 1)
    return b, np.sqrt(np.clip(np.diag(V), 0, None))


def run(con) -> dict:
    hist = load_history(con)
    start = dict(zip(hist.trial_ids, hist.start))
    rates = fit_rate_table(con, keep=lambda t: start.get(t, "9999") < CUTOFF, label=f"trials started before {CUTOFF}")
    meta = {n: (json.loads(ph or "[]"), cls) for n, ph, cls in con.execute("SELECT nct_id, phases, sponsor_class FROM trials")}

    sites_of: dict[int, list[str]] = {}
    for ti, si, _ in hist.links:
        sites_of.setdefault(ti, []).append(hist.site_ids[si])

    rows = []
    for i, nct in enumerate(hist.trial_ids):
        if hist.start[i] < CUTOFF or i not in sites_of:
            continue
        ss = sites_of[i]
        lam = np.array([rates["lam_eff"].get(s, rates["unseen"]) if rates["n_hist"].get(s, 0) > 0 else rates["unseen"]
                        for s in ss])
        seen = np.mean([rates["n_hist"].get(s, 0) > 0 for s in ss])
        y = np.log(hist.N[i] / (hist.tau[i] * len(ss)))
        phases, cls = meta.get(nct, ([], None))
        rows.append(dict(nct=nct, y=y, score=float(np.log(lam.mean())), n_sites=len(ss), year=int(hist.start[i][:4]),
                         phases=phases, industry=cls == "INDUSTRY", seen=float(seen)))

    def fit(sub, label):
        if len(sub) < 30:
            return {"label": label, "n": len(sub), "note": "too few trials"}
        years = sorted({r["year"] for r in sub})
        cols = [[r["score"] for r in sub], [1.0] * len(sub)]
        cols += [[float(ph in r["phases"]) for r in sub] for ph in ("PHASE1", "PHASE3", "PHASE4")]
        cols += [[np.log(r["n_sites"]) for r in sub]]
        cols += [[float(r["year"] == y) for r in sub] for y in years[1:]]
        X = np.array(cols).T
        y = np.array([r["y"] for r in sub])
        b, se = _ols_hc1(y, X)
        z = b[0] / se[0] if se[0] > 0 else 0.0
        return {"label": label, "n": len(sub), "slope": float(b[0]), "se": float(se[0]),
                "ci95": [float(b[0] - 1.96 * se[0]), float(b[0] + 1.96 * se[0])], "p": float(2 * norm.sf(abs(z))),
                "median_share_of_sites_seen_before_cutoff": float(np.median([r["seen"] for r in sub]))}

    ind23 = [r for r in rows if r["industry"] and ({"PHASE2", "PHASE3"} & set(r["phases"]))]
    return {
        "method": "see backend/concord/analysis/selection_validation.py docstring",
        "cutoff": CUTOFF, "rates": {"label": rates["label"], "n_trials": rates["n_trials"]},
        "outcome": "log(actual enrollment / (enrollment window months x registered sites)), completed trials",
        "score": "log mean pre-cutoff site rate over the trial's registered sites (unseen sites get the unseen rate)",
        "controls": "phase dummies, log registered sites, start-year fixed effects; HC1 robust SEs",
        "primary": fit(rows, "all completed lung trials started 2018 or later"),
        "industry_phase2_3": fit(ind23, "industry Phase II/III subset"),
        "interpretation": "Slope near 1: registry-based site rates are calibrated on observed enrollment. Near 0: no "
                          "signal. Observational check of the scores, not a test of choosing different sites.",
    }


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    con = sqlite3.connect(DB_PATH)
    out = run(con)
    con.close()
    path = FINDINGS_DIR / "selection_validation.json"
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    for k in ("primary", "industry_phase2_3"):
        r = out[k]
        if "slope" in r:
            print(f"{r['label']}: slope {r['slope']:.3f} [{r['ci95'][0]:.3f}, {r['ci95'][1]:.3f}], p {r['p']:.3g}, n {r['n']}")
    print("->", path)


if __name__ == "__main__":
    main()
