"""POST HOC diagnostics of the pre-registered two-way SEs in concord.analysis.congestion.

    python -m concord.analysis.congestion_se_diagnostics [--out data/robustness/congestion_v2_se_diagnostics.json]

NOT part of the pre-registered method. Written after the V2 results, because the two-way SEs of the
trial-level estimators (pooled, within) came out much wider than the trial-only ones, with 14-19
negative eigenvalues clipped. Nothing here changes a pre-registered number, the meta, the default beta
or the contract; it only explains where the width comes from. Read-only on the DB.

Per sample (full, S1p, S1, S2, S3) and overlap estimator (pooled, site_fe, within), for the coefficient
on the exposure:
  se_two_way            the pre-registered number (asserted equal to congestion.estimate)
  se_trial_only         CR1 by trial
  se_two_way_unclipped  same formula without clipping negative eigenvalues (None if the diagonal < 0)
  sd_v_trial, sd_v_site, sd_v_trial_site
                        sqrt of the [0, 0] entry of each CGM component (with its CR1 factor)
  eigenvalues           number negative, min, max of the unclipped V
  se_pairs_once         (trial-level only) meat = sum over pairs of trials that share >= 1 site, each
                        pair counted ONCE (diagonal included), trial CR1 factor, unclipped. The
                        pre-registered multi-membership site term counts a pair once per shared site;
                        under site shocks averaged over a trial's sites the covariance of two trials
                        is proportional to their shared-site count already, so the per-site count
                        over-weights pairs of big trials. This is the alternative a future
                        pre-registration could use; it is not used anywhere here.
  shared-site summary   share of trial pairs sharing >= 1 site, mean shared sites among them, mean
                        sites per trial.
  coding                (added after the audit) se_two_way and the unclipped se under the equivalent
                        codings of the controls in congestion.ALT_CODINGS. The clipped (pre-registered)
                        se moves with the coding; the coefficient and its unclipped variance do not
                        (asserted). So the clipped se is not "conservative" in any principled sense: part
                        of its width is arbitrary. congestion.run() reports the unclipped values beside
                        the pre-registered ones (AUDIT FIX 3 there).
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys

import numpy as np
from scipy import sparse

from concord.analysis import congestion as cg
from concord.paths import DB_PATH, ROOT


def _sd(v: float) -> float | None:
    return float(np.sqrt(v)) if v >= 0 else None


def _fit_diag(y, X, trial_ids, member_obs, member_site, w, x, n_rows: int, trial_site_rows: int) -> dict:
    r = cg._fit(y, X, trial_ids, member_obs, member_site, w, x, n_rows, trial_site_rows)
    w = np.ones(len(y)) if w is None else w
    sw = np.sqrt(w)
    Xw, yw = X * sw[:, None], y * sw
    B = np.linalg.pinv(Xw.T @ Xw)
    S = Xw * (yw - Xw @ (B @ Xw.T @ yw))[:, None]
    n, k = S.shape
    _, t_code = np.unique(np.asarray(trial_ids), return_inverse=True)
    _, s_code = np.unique(np.asarray(member_site), return_inverse=True)
    M_t, G_t = cg._cr1_meat(t_code, S, n, k)
    M_s, _ = cg._cr1_meat(s_code, S[member_obs], n, k)
    M_ts, _ = cg._cr1_meat(t_code[member_obs].astype(np.int64) * (int(s_code.max()) + 1) + s_code,
                           S[member_obs], n, k)
    Vt, Vs, Vts = (B @ M @ B for M in (M_t, M_s, M_ts))
    V = Vt + Vs - Vts
    ev = np.linalg.eigvalsh((V + V.T) / 2)
    d = {"se_two_way": r.get("se_twoway_clipped", r["se"]), "se_trial_only": r["se_trial_only"], "se_two_way_unclipped": _sd(V[0, 0]),
         "sd_v_trial": _sd(Vt[0, 0]), "sd_v_site": _sd(Vs[0, 0]), "sd_v_trial_site": _sd(Vts[0, 0]),
         "negative_eigenvalues": int((ev < 0).sum()), "min_eigenvalue": float(ev.min()),
         "max_eigenvalue": float(ev.max()), "coef": r["coef"], "trials": r["clusters"]}
    if G_t == n and len(member_obs) > n:  # trial level with multi-membership
        A = sparse.csr_matrix((np.ones(len(member_obs)), (member_obs, s_code)), shape=(n, int(s_code.max()) + 1))
        K = (A @ A.T).tocoo()
        off = K.row != K.col
        share = sparse.csr_matrix((np.ones(len(K.data)), (K.row, K.col)), shape=(n, n))
        adj = G_t / (G_t - 1) * (n - 1) / max(n - k, 1)
        Vp = B @ (adj * (S.T @ (share @ S))) @ B
        d.update(se_pairs_once=_sd(Vp[0, 0]),
                 share_pairs_sharing_a_site=float(off.sum() / (n * (n - 1))),
                 mean_shared_sites_among_sharing_pairs=float(K.data[off].mean()) if off.any() else 0.0,
                 mean_sites_per_trial=float(len(member_obs) / n))
    return {**r, "diag": d}


def run(con: sqlite3.Connection) -> dict:
    d = cg.load(con)
    trials = d["trials"]
    samples = {"full": [(r[0], r[1], r[cg.MEASURE_COL["overlap"]]) for r in d["rows"]]}
    srows, _ = cg.subset_rows(con, d)
    samples.update(srows)
    out = {}
    for name, rows in samples.items():
        res = cg.estimate(trials, rows, fit=_fit_diag)
        ref = cg.estimate(trials, rows)
        alt = {c: cg.estimate(trials, rows, design=des) for c, des in cg.ALT_CODINGS.items()}
        for est in ("pooled", "site_fe", "within"):
            assert abs(res[est]["diag"]["se_two_way"] - ref[est].get("se_twoway_clipped", ref[est]["se"])) < 1e-12, (name, est)
            coding = {"as_coded": {"se_two_way": res[est]["diag"]["se_two_way"],
                                   "se_two_way_unclipped": res[est]["diag"]["se_two_way_unclipped"],
                                   "negative_eigenvalues": res[est]["diag"]["negative_eigenvalues"]}}
            for c, a in alt.items():
                e = a[est]
                assert abs(e["coef"] - ref[est]["coef"]) < 1e-9, (name, est, c)
                v0 = ref[est]["var_twoway_unclipped"]
                assert abs(e["var_twoway_unclipped"] - v0) <= 1e-9 * abs(v0), (name, est, c)
                coding[c] = {"se_two_way": e.get("se_twoway_clipped", e["se"]), "se_two_way_unclipped": e["se_twoway_unclipped"],
                             "negative_eigenvalues": e["negative_eigenvalues_clipped"]}
            res[est]["diag"]["coding"] = coding
        out[name] = {est: res[est]["diag"] for est in ("pooled", "site_fe", "within")}
    return {"note": "post hoc; not part of the pre-registered method; no pre-registered number depends on it",
            "measure": "overlap", "samples": out}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "data" / "robustness" / "congestion_v2_se_diagnostics.json"))
    a = ap.parse_args()
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    res = run(con)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(res, fh, indent=2)
    f = lambda v: "   -  " if v is None else f"{v:.4f}"  # noqa: E731
    print("sample est      coef     se2way  unclip  pairs1  trial  | sd Vt   Vs      Vts    | neg  min_eig  max_eig")
    for name, ests in res["samples"].items():
        for est, c in ests.items():
            print(f"{name:6s} {est:8s} {c['coef']:+.4f}  {f(c['se_two_way'])}  {f(c['se_two_way_unclipped'])}  "
                  f"{f(c.get('se_pairs_once'))}  {f(c['se_trial_only'])} | {f(c['sd_v_trial'])}  {f(c['sd_v_site'])}  "
                  f"{f(c['sd_v_trial_site'])} | {c['negative_eigenvalues']:3d}  {c['min_eigenvalue']:+.2e}  "
                  f"{c['max_eigenvalue']:+.2e}  shared={c.get('mean_shared_sites_among_sharing_pairs')}")
    print("coding: se_two_way as coded / " + " / ".join(cg.ALT_CODINGS) + "  (unclipped)")
    for name, ests in res["samples"].items():
        for est, c in ests.items():
            cs = c["coding"]
            print(f"{name:6s} {est:8s} " + "  ".join(f(v["se_two_way"]) for v in cs.values())
                  + f"  ({f(cs['as_coded']['se_two_way_unclipped'])})")
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
