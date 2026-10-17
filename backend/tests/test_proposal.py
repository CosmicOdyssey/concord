"""Site proposal check and counter-proposal export (concord.proposal, /api/terms-flow/{nct}/proposal-*)."""

import pytest

from concord import proposal, terms
from concord.paths import DATA_DIR, DB_PATH

NCT = "NCT05800015"
needs_data = pytest.mark.skipif(not (DB_PATH.exists() and (DATA_DIR / "ratecard.json").exists()),
                                reason="data/concord.db or data/ratecard.json not built")
FORBIDDEN = ("time-to-fill", "time to fill", "enrollment rate", "speedup", "faster", "months saved")


def _default_site() -> str:
    return terms.sites(NCT)["default_pair"][0]


def _row(res: dict, n: int) -> dict:
    return next(r for r in res["rows"] if r["row"] == n)


# ---------------------------------------------------------------- parsing (no data needed)

@pytest.mark.parametrize("raw,expect", [
    ("1250", (1250.0, False)), ("$1,250.00", (1250.0, False)), (" $ 95 ", (95.0, False)), ("6.50", (6.5, False)),
    ("30%", (30.0, True)), ("USD 40", (40.0, False)), ("$.75", (0.75, False)),
    ("abc", None), ("-5", None), ("(100)", None), ("", None), ("1e3", None), ("$", None),
    ("$15,000", (15000.0, False)), ("1,234,567.89", (1234567.89, False)),
    ("6,50", None), ("1,2345", None), ("12,34,567", None), ("1500,00", None),  # a comma only groups thousands
])
def test_parse_amount(raw, expect):
    assert proposal.parse_amount(raw) == expect


def test_parse_amount_decimal_comma():
    assert proposal.parse_amount("6,50", decimal_comma=True) == (6.5, False)
    assert proposal.parse_amount("$1.234,50", decimal_comma=True) == (1234.5, False)
    assert proposal.parse_amount("30%", decimal_comma=True) == (30.0, True)
    assert proposal.parse_amount("275", decimal_comma=True) == (275.0, False)


def test_semicolon_csv_with_decimal_commas():
    p = proposal.parse_csv("Code;Proposed price (USD)\n85025;6,50\n80053;14,00\n71260;$1.234,50")
    assert p["header"] is True and p["errors"] == []
    assert [(r["item"], r["amount"]) for r in p["rows"]] == [("85025", 6.5), ("80053", 14.0), ("71260", 1234.5)]
    assert all(r["decimal_comma"] for r in p["rows"])
    # a comma file whose first item happens to contain a semicolon stays comma-separated
    p = proposal.parse_csv("Labs; fasting,12\n71260,275\n93000,20")
    assert [(r["item"], r["amount"]) for r in p["rows"]] == [("Labs; fasting", 12.0), ("71260", 275.0), ("93000", 20.0)]


def test_unreadable_first_row_is_an_error_not_a_header():
    for first in ("Study start-up fee,TBD", "IRB fee,N/A", "IRB fee,Fee waived"):
        p = proposal.parse_csv(f"{first}\n71260,275")
        assert p["header"] is False and [r["item"] for r in p["rows"]] == ["71260"]
        assert len(p["errors"]) == 1 and p["errors"][0]["row"] == 1 and "not a number" in p["errors"][0]["error"]
    for head in ("item_or_code,amount", "Item,Site ask", "Description,Price per occurrence", "CPT/HCPCS code,USD",
                 "Service,$", "Code,Amount (USD)"):
        p = proposal.parse_csv(f"{head}\n71260,275")
        assert p["header"] is True and p["errors"] == [], head


