"""Pre-cleared terms: Medicare-indexed rate card, standard non-procedure schedule,
coverage grid and term sheet (master doc §3, eq. 1).

Every number carries provenance. Physician-fee-schedule codes are priced from the real
CMS RVU file and GPCIs (data/ratecard.json, built by concord.ratecard.cms) and flagged
verified. Lab codes need the CLFS file, which CMS serves behind an AMA license click-through;
until a user loads it, they fall back to approximate placeholders flagged `verified=False`.
Nothing here is a legal FMV determination.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from functools import lru_cache

from concord.compiler.protocol import Protocol
from concord.paths import DATA_DIR

PLACEHOLDER_SOURCE = "Approximate national amount (placeholder); replace with CMS PFS/CLFS file"


@dataclass(frozen=True)
class Rate:
    code: str
    description: str
    amount: float
    schedule: str  # "PFS" | "CLFS"
    source: str = PLACEHOLDER_SOURCE
    verified: bool = False


RATES = {r.code: r for r in [
    Rate("99205", "New patient visit, high complexity", 211.0, "PFS"),
    Rate("99213", "Established patient visit, low complexity", 91.0, "PFS"),
    Rate("99214", "Established patient visit, moderate complexity", 129.0, "PFS"),
    Rate("71260", "CT chest with contrast", 160.0, "PFS"),
    Rate("74177", "CT abdomen and pelvis with contrast", 310.0, "PFS"),
    Rate("70553", "MRI brain without and with contrast", 340.0, "PFS"),
    Rate("93000", "Electrocardiogram, 12-lead, with interpretation", 16.0, "PFS"),
    Rate("88342", "Immunohistochemistry, first stain", 100.0, "PFS"),
    Rate("96413", "Chemotherapy IV infusion, up to 1 hour", 125.0, "PFS"),
    Rate("96417", "Chemotherapy IV infusion, each sequential infusion", 57.0, "PFS"),
    Rate("85025", "Complete blood count with differential", 7.77, "CLFS"),
    Rate("80053", "Comprehensive metabolic panel", 10.56, "CLFS"),
    Rate("84443", "Thyroid stimulating hormone", 16.80, "CLFS"),
    Rate("84702", "hCG, quantitative", 15.0, "CLFS"),
    Rate("36415", "Routine venipuncture", 3.0, "CLFS"),
    Rate("81445", "Targeted genomic sequence analysis, solid tumor, 5–50 genes", 597.0, "CLFS"),
]}

# NYC boroughs map to Medicare localities by county, which CT.gov does not give us.
CITY_ALIAS = {"NEW YORK": "MANHATTAN", "BROOKLYN": "NYC SUBURBS", "BRONX": "NYC SUBURBS",
              "STATEN ISLAND": "NYC SUBURBS", "FLUSHING": "QUEENS", "JAMAICA": "QUEENS", "QUEENS": "QUEENS"}
LOCALITY_NOTE = "Medicare locality matched by city name (county-level match not implemented)"


@lru_cache(maxsize=1)
def _cms() -> dict:
    path = DATA_DIR / "ratecard.json"
    return json.loads(path.read_text()) if path.exists() else {}


def _locality(state: str | None, city: str | None) -> dict | None:
    from concord.ratecard.cms import STATE_ABBR
    pfs = _cms().get("pfs")
    if not pfs or not state:
        return None
    abbr = STATE_ABBR.get(state)
    locs = [l for l in pfs["localities"] if l["state"] == abbr]
    if not locs:
        return None
    if len(locs) == 1:
        return locs[0]
    c = (city or "").upper().strip()
    key = CITY_ALIAS.get(c, c)
    for l in locs:
        if key and key in l["name"]:
            return l
    return next((l for l in locs if l["name"].startswith("REST OF")), locs[0])


def price(code: str, state: str | None = None, city: str | None = None, country: str | None = None,
          loc: dict | None = None) -> dict | None:
    """Medicare amount for one code: CMS PFS (locality-adjusted for U.S. sites) or CLFS (national),
    else the flagged placeholder. None if unknown (never silently zero).

    `loc` (a locality row from ratecard.json) skips the city-name match when the caller has
    already resolved the site's Medicare locality (concord.terms resolves it by county)."""
    cms = _cms()
    pfs = cms.get("pfs", {})
    row = pfs.get("codes", {}).get(code)
    placeholder = RATES.get(code)
    if row and row["national"]:
        if loc is None:
            loc = _locality(state, city) if (country in (None, "United States")) else None
        amt = row["national"]
        if loc:
            amt = round((row["work"] * loc["gpci_work"] + row["pe_nf"] * loc["gpci_pe"] + row["mp"] * loc["gpci_mp"])
                        * pfs["conversion_factor"], 2)
        return {"amount": amt, "national": row["national"], "schedule": "PFS", "verified": True,
                "source": pfs["source"], "locality": loc["name"] if loc else "national",
                "description": placeholder.description if placeholder else code}
    clfs = cms.get("clfs", {}).get("codes", {}).get(code)
    if clfs:
        return {"amount": clfs["national"], "national": clfs["national"], "schedule": "CLFS", "verified": True,
                "source": cms["clfs"]["source"], "locality": "national (CLFS is not geographically adjusted)",
                "description": placeholder.description if placeholder else code}
    if placeholder:
        note = (" (CLFS file not loaded: CMS requires accepting the AMA CPT license to download it)"
                if placeholder.schedule == "CLFS" else "")
        return {"amount": placeholder.amount, "national": placeholder.amount, "schedule": placeholder.schedule,
                "verified": False, "source": PLACEHOLDER_SOURCE + note, "locality": "national",
                "description": placeholder.description}
    return None


