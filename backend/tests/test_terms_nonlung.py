"""Non-lung protocol in Protocol to terms: SIENNA (NCT06541704, geographic atrophy) and the registry-snapshot
fallback for trials that are not in the lung-only database."""

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from concord import terms, terms_registry
from concord.paths import DATA_DIR, DB_PATH

NCT = "NCT06541704"
needs_pfs = pytest.mark.skipif(not (DATA_DIR / "ratecard.json").exists(), reason="data/ratecard.json not built")
FORBIDDEN = ("time-to-fill", "time to fill", "enrollment rate", "speedup", "faster", "months saved")


def _sid(city: str, facility: str) -> str:
    for s in terms.sites(NCT)["sites"]:
        if s["city"] == city and facility.lower() in s["facility"].lower():
            return s["site_id"]
    raise AssertionError(f"no {facility} site in {city}")


# ---------------------------------------------------------------- protocol (no data needed)

def test_protocol_loads_labelled_and_sourced():
    p = terms.load_protocol(NCT)
    assert NCT in terms.list_protocols()
    assert p["label"] == terms.ILLUSTRATIVE
    assert p["area"] == "Outside lung cancer" and p["condition"]
    assert p["sources"] and all(s["field"] and s["quote"] and s["used_for"] for s in p["sources"])
    assert p["assumptions"] and p["standard_care_reference"] and "Not a coverage determination" in p["standard_care_source"]
    rules = {n["rule"] for n in p["nodes"]}
    assert {"R1", "R2", "R3", "R4"} <= rules and "R5" not in rules  # no standard therapy in every arm
    std_ids = {i[0] for i in terms.STANDARD_ITEMS}
    for x in p["procedures"]:
        assert x["pricing"] in ("cpt", "none") or x["pricing"].split(":")[1] in std_ids
    rule = {n["id"]: n["rule"] for n in p["nodes"]}
    assert rule["D1:inj_poz"] == "R1" and rule["W52:faf"] == "R3" and rule["W4:eye_int"] == "R4"
    assert rule["SCR:nm_cx"] == "R2"  # meningococcal carriage culture: registry exclusion 12


def test_registry_snapshot_has_source_and_us_sites():
    snap = terms_registry.snapshot(NCT)
    assert snap["source_url"] == f"https://clinicaltrials.gov/api/v2/studies/{NCT}" and snap["fetched"]
    assert snap["trial"]["sponsor"].startswith("Regeneron") and "PHASE3" in snap["trial"]["phases"]
    assert snap["sites"] and all(s["country"] == "United States" for s in snap["sites"])
    assert terms_registry.snapshot("NCT05800015") is None  # lung trials come from the database


def test_trial_listed_with_label_next_to_lung_protocols():
    ts = {t["nct_id"]: t for t in terms.trials()}
    assert NCT in ts and ts[NCT]["area"] == "Outside lung cancer"
    assert ts[NCT]["trial"]["sponsor"].startswith("Regeneron")
    assert ts[NCT]["trial"]["n_us_sites"] == len(terms_registry.site_rows(NCT))


# ---------------------------------------------------------------- fallback path

def test_trial_not_in_database():
    if not DB_PATH.exists():
        pytest.skip("data/concord.db not built")
    con = sqlite3.connect(f"file:{DB_PATH.as_posix()}?mode=ro", uri=True)
    try:
        assert con.execute("SELECT COUNT(*) FROM trials WHERE nct_id=?", (NCT,)).fetchone()[0] == 0
    finally:
        con.close()
    facts = terms._trial_facts(NCT)
    assert facts["in_database"] is False and "fetched" in facts["source"]


def test_fallback_without_database(monkeypatch, tmp_path):
    """No database at all: the snapshot still serves facts and sites; a lung trial still needs the database."""
    monkeypatch.setattr(terms, "DB_PATH", tmp_path / "missing.db")
    assert terms._trial_facts(NCT)["sponsor"].startswith("Regeneron")
    assert len(terms._site_rows(NCT)) == len(terms_registry.site_rows(NCT))
    with pytest.raises(terms.NotFound):
        terms._site_rows("NCT05800015")


@needs_pfs
def test_snapshot_sites_never_guess_a_locality():
    out = terms.sites(NCT)
    assert out["n_withdrawn_hidden"] == sum(1 for r in terms_registry.site_rows(NCT) if r["site_status"] == "WITHDRAWN")
    by_city = {(s["state_abbr"], s["city"]): s for s in out["sites"]}
    # crosswalked county and one-locality state resolve, verified
    assert by_city[("NY", "New York")]["locality"]["name"] == "MANHATTAN"
    assert by_city[("NY", "New York")]["locality"]["verified"]
    assert by_city[("AZ", "Phoenix")]["locality"]["method"] == "the whole state is one Medicare locality"
    # a city whose county is not crosswalked, in a multi-locality state, stays unresolved and says so
    tampa = by_city[("FL", "Tampa")]
    assert tampa["locality"] is None and "not resolved" in tampa["locality_note"]
    assert all(s["locality"] is None or s["locality"]["verified"] for s in out["sites"])
    # the lung trials keep their existing behaviour (city-name match allowed, flagged unverified)
    assert terms.resolve_locality("Florida", "Tampa", "United States") is not None
    assert terms.resolve_locality("Florida", "Tampa", "United States", name_match=False) is None


