"""Site scores (concord.site_scores, concord.api.site_scores). The tests that read the real database are skipped
without it (the point is that the breakdown reproduces the app's stored scores exactly); the simulation tests of
the interval's heterogeneity estimator need no database."""
import json
import math
import sqlite3

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from scipy.stats import gamma as gamma_dist

from concord import paths
from concord import site_scores as S
from concord.api import site_scores as api
from concord.model import recruitment as R
from concord.paths import DB_PATH

needs_db = pytest.mark.skipif(not DB_PATH.exists(), reason="data/concord.db not built")


@pytest.fixture(scope="module")
def con():
    if not DB_PATH.exists():
        pytest.skip("data/concord.db not built")
    c = sqlite3.connect(DB_PATH)
    yield c
    c.close()


@pytest.fixture(scope="module")
def st():
    if not DB_PATH.exists():
        pytest.skip("data/concord.db not built")
    return S._state()


@pytest.fixture(scope="module")
def client():
    if not DB_PATH.exists():
        pytest.skip("data/concord.db not built")
    app = FastAPI()
    app.include_router(api.router)
    return TestClient(app)


def test_fit_replica_equals_recruitment_fit(con, st):
    ref = R.fit(R.load_history(con))
    f = st.fit
    assert ref.site_ids == f.hist.site_ids
    assert ref.alpha == f.alpha and ref.beta == f.beta
    assert np.array_equal(ref.shape, f.shape)
    assert np.array_equal(ref.rate, f.rate)


def test_score_equals_site_model_lam_eff_for_every_site(con, st):
    stored = dict(con.execute("SELECT site_id, lam_eff FROM site_model"))
    f = st.fit
    ours = dict(zip(f.hist.site_ids, f.lam_eff.tolist()))
    assert set(ours) <= set(stored)
    worst = max(abs(ours[s] - stored[s]) for s in ours)
    assert worst <= 1e-12
    # Sites with no fitted trial get the unseen-site rate, which is the low-history cap.
    unseen = [v for s, v in stored.items() if s not in ours]
    assert unseen and all(abs(v - f.floor) <= 1e-12 for v in unseen)
    assert st.stored_max_diff <= 1e-12 and st.stored_compared == len(ours)


def test_final_estep_allocations_conserve_enrollment(st):
    f = st.fit
    per_trial = np.bincount(f.ti, weights=f.n_hat, minlength=len(f.hist.N))
    assert np.allclose(per_trial, f.hist.N, rtol=1e-9)
    assert np.allclose(f.alpha + f.sum_n, f.shape, rtol=1e-12)
    assert np.allclose(f.beta + f.sum_e, f.rate, rtol=1e-12)
    assert f.iters_run == S.FIT_ITERS


def _first(st, pred):
    return next(st.fit.hist.site_ids[i] for i in st.us_idx if pred(int(i)))


def test_breakdown_steps_add_up(st):
    f = st.fit
    sid = max((f.hist.site_ids[i] for i in st.us_idx), key=lambda s: f.n_fit[st.s_index[s]])
    d = S.site_detail(sid)
    p, data, post = d["prior"], d["data"], d["posterior"]
    w = data["data_weight"]
    assert math.isclose(post["mean"], w * data["data_rate"] + (1 - w) * p["mean"], rel_tol=1e-12)
    assert math.isclose(post["shape"], p["alpha"] + data["sum_n_hat"], rel_tol=1e-12)
    assert math.isclose(post["rate"], p["beta"] + data["sum_exposure"], rel_tol=1e-12)
    assert post["p10"] < post["mean"] < post["p90"]
    assert d["score"] == post["mean"] and not d["cap"]["applied"]
    h = d["history"]
    assert len(d["trials"]) == h["n_fit"]
    assert h["n_fit"] + h["n_not_fit"] == h["n_hist"]
    assert math.isclose(sum(t["n_hat"] for t in d["trials"]), data["sum_n_hat"], rel_tol=1e-9)
    assert math.isclose(sum(t["exposure"] for t in d["trials"]), data["sum_exposure"], rel_tol=1e-9)
    for t in d["trials"]:
        assert math.isclose(t["equal_split"], t["enrollment"] / t["n_sites"])
        assert math.isclose(t["trial_rate"], t["enrollment"] / (t["window_months"] * t["n_sites"]))
        assert 0 < t["n_hat"] <= t["enrollment"] + 1e-9


