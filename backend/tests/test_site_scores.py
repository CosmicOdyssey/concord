"""Site scores (concord.site_scores, concord.api.site_scores). Every test reads the real database and is skipped
without it: the point is that the breakdown reproduces the app's stored scores exactly."""
import json
import math
import sqlite3

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from concord import paths
from concord import site_scores as S
from concord.api import site_scores as api
from concord.model import recruitment as R
from concord.paths import DB_PATH

pytestmark = pytest.mark.skipif(not DB_PATH.exists(), reason="data/concord.db not built")


@pytest.fixture(scope="module")
def con():
    c = sqlite3.connect(DB_PATH)
    yield c
    c.close()


@pytest.fixture(scope="module")
def st():
    return S._state()


@pytest.fixture(scope="module")
def client():
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
    pct = [r["percentile"] for r in out["rows"]]
    assert all(0 < p <= 100 for p in pct)


def test_summary_buckets_and_histogram(st):
    s = S.summary()
    assert sum(b["sites"] for b in s["buckets"]) == s["us"]["sites"] == len(st.us_idx)
    assert sum(x["low_history"] + x["history_3plus"] for x in s["histogram"]["bins"]) == s["us"]["sites"]
    assert all(b["capped"] == 0 for b in s["buckets"] if not b["low_history"])
    assert s["consistency"]["max_abs_diff"] <= 1e-12
    assert s["preset"]["n_fit"] >= max(b["lo"] for b in s["buckets"])


def test_api_routes(client):
    r = client.get("/api/site-scores/summary")
    assert r.status_code == 200 and "validation" in r.json()
    r = client.get("/api/site-scores", params={"limit": 3})
    assert r.status_code == 200 and len(r.json()["rows"]) == 3
    sid = r.json()["rows"][0]["site_id"]
    r = client.get(f"/api/site-scores/{sid}")
    assert r.status_code == 200 and r.json()["site"]["site_id"] == sid
    assert client.get("/api/site-scores/not-a-site").status_code == 404
    assert client.get("/api/site-scores", params={"region": "Mars"}).status_code == 400
    assert client.get("/api/site-scores", params={"sort": "speed"}).status_code == 400
