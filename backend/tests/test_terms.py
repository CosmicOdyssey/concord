"""Protocol-to-terms flow (concord.terms, concord.api.terms)."""

import json

import pytest

from concord import terms
from concord.paths import DATA_DIR, DB_PATH
from concord.ratecard import medicare

NCTS = ("NCT05800015", "NCT06627647")
needs_db = pytest.mark.skipif(not DB_PATH.exists(), reason="data/concord.db not built")
needs_pfs = pytest.mark.skipif(not (DATA_DIR / "ratecard.json").exists(), reason="data/ratecard.json not built")
FORBIDDEN = ("time-to-fill", "time to fill", "enrollment rate", "speedup", "faster", "months saved")


def _site(nct: str, city: str, facility: str = "") -> str:
    for s in terms.sites(nct)["sites"]:
        if s["city"] == city and facility.lower() in s["facility"].lower():
            return s["site_id"]
    raise AssertionError(f"no {facility} site in {city} for {nct}")


# ---------------------------------------------------------------- protocols (no DB needed)

@pytest.mark.parametrize("nct", NCTS)
def test_protocol_loads_with_rules_and_illustrative_label(nct):
    p = terms.load_protocol(nct)
    assert p["label"] == terms.ILLUSTRATIVE
    assert p["nodes"]
    for n in p["nodes"]:
        assert n["rule"] in terms.RULES and n["reason"]
        assert n["coverage"] == terms.RULES[n["rule"]]["coverage"]
    # every rule is exercised by at least one node in the Regeneron protocol
    if nct == "NCT05800015":
        assert {n["rule"] for n in p["nodes"]} == set(terms.RULES)
    # coded procedures carry our own short labels; non-coded ones are priced from the standard schedule or nothing
    std_ids = {i[0] for i in terms.STANDARD_ITEMS}
    for x in p["procedures"]:
        assert x["pricing"] == "cpt" or x["pricing"] == "none" or x["pricing"].split(":")[1] in std_ids


def test_investigational_and_comparator_rules():
    p = terms.load_protocol("NCT05800015")
    rule = {n["id"]: n["rule"] for n in p["nodes"]}
    assert rule["C1D1:inf_ip"] == "R1"  # fianlimab or placebo
    assert rule["C1D1:inf_cemi"] == "R5"  # approved backbone in every arm
    assert rule["C3D1:ct_chest"] == "R3" and rule["C7D1:ct_chest"] == "R4"  # more frequent than standard care


@pytest.mark.parametrize("nct", NCTS)
def test_r4_labels_only_the_extra_scans(nct):
    """Weeks 13-48: the protocol scans every 6 weeks (weeks 18, 24, 30, 36, 42, 48) and the standard-care
    reference about every 9 weeks (4 scans). Exactly the 2 extra scans are research (R4); the other 4 and
    every scan after week 48 (every 9 weeks, matching the reference) are routine (R3)."""
    p = terms.load_protocol(nct)
    visits = {v["id"]: v for v in p["visits"]}
    rule = {n["id"]: n["rule"] for n in p["nodes"]}
    # occurrences per participant still on study at week 48, by visit
    occ = {"C7D1": 1, "TA6": 4, "TA36": 1}
    for proc in ("ct_chest", "ct_abd"):
        research = sum(k for vid, k in occ.items() if rule[f"{vid}:{proc}"] == "R4")
        routine = sum(k for vid, k in occ.items() if rule[f"{vid}:{proc}"] == "R3")
        assert (research, routine) == (2, 4)
        assert rule[f"TA9:{proc}"] == "R3"
        assert terms.RULES[rule[f"TA9:{proc}"]]["coverage"] == "routine"
    assert "24, 30, 42 and 48" in visits["TA6"]["label"] and "36" in visits["TA36"]["label"]
    assert "TAX" not in visits  # the old single q6w-then-q9w column mixed routine and extra scans


def test_edges_follow_windows():
    pv = terms.protocol_view("NCT05800015")
    e = {(x["src"], x["dst"]): x for x in pv["edges"]}
    assert e[("C1D1", "C2D1")]["nominal_days"] == 21
    assert e[("C1D1", "C2D1")]["window_min_days"] == 18 and e[("C1D1", "C2D1")]["window_max_days"] == 24


def test_unknown_protocol_and_bad_inputs_rejected():
    with pytest.raises(terms.NotFound):
        terms.load_protocol("NCT00000000")
    with pytest.raises(terms.TermsError):
        terms.standard_schedule({"screen_fail": 1})  # computed, never editable
    with pytest.raises(terms.TermsError):
        terms.standard_schedule({"overhead": 2})
    for bad in (float("inf"), float("nan"), -1, 1e9, "50", True):
        with pytest.raises(terms.TermsError):
            terms.standard_schedule({"startup": bad})
    assert terms.standard_schedule({"startup": 9000})["startup"]["amount"] == 9000


# ---------------------------------------------------------------- localities

