"""Any trial in Protocol to terms (concord.trial_import): add by NCT ID, registry draft, SoA CSV import.

Offline: the ClinicalTrials.gov response is a saved fixture (tests/fixtures/ctgov_NCT07564414.json, fetched
2026-10-17 from https://clinicaltrials.gov/api/v2/studies/NCT07564414); the cache goes to a temp dir."""

import io
import json
import urllib.error
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from concord import proposal, terms, terms_registry, terms_spread, trial_import
from concord.paths import DATA_DIR

FIX = Path(__file__).parent / "fixtures" / "ctgov_NCT07564414.json"
NCT = "NCT07564414"
needs_pfs = pytest.mark.skipif(not (DATA_DIR / "ratecard.json").exists(), reason="data/ratecard.json not built")
FORBIDDEN = ("time-to-fill", "time to fill", "enrollment rate", "speedup", "faster", "months saved")


@pytest.fixture()
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(terms_registry, "CACHE_DIR", tmp_path / "registry_cache")
    terms.load_protocol.cache_clear()
    terms_registry.snapshot.cache_clear()
    yield tmp_path / "registry_cache"
    terms.load_protocol.cache_clear()
    terms_registry.snapshot.cache_clear()


def _fixture(_nct: str) -> dict:
    return json.loads(FIX.read_text(encoding="utf-8"))


def _no_network(*_a, **_k):
    raise AssertionError("tests must not reach the network")


@pytest.fixture()
def added(cache, monkeypatch):
    monkeypatch.setattr(trial_import, "fetch_study", _fixture)
    monkeypatch.setattr("urllib.request.urlopen", _no_network)
    return trial_import.add_trial(NCT)


# ---------------------------------------------------------------- fetch, cache, errors

def test_unknown_nct_is_a_clear_404(cache, monkeypatch):
    def fake(req, timeout):
        assert timeout == trial_import.FETCH_TIMEOUT
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, io.BytesIO(b""))
    monkeypatch.setattr("urllib.request.urlopen", fake)
    with pytest.raises(terms.NotFound, match="ClinicalTrials.gov has no study NCT00000000"):
        trial_import.add_trial("NCT00000000")
    from concord.api.main import app
    r = TestClient(app).post("/api/terms-flow/add-trial", json={"nct_id": "nct00000000"})
    assert r.status_code == 404 and "no study" in r.json()["detail"]
    r = TestClient(app).post("/api/terms-flow/add-trial", json={"nct_id": "12345"})
    assert r.status_code == 400 and "not an NCT ID" in r.json()["detail"]
    assert not list(cache.glob("*")) if cache.exists() else True  # nothing cached for a failed fetch


def test_network_failure_is_reported(cache, monkeypatch):
    def fake(req, timeout):
        raise urllib.error.URLError("timed out")
    monkeypatch.setattr("urllib.request.urlopen", fake)
    with pytest.raises(terms.TermsError, match="Could not reach ClinicalTrials.gov"):
        trial_import.add_trial("NCT07564414")


def test_add_trial_caches_once_outside_repo(added, cache, monkeypatch):
    assert added["status"] == "fetched"
    for f in (f"{NCT}.json", f"{NCT}.study.json", f"{NCT}.protocol.json"):
        assert (cache / f).exists()
    assert not (terms.PROTOCOL_DIR / f"{NCT}.json").exists()
    assert not (terms_registry.REGISTRY_DIR / f"{NCT}.json").exists()
    # second add: from the cache, no fetch
    monkeypatch.setattr(trial_import, "fetch_study", _no_network)
    assert trial_import.add_trial(NCT)["status"] == "cached"
    snap = terms_registry.snapshot(NCT)
    assert snap["source_url"].endswith(NCT) and snap["fetched"]
    facts = terms._trial_facts(NCT)
    assert facts["n_us_sites"] > 50 and "cached when added by NCT ID" in facts["source"]
    assert NCT in terms.list_protocols()
    cards = terms.trials()
    assert cards[-1]["nct_id"] == NCT and cards[-1]["import"]["source"] == "registry_draft"


def test_authored_trial_is_not_overwritten(cache):
    r = trial_import.add_trial("NCT06541704", fetch=_no_network)
    assert r["status"] == "authored"
    with pytest.raises(terms.TermsError, match="authored schedule"):
        trial_import.upload_soa("NCT06541704", "visit,day,procedure\nScreening,-28,ECG\n")


# ---------------------------------------------------------------- registry draft

def test_timepoints_from_time_frames():
    tp = lambda s: sorted({d for d, _, _ in trial_import.timepoints(s)})  # noqa: E731
    assert tp("From randomisation (week 0) to end of treatment (week 72)") == [1, 505]
    assert tp("At baseline and week 24") == [1, 169]
    assert tp("Weeks 4, 8 and 12") == [29, 57, 85]
    assert tp("Up to approximately 30 weeks") == [211]
    assert tp("Up to 51 months") == [1553]
    assert tp("Baseline and up to approximately 3 years") == [1, 1097]
    assert tp("Up to 30 days after the last dose") == []  # relative anchor: not a study day