def test_low_history_cap(st):
    f = st.fit
    capped = _first(st, lambda i: f.n_fit[i] < R.LOW_HISTORY_N and f.mean[i] > f.floor)
    d = S.site_detail(capped)
    assert d["cap"]["low_history"] and d["cap"]["applied"]
    assert d["score"] == f.floor and d["posterior"]["mean"] > f.floor
    below = _first(st, lambda i: f.n_fit[i] < R.LOW_HISTORY_N and f.mean[i] <= f.floor)
    d = S.site_detail(below)
    assert d["cap"]["low_history"] and not d["cap"]["applied"] and d["score"] == d["posterior"]["mean"]


def test_calibrated_score_definition(st):
    f = st.fit
    lam = f.lam_eff[st.us_idx]
    m = float(np.mean(np.log(lam)))
    assert math.isclose(st.m, m, rel_tol=1e-12)
    doc = json.loads((paths.FINDINGS_DIR / S.VALIDATION_FILE).read_text(encoding="utf-8"))
    b = doc["industry_phase2_3"]["slope"]
    out = S.list_sites(limit=20)
    assert out["calibration"]["b"] == b and out["calibration"]["b_ci"] == doc["industry_phase2_3"]["ci95"]
    for r in out["rows"]:
        assert math.isclose(r["calibrated"], math.exp(m + b * (math.log(r["score"]) - m)), rel_tol=1e-12)


@needs_db
def test_calibration_omitted_without_validation_file(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "FINDINGS_DIR", tmp_path)
    out = S.list_sites(limit=5)
    assert out["calibration"] is None and all(r["calibrated"] is None for r in out["rows"])
    s = S.summary()
    assert s["validation"] is None and s["calibration"] is None
    assert S.site_detail(out["rows"][0]["site_id"])["calibrated"] is None


def test_list_defaults_to_history_depth_and_filters(st, con):
    out = S.list_sites(limit=500)
    assert out["total"] == len(st.us_idx)
    n = [r["n_fit"] for r in out["rows"]]
    assert n == sorted(n, reverse=True)
    us = {r[0] for r in con.execute("SELECT site_id FROM sites WHERE country='United States' AND anonymized=0")}
    assert all(r["site_id"] in us and r["n_fit"] >= 1 for r in out["rows"])
    ne = S.list_sites(region="US-Northeast", limit=500)
    from concord.service import REGIONS
    assert ne["total"] > 0 and all(r["state"] in REGIONS["US-Northeast"] for r in ne["rows"])
    ma = S.list_sites(state="Massachusetts", min_trials=3, limit=500)
    assert all(r["state"] == "Massachusetts" and r["n_fit"] >= 3 for r in ma["rows"])
    q = S.list_sites(q="dana", limit=500)
    assert q["total"] > 0 and all("dana" in f"{r['facility']} {r['city']} {r['state']}".lower() for r in q["rows"])
    by_score = S.list_sites(sort="-score", limit=50)["rows"]
    assert [r["score"] for r in by_score] == sorted((r["score"] for r in by_score), reverse=True)
    for r in out["rows"]:
        if r["capped"]:
            assert r["percentile"] is None and r["percentile_status"] == "tied_at_cap"
        else:
            assert 0 < r["percentile"] <= 100 and r["percentile_status"] == "ok"


