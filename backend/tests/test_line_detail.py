"""One term-sheet line, step by step (concord.line_detail): the CMS units, each site's regional adjustments, the
conversion factor, the Medicare rate, then the multiplier and overhead assumptions and the sponsor price, which must
reconcile with Budget. The CT chest checks recompute the Medicare rate straight from the CMS 2026 files."""

import csv
import io
import json
import zipfile

import pytest

from concord import line_detail as ld
from concord import terms
from concord.paths import DATA_DIR, DB_PATH

needs_db = pytest.mark.skipif(not DB_PATH.exists(), reason="data/concord.db not built")
needs_pfs = pytest.mark.skipif(not (DATA_DIR / "ratecard.json").exists(), reason="data/ratecard.json not built")
RVU_ZIP = DATA_DIR / "raw" / "cms" / "rvu26d" / "rvu26d.zip"
needs_zip = pytest.mark.skipif(not RVU_ZIP.exists(), reason="CMS rvu26d.zip not downloaded")
FORBIDDEN = ("time-to-fill", "time to fill", "enrollment rate", "speedup", "faster", "months saved")
CT = "C7D1:ct_chest"  # CT chest 71260 at cycle 7 day 1: research (R4) in both lung protocols


def _site(nct: str, city: str, facility: str = "") -> str:
    for s in terms.sites(nct)["sites"]:
        if s["city"] == city and facility.lower() in s["facility"].lower():
            return s["site_id"]
    raise AssertionError(f"no {facility} site in {city} for {nct}")


def _cms_rate(code: str, state: str, locality: str) -> float:
    """Medicare non-facility amount recomputed from the CMS files themselves (not data/ratecard.json)."""
    z = zipfile.ZipFile(RVU_ZIP)

    def rows(prefix: str) -> list[list[str]]:
        name = next(n for n in z.namelist() if n.startswith(prefix) and n.endswith(".csv"))
        return list(csv.reader(io.StringIO(z.read(name).decode("latin-1"))))

    assert next(n for n in z.namelist() if n.startswith("PPRRVU")) == "PPRRVU2026_Oct_nonQPP.csv"
    r = next(r for r in rows("PPRRVU") if r and r[0] == code and not r[1])  # global service, no modifier
    work, pe_nf, mp, cf = float(r[5]), float(r[6]), float(r[10]), float(r[25])
    g = next(g for g in rows("GPCI") if len(g) >= 7 and g[1] == state and g[2] == locality)
    return round((work * float(g[4]) + pe_nf * float(g[5]) + mp * float(g[6])) * cf, 2)


@needs_db
@needs_pfs
def test_ct_chest_manhattan_breakdown_reproduces_191_25():
    a, b = _site("NCT05800015", "New York", "NYU"), _site("NCT05800015", "Hattiesburg")
    d = ld.line_detail("NCT05800015", CT, a, b)
    assert d["applicable"] and d["code"] == "71260" and d["payer"] == "Sponsor"
    assert [c["units"] for c in d["components"]] == [1.13, 3.77, 0.09]
    assert [c["label"] for c in d["components"]] == ["Doctor's time", "Practice costs (staff, equipment, rent)",
                                                     "Malpractice insurance"]
    assert d["conversion_factor"] == 33.4009
    sa = d["sites"]["a"]
    assert (sa["locality"]["state"], sa["locality"]["code"], sa["locality"]["title"]) == ("NY", "01", "Manhattan")
    assert sa["adjustment"] == {"work": 1.064, "pe": 1.162, "mp": 1.586}
    assert sa["adjusted_units"] == {"work": 1.2023, "pe": 4.3807, "mp": 0.1427}
    assert sa["total_units"] == 5.7258
    assert sa["medicare_rate"] == 191.25  # NY locality 01 Manhattan (not $195.46: that is locality 02)
    # Site B differs only in its regional adjustments
    sb = d["sites"]["b"]
    assert sb["locality"]["code"] == "00" and sb["medicare_rate"] == 148.38
    # sources name the CMS file, year, row and locality
    assert d["units_source"]["label"] == "CMS 2026 Physician Fee Schedule RVU file (rvu26d, October release), row 71260"
    assert sa["adjustment_source"]["label"] == "CMS 2026 GPCI file, locality Manhattan (NY 01)"
    assert d["conversion_factor_source"]["label"] == "CMS CY 2026 conversion factor"
    assert d["cms_lookup"]["url"] == "https://www.cms.gov/medicare/physician-fee-schedule/search"
    assert "non-facility" in d["setting_note"] and "facility fee" in d["setting_note"]
    assert d["same_note"].startswith("Units and dollars per unit are the same at every site")