def test_parse_messy_csv():
    text = ("﻿# a comment line\n"
            "Item or code , Amount\n"
            "\n"
            "71260, $275.00\n"
            "\"CT abdomen and pelvis with contrast\",\"$1,150.00\"\n"
            "Study start-up fee,$15,000\n"          # unquoted thousands separator
            "Labs, 85025, 12\n"                     # item with a comma, not a thousands separator
            "93000,ninety\n"                        # unreadable amount
            "lonely\n"                              # one column
            "Institutional overhead,30%\n"
            "99213,150,,\n")                        # trailing empty columns
    p = proposal.parse_csv(text)
    assert p["header"] is True
    got = {(r["item"], r["amount"], r["percent"]) for r in p["rows"]}
    assert ("71260", 275.0, False) in got
    assert ("CT abdomen and pelvis with contrast", 1150.0, False) in got
    assert ("Study start-up fee", 15000.0, False) in got
    assert ("Labs, 85025", 12.0, False) in got
    assert ("Institutional overhead", 30.0, True) in got
    assert ("99213", 150.0, False) in got
    assert next(r for r in p["rows"] if r["item"] == "Study start-up fee")["rejoined"] is True
    errs = {e["row"]: e["error"] for e in p["errors"]}
    assert len(errs) == 2 and any("not a number" in v for v in errs.values()) and any("two columns" in v for v in errs.values())
    # row numbers are the line numbers of the pasted text
    assert next(r for r in p["rows"] if r["item"] == "71260")["row"] == 4


def test_parse_semicolon_and_tab_and_limits():
    assert [r["amount"] for r in proposal.parse_csv("71260;275\n93000;20")["rows"]] == [275.0, 20.0]
    assert [r["amount"] for r in proposal.parse_csv("71260\t275\n93000\t20")["rows"]] == [275.0, 20.0]
    with pytest.raises(proposal.ProposalError):
        proposal.parse_csv("   \n")
    with pytest.raises(proposal.ProposalError):
        proposal.parse_csv("x,1\n" * (proposal.MAX_ROWS + 5))


def test_band_validation():
    for lo, hi in ((1.5, 1.0), (0.0, 1.0), (1.0, 9.0), (float("nan"), 1.0)):
        with pytest.raises(proposal.ProposalError):
            proposal._band(lo, hi)  # noqa: SLF001
    assert proposal._band(1, 1.5) == (1.0, 1.5)  # noqa: SLF001


# ---------------------------------------------------------------- matching and flags

@needs_data
def test_matching_by_code_then_label():
    site = _default_site()
    text = ("item,amount\n"
            "71260,200\n"                                   # code
            "ct CHEST with Contrast,200\n"                  # label, case-insensitive
            "99213 Established-patient visit,120\n"         # code inside text
            "Coordinator time and data entry,200\n"         # standard item label
            "Scan upload for blinded central review,100\n"  # protocol label of a standard-priced item
            "IRB fee,3500\n"                                # common name
            "Institutional overhead,30%\n"                  # rate
            "J9271,5000\n"                                  # a code not in the protocol
            "Valet parking,20\n")                           # nothing like it
    res = proposal.check(NCT, site, text)
    assert _row(res, 2)["method"] == "code" and _row(res, 2)["code"] == "71260"
    assert _row(res, 3)["method"] == "label" and _row(res, 3)["code"] == "71260"
    assert "same item as row 2" in _row(res, 3)["notes"]
    assert _row(res, 4)["code"] == "99213"
    for n, iid in ((5, "coordinator"), (6, "image_upload"), (7, "irb"), (8, "overhead")):
        r = _row(res, n)
        assert r["flag"] == "justify" and r["match"] == iid and r["reference_label"] == proposal.REF_LABEL
        assert r["reference"] is not None and r["source"]["title"] == terms.STANDARD_SOURCE
    assert _row(res, 7)["method"] == "common name"
    assert _row(res, 8)["ask"] == pytest.approx(0.30) and _row(res, 8)["reference"] == pytest.approx(0.25)
    for n in (9, 10):
        assert _row(res, n)["flag"] == "unmatched" and _row(res, n)["source"] is None
    assert any("J9271" in x for x in _row(res, 9)["notes"])
    c = res["summary"]["counts"]
    assert c["unmatched"] == 2 and c["justify"] == 4 and sum(c.values()) == res["summary"]["n_rows"] == 9


