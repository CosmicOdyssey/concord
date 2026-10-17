"""Portfolio overlap audit (concord.overlap + /api/overlap). Skipped when the data has not been built."""
import json
import re

import pytest

from concord.paths import DB_PATH

pytestmark = pytest.mark.skipif(not DB_PATH.exists(), reason="data/concord.db not built")

REGENERON = "Regeneron Pharmaceuticals"
FIANLIMAB = ("NCT05785767", "NCT05800015")


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from concord.api.main import app
    return TestClient(app)


@pytest.fixture(scope="module")
def regeneron():
    from concord import overlap
    return overlap.audit(REGENERON, "2024-09-01", "US")


def _pair(res, a, b):
    for p in res["pairs"]:
        if {p["p"], p["q"]} == {a, b}:
            return p
    raise AssertionError(f"pair {a} {b} missing")


def test_window_matches_service_as_of_rule():
    from concord.overlap import window
    w = window("2020-01-01", "2030-01-01", None)
    assert w["end"] - w["start"] == pytest.approx(0.65 * 3653)
    assert not w["open_ended"]
    assert window("2020-01-01", None, None)["open_ended"]


def test_criteria_diff_matches_on_id():
    from concord.compiler.eligibility import Criterion
    from concord.overlap import criteria_diff
    a = [Criterion("x", "inclusion", "ecog", "<=", 1, "ECOG", "s"), Criterion("y", "inclusion", "stage", "in", ["IV"], "IV", "s")]
    b = [Criterion("y", "inclusion", "stage", "in", ["III", "IV"], "III-IV", "s"), Criterion("z", "exclusion", "ild_history", "==", True, "ILD", "s")]
    d = criteria_diff(a, b)
    assert d == {"only_p": ["x"], "only_q": ["z"], "shared": ["y"], "shared_differs": ["y"]}


def test_regeneron_trials_on_sept_2024(regeneron):
    ids = [t["nct_id"] for t in regeneron["trials"]]
    assert set(FIANLIMAB) <= set(ids)
    assert len(regeneron["pairs"]) == len(ids) * (len(ids) - 1) // 2
    for t in regeneron["trials"]:
        # Same as-of rule as service.build: started on or before the date, estimated window still open.
        assert t["start_date"] <= "2024-09-01" <= t["estimated_window_end"]
        assert t["eligibility_source"] == "hand-encoded"  # the Regeneron portfolio is in OVERRIDES
        assert t["n_sites"] >= t["n_sites_identified"] >= 0
        assert isinstance(t["other_sponsor_trials_at_sites"], int)
        assert t["other_sponsor_trials_at_sites"] >= t["other_sponsor_trials_at_sites_industry"]


def test_fianlimab_pair(regeneron):
    p = _pair(regeneron, *FIANLIMAB)
    o = {p["p"]: p["o_pq"], p["q"]: p["o_qp"]}
    # PD-L1 >= 50% and never-smokers excluded vs any PD-L1: the first population sits inside the second.
    assert o["NCT05785767"] == pytest.approx(1.0)
    assert 0.15 < o["NCT05800015"] < 0.4
    assert p["shared_sites"] == len(p["shared_site_ids"]) >= 10
    assert p["months_both_recruiting_estimated"] > 12
    assert not p["upper_bound"]
    d = p["criteria_diff"]
    only_785 = d["only_p"] if p["p"] == "NCT05785767" else d["only_q"]
    assert {"pdl1_high", "no_never_smoker"} <= set(only_785)
    assert "tx_naive" in d["shared"]
    for sid in p["shared_site_ids"]:
        s = regeneron["sites"][sid]
        assert not s["anonymized"] and s["country"] == "United States"


def test_shared_sites_are_registered_on_both(regeneron):
    by_id = {t["nct_id"]: set(t["site_ids"]) for t in regeneron["trials"]}
    for p in regeneron["pairs"]:
        assert set(p["shared_site_ids"]) <= by_id[p["p"]] & by_id[p["q"]]
    for t in regeneron["trials"]:
        assert len(t["site_ids"]) == t["n_sites"]
        assert t["n_sites"] - t["n_sites_identified"] == sum(regeneron["sites"][s]["anonymized"] for s in t["site_ids"])


def test_region_narrows_sites():
    from concord import overlap
    us = overlap.audit(REGENERON, "2024-09-01", "US")
    world = overlap.audit(REGENERON, "2024-09-01", None)
    assert world["region_label"].startswith("All registered sites worldwide")
    w = {t["nct_id"]: t["n_sites"] for t in world["trials"]}
    for t in us["trials"]:
        assert t["n_sites"] <= w[t["nct_id"]]
    assert _pair(world, *FIANLIMAB)["shared_sites"] >= _pair(us, *FIANLIMAB)["shared_sites"]


def test_upper_bound_follows_design():
    from concord.compiler.overrides import DESIGN
    from concord.overlap import upper_bound_reasons
    for nct, d in DESIGN.items():
        expect = bool(d["requires_unmodeled_biomarker"] or d["design"] in ("basket", "multi_cohort") or d["unmodeled"])
        assert bool(upper_bound_reasons(nct)) == expect, nct
    assert upper_bound_reasons("NCT00000000") == []


def test_no_forecast_fields(regeneron):
    """App rule: no predicted speedup, time-to-fill, enrollment rate or ratio in the payload."""
    keys = set()

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                keys.add(k)
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(regeneron)
    bad = [k for k in keys if re.search(r"(^|_)(speedup|rates?|ratios?|forecast|predicted)(_|$)|time_to|^T_", k)]
    assert not bad, bad


def test_api_endpoints(client):
    r = client.get("/api/overlap/sponsors", params={"as_of": "2024-09-01", "region": "US"})
    assert r.status_code == 200
    names = {s["sponsor"]: s["trials"] for s in r.json()["sponsors"]}
    assert names.get(REGENERON, 0) >= 2
    assert all(n >= 2 for n in names.values())

    r = client.get("/api/overlap", params={"sponsor": REGENERON, "as_of": "2024-09-01", "region": "US"})
    assert r.status_code == 200
    body = r.json()
    assert {t["nct_id"] for t in body["trials"]} >= set(FIANLIMAB)
    json.dumps(body)

    assert client.get("/api/overlap", params={"sponsor": REGENERON, "region": "Mars"}).status_code == 400
    assert client.get("/api/overlap", params={"sponsor": REGENERON, "as_of": "Sept 1"}).status_code == 400
    assert client.get("/api/overlap", params={"sponsor": "No Such Sponsor Inc"}).status_code == 404
    r = client.get("/api/overlap", params={"sponsor": REGENERON, "as_of": "2024-09-01", "region": "all"})
    assert r.status_code == 200 and r.json()["region"] is None


def test_self_overlap_definition_and_counts():
    from concord.overlap import self_overlap
    res = self_overlap()
    assert res["count"] == len(res["pairs"])
    assert res["upper_bound_count"] == sum(p["upper_bound"] for p in res["pairs"])
    assert res["context"]["count_at_min_5_shared_sites"] >= res["count"]
    for p in res["pairs"]:
        assert p["shared_sites"] >= 10
        assert max(p["o_pq"], p["o_qp"]) >= 0.8
        assert p["both_recruiting_to"] > "2015-01-01"
    fl = [p for p in res["pairs"] if {p["p"], p["q"]} == set(FIANLIMAB)]
    assert len(fl) == 1 and fl[0]["sponsor"] == REGENERON