@needs_pfs
def test_locality_resolved_by_county():
    assert terms.resolve_locality("New York", "New York", "United States")["name"] == "MANHATTAN"
    # The Bronx is not in the Manhattan locality; a city-name match would have said rest of New York.
    assert terms.resolve_locality("New York", "The Bronx", "United States")["name"] == "NYC SUBURBS/LONG ISLAND"
    assert terms.resolve_locality("New York", "Buffalo", "United States")["name"] == "REST OF NEW YORK"
    assert terms.resolve_locality("Virginia", "Fairfax", "United States")["name"] == "DC + MD/VA SUBURBS"
    assert terms.resolve_locality("Mississippi", "Hattiesburg", "United States")["name"] == "MISSISSIPPI"
    assert terms.resolve_locality("Ontario", "Toronto", "Canada") is None


# ---------------------------------------------------------------- budget

@needs_db
@pytest.mark.parametrize("nct", NCTS)
def test_budget_bills_only_research_to_sponsor(nct):
    s = terms.sites(nct)
    assert s["sites"] and all(x["status"] != "WITHDRAWN" for x in s["sites"])
    a, b = s["default_pair"]
    assert a and b and a != b
    bud = terms.budget(nct, a)
    for v in bud["visits"]:
        for l in v["lines"]:
            if l["coverage"] == "routine":
                assert l["payer"] == "Insurance" and l["amount"] is None
            else:
                assert l["payer"] == "Sponsor"
        assert v["visit_total"] == pytest.approx(v["research_subtotal"] + v["coordinator"] + v["overhead"], abs=0.011)
        assert v["research_subtotal"] == pytest.approx(sum(l["amount"] or 0 for l in v["lines"]), abs=0.011)
    t = bud["totals"]
    fixed = [v for v in bud["visits"] if v["kind"] != "repeat"]
    assert t["per_participant"] == pytest.approx(sum(v["visit_total"] for v in fixed), abs=0.011)
    assert t["screen_failure"] == bud["visits"][0]["visit_total"]
    # lab codes are flagged, never silently verified
    for v in bud["visits"]:
        for l in v["lines"]:
            if l["schedule"] == "CLFS" and not bud["clfs_loaded"]:
                assert l["placeholder"] and l["note"] == terms.CLFS_NOTE


@needs_db
@needs_pfs
def test_pfs_line_matches_published_formula_and_medicare_price():
    sid = _site("NCT05800015", "New York", "NYU")
    bud = terms.budget("NCT05800015", sid)
    loc = bud["locality"]
    line = next(l for v in bud["visits"] for l in v["lines"] if l["node_id"] == "C1D1:inf_ip")
    rvu, cf = line["rvu"], bud["conversion_factor"]
    exact = (rvu["work"] * loc["gpci_work"] + rvu["pe"] * loc["gpci_pe"] + rvu["mp"] * loc["gpci_mp"]) * cf
    assert line["medicare_amount"] == round(exact, 2)
    # Manhattan: the shared city-name lookup in medicare.price reaches the same locality and amount
    assert loc["name"] == "MANHATTAN"
    assert line["medicare_amount"] == medicare.price("96417", "New York", "New York", "United States")["amount"]
    assert line["schedule"] == "PFS" and line["verified"]


@needs_db
def test_multiplier_overrides_and_standard_edits():
    sid = _site("NCT05800015", "New York", "NYU")
    base = terms.budget("NCT05800015", sid)
    up = terms.budget("NCT05800015", sid, multiplier=1.5)
    ln = lambda b, nid: next(l for v in b["visits"] for l in v["lines"] if l["node_id"] == nid)  # noqa: E731
    assert ln(up, "SCR:ecg")["amount"] == pytest.approx(round(ln(base, "SCR:ecg")["medicare_amount"] * 1.5, 2))
    assert ln(up, "SCR:tissue")["amount"] == ln(base, "SCR:tissue")["amount"]  # standard items are not multiplied
    ov = terms.budget("NCT05800015", sid, overrides={"C7D1:ct_chest": "routine", "C1D1:inf_cemi": "research"})
    assert ln(ov, "C7D1:ct_chest")["payer"] == "Insurance" and ln(ov, "C1D1:inf_cemi")["payer"] == "Sponsor"
    assert {o["node_id"] for o in ov["overrides"]} == {"C7D1:ct_chest", "C1D1:inf_cemi"}
    assert all("reviewer override" in o["basis"] for o in ov["overrides"])
    # an "override" equal to the rule's label is not an override
    same = terms.budget("NCT05800015", sid, overrides={"C1D1:inf_ip": "research"})
    assert same["overrides"] == []
    ed = terms.budget("NCT05800015", sid, standard={"coordinator": 0, "overhead": 0})
    assert all(v["coordinator"] == 0 and v["overhead"] == 0 for v in ed["visits"])
    with pytest.raises(terms.TermsError):
        terms.budget("NCT05800015", sid, overrides={"NOPE:x": "routine"})
    with pytest.raises(terms.NotFound):
        terms.budget("NCT05800015", "not-a-site")