def test_capped_and_unfitted_sites_get_no_percentile(st, con):
    """Every capped site ties at the cap value, which sits above most deep-history sites, so a percentile would
    rank a 1-2 trial site above them; a U.S. site with no fitted trial is not among the U.S. fitted sites."""
    f = st.fit
    capped = [i for i in st.us_idx if f.n_fit[i] < R.LOW_HISTORY_N and f.mean[i] > f.floor]
    assert len(capped) == st.at_cap > 0
    d = S.site_detail(f.hist.site_ids[int(capped[0])])
    assert d["percentile"] is None and d["percentile_status"] == "tied_at_cap" and d["us_at_cap"] == st.at_cap
    fitted = set(f.hist.site_ids)
    unfitted = next(r[0] for r in con.execute(
        "SELECT s.site_id FROM sites s JOIN site_model m USING(site_id) "
        "WHERE s.country='United States' AND s.anonymized=0 AND m.n_hist > 0 ORDER BY m.n_hist DESC")
        if r[0] not in fitted)
    d = S.site_detail(unfitted)
    assert d["history"]["n_fit"] == 0 and d["percentile"] is None and d["percentile_status"] == "no_fitted_trials"
    assert d["score"] == f.floor and not d["site"]["in_us_list"]
    deep = max(st.us_idx, key=lambda i: f.n_fit[i])
    d = S.site_detail(f.hist.site_ids[int(deep)])
    assert d["percentile_status"] == "ok" and 0 < d["percentile"] <= 100
    assert d["calibrated"]["relative_to_us_mean"] is False


def test_non_us_site_labels(st):
    f = st.fit
    i = next(i for s, i in st.s_index.items()
             if st.sites.get(s) and st.sites[s]["country"] not in (S.US, None) and not st.sites[s]["anonymized"])
    d = S.site_detail(f.hist.site_ids[i])
    assert d["percentile"] is None and d["percentile_status"] == "outside_us"
    assert d["calibrated"]["relative_to_us_mean"] is True


def _reading_for(ind: dict, allt: dict | None) -> str:
    def blk(r):
        return None if r is None else {**r, "overstatement": 1 / r["slope"] if r["slope"] > 0 else None}
    return S._reading(blk(ind), blk(allt))


def test_validation_reading_follows_the_numbers():
    ind = {"slope": 0.334, "ci95": [0.164, 0.504]}
    both = _reading_for(ind, {"slope": 0.158, "ci95": [0.072, 0.243]})
    assert both.startswith("Both slopes are above zero") and "Both slopes are below 1" in both
    assert "on the log scale" in both and "about 3x (about 6x across all trials)" in both
    one = _reading_for(ind, None)
    assert "Both" not in one and one.startswith("The slope is above zero and its 95% interval excludes zero")
    assert "The industry Phase II/III slope is below 1" in one
    mixed = _reading_for(ind, {"slope": 1.2, "ci95": [-0.1, 2.5]})
    assert "Both" not in mixed and "The 95% interval for all trials includes zero" in mixed
    assert "about 6x" not in mixed
    high = _reading_for({"slope": 1.1, "ci95": [0.8, 1.4]}, None)
    assert "not below 1" in high and "overstated" not in high


def test_summary_buckets_and_histogram(st):
    s = S.summary()
    assert sum(b["sites"] for b in s["buckets"]) == s["us"]["sites"] == len(st.us_idx)
    assert sum(x["low_history"] + x["history_3plus"] for x in s["histogram"]["bins"]) == s["us"]["sites"]
    assert all(b["capped"] == 0 for b in s["buckets"] if not b["low_history"])
    assert s["consistency"]["max_abs_diff"] <= 1e-12
    assert s["preset"]["n_fit"] >= max(b["lo"] for b in s["buckets"])
    assert s["preset"]["basis"].startswith("most fitted trials among")
    if "dana" in s["preset"]["facility"].lower() or "sloan" in s["preset"]["facility"].lower():
        assert "Dana-Farber" in s["preset"]["basis"]
    assert s["us"]["at_cap"] == s["us"]["capped"]


