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
    assert w["estimate_end"] == w["end"]
    assert not w["open_ended"]
    assert window("2020-01-01", None, None)["open_ended"]


def test_window_bounded_by_snapshot_status():
    """The CT.gov status at the snapshot overrides the 0.65 estimate in both directions."""
    from datetime import date

    from concord.overlap import window
    snap = "2026-10-16"
    s = date.fromisoformat(snap).toordinal()
    closed = window("2023-01-01", "2030-01-01", None, "ACTIVE_NOT_RECRUITING", snap)
    assert closed["estimate_end"] > s and closed["end"] == s and not closed["recruiting_at_snapshot"]
    still = window("2018-01-01", "2020-01-01", None, "RECRUITING", snap)
    assert still["estimate_end"] < s and still["end"] == s + 1 and still["recruiting_at_snapshot"]
    early = window("2018-01-01", "2020-01-01", None, "COMPLETED", snap)
    assert early["end"] == early["estimate_end"] and not early["bounded_by_status"]


def test_as_of_capped_at_snapshot(client):
    """No projection: dates after the registry snapshot are refused; the default is the snapshot."""
    from datetime import date, timedelta

    from concord.overlap import check_date, snapshot_date
    snap = snapshot_date()
    assert check_date(None) == snap
    later = (date.fromisoformat(snap) + timedelta(days=1)).isoformat()
    with pytest.raises(ValueError):
        check_date(later)
    assert client.get("/api/overlap", params={"sponsor": REGENERON, "as_of": "2029-06-01"}).status_code == 400
    assert client.get("/api/overlap/sponsors", params={"as_of": later}).status_code == 400


def test_snapshot_date_uses_registry_status():
    """On the snapshot date 'recruiting' is the CT.gov status, for the sponsor's trials and the other-sponsor counts."""
    import sqlite3

    from concord import overlap
    snap = overlap.snapshot_date()
    sp = overlap.sponsors(None, "US")
    assert sp["as_of"] == snap and sp["basis"] == "registry"
    top = sp["sponsors"][0]["sponsor"]
    res = overlap.audit(top, None, "US")
    assert res["basis"] == "registry" and res["as_of"] == snap
    assert res["trials"] and all(t["status_now"] in overlap.OPEN_STATUSES for t in res["trials"])
    assert all(t["recruiting_at_snapshot"] for t in res["trials"])
    con = sqlite3.connect(DB_PATH)
    n_open = con.execute(f"""SELECT COUNT(DISTINCT t.nct_id) FROM trials t JOIN trial_sites ts USING(nct_id)
                             JOIN sites s USING(site_id) WHERE t.is_lung=1 AND t.sponsor=? AND s.country='United States'
                             AND COALESCE(ts.site_status, '') <> 'WITHDRAWN' AND t.start_date <= ?
                             AND t.status IN ('RECRUITING', 'ENROLLING_BY_INVITATION')""", (top, snap)).fetchone()[0]
    con.close()
    assert len(res["trials"]) == n_open
    for p in res["pairs"]:
        assert p["both_recruiting_to"] is None or p["both_recruiting_to"] <= snap


def test_past_date_bounded_by_snapshot_status(regeneron):
    """Every Regeneron trial is Active, not recruiting at the snapshot: the estimate that runs past it is flagged."""
    snap = regeneron["snapshot_date"]
    assert regeneron["basis"] == "estimated"
    for t in regeneron["trials"]:
        assert not t["recruiting_at_snapshot"]
        assert t["status_overrides_estimate"] == (t["estimated_window_end"] > snap)
    for p in regeneron["pairs"]:
        assert p["both_recruiting_to"] is None or p["both_recruiting_to"] <= snap


def test_criteria_diff_matches_on_concept():
    from concord.compiler.eligibility import Criterion
    from concord.overlap import criteria_diff
    from concord.service import population
    a = [Criterion("x", "inclusion", "ecog", "<=", 1, "ECOG", "s"),
         Criterion("stage_adv", "inclusion", "stage", "in", ["IV"], "IV", "s"),
         Criterion("egfr_req", "inclusion", "egfr", "==", True, "EGFR+", "s")]
    b = [Criterion("stage_iv", "inclusion", "stage", "in", ["III", "IV"], "III-IV", "s"),
         Criterion("z", "exclusion", "ild_history", "==", True, "ILD", "s"),
         Criterion("ecog_ge2", "exclusion", "ecog", ">=", 2, "ECOG 0-1", "s"),
         Criterion("alk_req", "inclusion", "alk", "==", True, "ALK+", "s")]
    d = criteria_diff(a, b)
    # Different ids, one concept each; driver requirements (OR group) are one concept.
    assert d["only_p"] == [] and d["only_q"] == ["z"]
    by = {s["concept"]: s for s in d["shared"]}
    assert set(by) == {"ecog", "stage", "driver requirement"}
    assert by["stage"]["p"] == ["stage_adv"] and by["stage"]["q"] == ["stage_iv"] and not by["stage"]["same"]
    # 'ECOG <= 1' (inclusion) and 'not ECOG >= 2' (exclusion) select the same patients.
    assert criteria_diff(a, b, population())["shared"][0]["same"] is True