@needs_db
@needs_pfs
@pytest.mark.parametrize("nct", NCTS)
def test_compare_difference_decomposes_into_gpci(nct):
    a, b = terms.sites(nct)["default_pair"]
    c = terms.compare(nct, a, b)
    assert c["a"]["locality"]["name"] != c["b"]["locality"]["name"]
    sm = c["summary"]
    assert sm["delta_per_participant"] != 0
    parts = sm["from_work"] + sm["from_pe"] + sm["from_mp"] + sm["delta_overhead"] + sm["rounding"]
    assert parts == pytest.approx(sm["delta_per_participant"], abs=0.011)
    assert abs(sm["rounding"]) < 0.25  # cent rounding only
    for r in c["rows"]:
        assert r["delta_unit"] == pytest.approx(r["delta_work"] + r["delta_pe"] + r["delta_mp"] + r["rounding"],
                                                abs=1e-3)
        assert abs(r["rounding"]) <= 0.011
        if not r["rvu"]:
            assert r["delta_unit"] == 0  # labs and standard items do not vary by locality


# ---------------------------------------------------------------- term sheet

@needs_db
def test_termsheet_has_provenance_labels_and_no_forecasts():
    sid = _site("NCT05800015", "New York", "NYU")
    other = _site("NCT05800015", "Hattiesburg")
    ts = terms.termsheet("NCT05800015", sid, 1.0, {"C7D1:ct_chest": "routine"}, {"coordinator": 180}, other)
    md = terms.termsheet_markdown(ts)
    page = terms.termsheet_html(ts)
    for doc in (md, page):
        assert terms.DISCLAIMER in doc and terms.ILLUSTRATIVE in doc
        assert "reviewer override" in doc and "Proposed standard" in doc
        low = doc.lower()
        assert not any(w in low for w in FORBIDDEN)
    for v in ts["budget"]["visits"]:
        for l in v["lines"]:
            if l["payer"] == "Sponsor":
                prov = terms._provenance(l, ts["budget"])  # noqa: SLF001
                assert prov
                if l["schedule"] == "CLFS" and l["placeholder"]:
                    assert "amount from: " in prov and l["source"] in prov  # names where the amount comes from
                if l["schedule"] == "Standard":
                    assert l["standard_label"] in prov and l["standard_item"] not in prov.split(":")[0]
    # standard items by label, never internal ids
    assert "schedule item 'coordinator'" not in md and "Coordinator time and data entry, $180.00" in md
    # section 7 carries both per-line formulas, the GPCI split and the '+' marker for per-occurrence items
    sec7 = md.split("## 7. Site comparison")[1].split("## Sources")[0]
    assert "Formula at A" in sec7 and "Formula at B" in sec7 and "From PE GPCI" in sec7
    assert "x 100% = $" in sec7 and "GPCI difference (B - A)" in sec7
    assert "| 0+ |" in sec7  # CT chest after the C7 override recurs only at week 36; survival contact likewise
    # print page: formulas for both sites under each compare row; tables scroll inside wrappers on a phone
    assert "<tr class='sub'>" in page and "A: (" in page and "B: (" in page and "<div class='tw" in page


@needs_db
def test_api_endpoints():
    from fastapi.testclient import TestClient

    from concord.api.main import app

    c = TestClient(app)
    tr = c.get("/api/terms-flow/trials").json()
    assert [t["nct_id"] for t in tr][0] == "NCT05800015"
    assert all("enrollment" not in t["trial"] for t in tr)
    pv = c.get("/api/terms-flow/NCT05800015/protocol").json()
    assert pv["label"] == terms.ILLUSTRATIVE
    s = c.get("/api/terms-flow/nct05800015/sites").json()
    a, b = s["default_pair"]
    q = {"site_id": a, "multiplier": 1.2, "overrides": json.dumps({"C7D1:ct_chest": "routine"}),
         "standard": json.dumps({"pro": 50})}
    bud = c.get("/api/terms-flow/NCT05800015/budget", params=q)
    assert bud.status_code == 200 and bud.json()["multiplier"] == 1.2
    cmp_ = c.get("/api/terms-flow/NCT05800015/compare", params={"site_a": a, "site_b": b})
    assert cmp_.status_code == 200
    md = c.get("/api/terms-flow/NCT05800015/termsheet.md", params={**q, "compare_site": b})
    assert md.status_code == 200 and "attachment" in md.headers["content-disposition"]
    page = c.get("/api/terms-flow/NCT05800015/termsheet.html", params=q)
    assert page.status_code == 200 and page.text.startswith("<!doctype html>")
    assert c.get("/api/terms-flow/NCT05800015/budget", params={"site_id": a, "overrides": "[1]"}).status_code == 400
    assert c.get("/api/terms-flow/NCT05800015/budget", params={"site_id": "x"}).status_code == 404
    assert c.get("/api/terms-flow/NCT00000001/protocol").status_code == 404
