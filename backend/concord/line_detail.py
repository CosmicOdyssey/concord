"""Step-by-step price of one physician-fee-schedule line, at Site A and (optionally) Site B.

For a term-sheet line priced from the CMS Physician Fee Schedule (PFS), this lays out every step of the price:

    units for this code (work, practice expense non-facility, malpractice RVUs; CMS RVU file, code row)
      x regional adjustment (work, PE, MP GPCIs; CMS GPCI file, the site's locality)
      = adjusted units, summed to total units
      x Medicare dollars per unit (CMS CY 2026 conversion factor, same RVU file)
      = Medicare rate (rounded to the cent, as CMS rounds)
      x multiplier (an assumption the user sets; the budget's "% of Medicare")
      + overhead (an assumption the user sets; the budget's overhead rate)
      = sponsor price for this line

and shows how the line reconciles with the per-participant total in Budget. Every number comes from
concord.terms.budget() (which prices from data/ratecard.json, built from the CMS files by concord.ratecard.cms),
so the table and the budget can never disagree. No forecasting; decision support, not a fair-market-value opinion.
"""

from __future__ import annotations

import re
import zipfile
from functools import lru_cache

from concord import terms
from concord.paths import DATA_DIR
from concord.ratecard import medicare

# The CMS Physician Fee Schedule Look-Up Tool ("Search the Physician Fee Schedule"), reached from the
# "Begin Search" button on https://www.cms.gov/medicare/physician-fee-schedule/search/overview (checked 2026-10-17).
CMS_LOOKUP_URL = "https://www.cms.gov/medicare/physician-fee-schedule/search"
CMS_LOOKUP_LABEL = "CMS Physician Fee Schedule Look-Up Tool"

SAME_NOTE = "Units and dollars per unit are the same at every site; only the regional adjustments differ."
SETTING_NOTE = ("Uses Medicare's office-setting (non-facility) rate; hospital-based sites may bill a separate facility "
                "fee, which is not included.")
ROUNDING_NOTE = ("Adjusted units are shown to 4 decimals; the Medicare rate is computed from the unrounded products and "
                 "rounded to the cent once. The overhead shown is this line's share, rounded to the cent; Budget "
                 "applies the overhead rate to each visit's research items and coordinator time.")

# Plain labels in the UI; the technical terms go in tooltips.
COMPONENTS = [
    ("work", "Doctor's time",
     "Work RVU (relative value unit for physician work) x work GPCI (geographic practice cost index; CMS's 2026 "
     "work GPCI column carries a 1.0 floor)"),
    ("pe", "Practice costs (staff, equipment, rent)",
     "Non-facility practice expense RVU x practice expense GPCI. Non-facility: the office-setting value, used when "
     "the service is billed outside a hospital"),
    ("mp", "Malpractice insurance", "Malpractice (professional liability) RVU x malpractice GPCI"),
]
GLOSSARY = {
    "rvu": "RVU (relative value unit): CMS's measure of the resources a service uses. Each code has three: physician "
           "work, practice expense and malpractice.",
    "gpci": "GPCI (geographic practice cost index): CMS's adjustment of each RVU for local costs in a Medicare "
            "payment locality.",
    "nonqpp": "nonQPP: the RVU file and conversion factor for clinicians who are not qualifying participants in an "
              "advanced alternative payment model (most clinicians). Qualifying participants have a slightly "
              "higher 2026 conversion factor.",
    "non_facility": "Non-facility: Medicare's office-setting rate, which includes the practice's own costs. A "
                    "hospital outpatient department bills a separate facility fee and the physician is paid the "
                    "lower facility rate.",
}
_UPPER = {"NYC", "DC", "MD/VA", "II", "III"}
_LOWER = {"OF", "AND", "THE"}


def _title(name: str) -> str:
    """'NYC SUBURBS/LONG ISLAND' -> 'NYC Suburbs/Long Island' (CMS writes locality names in capitals)."""
    def word(w: str, first: bool) -> str:
        if w in _UPPER:
            return w
        if not first and w in _LOWER:
            return w.lower()
        return "/".join(p[:1] + p[1:].lower() if p not in _UPPER else p for p in w.split("/"))
    return " ".join(word(w, i == 0) for i, w in enumerate(name.split()))