@needs_data
def test_flags_at_band_edges_and_cms_source():
    site = _default_site()
    b = terms.budget(NCT, site)
    med = next(ln["medicare_amount"] for v in b["visits"] for ln in v["lines"] if ln["code"] == "71260")
    lo, hi = proposal._times(med, 1.0), proposal._times(med, 1.5)  # noqa: SLF001
    text = "\n".join(f"71260,{x:.2f}" for x in (lo, hi, hi + 0.01, lo - 0.01))
    res = proposal.check(NCT, site, text)
    assert [r["flag"] for r in res["rows"]] == ["in_range", "in_range", "above", "below"]
    assert res["rows"][2]["outside_by"] == pytest.approx(0.01) and res["rows"][3]["outside_by"] == pytest.approx(0.01)
    r = res["rows"][0]
    assert (r["range_low"], r["range_high"], r["medicare"]) == (lo, hi, med)
    src = r["source"]
    assert src["schedule"] == "PFS" and src["year"] == 2026 and src["file"] and src["code"] == "71260"
    loc = res["locality"]
    assert loc["name"] in src["locality"] and loc["code"] in src["locality"] and src["formula"]
    # a lab line: national CLFS amount, its own file and year
    lab = proposal.check(NCT, site, "85025,9")["rows"][0]
    assert lab["kind"] == "lab" and lab["source"]["schedule"] == "CLFS" and "national" in lab["source"]["locality"]
    # a narrower band moves the flags; the band is echoed as an assumption
    res2 = proposal.check(NCT, site, f"71260,{hi:.2f}", band_low=1.0, band_high=1.2)
    assert res2["rows"][0]["flag"] == "above"
    assert res2["band"]["label"] == "assumption" and "120%" in res2["band"]["text"]


@needs_data
def test_half_up_rounding_of_range():
    assert proposal._times(107.63, 1.5) == 161.45  # noqa: SLF001  (161.445 -> 161.45, not float 161.44)
    assert proposal._cents(161.445) == 16145  # noqa: SLF001


@needs_data
def test_routine_only_code_is_noted():
    res = proposal.check(NCT, _default_site(), "70553,400")  # brain MRI: routine (R3) at every occurrence
    r = res["rows"][0]
    assert r["coverage"]["sponsor_visits"] == 0 and any("routine care" in n for n in r["notes"])


@needs_data
def test_routine_only_code_response_says_insurance():
    res = proposal.check(NCT, _default_site(), "70553,4000\n71260,4000")
    mri, ct = res["rows"]
    assert mri["flag"] == "above" and "billed to insurance" in proposal.response_text(mri)
    assert "counter at or below" not in proposal.response_text(mri)
    assert ct["coverage"]["sponsor_visits"] > 0 and "counter at or below" in proposal.response_text(ct)
    page = proposal.counter_proposal_html(res, "simple")
    assert "not to the sponsor" in page


@needs_data
def test_overhead_rate_vs_dollars():
    site = _default_site()
    for raw, ask, rate in (("30%", 0.30, True), ("30", 0.30, True), ("0.3", 0.30, True), ("1", 0.01, True),
                           ("$30000", 30000.0, False), ("30000", 30000.0, False), ("\"$30,000\"", 30000.0, False)):
        r = proposal.check(NCT, site, f"Institutional overhead,{raw}")["rows"][0]
        assert r["match"] == "overhead" and r["ask"] == pytest.approx(ask) and r["ask_rate"] is rate, raw
        assert r["reference_rate"] is True and r["reference"] == pytest.approx(0.25)
        assert proposal._ask_text(r) == ("30%" if ask == 0.30 else "1%" if ask == 0.01 else "$30,000.00")  # noqa: SLF001
        if not rate:
            assert any("dollar amount" in n for n in r["notes"])


@needs_data
def test_semicolon_decimal_comma_flags():
    res = proposal.check(NCT, _default_site(), "85025;6,50\n80053;14,00")
    assert [(r["code"], r["ask"]) for r in res["rows"]] == [("85025", 6.5), ("80053", 14.0)]
    assert [r["flag"] for r in res["rows"]] == ["below", "in_range"]
    assert all(any("decimal comma" in n for n in r["notes"]) for r in res["rows"])


@needs_data
def test_percent_on_a_coded_line_is_an_error():
    res = proposal.check(NCT, _default_site(), "71260,150%\n93000,20")
    assert len(res["rows"]) == 1 and res["summary"]["n_errors"] == 1


# ---------------------------------------------------------------- sample