def test_api_routes(client):
    r = client.get("/api/site-scores/summary")
    assert r.status_code == 200 and "validation" in r.json()
    h = r.json()["heterogeneity"]
    assert {"k", "inv_k", "inv_k_ci95", "sites_used", "trials_used", "cross_check", "fallback"} <= set(h)
    assert {"sites", "median_width_ratio", "iqr"} <= set(h["cross_check"])
    r = client.get("/api/site-scores", params={"limit": 3})
    assert r.status_code == 200 and len(r.json()["rows"]) == 3
    assert all(len(x["interval"]) == 2 and len(x["interval_poisson"]) == 2 for x in r.json()["rows"])
    sid = r.json()["rows"][0]["site_id"]
    r = client.get(f"/api/site-scores/{sid}")
    assert r.status_code == 200 and r.json()["site"]["site_id"] == sid
    d = r.json()
    assert {"N_eff", "n_eff", "CV2_data"} <= set(d["data"])
    assert {"interval", "interval_poisson", "p10_poisson", "p90_poisson", "interval_method"} <= set(d["posterior"])
    assert client.get("/api/site-scores/not-a-site").status_code == 404
    assert client.get("/api/site-scores", params={"region": "Mars"}).status_code == 400
    assert client.get("/api/site-scores", params={"sort": "speed"}).status_code == 400


# ---------- the interval: trial-to-trial heterogeneity (no database needed for the simulations) ----------

def _nb2_sites(seed: int, inv_k: float, n_sites: int = 400, m_range=(8, 40), e_range=(3.0, 15.0)):
    """Simulated NB2 links: n_ts ~ Poisson(lam_s * eps_ts * e_ts), eps ~ Gamma(k, k), varied exposures."""
    rng = np.random.default_rng(seed)
    m = rng.integers(m_range[0], m_range[1] + 1, size=n_sites)
    lam = rng.gamma(2.0, 0.5, size=n_sites)
    si = np.repeat(np.arange(n_sites), m)
    e = rng.uniform(*e_range, size=len(si))
    eps = rng.gamma(1.0 / inv_k, inv_k, size=len(si)) if inv_k > 0 else np.ones(len(si))
    return rng.poisson(lam[si] * eps * e).astype(float), e, si, n_sites


def test_inv_k_terms_match_hand_computed_values():
    """The estimator in the spec, on fixed inputs worked out by hand, so the m/(m-1) correction, the -n Poisson term
    and pooling (sum num / sum den, not a mean of per-site ratios) are all pinned down.

    Site 0: n = 2, 5, 11; e = 1, 2, 3 -> d = 18/6 = 3, mu = 3, 6, 9;
            sum((n - mu)^2 - n) = (1 - 2) + (1 - 5) + (4 - 11) = -12, num = 3/2 * -12 = -18, den = 9 + 36 + 81 = 126
    Site 1: n = 0, 10, 26; e = 2, 2, 4 -> d = 36/8 = 4.5, mu = 9, 9, 18;
            sum = (81 - 0) + (1 - 10) + (64 - 26) = 110, num = 3/2 * 110 = 165, den = 81 + 81 + 324 = 486
    Site 2: two trials, below min_trials = 3, left out.
    Pooled 1/k = (-18 + 165) / (126 + 486) = 147 / 612."""
    n = np.array([2, 5, 11, 0, 10, 26, 4, 9], dtype=float)
    e = np.array([1, 2, 3, 2, 2, 4, 1, 1], dtype=float)
    si = np.array([0, 0, 0, 1, 1, 1, 2, 2])
    sites, num, den = S.inv_k_terms(n, e, si, 3, min_trials=3)
    assert sites.tolist() == [0, 1]
    assert np.allclose(num, [-18.0, 165.0], rtol=0, atol=1e-12) and np.allclose(den, [126.0, 486.0], rtol=0, atol=1e-12)
    assert math.isclose(S.inv_k_from_terms(num, den), 147 / 612, rel_tol=1e-12)
    # Site 0 alone has less spread than Poisson: clipped at 0. Not eligible -> left out.
    assert S.inv_k_from_terms(num[:1], den[:1]) == 0.0
    assert S.inv_k_terms(n, e, si, 3, np.array([False, True, True]), min_trials=3)[0].tolist() == [1]
    # Effective patients for site 0 at 1/k = 0.5: n_eff = 36/14, CV2 = 1/18 + 0.5 * 14/36 = 1/4, N_eff = 4.
    n_eff, cv2, N_eff = S.effective_patients(np.array([18.0]), np.array([6.0]), np.array([14.0]), 0.5)
    assert math.isclose(n_eff[0], 36 / 14) and math.isclose(cv2[0], 0.25) and math.isclose(N_eff[0], 4.0)
    # Concentration: weights 126/612 and 486/612; dropping the largest (site 1) leaves site 0, clipped to 0.
    c = S.weight_concentration(sites, num, den, ["a", "b", "c"])
    assert c["largest_site_id"] == "b" and math.isclose(c["largest_weight"], 486 / 612)
    assert math.isclose(c["largest_inv_k"], 165 / 486) and c["inv_k_without_largest"] == 0.0
    assert math.isclose(c["top10_weight"], 1.0) and c["inv_k_others"] is None