# ---------------------------------------------------------------- pricing and export

@needs_pfs
def test_budget_prices_from_cms_and_never_zeroes_unpriced_codes():
    st = terms.sites(NCT)
    a, b = st["default_pair"]
    assert a and b and a != b
    bud = terms.budget(NCT, a)
    assert bud["locality"]["name"] == "MANHATTAN"
    lines = [l for v in bud["visits"] for l in v["lines"]]
    for l in lines:
        if l["payer"] == "Insurance":
            assert l["coverage"] == "routine" and l["amount"] is None and l["medicare_amount"] is not None
        if l["schedule"] in ("PFS", "CLFS"):
            assert l["verified"] and not l["placeholder"]
    unpriced = {l["code"] for l in lines if l["code"] and l["medicare_amount"] is None}
    assert unpriced == {"90620", "90677", "90734"}  # vaccine products: no PFS/CLFS amount in the rate card
    for l in lines:
        if l["code"] in unpriced:
            assert l["amount"] is None and "never counted as zero" in l["note"]
    vfx = [l for l in lines if l["procedure_id"] == "vfx"]
    assert vfx and all(l["schedule"] == "None" and l["amount"] is None for l in vfx)
    t = bud["totals"]
    assert t["per_participant_scope"].startswith("screening through week 104")
    assert t["per_participant"] == pytest.approx(
        t["per_participant_research_items"] + t["per_participant_coordinator"] + t["per_participant_overhead"], abs=0.02)
    assert t["per_participant_placeholder"] == 0  # CLFS loaded: no lab placeholders
    assert [x["visit_id"] for x in t["per_occurrence"]] == ["DX"]


@needs_pfs
def test_compare_and_termsheet_exports():
    a = _sid("New York", "Retina Associates of New York")
    b = _sid("Madison", "Mississippi Retina Associates")
    c = terms.compare(NCT, a, b)
    sm = c["summary"]
    assert sm["delta_per_participant"] == pytest.approx(
        sm["from_work"] + sm["from_pe"] + sm["from_mp"] + sm["delta_overhead"] + sm["rounding"], abs=0.02)
    assert sm["delta_per_participant"] < 0  # Mississippi GPCIs are below Manhattan's
    ts = terms.termsheet(NCT, a, compare_site=b)
    md, html = terms.termsheet_markdown(ts), terms.termsheet_html(ts)
    for doc in (md, html):
        assert terms.DISCLAIMER in doc and terms.ILLUSTRATIVE in doc
        assert "clinicaltrials.gov/api/v2/studies/NCT06541704" in doc and "fetched 2026-10-17" in doc
        assert "screening through week 104" in doc and "cycle 8" not in doc
        low = doc.lower()
        assert not any(f in low for f in FORBIDDEN)
    unresolved = _sid("Tampa", "University of South Florida")
    md2 = terms.termsheet_markdown(terms.termsheet(NCT, unresolved))
    assert "national amounts" in md2 and "left unresolved rather than guessed" in md2


@needs_pfs
def test_api_serves_the_new_protocol():
    from concord.api.main import app

    cl = TestClient(app)
    assert NCT in [t["nct_id"] for t in cl.get("/api/terms-flow/trials").json()]
    p = cl.get(f"/api/terms-flow/{NCT.lower()}/protocol").json()
    assert p["area"] == "Outside lung cancer" and p["practice_basis"]
    s = cl.get(f"/api/terms-flow/{NCT}/sites").json()
    a, b = s["default_pair"]
    assert cl.get(f"/api/terms-flow/{NCT}/budget", params={"site_id": a}).status_code == 200
    assert cl.get(f"/api/terms-flow/{NCT}/compare", params={"site_a": a, "site_b": b}).status_code == 200
    r = cl.get(f"/api/terms-flow/{NCT}/termsheet.md", params={"site_id": a, "compare_site": b})
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    h = cl.get(f"/api/terms-flow/{NCT}/termsheet.html", params={"site_id": a})
    assert h.status_code == 200 and "<!doctype html>" in h.text
    ov = json.dumps({"SCR:vax_pcv": "routine"})
    bo = cl.get(f"/api/terms-flow/{NCT}/budget", params={"site_id": a, "overrides": ov}).json()
    assert bo["totals"]["n_overrides"] == 1