@needs_data
def test_synthetic_sample():
    s = proposal.sample(NCT)
    assert "SYNTHETIC" in s["filename"] and s["synthetic"] is True and "SYNTHETIC" in s["label"]
    assert s["csv"].lstrip().startswith("# SYNTHETIC")
    res = proposal.check(NCT, _default_site(), s["csv"])
    c = res["summary"]["counts"]
    assert res["summary"]["n_errors"] == 0 and res["header"] is True
    assert c["in_range"] >= 2 and c["above"] >= 2 and c["below"] == 2 and c["justify"] >= 4 and c["unmatched"] == 1
    cd = res["summary"]["coded"]
    assert cd["n"] == c["in_range"] + c["above"] + c["below"]
    assert cd["range_low"] <= cd["range_high"] and len(res["summary"]["top_outside"]) == 3
    tops = [t["outside_by"] for t in res["summary"]["top_outside"]]
    assert tops == sorted(tops, reverse=True)
    # the export of the synthetic sample says so, in both modes, next to the site's name
    assert res["synthetic"] is True
    for detail in ("simple", "detailed"):
        page = proposal.counter_proposal_html(res, detail)
        assert "<title>SYNTHETIC: " in page and "<h1>SYNTHETIC: " in page
        assert "SYNTHETIC sample proposal: invented prices" in page and "not market data" in page
    # the same rows without the comment line are not marked synthetic
    plain = "\n".join(ln for ln in s["csv"].splitlines() if not ln.startswith("#"))
    res2 = proposal.check(NCT, _default_site(), plain)
    assert res2["synthetic"] is False and "SYNTHETIC" not in proposal.counter_proposal_html(res2, "detailed")
    with pytest.raises(terms.NotFound):
        proposal.sample("NCT06627647")


# ---------------------------------------------------------------- export

@needs_data
def test_export_escapes_user_text_and_carries_labels():
    evil = "<script>alert('x')</script> & <b>bold</b>"
    text = f"\"{evil}\",100\n71260,10000\n71260,200\n\"<img src=x onerror=alert(1)>\",abc"
    res = proposal.check(NCT, _default_site(), text)
    for detail in ("simple", "detailed"):
        page = proposal.counter_proposal_html(res, detail)
        assert "<script>alert" not in page and "<b>bold</b>" not in page and "<img src=x" not in page
        assert "&lt;script&gt;" in page and "&lt;img src=x onerror=alert(1)&gt;" in page
        assert terms.DISCLAIMER in page and "Illustrative protocol" in page
        assert "Assumption: the justified range" in page and res["locality"]["name"] in page
        assert "CMS PFS 2026" in page
        low = page.lower()
        assert not any(w in low for w in FORBIDDEN)
    simple = proposal.counter_proposal_html(res, "simple")
    detailed = proposal.counter_proposal_html(res, "detailed")
    assert "Within the justified range" not in simple and "Within the justified range" in detailed
    assert simple.count("<tr class='main'>") == 2 and detailed.count("<tr class='main'>") == 3


@needs_data
def test_api_endpoints():
    from fastapi.testclient import TestClient

    from concord.api.main import app

    c = TestClient(app)
    site = _default_site()
    s = c.get(f"/api/terms-flow/{NCT}/proposal-sample")
    assert s.status_code == 200 and "SYNTHETIC" in s.json()["filename"]
    assert c.get("/api/terms-flow/NCT06627647/proposal-sample").status_code == 404
    body = {"site_id": site, "csv": s.json()["csv"]}
    r = c.post(f"/api/terms-flow/{NCT}/proposal-check", json=body)
    assert r.status_code == 200 and r.json()["summary"]["counts"]["unmatched"] == 1
    assert c.post(f"/api/terms-flow/{NCT}/proposal-check", json={**body, "band_low": 2, "band_high": 1}).status_code == 400
    assert c.post(f"/api/terms-flow/{NCT}/proposal-check", json={**body, "csv": ""}).status_code == 400
    assert c.post(f"/api/terms-flow/{NCT}/proposal-check", json={**body, "site_id": "nope"}).status_code == 404
    h = c.post(f"/api/terms-flow/{NCT}/counter-proposal.html", json={**body, "detail": "detailed"})
    assert h.status_code == 200 and h.headers["content-type"].startswith("text/html")
    assert "attachment" in h.headers["content-disposition"] and terms.DISCLAIMER in h.text
    assert "_SYNTHETIC.html" in h.headers["content-disposition"] and "SYNTHETIC sample proposal" in h.text
    plain = "\n".join(ln for ln in body["csv"].splitlines() if not ln.startswith("#"))
    h2 = c.post(f"/api/terms-flow/{NCT}/counter-proposal.html", json={**body, "csv": plain})
    assert h2.status_code == 200 and "SYNTHETIC" not in h2.headers["content-disposition"]
