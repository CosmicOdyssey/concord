"""Locality distribution and spread comparison (concord.terms_spread, P2.5 and P2.6)."""

import json

import pytest

from concord import terms, terms_spread
from concord.paths import DATA_DIR, DB_PATH
from concord.ratecard import medicare

NCTS = ("NCT05800015", "NCT06627647")
needs_db = pytest.mark.skipif(not DB_PATH.exists(), reason="data/concord.db not built")
needs_pfs = pytest.mark.skipif(not (DATA_DIR / "ratecard.json").exists(), reason="data/ratecard.json not built")
FORBIDDEN = ("time-to-fill", "time to fill", "enrollment rate", "speedup", "faster", "months saved")


# ---------------------------------------------------------------- pure math (no data needed)

def test_percentile_rank_mid_rank():
    vals = [1.0, 2.0, 3.0, 4.0]
    assert terms_spread.percentile_rank(1.0, vals) == 12.5  # (0 below + 0.5 x 1 same) / 4
    assert terms_spread.percentile_rank(4.0, vals) == 87.5
    assert terms_spread.percentile_rank(2.5, vals) == 50.0  # not in the list: 2 below, none the same
    assert terms_spread.percentile_rank(2.0, [2.0, 2.0, 2.0, 5.0]) == 37.5  # ties count half
    with pytest.raises(ValueError):
        terms_spread.percentile_rank(1.0, [])


def test_quantile_linear_interpolation():
    q = terms_spread._quantile  # noqa: SLF001
    vals = [10.0, 20.0, 30.0, 40.0, 50.0]
    assert q(vals, 0.5) == 30.0
    assert q(vals, 0.1) == pytest.approx(14.0)  # position 0.4 between 10 and 20
    assert q(vals, 0.9) == pytest.approx(46.0)
    assert q(vals, 0.0) == 10.0 and q(vals, 1.0) == 50.0
    assert q([7.0], 0.9) == 7.0


# ---------------------------------------------------------------- locality distribution

@needs_db
@needs_pfs
@pytest.mark.parametrize("nct", NCTS)
def test_every_locality_priced(nct):
    d = terms_spread.locality_distribution(nct)
    locs = medicare._cms()["pfs"]["localities"]  # noqa: SLF001
    assert len(d["localities"]) == len(locs) > 100
    keys = {r["key"] for r in d["localities"]}
    assert keys == {f"{l['state']}-{l['locality']}" for l in locs}
    for r in d["localities"]:
        assert r["total"] > 0 and r["pfs"] > 0
        assert r["total"] == pytest.approx(r["pfs"] + r["lab"], abs=0.006)
        assert r["lab"] == d["lab_constant"]  # CLFS is national: the same constant everywhere
        assert 0 < r["percentile"] <= 100
    st = d["stats"]
    totals = sorted(r["total"] for r in d["localities"])
    assert st["n"] == len(totals)
    assert st["min"] == totals[0] and st["max"] == totals[-1]
    assert st["min"] <= st["p10"] <= st["median"] <= st["p90"] <= st["max"]
    assert d["unpriced_codes"] == []
    assert d["multiplier"] == 1.0
    assert "GPCI" in d["sources"]["gpci"]


@needs_db
@needs_pfs
def test_locality_matches_hand_formula():
    """One locality priced by hand from RVUs, GPCIs and the conversion factor, line by line, cent rounding."""
    nct = "NCT05800015"
    d = terms_spread.locality_distribution(nct)
    cms = medicare._cms()  # noqa: SLF001
    cf = cms["pfs"]["conversion_factor"]
    row = max(d["localities"], key=lambda r: r["total"])
    lines, _ = terms_spread._proc_lines(nct, None)  # noqa: SLF001
    pfs = lab = 0.0
    for l in lines:
        c = cms["pfs"]["codes"].get(l["code"])
        if c and c["national"]:
            pfs += round((c["work"] * row["gpci_work"] + c["pe_nf"] * row["gpci_pe"] + c["mp"] * row["gpci_mp"]) * cf, 2)
        else:
            lab += cms["clfs"]["codes"][l["code"]]["national"]
    assert row["pfs"] == pytest.approx(pfs, abs=0.006)
    assert row["lab"] == pytest.approx(lab, abs=0.006)