@lru_cache(maxsize=1)
def _files() -> dict:
    """Year, release and file names of the loaded CMS PFS files, read from the ratecard's source line and, when the
    CMS zip is in data/raw/cms, from the zip itself (the RVU loader reads the first PPRRVU csv in it)."""
    src = medicare._cms().get("pfs", {}).get("source", "")  # noqa: SLF001 - same package
    m = re.search(r"(\d{4}) National Physician Fee Schedule Relative Value File (\w+) Release", src)
    year, release = (m.group(1), m.group(2)) if m else (None, None)
    zname = src.rsplit(", ", 1)[-1] if src.endswith(".zip") else None
    rvu_csv, gpci_csv = None, None
    if zname:
        z = DATA_DIR / "raw" / "cms" / zname.removesuffix(".zip") / zname
        if z.exists():
            names = zipfile.ZipFile(z).namelist()
            rvu_csv = next((n for n in names if n.startswith("PPRRVU") and n.endswith(".csv")), None)
            gpci_csv = next((n for n in names if n.startswith("GPCI") and n.endswith(".csv")), None)
    return {"year": year, "release": release, "zip": zname, "rvu_csv": rvu_csv, "gpci_csv": gpci_csv,
            "source": src}


def _rvu_source(code: str) -> dict:
    f = _files()
    stem = (f["zip"] or "").removesuffix(".zip")
    label = (f"CMS {f['year']} Physician Fee Schedule RVU file ({stem}, {f['release']} release), row {code}"
             if f["year"] else f"CMS Physician Fee Schedule RVU file, row {code}")
    detail = (f"{f['rvu_csv'] or 'PPRRVU file (nonQPP)'} in {f['zip']}: HCPCS {code}, no modifier (the global "
              "service), columns WORK RVU, NON-FAC PE RVU and MP RVU") if f["zip"] else label
    return {"label": label, "detail": detail, "file": f["rvu_csv"], "zip": f["zip"], "row": code}


def _cf_source(code: str) -> dict:
    f = _files()
    label = f"CMS CY {f['year']} conversion factor" if f["year"] else "CMS conversion factor"
    detail = (f"CONV FACTOR column of the same RVU file ({f['rvu_csv'] or 'nonQPP'}, row {code}); the nonQPP "
              "conversion factor")
    return {"label": label, "detail": detail}


def _gpci_source(loc: dict | None) -> dict:
    f = _files()
    if loc is None:
        return {"label": "No Medicare locality resolved for this site: national amounts (adjustments of 1.000), "
                         "an assumption", "detail": None, "assumption": True}
    where = f"locality {_title(loc['name'])} ({loc['state']} {loc['code']})"
    label = f"CMS {f['year']} GPCI file, {where}" if f["year"] else f"CMS GPCI file, {where}"
    detail = (f"{f['gpci_csv'] or 'GPCI file'} in {f['zip']}: state {loc['state']}, locality number {loc['code']}, "
              f"{loc['name']}; how the site was matched: {loc['method']}") if f["zip"] else label
    return {"label": label, "detail": detail, "assumption": False}


def _visit_count(v: dict) -> tuple[int, str]:
    """How many times this visit counts in the per-participant total, and how to say it."""
    if v["kind"] != "repeat":
        return 1, "once per participant"
    if v.get("occurrences"):
        return v["occurrences"], f"{v['occurrences']} times per participant ({v['repeat']})"
    return 0, f"per occurrence only ({v['repeat']}), outside the per-participant total"