@dataclass(frozen=True)
class StandardItem:
    id: str
    label: str
    amount: float
    unit: str  # "per_site" | "per_patient" | "per_visit" | "pct_of_procedures"


# Concord standard non-procedure schedule v0. A proposal to negotiate against, not market data.
STANDARD_SCHEDULE = [
    StandardItem("startup", "Study start-up (regulatory, SIV)", 8000.0, "per_site"),
    StandardItem("irb", "Central IRB reliance fee", 3500.0, "per_site"),
    StandardItem("pharmacy", "Investigational pharmacy setup", 2500.0, "per_site"),
    StandardItem("closeout", "Close-out visit", 2500.0, "per_site"),
    StandardItem("archive", "Record archiving", 1500.0, "per_site"),
    StandardItem("coordinator", "Coordinator time and data entry", 175.0, "per_visit"),
    StandardItem("screen_fail", "Screen failure (per screened, not enrolled; billed as incurred)", 500.0,
                 "per_screen_failure"),
    StandardItem("overhead", "Institutional overhead", 0.25, "pct_of_procedures"),
]
SCHEDULE_SOURCE = "Concord standard schedule v0 (proposal; itemized and negotiable)"

ACTA_TERMS = [
    "Accelerated Clinical Trial Agreement (ACTA) template, unmodified core clauses",
    "Payment on the attached rate card; invoiced quarterly against completed visits",
    "Coverage analysis attached; site bills only items labeled routine to Medicare/insurers",
    "Sponsor pays for all items labeled research; no double billing (NCD 310.1)",
    "Subject injury, publication and IP per ACTA defaults",
]

# Inferred site capabilities. Public data does not list equipment; these are assumptions
# from site type, shown as "inferred" in the term sheet.
BASE_CAPS = {"infusion", "ct", "ecg", "central_lab_shipping", "ip_pharmacy"}
HOSPITAL_CAPS = {"mri", "tissue_handling", "pk_processing", "central_imaging_upload"}


def site_capabilities(facility: str, is_amc: bool) -> tuple[set[str], str]:
    name = (facility or "").lower()
    if is_amc or any(w in name for w in ("hospital", "medical center", "cancer center", "institute", "health")):
        return BASE_CAPS | HOSPITAL_CAPS, "inferred from site type (hospital/academic)"
    return BASE_CAPS | {"central_imaging_upload"}, "inferred from site type (community practice)"


