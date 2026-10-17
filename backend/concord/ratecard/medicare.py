"""Pre-cleared terms: Medicare-indexed rate card, standard non-procedure schedule,
coverage grid and term sheet (master doc §3, eq. 1).

Every number carries provenance. Procedure amounts below are APPROXIMATE national
figures used as placeholders until the CMS Physician Fee Schedule (RVU + GPCI)
and Clinical Lab Fee Schedule files are loaded; they are flagged `verified=False`
and the UI must show that. Nothing here is a legal FMV determination.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from concord.compiler.protocol import Protocol

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

# Placeholder geographic adjustment by state until GPCI files are loaded (1.0 = national).
LOCALITY = {"New York": 1.08, "California": 1.10, "Massachusetts": 1.06, "New Jersey": 1.07, "Connecticut": 1.05,
            "Maryland": 1.05, "District of Columbia": 1.07, "Washington": 1.04, "Illinois": 1.02}
LOCALITY_SOURCE = "Placeholder state-level factor; replace with CMS GPCI by Medicare locality"


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
    StandardItem("screen_fail", "Screen failure (per screened, not enrolled)", 500.0, "per_patient"),
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


def locality_factor(state: str | None, country: str | None) -> tuple[float, str]:
    if country and country != "United States":
        return 1.0, "Non-U.S. site: Medicare index not applicable; shown at national rate for comparison"
    return LOCALITY.get(state or "", 1.0), LOCALITY_SOURCE


def coverage_grid(protocol: Protocol) -> list[dict]:
    vis = {v.id: v.label for v in protocol.visits}
    out = []
    for n in protocol.nodes:
        r = RATES.get(n.code)
        out.append({
            "node": n.id, "visit": vis[n.visit], "procedure": n.procedure, "code": n.code,
            "coverage": n.coverage, "payer": "Sponsor" if n.coverage == "research" else "Medicare / insurer",
            "rationale": n.rationale, "medicare_amount": r.amount if r else None, "verified": r.verified if r else False,
        })
    return out


def per_patient_budget(protocol: Protocol, state: str | None, country: str | None, multiplier: float = 1.0) -> dict:
    """Equation (1): research-labeled nodes at m x locality-adjusted Medicare, plus standard items."""
    loc, loc_src = locality_factor(state, country)
    lines, unknown = [], []
    for n in protocol.nodes:
        if n.coverage != "research":
            continue
        r = RATES.get(n.code)
        if r is None:
            unknown.append(n.code)  # unknown is never zero: surfaced, not silently dropped
            continue
        lines.append({"node": n.id, "code": n.code, "procedure": n.procedure,
                      "amount": round(r.amount * loc * multiplier, 2), "source": r.source, "verified": r.verified})
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
    per_site = [asdict(i) for i in STANDARD_SCHEDULE if i.unit in ("per_site", "per_patient")]
    return {
        "multiplier": multiplier, "locality_factor": loc, "locality_source": loc_src,
        "procedure_lines": lines, "procedures_total": round(procedures, 2),
        "per_patient_items": items, "per_patient_total": round(per_patient, 2),
        "per_site_items": per_site, "schedule_source": SCHEDULE_SOURCE, "unpriced_codes": unknown,
    }


def term_sheet(protocol: Protocol, site: dict, expected_patients: float, multiplier: float = 1.0) -> dict:
    caps, cap_src = site_capabilities(site.get("facility", ""), bool(site.get("is_amc")))
    req = protocol.requirements()
    budget = per_patient_budget(protocol, site.get("state"), site.get("country"), multiplier)
    fixed = sum(i["amount"] for i in budget["per_site_items"] if i["unit"] == "per_site")
    return {
        "protocol": {"id": protocol.id, "title": protocol.title},
        "site": site,
        "capability_check": [{"capability": c, "met": c in caps} for c in req],
        "capabilities_source": cap_src,
        "capability_ok": all(c in caps for c in req),
        "coverage_grid": coverage_grid(protocol),
        "budget": budget,
        "expected_patients": round(expected_patients, 1),
        "expected_site_total": round(fixed + budget["per_patient_total"] * expected_patients, 2),
        "agreement": ACTA_TERMS,
        "disclaimer": "Decision support only. Not a legal fair-market-value determination or a coverage determination.",
    }