@needs_pfs
def test_registry_draft_mapping_is_cited_and_explicit(added):
    p = terms.load_protocol(NCT)
    assert p["label"] == trial_import.DRAFT_LABEL == "Draft from the public record, not the sponsor's protocol"
    assert [v["id"] for v in p["visits"]] == ["SCR", "D1", "W72", "W80"]
    for v in p["visits"]:
        assert v["inferred"].startswith("inferred from the registry: ") and v["inferred"].endswith(
            "- confirm against the protocol")
    procs = {x["id"]: x for x in p["procedures"]}
    assert procs["a1c"]["code"] == "83036" and procs["lipids"]["code"] == "80061"
    assert procs["adm_sc"]["code"] == "96372"  # "administered subcutaneously" (interventions[].description)
    for x in p["procedures"]:
        assert "inferred from the registry: " in x["inferred"] and x["mapping"]
        if x["pricing"] == "cpt":  # only codes in the loaded CMS rate card, each citing where its descriptor is
            assert trial_import._in_ratecard(x["code"]) and "descriptor in the CMS" in x["mapping"]
    assert all(n["rule"] == "RA" and n["coverage"] == "research" for n in p["nodes"])
    for n in p["nodes"]:
        assert "inferred from the registry: " in n["reason"] and "confirm against the protocol" in n["reason"]
    imp = p["import"]
    assert [u["quote"] for u in imp["unmapped"]] == ["Ratio to baseline: Free fatty acids"]
    assert procs["om1"]["pricing"] == "unpriced"
    view = terms.protocol_view(NCT)
    rules = {r["id"]: r for r in view["rules"]}
    assert rules["RA"]["title"] == "Research (assumed until reviewed)" and rules["RA"]["nodes"] == len(p["nodes"])
    assert "RA" not in {r["id"] for r in terms.protocol_view("NCT06541704")["rules"]}


# ---------------------------------------------------------------- SoA CSV

MESSY = (
    "﻿My study schedule;;;;\n"
    "Visit name ; Week ; Assessment ; CPT ; Repeats\n"
    "Screening; -4 ; Office visit, new patient ; $99204 ;\n"
    " ; ; Blood count ; 85025 ;\n"
    "\n"
    "# a comment row\n"
    "Day 1;0;ECG;93000;\n"
    ";;Study drug dispensing;standard:ip_dispense;\n"
    "Dosing visit;W4 ±3;SC injection;96372;12\n"
    "Week 52;52;HbA1c;;\n"
    "Week 52;52;Mystery test;;\n"
    "Week 52;52;Bad code;ABC;\n"
)


def test_soa_csv_parsing_accepts_messy_input():
    r = trial_import.parse_soa_csv(MESSY)
    v = r["visits"]
    assert list(v) == ["screening", "day 1", "dosing visit", "week 52"]
    assert v["screening"]["day"] == -28 and v["day 1"]["day"] == 1
    assert v["dosing visit"]["day"] == 29 and v["dosing visit"]["win"] == 3 and v["dosing visit"]["repeats"] == 12
    assert v["week 52"]["day"] == 365
    items = [(i["visit"], i["procedure"], i["code"]) for i in r["items"]]
    assert ("screening", "Blood count", "85025") in items  # blank visit cell carried down
    assert ("screening", "Office visit, new patient", "99204") in items  # '$' stripped
    assert ("day 1", "Study drug dispensing", "standard:ip_dispense") in items


@needs_pfs
def test_soa_csv_upload_builds_a_priced_schedule(added):
    res = trial_import.upload_soa(NCT, MESSY)
    imp = res["import"]
    assert imp["source"] == "csv" and imp["n_visits"] == 4
    assert any("not a CPT/HCPCS code" in w for w in imp["warnings"])
    p = terms.load_protocol(NCT)
    procs = {x["label"]: x for x in p["procedures"]}
    assert procs["HbA1c"]["code"] == "83036" and "mapped from the procedure name" in procs["HbA1c"]["mapping"]
    assert procs["Mystery test"]["pricing"] == "unpriced"
    assert procs["Study drug dispensing"]["pricing"] == "standard:ip_dispense"
    dose = next(v for v in p["visits"] if v["label"] == "Dosing visit")
    assert dose["kind"] == "repeat" and dose["occurrences"] == 12
    assert p["visits"][0]["kind"] == "screening"
    # back to the registry draft
    assert trial_import.reset_draft(NCT)["import"]["source"] == "registry_draft"


def test_template_parses():
    r = trial_import.parse_soa_csv(trial_import.template_csv())
    assert len(r["visits"]) == 4 and r["visits"]["dosing visit"]["repeats"] == 12