def test_regeneron_trials_on_sept_2024(regeneron):
    ids = [t["nct_id"] for t in regeneron["trials"]]
    assert set(FIANLIMAB) <= set(ids)
    assert len(regeneron["pairs"]) == len(ids) * (len(ids) - 1) // 2
    for t in regeneron["trials"]:
        # service.build's as-of rule (none is recruiting at the snapshot, so the estimate applies, capped there).
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
    assert not p["unreviewed_criteria"] and p["sparse_criteria"] == []
    d = p["criteria_diff"]
    only_785 = d["only_p"] if p["p"] == "NCT05785767" else d["only_q"]
    assert {"pdl1_high", "no_never_smoker"} <= set(only_785)
    assert any("tx_naive" in s["p"] and s["same"] for s in d["shared"])
    for sid in p["shared_site_ids"]:
        s = regeneron["sites"][sid]
        assert not s["anonymized"] and s["country"] == "United States"


def test_shared_sites_are_registered_on_both(regeneron):
    by_id = {t["nct_id"]: set(t["site_ids"]) for t in regeneron["trials"]}
    anon = {s for s, v in regeneron["sites"].items() if v["anonymized"]}
    for p in regeneron["pairs"]:
        both = by_id[p["p"]] & by_id[p["q"]]
        assert set(p["shared_site_ids"]) == both - anon
        assert p["anonymized_same_city"] == len(both & anon)
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


def test_trials_without_completion_date_are_left_out():
    """A closed-status trial with no registered completion date has no estimable window: listed, never shown as
    recruiting. (A trial still recruiting at the snapshot needs no estimate: the registry says it is open.)"""
    import sqlite3

    from concord import overlap
    snap = overlap.snapshot_date()
    con = sqlite3.connect(DB_PATH)
    row = con.execute("""SELECT sponsor, nct_id, start_date FROM trials WHERE is_lung=1 AND sponsor IS NOT NULL
                         AND start_date IS NOT NULL AND start_date < ? AND primary_completion_date IS NULL
                         AND completion_date IS NULL AND status NOT IN
                         ('WITHDRAWN', 'NOT_YET_RECRUITING', 'RECRUITING', 'ENROLLING_BY_INVITATION')
                         ORDER BY start_date LIMIT 1""", (snap,)).fetchone()
    con.close()
    if row is None:
        pytest.skip("no open-ended trial in this DB")
    sponsor, nct, start = row
    res = overlap.audit(sponsor, "2024-09-01" if start <= "2024-09-01" else start, None)
    assert nct in res["excluded_open_ended"]
    assert nct not in {t["nct_id"] for t in res["trials"]}
    assert not any(t["open_ended"] and not t["recruiting_at_snapshot"] for t in res["trials"])


def test_not_yet_recruiting_never_counted():
    """A trial CT.gov lists as not yet recruiting at the snapshot was not recruiting on any earlier date."""
    import sqlite3

    from concord import overlap
    snap = overlap.snapshot_date()
    con = sqlite3.connect(DB_PATH)
    row = con.execute("""SELECT sponsor, nct_id, start_date FROM trials WHERE is_lung=1 AND sponsor IS NOT NULL
                         AND status='NOT_YET_RECRUITING' AND start_date < ? AND primary_completion_date > ?
                         ORDER BY start_date DESC LIMIT 1""", (snap, snap)).fetchone()
    con.close()
    if row is None:
        pytest.skip("no overdue not-yet-recruiting trial in this DB")
    sponsor, nct, start = row
    res = overlap.audit(sponsor, start, None)
    assert nct not in {t["nct_id"] for t in res["trials"]}
    assert nct in {t["nct_id"] for t in res["not_yet_recruiting"]}


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
    snap = res["snapshot_date"]
    assert res["count"] == len(res["pairs"])
    assert res["upper_bound_count"] == sum(p["upper_bound"] for p in res["pairs"])
    assert res["context"]["count_at_min_5_shared_sites"] >= res["count"]
    for p in res["pairs"]:
        assert p["shared_sites"] >= 10
        assert max(p["o_pq"], p["o_qp"]) >= 0.8
        assert "2015-01-01" < p["both_recruiting_to"] <= snap  # nothing projected past the snapshot
        assert "NOT_YET_RECRUITING" not in p["status_at_snapshot"].values()
        assert p["containers"] and p["container_criteria"] == max(p["n_criteria"][c] for c in p["containers"])
    # Robust variants: the headline leads with pairs whose criteria were both reviewed.
    hand = [p for p in res["pairs"] if set(p["eligibility_source"].values()) == {"hand-encoded"}]
    assert res["headline"]["count"] == res["robustness"]["both_hand_encoded"]["count"] == len(hand)
    assert res["robustness"]["container_min_3_criteria"]["count"] == sum(p["container_criteria"] >= 3
                                                                         for p in res["pairs"])
    fl = [p for p in res["pairs"] if {p["p"], p["q"]} == set(FIANLIMAB)]
    assert len(fl) == 1 and fl[0]["sponsor"] == REGENERON