def _side(bud: dict, node_id: str, rvu: dict | None, cf: float | None) -> dict:
    visit = next((v for v in bud["visits"] for l in v["lines"] if l["node_id"] == node_id), None)
    if visit is None:
        raise terms.NotFound(f"{node_id} is not a line of this protocol")
    line = next(l for l in visit["lines"] if l["node_id"] == node_id)
    loc = bud["locality"]
    g = {"work": loc["gpci_work"], "pe": loc["gpci_pe"], "mp": loc["gpci_mp"]} if loc else {"work": 1.0, "pe": 1.0,
                                                                                               "mp": 1.0}
    rate = next(i["amount"] for i in bud["standard_schedule"] if i["id"] == "overhead")
    out: dict = {
        "site": {"site_id": bud["site"]["site_id"], "label": bud["site"]["label"]},
        "locality": ({"state": loc["state"], "code": loc["code"], "name": loc["name"], "title": _title(loc["name"]),
                      "method": loc["method"], "verified": loc["verified"]} if loc else None),
        "adjustment_source": _gpci_source(loc),
        "adjustment": g, "line": line, "visit": visit,
    }
    if rvu and cf:
        adjusted = {k: rvu[k] * g[k] for k in ("work", "pe", "mp")}
        total = sum(adjusted.values())
        exact = total * cf
        out.update({"adjusted_units": {k: round(v, 4) for k, v in adjusted.items()}, "total_units": round(total, 4),
                    "medicare_exact": round(exact, 4), "medicare_rate": line["medicare_amount"]})
    sponsor = line["payer"] == "Sponsor" and line["unit_amount"] is not None
    n, how = _visit_count(visit)
    t = bud["totals"]
    out["sponsor"] = None
    if sponsor:
        price = line["unit_amount"]
        over = terms._r2(price * rate)  # noqa: SLF001 - same package
        out["sponsor"] = {
            "multiplier": line["multiplier"], "line_price": price, "overhead_rate": rate, "overhead": over,
            "sponsor_price": terms._r2(price + over),  # noqa: SLF001
        }
    out["reconcile"] = {
        "visit_label": visit["label"], "count": n, "count_text": how,
        "visit_research_items": visit["research_subtotal"], "visit_coordinator": visit["coordinator"],
        "visit_overhead": visit["overhead"], "visit_total": visit["visit_total"],
        "in_research_items": terms._r2(line["amount"] * n) if sponsor else 0.0,  # noqa: SLF001
        "in_overhead": terms._r2(out["sponsor"]["overhead"] * n) if sponsor else 0.0,  # noqa: SLF001
        "per_participant_research_items": t["per_participant_research_items"],
        "per_participant_coordinator": t["per_participant_coordinator"],
        "per_participant_overhead": t["per_participant_overhead"],
        "per_participant": t["per_participant"],
        "adds_up": abs(t["per_participant_research_items"] + t["per_participant_coordinator"]
                       + t["per_participant_overhead"] - t["per_participant"]) < 0.015,
        "scope": t["per_participant_scope"],
    }
    del out["line"], out["visit"]
    return out


def line_detail(nct: str, node_id: str, site_a: str, site_b: str | None = None, multiplier: float = 1.0,
                overrides: dict[str, str] | None = None, standard: dict[str, float] | None = None) -> dict:
    """The step-by-step price of one term-sheet line (a protocol node) at Site A and, if given, Site B, with the
    same multiplier, coverage labels and standard-schedule edits as the budget."""
    sides = [("a", site_a)] + ([("b", site_b)] if site_b and site_b != site_a else [])
    buds = {k: terms.budget(nct, sid, multiplier, overrides, standard) for k, sid in sides}
    A = buds["a"]
    line = next((l for v in A["visits"] for l in v["lines"] if l["node_id"] == node_id), None)
    if line is None:
        raise terms.NotFound(f"{node_id} is not a line of {nct}")
    pfs = line["schedule"] == "PFS" and bool(line["rvu"]) and not line["placeholder"]
    rvu = line["rvu"] if pfs else None
    cf = A["conversion_factor"] if pfs else None
    out = {
        "nct_id": nct, "node_id": node_id, "visit_id": line["visit_id"], "procedure_id": line["procedure_id"],
        "label": line["label"], "code": line["code"], "payer": line["payer"], "coverage": line["coverage"],
        "override": line["override"], "rule": line["rule"], "schedule": line["schedule"],
        "applicable": pfs,
        "reason": None if pfs else "Only physician-fee-schedule lines are built from units and regional "
                                   "adjustments; this line is priced " + (
                                       "from the national lab fee schedule" if line["schedule"] == "CLFS" else
                                       "from the proposed standard schedule" if line["schedule"] == "Standard" else
                                       "without a published amount"),
        "multiplier": multiplier, "disclaimer": terms.DISCLAIMER, "label_tag": A["label"],
    }
    if pfs:
        out.update({
            "components": [{"id": k, "label": lab, "term": term, "units": rvu[k]} for k, lab, term in COMPONENTS],
            "units_source": _rvu_source(line["code"]),
            "conversion_factor": cf, "conversion_factor_source": _cf_source(line["code"]),
            "same_note": SAME_NOTE, "setting_note": SETTING_NOTE, "rounding_note": ROUNDING_NOTE,
            "glossary": GLOSSARY, "cms_lookup": {"url": CMS_LOOKUP_URL, "label": CMS_LOOKUP_LABEL},
            "pfs_source": A["pfs_source"],
        })
    out["sites"] = {k: _side(b, node_id, rvu, cf) for k, b in buds.items()}
    return out