# ---------------------------------------------------------------- end to end

@needs_pfs
def test_end_to_end_budget_for_an_added_trial(added):
    s = terms.sites(NCT)
    resolved = [x for x in s["sites"] if x["locality"]]
    unresolved = [x for x in s["sites"] if not x["locality"]]
    assert resolved and all(x["locality"]["verified"] for x in resolved)
    assert all("not resolved" in x["locality_note"] for x in unresolved)
    a, b = s["default_pair"]
    bud = terms.budget(NCT, a)
    t = bud["totals"]
    assert bud["label"] == trial_import.DRAFT_LABEL and bud["disclaimer"] == terms.DISCLAIMER
    assert t["per_participant"] > 0 and t["n_insurance_lines"] == 0  # everything research until reviewed
    assert t["unpriced_text"] and "Free fatty acids" in t["unpriced_text"]
    assert bud["anchoring"]["shares"] and bud["band"]["label"] == "assumption"
    # a reviewer marks the HbA1c lines routine care: they move to insurance and leave the sponsor total
    ov = {n["id"]: "routine" for n in terms.load_protocol(NCT)["nodes"] if n["procedure"] == "a1c"}
    bud2 = terms.budget(NCT, a, overrides=ov)
    assert bud2["totals"]["per_participant"] < t["per_participant"] and bud2["totals"]["n_overrides"] == len(ov)
    c = terms.compare(NCT, a, b)
    assert c["rows"]
    assert terms_spread.locality_distribution(NCT, a, b)["nct_id"] == NCT
    assert terms_spread.spreads(NCT, a, b, 1.0, 1.5, 0.75, 1.25, {}, {})["geography"]
    chk = proposal.check(NCT, a, "item,amount\nHemoglobin A1c,40\n", 1.0, 1.5, 1.0, {}, {})
    assert chk["rows"][0]["match"] == "83036"
    ts = terms.termsheet(NCT, a, compare_site=b)
    md = terms.termsheet_markdown(ts)
    assert trial_import.DRAFT_LABEL in md and terms.DISCLAIMER in md and "RA (research)" in md
    html = terms.termsheet_html(ts)
    for w in FORBIDDEN:
        assert w not in md.lower() and w not in html.lower()
    from concord.api.main import app
    cl = TestClient(app)
    assert cl.get(f"/api/terms-flow/{NCT}/protocol").json()["import"]["source"] == "registry_draft"
    assert cl.get(f"/api/terms-flow/{NCT}/budget", params={"site_id": a}).status_code == 200
    assert cl.get("/api/terms-flow/soa-template.csv").text.startswith("visit,day,procedure,code,repeats")
    assert cl.get(f"/api/terms-flow/{NCT}/soa.csv").text.startswith("visit,day,procedure,code,repeats")
    assert cl.post(f"/api/terms-flow/{NCT}/soa-csv", json={"csv": MESSY}).json()["import"]["source"] == "csv"


@needs_pfs
def test_sienna_round_trip_through_the_soa_csv(cache, monkeypatch, tmp_path):
    """SIENNA's authored schedule, exported to the template and re-imported (authored file hidden), with the
    authored routine items marked routine by reviewer overrides, prices the same at every checked site."""
    sienna = "NCT06541704"
    sites = terms.sites(sienna)["default_pair"]
    want = {s: terms.budget(sienna, s)["totals"] for s in sites}
    authored = terms.load_protocol(sienna)
    av = {v["id"]: v["label"] for v in authored["visits"]}
    ap = {x["id"]: x["label"] for x in authored["procedures"]}
    routine = {(av[n["visit"]], ap[n["procedure"]]) for n in authored["nodes"] if n["coverage"] == "routine"}
    text = trial_import.export_csv(sienna)
    empty = tmp_path / "no_authored"
    empty.mkdir()
    monkeypatch.setattr(terms, "PROTOCOL_DIR", empty)
    terms.load_protocol.cache_clear()
    trial_import.upload_soa(sienna, text)
    p = terms.load_protocol(sienna)
    assert p["import"]["source"] == "csv" and not p["import"]["warnings"]
    nv = {v["id"]: v["label"] for v in p["visits"]}
    np_ = {x["id"]: x["label"] for x in p["procedures"]}
    ov = {n["id"]: "routine" for n in p["nodes"] if (nv[n["visit"]], np_[n["procedure"]]) in routine}
    assert len(ov) == len(routine) and len(p["nodes"]) == len(authored["nodes"])
    for s in sites:
        got = terms.budget(sienna, s, overrides=ov)["totals"]
        for k in ("per_participant", "per_participant_research_items", "per_participant_insurance_medicare",
                  "screen_failure", "n_unpriced_sponsor_lines"):
            assert got[k] == want[s][k], (s, k)
