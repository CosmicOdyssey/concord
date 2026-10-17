"""Budget transparency (concord.anchoring through terms.budget/compare): anchored shares, the Medicare band,
the editable overhead assumption and the category breakdowns."""

import pytest

from concord import anchoring, terms
from concord.paths import DATA_DIR, DB_PATH

NCTS = ("NCT05800015", "NCT06627647")
needs_data = pytest.mark.skipif(not (DB_PATH.exists() and (DATA_DIR / "ratecard.json").exists()),
                                reason="data/concord.db or data/ratecard.json not built")


def _default_site(nct: str) -> str:
    return terms.sites(nct)["default_pair"][0]


def _lines(b: dict, fixed_only: bool = True) -> list[dict]:
    return [l for v in b["visits"] if not (fixed_only and v["kind"] == "repeat") for l in v["lines"]]


# ---------------------------------------------------------------- classification (no data needed)

def test_classify_rules():
    base = {"payer": "Sponsor", "amount": 10.0, "code": "99213", "schedule": "PFS", "verified": True,
            "placeholder": False}
    assert anchoring.classify(base)[0] == "public"
    assert anchoring.classify({**base, "schedule": "CLFS"})[0] == "public"
    assert anchoring.classify({**base, "schedule": "CLFS", "verified": False, "placeholder": True})[0] == "open"
    assert anchoring.classify({**base, "amount": None})[0] == "open"  # unpriced, never silently anchored
    std = {"payer": "Sponsor", "amount": 60.0, "code": None, "schedule": "Standard", "edited": False}
    assert anchoring.classify(std)[0] == "standard"
    assert anchoring.classify({**std, "edited": True})[0] == "open"
    assert anchoring.classify({**base, "payer": "Insurance"})[0] is None


@pytest.mark.parametrize("lo,hi", [(0.05, 1.0), (1.0, 6.0), (1.5, 1.0), (float("nan"), 1.0), (True, 1.5)])
def test_band_validation(lo, hi):
    with pytest.raises(ValueError):
        anchoring.check_band(lo, hi)


# ---------------------------------------------------------------- budget

@needs_data
@pytest.mark.parametrize("nct", NCTS)
def test_anchored_shares_add_up_to_per_participant(nct):
    b = terms.budget(nct, _default_site(nct))
    an = b["anchoring"]
    total = b["totals"]["per_participant"]
    assert [s["id"] for s in an["shares"]] == ["public", "standard", "open"]
    assert sum(s["amount"] for s in an["shares"]) == pytest.approx(total, abs=0.005)
    assert sum(s["pct"] for s in an["shares"]) == pytest.approx(100, abs=0.15)
    assert abs(an["rounding_to_open"]) <= 0.05
    # every sponsor line is classified; insurance lines are not part of the sponsor budget
    for l in _lines(b, fixed_only=False):
        assert (l["anchor"] is None) == (l["payer"] != "Sponsor")
    fixed = _lines(b)
    pub = sum(l["amount"] for l in fixed if l["anchor"] == "public")
    assert an["shares"][0]["amount"] == pytest.approx(pub, abs=0.005)
    for l in fixed:
        if l["anchor"] == "public":
            assert l["schedule"] in ("PFS", "CLFS") and l["verified"] and not l["placeholder"]
    # coordinator time is a proposed-standard item, overhead is open to negotiation
    std = an["shares"][1]
    assert any(c["label"] == "Coordinator time" for c in std["components"])
    assert an["shares"][2]["amount"] >= b["totals"]["per_participant_overhead"] - 0.05


@needs_data
def test_band_math_and_point_value_unchanged():
    nct = "NCT05800015"
    sid = _default_site(nct)
    base = terms.budget(nct, sid, band_lo=1.0, band_hi=1.0)
    plain = terms.budget(nct, sid)  # default band 100%-150%
    # the band never changes the point budget
    assert plain["totals"]["per_participant"] == base["totals"]["per_participant"]
    t = base["totals"]
    assert t["per_participant_low"] == t["per_participant_high"] == t["per_participant"]
    for v in base["visits"]:
        assert v["visit_low"] == v["visit_high"] == v["visit_total"]
    # 100%-150%: coded lines move, everything else keeps its point value
    for l in _lines(plain, fixed_only=False):
        if l["banded"]:
            assert l["low"] == pytest.approx(round(l["medicare_amount"] * 1.0, 2))
            assert l["high"] == pytest.approx(round(l["medicare_amount"] * 1.5, 2))
        elif l["amount"] is not None:
            assert l["low"] == l["high"] == l["amount"]
    pt = plain["totals"]
    assert pt["per_participant_low"] < pt["per_participant_high"]
    rate = next(i["amount"] for i in plain["standard_schedule"] if i["id"] == "overhead")
    coded_hi = sum(l["high"] - l["low"] for l in _lines(plain) if l["banded"])
    assert pt["per_participant_high"] - pt["per_participant_low"] == pytest.approx(coded_hi * (1 + rate), abs=0.15)
    assert plain["band"]["label"] == "assumption" and plain["band"]["lo"] == 1.0 and plain["band"]["hi"] == 1.5
    with pytest.raises(ValueError):
        terms.budget(nct, sid, band_lo=2.0, band_hi=1.0)