def test_moment_estimator_recovers_known_k_on_simulated_nb2():
    """The pooled moment estimator, on several hundred sites with varied exposures. It runs a few percent low with
    unequal exposures (d_s^2 inflates the denominator; m/(m-1) is exact only for equal exposures), so the band is
    +-20%; with Poisson-only data it returns ~0 (clipped)."""
    for true in (0.5, 1.0):
        sites, num, den = S.inv_k_terms(*_nb2_sites(11, true))
        est = S.inv_k_from_terms(num, den)
        assert len(sites) == 400
        assert 0.8 * true <= est <= 1.2 * true, (true, est)
    _, num, den = S.inv_k_terms(*_nb2_sites(12, 0.0))
    assert S.inv_k_from_terms(num, den) <= 0.02
    lo = S.inv_k_from_terms(*S.inv_k_terms(*_nb2_sites(13, 0.5))[1:])
    hi = S.inv_k_from_terms(*S.inv_k_terms(*_nb2_sites(13, 2.0))[1:])
    assert hi > 2.5 * lo
    # Sites below the trial threshold or not eligible are left out; nothing qualifying -> None (fallback).
    n, e, si, ns = _nb2_sites(14, 1.0, n_sites=20, m_range=(2, 4))
    assert len(S.inv_k_terms(n, e, si, ns)[0]) == 0
    assert S.inv_k_from_terms(*S.inv_k_terms(n, e, si, ns)[1:]) is None
    n, e, si, ns = _nb2_sites(15, 1.0, n_sites=20)
    elig = np.arange(ns) % 2 == 0
    assert set(S.inv_k_terms(n, e, si, ns, elig)[0].tolist()) == set(np.flatnonzero(elig).tolist())
    _, num, den = S.inv_k_terms(*_nb2_sites(16, 1.0))
    ci, est = S.inv_k_ci95(num, den), S.inv_k_from_terms(num, den)
    assert ci[0] < est < ci[1] and ci == S.inv_k_ci95(num, den)  # fixed seed: reproducible


def test_cv_formula_matches_simulated_sampling_sd():
    """CV2_data = 1/sum n + 1/(k n_eff) is the squared CV of sum n / sum e for one site under NB2."""
    rng = np.random.default_rng(7)
    lam, inv_k = 0.8, 1.4
    e = rng.lognormal(np.log(6.0), 0.9, size=12)
    eps = rng.gamma(1.0 / inv_k, inv_k, size=(200_000, len(e)))
    rates = rng.poisson(lam * eps * e).sum(axis=1) / e.sum()
    n_eff, cv2, N_eff = S.effective_patients(np.array([lam * e.sum()]), np.array([e.sum()]),
                                             np.array([(e ** 2).sum()]), inv_k)
    assert math.isclose(n_eff[0], e.sum() ** 2 / (e ** 2).sum())
    assert math.isclose(rates.std() / lam, math.sqrt(cv2[0]), rel_tol=0.02)
    assert math.isclose(N_eff[0], 1 / cv2[0])
    # No data: N_eff = 0 (CV infinite); no heterogeneity: N_eff = sum n.
    _, cv2, N_eff = S.effective_patients(np.array([0.0, 5.0]), np.array([0.0, 10.0]), np.array([0.0, 50.0]), 0.0)
    assert N_eff[0] == 0 and math.isinf(cv2[0]) and math.isclose(N_eff[1], 5.0)