@needs_db
@needs_pfs
@pytest.mark.parametrize("nct", NCTS)
def test_site_total_equals_budget_procedure_total(nct):
    a, b = terms.sites(nct)["default_pair"]
    d = terms_spread.locality_distribution(nct, a, b)
    assert len(d["sites"]) == 2
    for s, sid in zip(d["sites"], (a, b)):
        bud = terms.budget(nct, sid, 1.0)
        proc = round(sum(l["amount"] for v in bud["visits"] if v["kind"] != "repeat" for l in v["lines"]
                         if l["payer"] == "Sponsor" and l["schedule"] in ("PFS", "CLFS") and l["amount"] is not None), 2)
        assert s["total"] == pytest.approx(proc, abs=0.005)
        assert s["budget_procedure_total"] == pytest.approx(proc, abs=0.005)
        row = next(r for r in d["localities"] if r["key"] == s["key"])
        assert row["total"] == s["total"]
        totals = [r["total"] for r in d["localities"]]
        assert s["percentile"] == pytest.approx(terms_spread.percentile_rank(s["total"], totals), abs=0.05)
        assert s["n_below"] == sum(1 for t in totals if t < s["total"] - 0.005)


@needs_db
@needs_pfs
def test_overrides_flow_through():
    """Turning a research PFS line to routine lowers every locality's total."""
    nct = "NCT05800015"
    p = terms.load_protocol(nct)
    procs = {x["id"]: x for x in p["procedures"]}
    node = next(n for n in p["nodes"] if n["coverage"] == "research" and procs[n["procedure"]].get("code") == "93000"
                and n["visit"] == "SCR")
    base = terms_spread.locality_distribution(nct)
    ov = terms_spread.locality_distribution(nct, overrides={node["id"]: "routine"})
    for r0, r1 in zip(base["localities"], ov["localities"]):
        assert r1["total"] < r0["total"]
    with pytest.raises(terms.TermsError):
        terms_spread.locality_distribution(nct, overrides={"nope": "routine"})


# ---------------------------------------------------------------- spreads

@needs_db
@needs_pfs
def test_spreads_match_inputs():
    nct = "NCT05800015"
    a, b = terms.sites(nct)["default_pair"]
    d = terms_spread.locality_distribution(nct, a, b)
    sp = terms_spread.spreads(nct, a, b, 1.0, 1.5, 0.75, 1.25)
    g = sp["geography"]
    assert (g["low"], g["high"], g["p10"], g["p90"]) == (d["stats"]["min"], d["stats"]["max"], d["stats"]["p10"],
                                                         d["stats"]["p90"])
    assert g["width"] == pytest.approx(g["high"] - g["low"], abs=0.006)
    # (b): at 100% the band's floor is the site's own locality total; at 150% each line is 1.5x, cent-rounded
    for m, s in zip(sp["multiplier"], d["sites"]):
        assert m["low"] == m["at_100"] == s["total"]
        assert m["high"] == pytest.approx(1.5 * s["total"], abs=0.01 * (d["n_pfs_lines"] + d["n_lab_lines"]))
        bud = terms.budget(nct, m["site_id"], 1.5)
        proc = sum(l["amount"] for v in bud["visits"] if v["kind"] != "repeat" for l in v["lines"]
                   if l["payer"] == "Sponsor" and l["schedule"] in ("PFS", "CLFS") and l["amount"] is not None)
        assert m["high"] == pytest.approx(proc, abs=0.005)
    # (c): coordinator time plus standard-priced research lines, as the budget computes them, x the band
    f = sp["fees"]
    bud = terms.budget(nct, a, 1.0)
    std_lines = sum(l["amount"] for v in bud["visits"] if v["kind"] != "repeat" for l in v["lines"]
                    if l["payer"] == "Sponsor" and l["schedule"] == "Standard" and l["amount"] is not None)
    assert f["base"] == pytest.approx(bud["totals"]["per_participant_coordinator"] + std_lines, abs=0.005)
    assert f["low"] == pytest.approx(0.75 * f["base"], abs=0.005)
    assert f["high"] == pytest.approx(1.25 * f["base"], abs=0.005)
    assert sum(i["amount"] for i in f["items"]) == pytest.approx(f["base"], abs=0.005)
    assert "no public benchmark" in f["assumption"]
    assert "Assumption" in sp["multiplier"][0]["assumption"]