@needs_data
def test_overhead_edit_moves_open_share_and_is_labelled_assumption():
    nct = "NCT05800015"
    sid = _default_site(nct)
    base = terms.budget(nct, sid)
    ed = terms.budget(nct, sid, standard={"overhead": 0.10})
    over = next(i for i in ed["standard_schedule"] if i["id"] == "overhead")
    assert over["assumption"] and over["label"].endswith("(assumption)") and over["amount"] == 0.10
    assert ed["totals"]["per_participant_overhead"] < base["totals"]["per_participant_overhead"]
    assert ed["anchoring"]["shares"][2]["amount"] < base["anchoring"]["shares"][2]["amount"]
    assert ed["anchoring"]["shares"][0]["amount"] == base["anchoring"]["shares"][0]["amount"]
    zero = terms.budget(nct, sid, standard={"overhead": 0})
    assert zero["anchoring"]["shares"][2]["amount"] == pytest.approx(0, abs=0.05)
    # an edited coordinator rate is no longer the proposed standard
    co = terms.budget(nct, sid, standard={"coordinator": 200})
    assert any(c["label"].startswith("Coordinator time") for c in co["anchoring"]["shares"][2]["components"])


@needs_data
@pytest.mark.parametrize("nct", NCTS)
def test_breakdowns_add_up(nct):
    b = terms.budget(nct, _default_site(nct))
    t = b["totals"]
    bd = b["breakdowns"]
    for key in ("cost_type", "visit", "anchoring"):
        assert sum(x["amount"] for x in bd[key]) == pytest.approx(t["per_participant"], abs=0.05), key
        assert sum(x["high"] for x in bd[key]) == pytest.approx(t["per_participant_high"], abs=0.05), key
    assert bd["payer"][0]["amount"] == t["per_participant"]
    assert bd["payer"][1]["amount"] == t["per_participant_insurance_medicare"] and bd["payer"][1]["not_sponsor"]
    assert {x["id"] for x in bd["visit"]} <= {"screening", "treatment", "eot", "follow_up"}
    assert bd["outside"]["one_time_fees"]["amount"] == t["per_site_one_time"]


@needs_data
def test_pricing_basis_is_non_facility_and_compare_carries_band():
    nct = "NCT05800015"
    b = terms.budget(nct, _default_site(nct))
    assert "non-facility" in b["pricing_basis"]["pfs"].lower() and b["pricing_basis"]["opps_included"] is False
    assert "non-facility" in (b["pfs_source"] or "")  # the loader reads the NON-FAC PE RVU column
    assert b["pricing_basis"]["lab_varies_by_site"] is False
    a, s2 = terms.sites(nct)["default_pair"]
    c = terms.compare(nct, a, s2, band_lo=1.0, band_hi=1.2)
    assert c["band"]["hi"] == 1.2 and c["a"]["totals"]["per_participant_high"] > c["a"]["totals"]["per_participant"]


@needs_data
def test_api_band_params():
    from fastapi.testclient import TestClient

    from concord.api.main import app

    c = TestClient(app)
    sid = _default_site("NCT05800015")
    r = c.get("/api/terms-flow/NCT05800015/budget", params={"site_id": sid, "band_lo": 1.0, "band_hi": 1.25})
    assert r.status_code == 200
    j = r.json()
    assert j["band"]["hi"] == 1.25 and all("anchor" in l for v in j["visits"] for l in v["lines"])
    bad = c.get("/api/terms-flow/NCT05800015/budget", params={"site_id": sid, "band_lo": 1.5, "band_hi": 1.0})
    assert bad.status_code == 400