def test_interval_includes_heterogeneity_and_scores_are_unchanged(st, con):
    f, het = st.fit, st.het
    assert het.inv_k is not None and het.inv_k > 0 and het.ci95[0] <= het.inv_k <= het.ci95[1]
    # Same centre: the interval contains the posterior mean; it is at least as wide as the Poisson one at both ends.
    assert np.all((het.lo < f.mean) & (f.mean < het.hi))
    assert np.all(het.lo <= f.lo * (1 + 1e-12)) and np.all(het.hi >= f.hi * (1 - 1e-12))
    assert np.all(het.N_eff <= f.sum_n * (1 + 1e-12)) and np.all(het.N_eff > 0)
    # With 1/k = 0 the formula is the Poisson posterior's interval.
    p_lo, p_hi = S.het_interval(f.alpha, f.mean, f.sum_n)
    assert np.allclose(p_lo, f.lo, rtol=1e-9) and np.allclose(p_hi, f.hi, rtol=1e-9)
    # N_eff = 0: the prior's quantiles.
    q_lo, q_hi = S.het_interval(f.alpha, f.alpha / f.beta, 0.0)
    assert math.isclose(q_lo, gamma_dist.ppf(0.1, f.alpha, scale=1 / f.beta), rel_tol=1e-12)
    assert math.isclose(q_hi, gamma_dist.ppf(0.9, f.alpha, scale=1 / f.beta), rel_tol=1e-12)
    # The score, cap, percentile and calibrated value do not use the interval: every score is still lam_eff.
    stored = dict(con.execute("SELECT site_id, lam_eff FROM site_model"))
    assert all(r["score"] == float(f.lam_eff[st.s_index[r["site_id"]]]) for r in st.rows)
    assert max(abs(r["score"] - stored[r["site_id"]]) for r in st.rows) <= 1e-12
    for r in st.rows[:200]:
        i = st.s_index[r["site_id"]]
        assert r["interval"] == [float(het.lo[i]), float(het.hi[i])]
        assert r["interval_poisson"] == [float(f.lo[i]), float(f.hi[i])]


def test_unfitted_site_interval_is_the_prior(st, con):
    fitted = set(st.fit.hist.site_ids)
    sid = next(r[0] for r in con.execute(
        "SELECT s.site_id FROM sites s JOIN site_model m USING(site_id) "
        "WHERE s.country='United States' AND s.anonymized=0 AND m.n_hist > 0 ORDER BY m.n_hist DESC")
        if r[0] not in fitted)
    d = S.site_detail(sid)
    assert d["data"]["N_eff"] == 0 and d["data"]["n_eff"] == 0 and d["data"]["CV2_data"] is None
    for a, b in zip(d["posterior"]["interval"], (d["prior"]["p10"], d["prior"]["p90"])):
        assert math.isclose(a, b, rel_tol=1e-12)
    assert d["posterior"]["interval_poisson"] == [d["prior"]["p10"], d["prior"]["p90"]]