def coverage_grid(protocol: Protocol, state: str | None = None, city: str | None = None,
                  country: str | None = None) -> list[dict]:
    vis = {v.id: v.label for v in protocol.visits}
    out = []
    for n in protocol.nodes:
        r = price(n.code, state, city, country)
        out.append({
            "node": n.id, "visit": vis[n.visit], "procedure": n.procedure, "code": n.code,
            "coverage": n.coverage, "payer": "Sponsor" if n.coverage == "research" else "Medicare / insurer",
            "rationale": n.rationale, "medicare_amount": r["amount"] if r else None,
            "schedule": r["schedule"] if r else None, "locality": r["locality"] if r else None,
            "verified": r["verified"] if r else False, "source": r["source"] if r else None,
        })
    return out


def per_patient_budget(protocol: Protocol, state: str | None, country: str | None, multiplier: float = 1.0,
                       city: str | None = None) -> dict:
    """Equation (1): research-labeled nodes at m x locality-adjusted Medicare, plus standard items."""
    lines, unknown = [], []
    for n in protocol.nodes:
        if n.coverage != "research":
            continue
        r = price(n.code, state, city, country)
        if r is None:
            unknown.append(n.code)  # unknown is never zero: surfaced, not silently dropped
            continue
        lines.append({"node": n.id, "code": n.code, "procedure": n.procedure, "schedule": r["schedule"],
                      "amount": round(r["amount"] * multiplier, 2), "national": r["national"],
                      "source": r["source"], "verified": r["verified"]})
    procedures = sum(l["amount"] for l in lines)
    n_visits = len(protocol.visits)
    items = []
    for it in STANDARD_SCHEDULE:
        if it.unit == "per_visit":
            items.append({"id": it.id, "label": it.label, "amount": it.amount * n_visits, "unit": f"{n_visits} visits"})
        elif it.unit == "pct_of_procedures":
            items.append({"id": it.id, "label": it.label, "amount": round(procedures * it.amount, 2),
                          "unit": f"{int(it.amount * 100)}% of procedures"})
    per_patient = procedures + sum(i["amount"] for i in items)
    per_site = [asdict(i) for i in STANDARD_SCHEDULE if i.unit == "per_site"]
    as_incurred = [asdict(i) for i in STANDARD_SCHEDULE if i.unit == "per_screen_failure"]
    loc = _locality(state, city) if country in (None, "United States") else None
    return {
        "multiplier": multiplier, "locality": loc["name"] if loc else "national",
        "locality_source": LOCALITY_NOTE if loc else "Non-U.S. or unmatched site: national amounts",
        "conversion_factor": _cms().get("pfs", {}).get("conversion_factor"),
        "as_incurred_items": as_incurred,
        "procedure_lines": lines, "procedures_total": round(procedures, 2),
        "per_patient_items": items, "per_patient_total": round(per_patient, 2),
        "per_site_items": per_site, "schedule_source": SCHEDULE_SOURCE, "unpriced_codes": unknown,
    }


def term_sheet(protocol: Protocol, site: dict, expected_patients: float, multiplier: float = 1.0) -> dict:
    caps, cap_src = site_capabilities(site.get("facility", ""), bool(site.get("is_amc")))
    req = protocol.requirements()
    budget = per_patient_budget(protocol, site.get("state"), site.get("country"), multiplier, site.get("city"))
    fixed = sum(i["amount"] for i in budget["per_site_items"] if i["unit"] == "per_site")
    return {
        "protocol": {"id": protocol.id, "title": protocol.title},
        "site": site,
        "capability_check": [{"capability": c, "met": c in caps} for c in req],
        "capabilities_source": cap_src,
        "capability_ok": all(c in caps for c in req),
        "coverage_grid": coverage_grid(protocol, site.get("state"), site.get("city"), site.get("country")),
        "budget": budget,
        "expected_patients": round(expected_patients, 1),
        # Total from the rounded patient count, so the sheet adds up as displayed.
        "expected_site_total": round(fixed + budget["per_patient_total"] * round(expected_patients, 1), 2),
        "agreement": ACTA_TERMS,
        "disclaimer": "Decision support only. Not a legal fair-market-value determination or a coverage determination.",
    }