@needs_db
@needs_pfs
def test_spreads_follow_user_bands_and_edits():
    nct = "NCT05800015"
    a, _ = terms.sites(nct)["default_pair"]
    sp = terms_spread.spreads(nct, a, None, 0.8, 2.0, 0.5, 1.0, standard={"coordinator": 200.0})
    m = sp["multiplier"][0]
    assert m["low"] < m["at_100"] < m["high"]
    assert len(sp["multiplier"]) == 1
    f = sp["fees"]
    coord = next(i for i in f["items"] if i["id"] == "coordinator")
    assert coord["unit_amount"] == 200.0 and coord["edited"] and f["edited"]
    assert f["high"] == f["base"] and f["low"] == pytest.approx(0.5 * f["base"], abs=0.005)
    for bad in ((1.5, 1.0, 0.75, 1.25), (0.0, 1.0, 0.75, 1.25), (1.0, 1.5, 1.3, 1.2), (1.0, 6.0, 0.75, 1.25)):
        with pytest.raises(terms.TermsError):
            terms_spread.spreads(nct, a, None, *bad)


@needs_db
@needs_pfs
def test_api_routes_and_wording():
    from fastapi.testclient import TestClient

    from concord.api.main import app

    c = TestClient(app)
    nct = "NCT05800015"
    a, b = terms.sites(nct)["default_pair"]
    r = c.get(f"/api/terms-flow/{nct}/locality-distribution", params={"site_a": a, "site_b": b})
    assert r.status_code == 200
    body = r.json()
    assert len(body["localities"]) > 100 and len(body["sites"]) == 2
    r2 = c.get(f"/api/terms-flow/{nct}/spreads", params={"site_a": a, "site_b": b, "mult_lo": 1, "mult_hi": 1.5,
                                                         "fee_lo": 0.75, "fee_hi": 1.25})
    assert r2.status_code == 200
    assert c.get(f"/api/terms-flow/{nct}/spreads", params={"site_a": a, "mult_lo": 2, "mult_hi": 1}).status_code == 400
    assert c.get(f"/api/terms-flow/{nct}/spreads", params={"site_a": "nope"}).status_code == 404
    assert c.get(f"/api/terms-flow/{nct}/locality-distribution", params={"overrides": "[1]"}).status_code == 400
    text = (json.dumps(body) + json.dumps(r2.json())).lower()
    for w in FORBIDDEN:
        assert w not in text
    assert body["disclaimer"] == terms.DISCLAIMER


# ---------------------------------------------------------------- line buckets and source labels (no data needed)

def test_lines_bucketed_by_schedule(monkeypatch):
    """A line without RVUs is lab only when its schedule is CLFS; an unadjusted PFS placeholder is its own bucket."""
    fake = {
        "11111": {"amount": 100.0, "rvu": {"work": 1.0}, "schedule_label": "PFS", "placeholder": False},
        "22222": {"amount": 10.0, "schedule_label": "CLFS", "placeholder": False},
        "33333": {"amount": 5.0, "schedule_label": "CLFS", "placeholder": True},
        "44444": {"amount": 40.0, "schedule_label": "PFS", "placeholder": True},
    }
    monkeypatch.setattr(terms, "_price_code", lambda code, loc: dict(fake[code]))
    lines = [{"code": c} for c in ("11111", "22222", "33333", "44444", "44444")]
    s = terms_spread._price_lines(lines, None)  # noqa: SLF001
    assert (s["pfs"], s["lab"], s["unadjusted"], s["total"]) == (100.0, 15.0, 80.0, 195.0)
    assert (s["n_pfs"], s["n_lab"], s["n_placeholder"], s["n_unadjusted"]) == (1, 2, 1, 2)


def test_gpci_label_follows_loaded_release(monkeypatch):
    def cms_with(src):
        monkeypatch.setattr(medicare, "_cms", lambda: {"pfs": {"source": src}})

    cms_with("CMS PFS 2027 National Physician Fee Schedule Relative Value File January Release, rvu27a.zip")
    assert terms_spread._gpci_source() == ("CMS RVU27A GPCI2027 table (Addendum E, CY 2027 GPCIs) in "  # noqa: SLF001
                                           "rvu27a.zip")
    assert terms_spread._gpci_short() == "CMS CY 2027 GPCI table"  # noqa: SLF001
    cms_with("some other file, pfs.zip")
    assert terms_spread._gpci_source() == "CMS GPCI table (Addendum E) in pfs.zip"  # noqa: SLF001
    assert terms_spread._gpci_short() == "CMS GPCI table"  # noqa: SLF001


@needs_pfs
def test_gpci_label_today():
    assert terms_spread._gpci_source().startswith("CMS RVU26D GPCI2026 table (Addendum E, CY 2026 GPCIs)")  # noqa: SLF001
    assert terms_spread._gpci_short() == "CMS CY 2026 GPCI table"  # noqa: SLF001