def test_heterogeneity_falls_back_to_poisson_without_qualifying_sites(st, monkeypatch):
    f = st.fit
    het = S.heterogeneity(f, np.zeros(len(f.hist.site_ids), dtype=bool), st.links_of)
    assert het.fallback and het.inv_k is None and het.cross_check is None and het.sites_used == 0
    assert np.array_equal(het.lo, f.lo) and np.array_equal(het.hi, f.hi)
    assert np.array_equal(het.N_eff, f.sum_n)
    # Every text that describes the range switches with it (summary method; the view reads interval_method).
    monkeypatch.setattr(S, "_state", lambda: S._State(**{**st.__dict__, "het": het}))
    s = S.summary()
    d = S.site_detail(f.hist.site_ids[int(st.us_idx[0])])
    assert s["heterogeneity"]["fallback"] and "exact counts" in s["method"] and "trial to the next" not in s["method"]
    assert d["posterior"]["interval_method"] == "poisson_fallback"
    assert d["posterior"]["interval"] == d["posterior"]["interval_poisson"]


def test_breakdown_reports_effective_patients(st):
    f = st.fit
    sid = max((f.hist.site_ids[i] for i in st.us_idx), key=lambda s: f.n_fit[st.s_index[s]])
    d = S.site_detail(sid)
    data, post = d["data"], d["posterior"]
    k = 1 / st.het.inv_k
    assert math.isclose(data["CV2_data"], 1 / data["sum_n_hat"] + 1 / (k * data["n_eff"]), rel_tol=1e-9)
    assert math.isclose(data["N_eff"], 1 / data["CV2_data"], rel_tol=1e-12)
    assert 1 <= data["n_eff"] <= d["history"]["n_fit"] and data["N_eff"] < data["sum_n_hat"]
    assert math.isclose(post["interval_shape"] / post["interval_rate"], post["mean"], rel_tol=1e-12)
    assert post["p10"] < post["p10_poisson"] < post["mean"] < post["p90_poisson"] < post["p90"]
    assert post["interval"] == [post["p10"], post["p90"]] and post["interval_method"] == "trial_heterogeneity"


def test_summary_heterogeneity_block(st):
    s = S.summary()
    h = s["heterogeneity"]
    assert not h["fallback"] and math.isclose(h["k"] * h["inv_k"], 1.0)
    assert h["inv_k_ci95"][0] <= h["inv_k"] <= h["inv_k_ci95"][1]
    assert h["sites_used"] > 0 and h["site_trials_used"] >= S.HET_MIN_TRIALS * h["sites_used"]
    assert 0 < h["trials_used"] <= h["site_trials_used"]
    assert "varies from one trial to the next" in s["method"]
    cc = h["cross_check"]
    assert cc["sites"] > 0 and cc["iqr"][0] <= cc["median_width_ratio"] <= cc["iqr"][1]
    for b in s["buckets"]:
        assert b["median_log_width"] >= b["median_log_width_poisson"] > 0
    # Recomputed from the pieces: identifiable sites with at least HET_MIN_TRIALS fitted trials.
    f = st.fit
    elig = np.array([not (st.sites.get(x) or {}).get("anonymized") for x in f.hist.site_ids])
    sites, num, den = S.inv_k_terms(f.n_hat, f.e, f.si, len(f.hist.site_ids), elig)
    assert len(sites) == h["sites_used"] and math.isclose(S.inv_k_from_terms(num, den), h["inv_k"], rel_tol=1e-12)
    assert int(f.n_fit[sites].sum()) == h["site_trials_used"]
    assert len(np.unique(f.ti[np.isin(f.si, sites)])) == h["trials_used"]
    # Concentration: shares and the leave-largest-out 1/k, recomputed from the same terms.
    c = h["concentration"]
    order = np.argsort(-den, kind="stable")
    assert math.isclose(c["top50_weight"], den[order[:50]].sum() / den.sum(), rel_tol=1e-12)
    assert c["largest_site_id"] == f.hist.site_ids[int(sites[order[0]])]
    keep = np.ones(len(den), dtype=bool)
    keep[order[0]] = False
    assert math.isclose(c["inv_k_without_largest"], S.inv_k_from_terms(num[keep], den[keep]), rel_tol=1e-12)
    cc = h["cross_check"]
    assert sum(b["sites"] for b in cc["by_patients_per_trial"]) == cc["sites"] and 0 <= cc["share_wider_than_bootstrap"] <= 1