@needs_db
@needs_pfs
def test_ct_chest_nyc_suburbs_breakdown_reproduces_195_46():
    """$195.46 is NY locality 02 (NYC Suburbs/Long Island), e.g. NCT06627647's Site A in Westbury."""
    a, b = terms.sites("NCT06627647")["default_pair"]
    d = ld.line_detail("NCT06627647", CT, a, b)
    sa = d["sites"]["a"]
    assert sa["site"]["label"].endswith("Westbury, NY")
    assert (sa["locality"]["state"], sa["locality"]["code"]) == ("NY", "02")
    assert sa["adjustment_source"]["label"] == "CMS 2026 GPCI file, locality NYC Suburbs/Long Island (NY 02)"
    assert sa["adjustment"] == {"work": 1.064, "pe": 1.189, "mp": 1.857}
    assert sa["total_units"] == 5.852
    assert sa["medicare_rate"] == 195.46


@needs_zip
def test_ct_chest_rates_straight_from_the_cms_files():
    assert _cms_rate("71260", "NY", "01") == 191.25  # Manhattan
    assert _cms_rate("71260", "NY", "02") == 195.46  # NYC Suburbs/Long Island


@needs_db
@needs_pfs
@pytest.mark.parametrize("mult,overhead", [(1.0, None), (1.5, 0.3)])
def test_sponsor_price_reconciles_with_budget(mult, overhead):
    a, b = _site("NCT05800015", "New York", "NYU"), _site("NCT05800015", "Hattiesburg")
    std = {"overhead": overhead} if overhead is not None else {}
    d = ld.line_detail("NCT05800015", CT, a, b, mult, None, std)
    for k, sid in (("a", a), ("b", b)):
        s = d["sites"][k]
        bud = terms.budget("NCT05800015", sid, mult, None, std)
        line = next(l for v in bud["visits"] for l in v["lines"] if l["node_id"] == CT)
        sp, rc = s["sponsor"], s["reconcile"]
        rate = 0.25 if overhead is None else overhead
        assert sp["overhead_rate"] == rate and sp["multiplier"] == mult
        assert sp["line_price"] == line["amount"] == round(s["medicare_rate"] * mult, 2)
        assert sp["overhead"] == round(sp["line_price"] * rate, 2)
        assert sp["sponsor_price"] == pytest.approx(sp["line_price"] + sp["overhead"], abs=1e-9)
        # the budget totals the table points to are the ones Budget shows, and they add up
        t = bud["totals"]
        assert rc["per_participant"] == t["per_participant"] and rc["adds_up"]
        assert rc["per_participant_research_items"] + rc["per_participant_coordinator"] + \
            rc["per_participant_overhead"] == pytest.approx(rc["per_participant"], abs=0.011)
        assert rc["count"] == 1 and rc["in_research_items"] == sp["line_price"]
        visit = next(v for v in bud["visits"] if v["visit_id"] == "C7D1")
        assert rc["visit_total"] == visit["visit_total"]
        assert rc["visit_overhead"] == pytest.approx(rate * (rc["visit_research_items"] + rc["visit_coordinator"]),
                                                     abs=0.011)
    if mult == 1.0 and overhead is None:
        assert d["sites"]["a"]["sponsor"]["sponsor_price"] == 239.06  # $191.25 + 25% overhead $47.81


@needs_db
@needs_pfs
def test_non_pfs_and_routine_lines():
    a = _site("NCT05800015", "New York", "NYU")
    lab = ld.line_detail("NCT05800015", "SCR:tissue", a)
    assert not lab["applicable"] and lab["reason"] and "components" not in lab and set(lab["sites"]) == {"a"}
    routine = ld.line_detail("NCT05800015", "C3D1:ct_chest", a)  # R3: billed to insurance
    assert routine["applicable"] and routine["payer"] == "Insurance"
    assert routine["sites"]["a"]["sponsor"] is None and routine["sites"]["a"]["medicare_rate"] == 191.25
    with pytest.raises(terms.NotFound):
        ld.line_detail("NCT05800015", "NOPE:x", a)


@needs_db
def test_line_detail_api():
    from fastapi.testclient import TestClient

    from concord.api.main import app

    c = TestClient(app)
    a, b = c.get("/api/terms-flow/NCT05800015/sites").json()["default_pair"]
    r = c.get("/api/terms-flow/NCT05800015/line-detail",
              params={"node_id": CT, "site_a": a, "site_b": b, "multiplier": 1.2,
                      "standard": json.dumps({"overhead": 0.2})})
    assert r.status_code == 200
    d = r.json()
    assert d["sites"]["a"]["sponsor"]["multiplier"] == 1.2 and d["sites"]["a"]["sponsor"]["overhead_rate"] == 0.2
    low = r.text.lower()
    assert not any(w in low for w in FORBIDDEN)
    assert c.get("/api/terms-flow/NCT05800015/line-detail", params={"node_id": "NOPE:x", "site_a": a}).status_code == 404
    assert c.get("/api/terms-flow/NCT05800015/line-detail",
                 params={"node_id": CT, "site_a": a, "multiplier": 9}).status_code == 400
