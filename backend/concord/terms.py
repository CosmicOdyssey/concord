"""Protocol to terms: a schedule of assessments becomes transparent, pre-priced terms.

No forecasting anywhere in this module. The flow:

1. A protocol (compiler/protocols/<NCT>.json): visits x procedures with visit windows. Hand-authored
   from public trial information and labelled "Illustrative, authored from public trial information".
2. A coverage label per node (routine care vs research) from explicit rules R1-R5. A reviewer can
   override any node; overrides are carried through every output as "reviewer override".
3. A per-visit budget at one of the trial's registered U.S. sites. Physician-fee-schedule codes are
   priced with ratecard.medicare.price() from the CMS 2026 PFS at the site's Medicare locality, which
   is resolved by county (see _CITY_COUNTY). Lab (CLFS) codes are placeholders until the CLFS file is
   loaded. A "% of Medicare" multiplier applies to coded lines. Only research nodes bill the sponsor.
4. A proposed standard non-procedure schedule (start-up, IRB, pharmacy, close-out, archiving,
   coordinator time, screen failure as incurred, ...), editable by the caller.
5. A term sheet (markdown and a printable HTML page) with provenance on every line, and a two-site
   comparison in which every price difference decomposes into published GPCI differences.

Decision support. Not a fair-market-value legal opinion.
"""

from __future__ import annotations

import html
import json
import sqlite3
from datetime import date
from functools import lru_cache
from pathlib import Path

from concord.paths import DB_PATH
from concord.ratecard import medicare
from concord.ratecard.cms import STATE_ABBR

PROTOCOL_DIR = Path(__file__).parent / "compiler" / "protocols"
ILLUSTRATIVE = "Illustrative, authored from public trial information"
DISCLAIMER = "Decision support. Not a fair-market-value legal opinion."
CLFS_NOTE = "placeholder until the CLFS file is loaded"
NCD = "Medicare NCD 310.1 (routine costs in clinical trials)"
STANDARD_LABEL = "Proposed standard"
STANDARD_SOURCE = "Concord proposed standard schedule v1: a starting point to negotiate against, not market data"


class TermsError(ValueError):
    """Bad request (unknown trial, site, node or schedule item)."""


class NotFound(TermsError):
    pass


# ---------------------------------------------------------------- coverage rules

RULES: dict[str, dict] = {
    "R1": {"coverage": "research", "title": "Investigational product and its administration",
           "text": "The investigational agent (or its blinded placebo), its preparation and the infusion that "
                   "delivers it are paid by the sponsor."},
    "R2": {"coverage": "research", "title": "Protocol-only test or activity",
           "text": "Items that exist only because of the protocol: PK and anti-drug-antibody samples, central "
                   "confirmation, protocol ECGs, eligibility-only serology, questionnaires, central scan upload, "
                   "protocol-timed safety and survival contacts."},
    "R3": {"coverage": "routine", "title": "Standard of care at standard frequency",
           "text": f"Visits, labs and imaging a patient on this therapy would receive anyway, at the standard-care "
                   f"frequency: billable to Medicare or the insurer under {NCD}."},
    "R4": {"coverage": "research", "title": "More frequent than standard care",
           "text": "A routine item repeated more often than the standard-care reference: the extra occurrences "
                   "are research."},
    "R5": {"coverage": "routine", "title": "Standard-of-care comparator or backbone administration",
           "text": f"Administration of approved standard therapy given in every arm is routine under {NCD}. "
                   "Drug supplied free by the sponsor is never billed."},
}

# The reference R3 and R4 compare against. Authored, not a coverage determination.
STANDARD_CARE_REFERENCE = [
    "Office visit with history, exam and toxicity check before each cycle",
    "Blood count and chemistry panel before each chemotherapy cycle",
    "TSH and free T4 at baseline and about every 6 weeks on PD-1 therapy",
    "CT chest/abdomen/pelvis at baseline, about every 6 weeks during induction (to week 12), "
    "then about every 9 weeks",
    "Brain MRI at baseline staging",
    "PD-L1 and EGFR/ALK/ROS1 testing at diagnosis",
    "No routine ECG, hepatitis serology or urinalysis for this regimen",
]
STANDARD_CARE_SOURCE = ("Authored reference consistent with common NCCN-concordant first-line NSCLC practice; "
                        "used only to apply rules R3 and R4. Not a coverage determination.")

# ---------------------------------------------------------------- standard schedule

_LEGACY = {i.id: i.amount for i in medicare.STANDARD_SCHEDULE}

# (id, label, default amount, unit). Units: per_site (one time), per_visit (each completed visit),
# per_occurrence (each time the schedule calls for it), rate (fraction of research items + coordinator time),
# as_incurred (computed; never editable).
STANDARD_ITEMS: list[tuple[str, str, float | None, str]] = [
    ("startup", "Study start-up (regulatory documents, site initiation visit)", _LEGACY.get("startup", 8000.0),
     "per_site"),
    ("irb", "IRB fee (central IRB reliance)", _LEGACY.get("irb", 3500.0), "per_site"),
    ("pharmacy_setup", "Investigational pharmacy setup", _LEGACY.get("pharmacy", 2500.0), "per_site"),
    ("closeout", "Close-out visit", _LEGACY.get("closeout", 2500.0), "per_site"),
    ("archiving", "Record archiving", _LEGACY.get("archive", 1500.0), "per_site"),
    ("coordinator", "Coordinator time and data entry", _LEGACY.get("coordinator", 175.0), "per_visit"),
    ("ip_dispense", "Study drug preparation and dispensing", 85.0, "per_occurrence"),
    ("sample_kit", "Research sample processing and shipping", 60.0, "per_occurrence"),
    ("tissue", "Archival tissue retrieval and shipment", 150.0, "per_occurrence"),
    ("image_upload", "Scan de-identification and upload for central review", 100.0, "per_occurrence"),
    ("pro", "Questionnaire administration", 40.0, "per_occurrence"),
    ("survival_contact", "Survival status contact", 75.0, "per_occurrence"),
    ("overhead", "Institutional overhead on research items and coordinator time", _LEGACY.get("overhead", 0.25),
     "rate"),
    ("screen_fail", "Screen failure: the screening visit payment, invoiced as incurred", None, "as_incurred"),
]
UNIT_LABEL = {"per_site": "per site, one time", "per_visit": "per completed visit",
              "per_occurrence": "each time performed", "rate": "of research items and coordinator time",
              "as_incurred": "as incurred"}


def standard_schedule(edits: dict[str, float] | None = None) -> dict[str, dict]:
    edits = edits or {}
    unknown = set(edits) - {i[0] for i in STANDARD_ITEMS if i[3] != "as_incurred"}
    if unknown:
        raise TermsError(f"unknown or non-editable schedule items: {sorted(unknown)}")
    out = {}
    for iid, label, default, unit in STANDARD_ITEMS:
        amt = default
        if iid in edits:
            v = float(edits[iid])
            if not (v >= 0) or (unit == "rate" and v > 1):
                raise TermsError(f"{iid}: amount must be >= 0" + (" and <= 1" if unit == "rate" else ""))
            amt = v
        out[iid] = {"id": iid, "label": label, "amount": amt, "default": default, "unit": unit,
                    "unit_label": UNIT_LABEL[unit], "edited": iid in edits and edits[iid] != default,
                    "label_tag": STANDARD_LABEL, "source": STANDARD_SOURCE}
    return out


# ---------------------------------------------------------------- protocols

def list_protocols() -> list[str]:
    return sorted(p.stem for p in PROTOCOL_DIR.glob("NCT*.json"))


@lru_cache(maxsize=8)
def load_protocol(nct: str) -> dict:
    """Read and expand a protocol file: schedule entries become nodes with ids '<visit>:<procedure>'."""
    path = PROTOCOL_DIR / f"{nct}.json"
    if not nct.startswith("NCT") or not path.exists():
        raise NotFound(f"no authored protocol for {nct}; available: {list_protocols()}")
    p = json.loads(path.read_text(encoding="utf-8"))
    visits = {v["id"]: v for v in p["visits"]}
    procs = {x["id"]: x for x in p["procedures"]}
    if len(visits) != len(p["visits"]) or len(procs) != len(p["procedures"]):
        raise ValueError(f"{nct}: duplicate visit or procedure id")
    nodes = []
    for entry in p["schedule"]:
        proc = procs[entry["proc"]]
        for at in entry["at"]:
            if at["rule"] not in RULES:
                raise ValueError(f"{nct}: unknown rule {at['rule']}")
            for vid in at["visits"]:
                if vid not in visits:
                    raise ValueError(f"{nct}: unknown visit {vid}")
                nodes.append({"id": f"{vid}:{proc['id']}", "visit": vid, "procedure": proc["id"],
                              "rule": at["rule"], "coverage": RULES[at["rule"]]["coverage"],
                              "reason": at["reason"], "window": at.get("window")})
    ids = [n["id"] for n in nodes]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{nct}: a procedure is scheduled twice at one visit")
    order = {v["id"]: i for i, v in enumerate(p["visits"])}
    porder = {x["id"]: i for i, x in enumerate(p["procedures"])}
    nodes.sort(key=lambda n: (order[n["visit"]], porder[n["procedure"]]))
    for x in p["procedures"]:
        x.setdefault("pricing", "cpt" if x.get("code") else "none")
    return {**p, "nodes": nodes}


def _edges(visits: list[dict]) -> list[dict]:
    """Consecutive scheduled visits with the allowed gap (target day of the next visit +/- its window)."""
    fixed = [v for v in visits if v["kind"] in ("screening", "treatment")]
    out = []
    for a, b in zip(fixed, fixed[1:]):
        a_day = a.get("day_end", a["day"]) if a["kind"] == "screening" else a["day"]
        out.append({"src": a["id"], "dst": b["id"], "nominal_days": b["day"] - a_day,
                    "window_min_days": b["day"] - b.get("minus", 0) - a_day,
                    "window_max_days": b["day"] + b.get("plus", 0) - a_day})
    return out


def _trial_facts(nct: str) -> dict:
    """Descriptive registry facts from the database (no enrollment figures)."""
    if not DB_PATH.exists():
        return {}
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        r = con.execute("SELECT nct_id, title, acronym, status, phases, sponsor, sponsor_class, start_date, n_sites "
                        "FROM trials WHERE nct_id=?", (nct,)).fetchone()
        if r is None:
            return {}
        us, us_wd = con.execute("SELECT COUNT(*), COALESCE(SUM(ts.site_status='WITHDRAWN'), 0) FROM trial_sites ts "
                                "JOIN sites s USING(site_id) WHERE ts.nct_id=? AND s.country='United States'",
                                (nct,)).fetchone()
    finally:
        con.close()
    out = dict(r)
    out["phases"] = json.loads(out["phases"] or "[]")
    out["n_us_sites"] = us
    out["n_us_sites_withdrawn"] = us_wd
    return out


def _design(nct: str) -> dict | None:
    try:
        from concord.compiler.overrides import DESIGN
    except Exception:  # noqa: BLE001 - optional metadata
        return None
    d = DESIGN.get(nct)
    return {"design": d["design"], "confidence": d.get("confidence")} if d else None


def protocol_view(nct: str) -> dict:
    p = load_protocol(nct)
    counts: dict[str, int] = {}
    for n in p["nodes"]:
        counts[n["rule"]] = counts.get(n["rule"], 0) + 1
    return {
        "nct_id": nct, "label": p["label"], "authored": p["authored"], "short_title": p["short_title"],
        "why_chosen": p["why_chosen"], "arms": p["arms"], "dosing": p["dosing"], "masking": p["masking"],
        "registry_notes": p.get("registry_notes", []), "sources": p["sources"], "assumptions": p["assumptions"],
        "visits": p["visits"], "procedures": p["procedures"], "nodes": p["nodes"], "edges": _edges(p["visits"]),
        "rules": [{"id": k, **v, "nodes": counts.get(k, 0)} for k, v in RULES.items()],
        "standard_care_reference": STANDARD_CARE_REFERENCE, "standard_care_source": STANDARD_CARE_SOURCE,
        "trial": _trial_facts(nct), "design": _design(nct), "disclaimer": DISCLAIMER,
    }


def trials() -> list[dict]:
    out = []
    for nct in list_protocols():
        p = load_protocol(nct)
        out.append({"nct_id": nct, "short_title": p["short_title"], "why_chosen": p["why_chosen"],
                    "arms": p["arms"], "dosing": p["dosing"], "masking": p["masking"],
                    "registry_notes": p.get("registry_notes", []), "label": p["label"],
                    "trial": _trial_facts(nct), "design": _design(nct)})
    # Regeneron first: it is the reference case of the demo.
    out.sort(key=lambda t: (0 if (t["trial"].get("sponsor") or "").startswith("Regeneron") else 1, t["nct_id"]))
    return out


# ---------------------------------------------------------------- Medicare localities

# County of each registered U.S. site city (both demo trials) in states with more than one Medicare
# locality, plus Virginia and Maryland (whose D.C. suburbs belong to the D.C. locality). CT.gov gives
# city and ZIP but not county, and Medicare localities are defined by county.
_CITY_COUNTY: dict[tuple[str, str], str] = {
    ("CA", "CERRITOS"): "Los Angeles County", ("CA", "WHITTIER"): "Los Angeles County",
    ("CA", "BEVERLY HILLS"): "Los Angeles County", ("CA", "LOS ANGELES"): "Los Angeles County",
    ("CA", "SANTA MONICA"): "Los Angeles County", ("CA", "FULLERTON"): "Orange County",
    ("CA", "ORANGE"): "Orange County", ("CA", "ANAHEIM"): "Orange County",
    ("CA", "RANCHO MIRAGE"): "Riverside County", ("CA", "REDLANDS"): "San Bernardino County",
    ("CA", "LOMA LINDA"): "San Bernardino County", ("CA", "SAN DIEGO"): "San Diego County",
    ("CA", "SAN FRANCISCO"): "San Francisco County", ("CA", "WALNUT CREEK"): "Contra Costa County",
    ("CA", "SANTA ROSA"): "Sonoma County", ("CA", "SACRAMENTO"): "Sacramento County",
    ("FL", "CLERMONT"): "Lake County", ("FL", "MIAMI"): "Miami-Dade County", ("FL", "ORANGE CITY"): "Volusia County",
    ("FL", "TALLAHASSEE"): "Leon County", ("FL", "BAY PINES"): "Pinellas County",
    ("FL", "ST. PETERSBURG"): "Pinellas County", ("FL", "FORT LAUDERDALE"): "Broward County",
    ("FL", "GAINESVILLE"): "Alachua County", ("FL", "JACKSONVILLE"): "Duval County", ("FL", "OCALA"): "Marion County",
    ("GA", "ATLANTA"): "Fulton County",
    ("IL", "CHICAGO"): "Cook County", ("IL", "ROLLING MEADOWS"): "Cook County", ("IL", "DECATUR"): "Macon County",
    ("IL", "HINSDALE"): "DuPage County", ("IL", "QUINCY"): "Adams County", ("IL", "ROCKFORD"): "Winnebago County",
    ("LA", "BATON ROUGE"): "East Baton Rouge Parish", ("LA", "ALEXANDRIA"): "Rapides Parish",
    ("LA", "SHREVEPORT"): "Caddo Parish",
    ("ME", "SOUTH PORTLAND"): "Cumberland County",
    ("MD", "BALTIMORE"): "Baltimore City", ("MD", "BETHESDA"): "Montgomery County",
    ("MI", "GRAND RAPIDS"): "Kent County",
    ("MO", "BRIDGETON"): "St. Louis County", ("MO", "COLUMBIA"): "Boone County",
    ("NJ", "PENNINGTON"): "Mercer County", ("NJ", "CAMDEN"): "Camden County",
    ("NY", "NEW YORK"): "New York County (Manhattan)", ("NY", "THE BRONX"): "Bronx County",
    ("NY", "BRONX"): "Bronx County", ("NY", "WESTBURY"): "Nassau County", ("NY", "BUFFALO"): "Erie County",
    ("OR", "MEDFORD"): "Jackson County", ("OR", "PORTLAND"): "Multnomah County", ("OR", "SALEM"): "Marion County",
    ("PA", "PITTSBURGH"): "Allegheny County", ("PA", "YORK"): "York County",
    ("TX", "FORT WORTH"): "Tarrant County", ("TX", "HOUSTON"): "Harris County", ("TX", "KINGWOOD"): "Harris County",
    ("TX", "IRVING"): "Dallas County", ("TX", "LUBBOCK"): "Lubbock County", ("TX", "PALESTINE"): "Anderson County",
    ("TX", "ROUND ROCK"): "Williamson County",
    ("WA", "SEATTLE"): "King County", ("WA", "SILVERDALE"): "Kitsap County", ("WA", "SPOKANE"): "Spokane County",
    ("WA", "TACOMA"): "Pierce County", ("WA", "WENATCHEE"): "Chelan County",
    ("VA", "CHARLOTTESVILLE"): "Charlottesville (independent city)", ("VA", "MIDLOTHIAN"): "Chesterfield County",
    ("VA", "FAIRFAX"): "Fairfax County", ("VA", "NORFOLK"): "Norfolk (independent city)",
    ("VA", "ROANOKE"): "Roanoke (independent city)",
}

# Counties that form each named (non rest-of-state) Medicare locality, by state. Value: locality code in
# the same state, or "ST:code" for a locality listed under another state (the D.C. suburbs).
_NAMED_LOCALITY: dict[str, dict[str, str]] = {
    "CA": {"Los Angeles County": "18", "Orange County": "18", "Riverside County": "62",
           "San Bernardino County": "62", "San Diego County": "72", "San Francisco County": "05",
           "San Mateo County": "05", "Alameda County": "05", "Contra Costa County": "05", "Marin County": "52",
           "Sonoma County": "67", "Sacramento County": "63", "Placer County": "63", "El Dorado County": "63",
           "Yolo County": "63", "Ventura County": "17", "Santa Clara County": "09"},
    "FL": {"Miami-Dade County": "04", "Monroe County": "04", "Broward County": "03", "Palm Beach County": "03",
           "Collier County": "03", "Lee County": "03", "Martin County": "03", "St. Lucie County": "03",
           "Indian River County": "03"},
    "GA": {c: "01" for c in ("Fulton County", "DeKalb County", "Cobb County", "Gwinnett County", "Clayton County",
                             "Cherokee County", "Douglas County", "Fayette County", "Forsyth County", "Henry County")},
    "IL": {"Cook County": "16", "DuPage County": "15", "Kane County": "15", "Lake County": "15", "Will County": "15",
           "Madison County": "12", "St. Clair County": "12"},
    "LA": {"Orleans Parish": "01", "Jefferson Parish": "01", "Plaquemines Parish": "01", "St. Bernard Parish": "01"},
    "ME": {"Cumberland County": "03", "York County": "03"},
    "MD": {"Baltimore City": "01", "Baltimore County": "01", "Anne Arundel County": "01", "Carroll County": "01",
           "Harford County": "01", "Howard County": "01", "Montgomery County": "DC:01",
           "Prince George's County": "DC:01"},
    "MA": {"Middlesex County": "01", "Norfolk County": "01", "Suffolk County": "01"},
    "MI": {"Wayne County": "01", "Oakland County": "01", "Macomb County": "01", "Washtenaw County": "01"},
    "MO": {"St. Louis County": "01", "St. Louis City": "01", "St. Charles County": "01", "Jefferson County": "01",
           "Jackson County": "02", "Clay County": "02", "Platte County": "02"},
    "NJ": {c: "01" for c in ("Bergen County", "Essex County", "Hudson County", "Hunterdon County",
                             "Middlesex County", "Morris County", "Passaic County", "Somerset County",
                             "Sussex County", "Union County", "Warren County")},
    "NY": {"New York County (Manhattan)": "01", "Bronx County": "02", "Kings County": "02", "Nassau County": "02",
           "Richmond County": "02", "Rockland County": "02", "Suffolk County": "02", "Westchester County": "02",
           "Queens County": "04", "Dutchess County": "03", "Orange County": "03", "Putnam County": "03",
           "Ulster County": "03"},
    "OR": {"Multnomah County": "01", "Clackamas County": "01", "Washington County": "01"},
    "PA": {c: "01" for c in ("Philadelphia County", "Bucks County", "Chester County", "Delaware County",
                             "Montgomery County")},
    "TX": {"Travis County": "31", "Jefferson County": "20", "Brazoria County": "09", "Dallas County": "11",
           "Tarrant County": "28", "Galveston County": "15", "Harris County": "18"},
    "WA": {"King County": "02"},
    "VA": {"Fairfax County": "DC:01", "Arlington County": "DC:01", "Alexandria (independent city)": "DC:01"},
}
COUNTY_SOURCE = ("County from a hand-encoded crosswalk of this demo's site cities; county-to-locality per the "
                 "CMS Medicare locality definitions")


def _localities() -> list[dict]:
    return medicare._cms().get("pfs", {}).get("localities", [])  # noqa: SLF001 - same package


def resolve_locality(state: str | None, city: str | None, country: str | None) -> dict | None:
    """Medicare PFS locality of a site, with how it was matched. None for non-U.S. sites or when the
    CMS GPCI file is not loaded (national amounts are used and the line says so)."""
    if country not in (None, "United States") or not state:
        return None
    locs = _localities()
    abbr = STATE_ABBR.get(state)
    if not locs or not abbr:
        return None
    in_state = [l for l in locs if l["state"] == abbr]
    rest = next((l for l in in_state if l["name"].startswith("REST OF")), in_state[0] if len(in_state) == 1 else None)
    c = (city or "").strip()
    county = _CITY_COUNTY.get((abbr, c.upper()))
    row, method, verified = None, "", False
    if county:
        tgt = _NAMED_LOCALITY.get(abbr, {}).get(county)
        if tgt:
            st, code = tgt.split(":") if ":" in tgt else (abbr, tgt)
            row = next((l for l in locs if l["state"] == st and l["locality"] == code), None)
        else:
            row = rest
        if row:
            method, verified = f"{c} is in {county}; CMS assigns {county} to this locality", True
    if row is None and len(in_state) == 1 and abbr not in ("VA", "MD"):
        row, method, verified = in_state[0], "the whole state is one Medicare locality", True
    if row is None:
        row = medicare._locality(state, city)  # noqa: SLF001 - same package
        if row is None:
            return None
        method = "matched by city name (county not in our crosswalk); check before relying on it"
    return {"state": row["state"], "code": row["locality"], "name": row["name"], "gpci_work": row["gpci_work"],
            "gpci_pe": row["gpci_pe"], "gpci_mp": row["gpci_mp"], "county": county, "method": method,
            "verified": verified, "source": _gpci_source()}


def _gpci_source() -> str:
    src = medicare._cms().get("pfs", {}).get("source", "")  # noqa: SLF001
    return f"GPCI table in {src.split(', ')[-1]}" if src else "CMS GPCI file not loaded"


# ---------------------------------------------------------------- sites

def _site_rows(nct: str) -> list[dict]:
    if not DB_PATH.exists():
        raise NotFound("database not built")
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute("SELECT s.site_id, s.facility, s.city, s.state, s.zip, s.country, s.anonymized, s.is_amc, "
                           "ts.site_status FROM trial_sites ts JOIN sites s USING(site_id) "
                           "WHERE ts.nct_id=? AND s.country='United States' ORDER BY s.state, s.city, s.facility",
                           (nct,)).fetchall()
    finally:
        con.close()
    return [dict(r) for r in rows]


def _site_out(r: dict) -> dict:
    loc = resolve_locality(r["state"], r["city"], r["country"])
    anon = bool(r["anonymized"])
    name = "Research site (name withheld by sponsor)" if anon else r["facility"]
    abbr = STATE_ABBR.get(r["state"] or "", r["state"] or "")
    return {"site_id": r["site_id"], "facility": name, "city": r["city"], "state": r["state"], "state_abbr": abbr,
            "zip": r["zip"], "anonymized": anon, "status": r["site_status"], "locality": loc,
            "label": f"{name}, {r['city']}, {abbr}"}


def sites(nct: str) -> dict:
    """The trial's registered U.S. sites (withdrawn sites hidden) with Medicare locality, plus the
    preselected comparison pair."""
    load_protocol(nct)
    rows = _site_rows(nct)
    shown = [_site_out(r) for r in rows if r["site_status"] != "WITHDRAWN"]
    p = load_protocol(nct)

    def match(spec: dict) -> str | None:
        for s in shown:
            if (spec.get("city", "").lower() == (s["city"] or "").lower()
                    and spec.get("facility", "").lower() in s["facility"].lower()):
                return s["site_id"]
        return None

    presets = []
    for pr in p.get("compare_presets", []):
        ids = [match(x) for x in pr["sites"]]
        if all(ids) and ids[0] != ids[1]:
            presets.append({"label": pr["label"], "site_ids": ids})
    default = [match(x) for x in p.get("compare_default", [])]
    if not (len(default) == 2 and all(default)):
        default = _fallback_pair(shown)
    return {"nct_id": nct, "sites": shown, "n_withdrawn_hidden": len(rows) - len(shown),
            "default_pair": default, "presets": presets, "county_source": COUNTY_SOURCE}


def _fallback_pair(shown: list[dict]) -> list[str | None]:
    """Two sites in different localities, the widest practice-expense gap first."""
    with_loc = [s for s in shown if s["locality"]]
    if len(with_loc) < 2:
        return [s["site_id"] for s in shown[:2]] + [None] * (2 - min(2, len(shown)))
    hi = max(with_loc, key=lambda s: s["locality"]["gpci_pe"])
    lo = min(with_loc, key=lambda s: s["locality"]["gpci_pe"])
    return [hi["site_id"], lo["site_id"]]


def _site(nct: str, site_id: str) -> dict:
    for r in _site_rows(nct):
        if r["site_id"] == site_id:
            return _site_out(r)
    raise NotFound(f"{site_id} is not a registered U.S. site of {nct}")


# ---------------------------------------------------------------- pricing

# Lab codes outside medicare.RATES that the demo protocols use. Approximate national amounts, flagged
# as placeholders exactly like the medicare.RATES lab placeholders, until the CLFS file is loaded.
LAB_PLACEHOLDERS = {"84439": 10.0, "87340": 10.0, "86803": 14.0, "81003": 2.0}


def _price_code(code: str, loc: dict | None) -> dict | None:
    loc_row = ({"name": loc["name"], "gpci_work": loc["gpci_work"], "gpci_pe": loc["gpci_pe"],
                "gpci_mp": loc["gpci_mp"]} if loc else None)
    r = medicare.price(code, loc=loc_row) if loc_row else medicare.price(code)
    if r is None and code in LAB_PLACEHOLDERS:
        v = LAB_PLACEHOLDERS[code]
        r = {"amount": v, "national": v, "schedule": "CLFS", "verified": False, "locality": "national",
             "source": medicare.PLACEHOLDER_SOURCE + " (CLFS file not loaded)"}
    if r is None:
        return None
    out = dict(r)
    pfs = medicare._cms().get("pfs", {})  # noqa: SLF001
    row = pfs.get("codes", {}).get(code)
    if r["schedule"] == "PFS" and r["verified"] and row:
        g = loc or {"gpci_work": 1.0, "gpci_pe": 1.0, "gpci_mp": 1.0, "name": "national"}
        out["rvu"] = {"work": row["work"], "pe": row["pe_nf"], "mp": row["mp"]}
        out["gpci"] = {"work": g["gpci_work"], "pe": g["gpci_pe"], "mp": g["gpci_mp"]}
        out["cf"] = pfs["conversion_factor"]
        exact = (row["work"] * g["gpci_work"] + row["pe_nf"] * g["gpci_pe"] + row["mp"] * g["gpci_mp"]) * pfs[
            "conversion_factor"]
        out["formula"] = (f"({row['work']:.2f} x {g['gpci_work']:.3f} + {row['pe_nf']:.2f} x {g['gpci_pe']:.3f} + "
                          f"{row['mp']:.2f} x {g['gpci_mp']:.3f}) x {pfs['conversion_factor']:.4f} = "
                          f"${exact:,.2f}")
        out["placeholder"] = False
        out["schedule_label"] = "PFS"
    else:
        out["placeholder"] = not r["verified"]
        out["schedule_label"] = r["schedule"]
        if r["schedule"] == "CLFS" and not r["verified"]:
            out["note"] = CLFS_NOTE
        elif not r["verified"]:
            out["note"] = "placeholder until the CMS PFS file is loaded"
    return out


def _coverage(p: dict, overrides: dict[str, str] | None) -> dict[str, dict]:
    overrides = overrides or {}
    ids = {n["id"] for n in p["nodes"]}
    bad = [k for k in overrides if k not in ids]
    if bad:
        raise TermsError(f"unknown nodes in overrides: {bad[:5]}")
    for k, v in overrides.items():
        if v not in ("routine", "research"):
            raise TermsError(f"override for {k} must be routine or research")
    out = {}
    for n in p["nodes"]:
        ov = overrides.get(n["id"])
        if ov and ov != n["coverage"]:
            out[n["id"]] = {"coverage": ov, "override": True,
                            "basis": f"reviewer override (rule {n['rule']} said {n['coverage']})"}
        else:
            out[n["id"]] = {"coverage": n["coverage"], "override": False,
                            "basis": f"{n['rule']}: {RULES[n['rule']]['title']}"}
    return out


def _r2(x: float) -> float:
    return round(x + 0.0, 2)


def budget(nct: str, site_id: str, multiplier: float = 1.0, overrides: dict[str, str] | None = None,
           standard: dict[str, float] | None = None) -> dict:
    """Per-visit payments at one registered site. Research nodes bill the sponsor at
    multiplier x locality-adjusted Medicare (coded items) or the standard schedule (non-procedure items);
    routine nodes are shown as billed to insurance at the Medicare amount."""
    if not (0.1 <= multiplier <= 5.0):
        raise TermsError("multiplier must be between 0.1 and 5 (10% to 500% of Medicare)")
    p = load_protocol(nct)
    site = _site(nct, site_id)
    loc = site["locality"]
    std = standard_schedule(standard)
    cov = _coverage(p, overrides)
    procs = {x["id"]: x for x in p["procedures"]}
    prices: dict[str, dict | None] = {}
    rate = std["overhead"]["amount"]
    visits_out = []
    for v in p["visits"]:
        lines = []
        for n in (n for n in p["nodes"] if n["visit"] == v["id"]):
            proc = procs[n["procedure"]]
            c = cov[n["id"]]
            line = {"node_id": n["id"], "visit_id": v["id"], "procedure_id": proc["id"], "label": proc["label"],
                    "category": proc["category"], "code": proc.get("code"), "rule": n["rule"],
                    "reason": n["reason"], "coverage": c["coverage"], "override": c["override"], "basis": c["basis"],
                    "payer": "Sponsor" if c["coverage"] == "research" else "Insurance",
                    "window": n.get("window"), "count": 1, "medicare_amount": None, "unit_amount": None,
                    "amount": None, "schedule": None, "verified": False, "placeholder": False, "source": None,
                    "formula": None, "rvu": None, "gpci": None, "cf": None, "note": proc.get("note"),
                    "multiplier": None}
            pricing = proc["pricing"]
            if pricing == "cpt":
                code = proc["code"]
                if code not in prices:
                    prices[code] = _price_code(code, loc)
                r = prices[code]
                if r is None:
                    line["note"] = "unpriced: code not in the loaded fee schedules (never counted as zero)"
                else:
                    line.update({"medicare_amount": r["amount"], "schedule": r["schedule_label"],
                                 "verified": r["verified"], "placeholder": r["placeholder"], "source": r["source"],
                                 "formula": r.get("formula"), "rvu": r.get("rvu"), "gpci": r.get("gpci"),
                                 "cf": r.get("cf")})
                    if r.get("note"):
                        line["note"] = r["note"]
                    if c["coverage"] == "research":
                        line["multiplier"] = multiplier
                        line["unit_amount"] = _r2(r["amount"] * multiplier)
            elif pricing.startswith("standard:"):
                it = std[pricing.split(":", 1)[1]]
                line.update({"schedule": "Standard", "source": f"{STANDARD_LABEL}: {it['label']}",
                             "verified": False, "standard_item": it["id"], "edited": it["edited"]})
                if c["coverage"] == "research":
                    line["unit_amount"] = _r2(it["amount"])
            else:  # no site charge
                line["schedule"] = "None"
            if c["coverage"] == "research" and line["unit_amount"] is not None:
                line["amount"] = _r2(line["unit_amount"] * line["count"])
            lines.append(line)
        research = _r2(sum(l["amount"] for l in lines if l["amount"] is not None))
        coord = std["coordinator"]["amount"] if v.get("coordinator", True) else 0.0
        overhead = _r2(rate * (research + coord))
        routine = _r2(sum(l["medicare_amount"] for l in lines
                          if l["payer"] == "Insurance" and l["medicare_amount"] is not None))
        visits_out.append({
            "visit_id": v["id"], "label": v["label"], "short": v["short"], "kind": v["kind"], "window": v["window"],
            "repeat": v.get("repeat"), "lines": lines, "research_subtotal": research, "coordinator": coord,
            "overhead": overhead, "visit_total": _r2(research + coord + overhead), "insurance_medicare": routine,
            "placeholder_amount": _r2(sum(l["amount"] for l in lines if l["amount"] is not None and l["placeholder"])),
        })
    fixed = [v for v in visits_out if v["kind"] != "repeat"]
    per_site_items = [it for it in std.values() if it["unit"] == "per_site"]
    scr = next(v for v in visits_out if v["kind"] == "screening")
    all_lines = [l for v in visits_out for l in v["lines"]]
    totals = {
        "per_participant": _r2(sum(v["visit_total"] for v in fixed)),
        "per_participant_scope": "screening through cycle 8, end of treatment and safety follow-up",
        "per_participant_research_items": _r2(sum(v["research_subtotal"] for v in fixed)),
        "per_participant_coordinator": _r2(sum(v["coordinator"] for v in fixed)),
        "per_participant_overhead": _r2(sum(v["overhead"] for v in fixed)),
        "per_participant_insurance_medicare": _r2(sum(v["insurance_medicare"] for v in fixed)),
        "per_participant_placeholder": _r2(sum(v["placeholder_amount"] for v in fixed)),
        "per_occurrence": [{"visit_id": v["visit_id"], "label": v["label"], "repeat": v["repeat"],
                            "amount": v["visit_total"]} for v in visits_out if v["kind"] == "repeat"],
        "screen_failure": scr["visit_total"],
        "per_site_one_time": _r2(sum(it["amount"] for it in per_site_items)),
        "n_sponsor_lines": sum(1 for l in all_lines if l["payer"] == "Sponsor"),
        "n_insurance_lines": sum(1 for l in all_lines if l["payer"] == "Insurance"),
        "n_overrides": sum(1 for l in all_lines if l["override"]),
        "n_placeholder_lines": sum(1 for l in all_lines if l["placeholder"] and l["payer"] == "Sponsor"),
    }
    pfs = medicare._cms().get("pfs", {})  # noqa: SLF001
    return {
        "nct_id": nct, "short_title": p["short_title"], "label": p["label"], "disclaimer": DISCLAIMER,
        "site": site, "locality": loc, "multiplier": multiplier,
        "conversion_factor": pfs.get("conversion_factor"), "pfs_source": pfs.get("source"),
        "clfs_loaded": bool(medicare._cms().get("clfs")),  # noqa: SLF001
        "visits": visits_out, "totals": totals, "standard_schedule": list(std.values()),
        "overrides": [{"node_id": l["node_id"], "visit": l["visit_id"], "procedure": l["label"], "rule": l["rule"],
                       "coverage": l["coverage"], "basis": l["basis"]} for l in all_lines if l["override"]],
        "rules": [{"id": k, **v} for k, v in RULES.items()], "ncd": NCD,
    }


# ---------------------------------------------------------------- two-site comparison

def compare(nct: str, site_a: str, site_b: str, multiplier: float = 1.0, overrides: dict[str, str] | None = None,
            standard: dict[str, float] | None = None) -> dict:
    """The same protocol at two sites. Every sponsor-line difference is decomposed into the published
    GPCI differences: delta = CF x m x (work RVU x dGPCI_work + PE RVU x dGPCI_pe + MP RVU x dGPCI_mp),
    plus cent rounding; overhead moves by its rate times the line differences."""
    if site_a == site_b:
        raise TermsError("pick two different sites")
    A = budget(nct, site_a, multiplier, overrides, standard)
    B = budget(nct, site_b, multiplier, overrides, standard)
    cf = A["conversion_factor"] or 0.0
    la = {l["node_id"]: l for v in A["visits"] for l in v["lines"]}
    lb = {l["node_id"]: l for v in B["visits"] for l in v["lines"]}
    kinds = {v["visit_id"]: v["kind"] for v in A["visits"]}
    groups: dict[str, dict] = {}
    for nid, a in la.items():
        b = lb[nid]
        if a["payer"] != "Sponsor" or a["unit_amount"] is None:
            continue
        g = groups.setdefault(a["procedure_id"], {
            "procedure_id": a["procedure_id"], "label": a["label"], "code": a["code"], "schedule": a["schedule"],
            "placeholder": a["placeholder"], "unit_a": a["unit_amount"], "unit_b": b["unit_amount"],
            "formula_a": a["formula"], "formula_b": b["formula"], "rvu": a["rvu"], "visits_fixed": [],
            "visits_repeat": []})
        (g["visits_repeat"] if kinds[a["visit_id"]] == "repeat" else g["visits_fixed"]).append(a["visit_id"])
    ga = A["locality"] or {"gpci_work": 1, "gpci_pe": 1, "gpci_mp": 1}
    gb = B["locality"] or {"gpci_work": 1, "gpci_pe": 1, "gpci_mp": 1}
    dg = {k: gb[f"gpci_{k}"] - ga[f"gpci_{k}"] for k in ("work", "pe", "mp")}
    rows = []
    tw = tpe = tmp = 0.0
    for g in groups.values():
        d_unit = _r2(g["unit_b"] - g["unit_a"])
        n = len(g["visits_fixed"])
        if g["rvu"]:
            parts = {k: g["rvu"][k] * dg[k] * cf * multiplier for k in ("work", "pe", "mp")}
            why = "published GPCI difference"
        else:
            parts = {"work": 0.0, "pe": 0.0, "mp": 0.0}
            why = ("not geographically adjusted (lab fee schedule is national)" if g["schedule"] == "CLFS"
                   else "standard schedule item: same at every site")
        rounding = d_unit - sum(parts.values())
        tw += n * parts["work"]
        tpe += n * parts["pe"]
        tmp += n * parts["mp"]
        rows.append({**g, "n_fixed": n, "delta_unit": d_unit, "delta_fixed": _r2(n * d_unit),
                     "delta_work": round(parts["work"], 4), "delta_pe": round(parts["pe"], 4),
                     "delta_mp": round(parts["mp"], 4), "rounding": round(rounding, 4), "why": why})
    rows.sort(key=lambda r: -abs(r["delta_fixed"]))
    ta, tb = A["totals"], B["totals"]
    d_total = _r2(tb["per_participant"] - ta["per_participant"])
    d_items = _r2(tb["per_participant_research_items"] - ta["per_participant_research_items"])
    d_over = _r2(tb["per_participant_overhead"] - ta["per_participant_overhead"])
    gpci_sum = tw + tpe + tmp
    return {
        "nct_id": nct, "multiplier": multiplier, "conversion_factor": cf, "pfs_source": A["pfs_source"],
        "disclaimer": DISCLAIMER, "label": A["label"],
        "a": {"site": A["site"], "locality": A["locality"], "totals": ta},
        "b": {"site": B["site"], "locality": B["locality"], "totals": tb},
        "gpci_delta": dg, "rows": rows,
        "summary": {
            "delta_per_participant": d_total, "delta_research_items": d_items, "delta_overhead": d_over,
            "from_work": round(tw, 2), "from_pe": round(tpe, 2), "from_mp": round(tmp, 2),
            "overhead_rate": A["standard_schedule"][[s["id"] for s in A["standard_schedule"]].index("overhead")][
                "amount"],
            "rounding": round(d_total - gpci_sum - d_over, 2),
            "per_occurrence": [{"visit_id": x["visit_id"], "label": x["label"], "a": x["amount"], "b": y["amount"],
                                "delta": _r2(y["amount"] - x["amount"])}
                               for x, y in zip(ta["per_occurrence"], tb["per_occurrence"])],
            "screen_failure": {"a": ta["screen_failure"], "b": tb["screen_failure"],
                               "delta": _r2(tb["screen_failure"] - ta["screen_failure"])},
        },
    }


# ---------------------------------------------------------------- term sheet export

def _money(x: float | None) -> str:
    if x is None:
        return "n/a"
    return f"-${-x:,.2f}" if x < 0 else f"${x:,.2f}"


def _loc_text(loc: dict | None) -> str:
    if not loc:
        return "national amounts (no U.S. Medicare locality resolved)"
    return (f"{loc['name']} ({loc['state']} locality {loc['code']}); GPCI work {loc['gpci_work']:.3f}, "
            f"PE {loc['gpci_pe']:.3f}, MP {loc['gpci_mp']:.3f}; {loc['method']}")


def _provenance(l: dict, b: dict) -> str:
    """One line of provenance for a priced line, as plain text."""
    tail = (f"; x {l['multiplier'] * 100:.0f}% of Medicare = {_money(l['unit_amount'])}"
            if l["multiplier"] and l["unit_amount"] is not None else "")
    if l["schedule"] == "PFS" and l["formula"]:
        loc = b["locality"]
        where = f"{loc['name']} ({loc['state']} {loc['code']})" if loc else "national"
        src = (b["pfs_source"] or "").split(", ")[-1]
        return f"CMS PFS {src}, {where}: {l['formula']}{tail}"
    if l["schedule"] == "CLFS":
        if l["placeholder"]:
            return f"CLFS national amount {_money(l['medicare_amount'])}, {CLFS_NOTE}{tail}"
        return f"{l['source']}{tail}"
    if l["schedule"] == "Standard":
        return (f"{STANDARD_LABEL} schedule: {l.get('standard_item')} {_money(l['unit_amount'])}"
                + (" (edited)" if l.get("edited") else ""))
    if l["schedule"] == "None":
        return l["note"] or "no site charge"
    return l["source"] or l["note"] or ""


def _basis(l: dict) -> str:
    return l["basis"] if l["override"] else f"rule {l['rule']}"


def termsheet(nct: str, site_id: str, multiplier: float = 1.0, overrides: dict[str, str] | None = None,
              standard: dict[str, float] | None = None, compare_site: str | None = None) -> dict:
    b = budget(nct, site_id, multiplier, overrides, standard)
    p = load_protocol(nct)
    cmp_ = compare(nct, site_id, compare_site, multiplier, overrides, standard) if compare_site else None
    return {"budget": b, "compare": cmp_, "protocol": {k: p[k] for k in ("short_title", "sources", "assumptions",
                                                                         "arms", "dosing", "masking")},
            "generated": date.today().isoformat(), "filename": f"term-sheet_{nct}_{site_id}.md"}


def termsheet_markdown(ts: dict) -> str:
    b, c, p = ts["budget"], ts["compare"], ts["protocol"]
    s = b["site"]
    out: list[str] = []
    w = out.append
    w(f"# Term sheet: {b['nct_id']} at {s['label']}")
    w("")
    w(f"> **{DISCLAIMER}**  ")
    w(f"> Schedule of assessments: **{b['label']}**. Not the sponsor's protocol.  ")
    w(f"> Generated {ts['generated']} by Concord. Every line states where its number comes from.")
    w("")
    w("## 1. Protocol and site")
    w("")
    w(f"- Protocol: {b['nct_id']}, {p['short_title']}")
    w(f"- Dosing (registry): {p['dosing']}")
    w(f"- Masking (registry): {p['masking']}")
    w(f"- Site: {s['label']}" + (f" {s['zip']}" if s.get("zip") else "") + f" (registry status: {s['status'] or 'not reported'})")
    w(f"- Medicare locality: {_loc_text(b['locality'])}")
    w(f"- Physician fee schedule: {b['pfs_source'] or 'not loaded'}; conversion factor {b['conversion_factor']}")
    w(f"- Multiplier on coded items: {b['multiplier'] * 100:.0f}% of Medicare")
    w(f"- Lab (CLFS) codes: {'CMS CLFS file' if b['clfs_loaded'] else 'approximate national amounts, ' + CLFS_NOTE}")
    w(f"- Coverage: routine items are billed to Medicare or the insurer under {NCD}; research items are paid by "
      f"the sponsor.")
    w("")
    w("## 2. Per-visit payments (paid by the sponsor)")
    w("")
    for v in b["visits"]:
        spons = [l for l in v["lines"] if l["payer"] == "Sponsor"]
        head = f"### {v['label']} (window: {v['window']})"
        if v["kind"] == "repeat":
            head += f": priced per occurrence, {v['repeat']}"
        w(head)
        w("")
        w("| Code | Item | Schedule | Coverage basis | Medicare at locality | Sponsor amount | Provenance |")
        w("|---|---|---|---|---:|---:|---|")
        for l in spons:
            w(f"| {l['code'] or '-'} | {l['label']} | {l['schedule'] or '-'} | {_basis(l)} | "
              f"{_money(l['medicare_amount']) if l['medicare_amount'] is not None else '-'} | {_money(l['amount'])} | "
              f"{_provenance(l, b)} |")
        if v["coordinator"]:
            w(f"| - | Coordinator time and data entry | Standard | per completed visit | - | {_money(v['coordinator'])} | "
              f"{STANDARD_LABEL} schedule item 'coordinator' |")
        rate = next(i["amount"] for i in b["standard_schedule"] if i["id"] == "overhead")
        w(f"| - | Institutional overhead | Standard | {rate * 100:.0f}% of the lines above | - | "
          f"{_money(v['overhead'])} | {STANDARD_LABEL} schedule item 'overhead' |")
        w(f"| | **Visit payment** | | | | **{_money(v['visit_total'])}** | |")
        w("")
    t = b["totals"]
    w("## 3. Totals")
    w("")
    w(f"- Per participant, {t['per_participant_scope']}: **{_money(t['per_participant'])}** "
      f"(research items {_money(t['per_participant_research_items'])}, coordinator time "
      f"{_money(t['per_participant_coordinator'])}, overhead {_money(t['per_participant_overhead'])}; "
      f"of which lab placeholders {_money(t['per_participant_placeholder'])})")
    for x in t["per_occurrence"]:
        w(f"- {x['label']}, {x['repeat']}: {_money(x['amount'])} each, invoiced as completed")
    w(f"- Screen failure, as incurred: {_money(t['screen_failure'])} (the screening visit payment)")
    w(f"- Per site, one time: {_money(t['per_site_one_time'])}")
    w(f"- Routine care billed to insurance per participant (Medicare amounts at this locality, for reference): "
      f"{_money(t['per_participant_insurance_medicare'])}")
    w("")
    w("## 4. Billed to insurance (routine care)")
    w("")
    w("| Visit | Code | Item | Coverage basis | Medicare at locality | Provenance |")
    w("|---|---|---|---|---:|---|")
    for v in b["visits"]:
        for l in v["lines"]:
            if l["payer"] == "Insurance":
                w(f"| {v['short']} | {l['code'] or '-'} | {l['label']} | {_basis(l)} | {_money(l['medicare_amount'])} | "
                  f"{_provenance(l, b)} |")
    w("")
    w(f"## 5. {STANDARD_LABEL} non-procedure schedule")
    w("")
    w("| Item | Amount | Unit | Note |")
    w("|---|---:|---|---|")
    for it in b["standard_schedule"]:
        if it["unit"] == "rate":
            amt = f"{it['amount'] * 100:.0f}%"
        elif it["unit"] == "as_incurred":
            amt = _money(t["screen_failure"])
        else:
            amt = _money(it["amount"])
        note = "edited from the proposed standard" if it["edited"] else STANDARD_LABEL
        w(f"| {it['label']} | {amt} | {it['unit_label']} | {note} |")
    w("")
    w(f"Source: {STANDARD_SOURCE}.")
    w("")
    w("## 6. Coverage rules and reviewer overrides")
    w("")
    for r in b["rules"]:
        w(f"- **{r['id']} ({r['coverage']})**, {r['title']}: {r['text']}")
    w("")
    if b["overrides"]:
        w("Reviewer overrides:")
        w("")
        for o in b["overrides"]:
            w(f"- {o['visit']} / {o['procedure']}: now **{o['coverage']}**, {o['basis']}")
    else:
        w("Reviewer overrides: none.")
    w("")
    if c:
        w("## 7. Site comparison")
        w("")
        for k in ("a", "b"):
            w(f"- Site {k.upper()}: {c[k]['site']['label']}; {_loc_text(c[k]['locality'])}; per participant "
              f"{_money(c[k]['totals']['per_participant'])}")
        sm = c["summary"]
        w(f"- Difference (B - A) per participant: **{_money(sm['delta_per_participant'])}** = work GPCI "
          f"{_money(sm['from_work'])} + practice-expense GPCI {_money(sm['from_pe'])} + malpractice GPCI "
          f"{_money(sm['from_mp'])} + overhead on those {_money(sm['delta_overhead'])} + rounding "
          f"{_money(sm['rounding'])}")
        w("")
        w("| Code | Item | Times per participant | A each | B each | Difference each | Why |")
        w("|---|---|---:|---:|---:|---:|---|")
        for r in c["rows"]:
            w(f"| {r['code'] or '-'} | {r['label']} | {r['n_fixed']} | {_money(r['unit_a'])} | {_money(r['unit_b'])} | "
              f"{_money(r['delta_unit'])} | {r['why']} |")
        w("")
    w("## Sources and assumptions")
    w("")
    for src in p["sources"]:
        w(f"- Registry {src['field']}: \"{src['quote']}\" (used for: {src['used_for']})")
    for a in p["assumptions"]:
        w(f"- Assumption: {a}")
    w("- Codes are shown with Concord's own short labels, not AMA CPT descriptors.")
    w("- PFS amounts are non-facility amounts (global service). Hospital outpatient departments are paid for "
      "the technical part under OPPS; the PFS amount is the published benchmark used here.")
    w("")
    w("## Proposed agreement terms")
    w("")
    for a in medicare.ACTA_TERMS:
        w(f"- {a}")
    w("")
    w(f"*{DISCLAIMER}*")
    return "\n".join(out) + "\n"


_CSS = """
:root{--text:#14181f;--muted:#5a6372;--border:#d9dde3;--accent:#1d4ed8;--soft:#f3f5f8;--warn:#8a4b00;--warnbg:#fff4e0}
*{box-sizing:border-box}body{font:13px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:var(--text);
background:#fff;margin:0;padding:24px;max-width:1100px;margin:0 auto}
h1{font-size:20px;margin:0 0 6px}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid var(--border);padding-bottom:4px}
h3{font-size:13px;margin:14px 0 4px}table{border-collapse:collapse;width:100%;margin:4px 0 10px;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid var(--border);padding:4px 6px;text-align:left;vertical-align:top}th{font-size:11px;
text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}td.n,th.n{text-align:right;white-space:nowrap}
.prov{font-size:11px;color:var(--muted)}.banner{background:var(--warnbg);color:var(--warn);padding:8px 10px;border-radius:6px;
margin:8px 0;font-weight:600}.tag{display:inline-block;font-size:11px;padding:0 6px;border-radius:999px;background:var(--soft);
color:var(--muted);font-weight:600}.ov{background:#fde9e7;color:#a12a1d}.total td{font-weight:700}
ul{margin:4px 0;padding-left:18px}.noprint{margin:10px 0}button{font:inherit;padding:6px 12px;border-radius:6px;
border:1px solid var(--border);background:#fff;cursor:pointer}
@media print{body{padding:0;max-width:none}.noprint{display:none}h2{break-after:avoid}tr{break-inside:avoid}}
"""


def termsheet_html(ts: dict) -> str:
    """Print-friendly page (use the browser's print to PDF). Same content as the markdown."""
    b, c, p = ts["budget"], ts["compare"], ts["protocol"]
    e = html.escape
    s = b["site"]
    t = b["totals"]
    rate = next(i["amount"] for i in b["standard_schedule"] if i["id"] == "overhead")
    h: list[str] = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' "
                    f"content='width=device-width,initial-scale=1'><link rel='icon' href='data:,'>"
                    f"<title>Term sheet {e(b['nct_id'])}</title>"
                    f"<style>{_CSS}</style></head><body>"]
    w = h.append
    w("<div class='noprint'><button onclick='window.print()'>Print or save as PDF</button></div>")
    w(f"<h1>Term sheet: {e(b['nct_id'])} at {e(s['label'])}</h1>")
    w(f"<div class='banner'>{e(DISCLAIMER)}</div>")
    w(f"<p><span class='tag'>{e(b['label'])}</span> Not the sponsor's protocol. Generated {e(ts['generated'])} by "
      f"Concord. Every line states where its number comes from.</p>")
    w("<h2>1. Protocol and site</h2><ul>")
    for li in [f"Protocol: {b['nct_id']}, {p['short_title']}", f"Dosing (registry): {p['dosing']}",
               f"Masking (registry): {p['masking']}",
               f"Site: {s['label']}{(' ' + s['zip']) if s.get('zip') else ''} (registry status: "
               f"{s['status'] or 'not reported'})",
               f"Medicare locality: {_loc_text(b['locality'])}",
               f"Physician fee schedule: {b['pfs_source'] or 'not loaded'}; conversion factor {b['conversion_factor']}",
               f"Multiplier on coded items: {b['multiplier'] * 100:.0f}% of Medicare",
               f"Lab (CLFS) codes: {'CMS CLFS file' if b['clfs_loaded'] else 'approximate national amounts, ' + CLFS_NOTE}",
               f"Coverage: routine items are billed to Medicare or the insurer under {NCD}; research items are paid "
               f"by the sponsor."]:
        w(f"<li>{e(li)}</li>")
    w("</ul><h2>2. Per-visit payments (paid by the sponsor)</h2>")
    for v in b["visits"]:
        head = f"{v['label']} (window: {v['window']})" + (f": priced per occurrence, {v['repeat']}" if v["kind"] == "repeat"
                                                   else "")
        w(f"<h3>{e(head)}</h3><table><thead><tr><th>Code</th><th>Item</th><th>Schedule</th><th>Coverage basis</th>"
          "<th class='n'>Medicare at locality</th><th class='n'>Sponsor amount</th><th>Provenance</th></tr></thead><tbody>")
        for l in v["lines"]:
            if l["payer"] != "Sponsor":
                continue
            cls = " class='ov'" if l["override"] else ""
            med = _money(l["medicare_amount"]) if l["medicare_amount"] is not None else "-"
            w(f"<tr><td>{e(l['code'] or '-')}</td><td>{e(l['label'])}</td><td>{e(l['schedule'] or '-')}</td>"
              f"<td><span{cls}>{e(_basis(l))}</span></td><td class='n'>{med}</td><td class='n'>{_money(l['amount'])}</td>"
              f"<td class='prov'>{e(_provenance(l, b))}</td></tr>")
        if v["coordinator"]:
            w(f"<tr><td>-</td><td>Coordinator time and data entry</td><td>Standard</td><td>per completed visit</td>"
              f"<td class='n'>-</td><td class='n'>{_money(v['coordinator'])}</td><td class='prov'>{e(STANDARD_LABEL)} "
              f"schedule item 'coordinator'</td></tr>")
        w(f"<tr><td>-</td><td>Institutional overhead</td><td>Standard</td><td>{rate * 100:.0f}% of the lines above</td>"
          f"<td class='n'>-</td><td class='n'>{_money(v['overhead'])}</td><td class='prov'>{e(STANDARD_LABEL)} "
          f"schedule item 'overhead'</td></tr>")
        w(f"<tr class='total'><td></td><td>Visit payment</td><td></td><td></td><td></td>"
          f"<td class='n'>{_money(v['visit_total'])}</td><td></td></tr></tbody></table>")
    w("<h2>3. Totals</h2><ul>")
    w(f"<li>Per participant, {e(t['per_participant_scope'])}: <b>{_money(t['per_participant'])}</b> (research items "
      f"{_money(t['per_participant_research_items'])}, coordinator time {_money(t['per_participant_coordinator'])}, "
      f"overhead {_money(t['per_participant_overhead'])}; of which lab placeholders "
      f"{_money(t['per_participant_placeholder'])})</li>")
    for x in t["per_occurrence"]:
        w(f"<li>{e(x['label'])}, {e(x['repeat'])}: {_money(x['amount'])} each, invoiced as completed</li>")
    w(f"<li>Screen failure, as incurred: {_money(t['screen_failure'])} (the screening visit payment)</li>")
    w(f"<li>Per site, one time: {_money(t['per_site_one_time'])}</li>")
    w(f"<li>Routine care billed to insurance per participant (Medicare amounts at this locality, for reference): "
      f"{_money(t['per_participant_insurance_medicare'])}</li></ul>")
    w("<h2>4. Billed to insurance (routine care)</h2><table><thead><tr><th>Visit</th><th>Code</th><th>Item</th>"
      "<th>Coverage basis</th><th class='n'>Medicare at locality</th><th>Provenance</th></tr></thead><tbody>")
    for v in b["visits"]:
        for l in v["lines"]:
            if l["payer"] == "Insurance":
                cls = " class='ov'" if l["override"] else ""
                w(f"<tr><td>{e(v['short'])}</td><td>{e(l['code'] or '-')}</td><td>{e(l['label'])}</td>"
                  f"<td><span{cls}>{e(_basis(l))}</span></td><td class='n'>{_money(l['medicare_amount'])}</td>"
                  f"<td class='prov'>{e(_provenance(l, b))}</td></tr>")
    w(f"</tbody></table><h2>5. {e(STANDARD_LABEL)} non-procedure schedule</h2><table><thead><tr><th>Item</th>"
      "<th class='n'>Amount</th><th>Unit</th><th>Note</th></tr></thead><tbody>")
    for it in b["standard_schedule"]:
        amt = (f"{it['amount'] * 100:.0f}%" if it["unit"] == "rate" else
               _money(t["screen_failure"]) if it["unit"] == "as_incurred" else _money(it["amount"]))
        note = "edited from the proposed standard" if it["edited"] else STANDARD_LABEL
        w(f"<tr><td>{e(it['label'])}</td><td class='n'>{amt}</td><td>{e(it['unit_label'])}</td><td>{e(note)}</td></tr>")
    w(f"</tbody></table><p class='prov'>Source: {e(STANDARD_SOURCE)}.</p>")
    w("<h2>6. Coverage rules and reviewer overrides</h2><ul>")
    for r in b["rules"]:
        w(f"<li><b>{e(r['id'])} ({e(r['coverage'])})</b>, {e(r['title'])}: {e(r['text'])}</li>")
    w("</ul>")
    if b["overrides"]:
        w("<p>Reviewer overrides:</p><ul>")
        for o in b["overrides"]:
            w(f"<li>{e(o['visit'])} / {e(o['procedure'])}: now <b>{e(o['coverage'])}</b>, {e(o['basis'])}</li>")
        w("</ul>")
    else:
        w("<p>Reviewer overrides: none.</p>")
    if c:
        sm = c["summary"]
        w("<h2>7. Site comparison</h2><ul>")
        for k in ("a", "b"):
            w(f"<li>Site {k.upper()}: {e(c[k]['site']['label'])}; {e(_loc_text(c[k]['locality']))}; per participant "
              f"{_money(c[k]['totals']['per_participant'])}</li>")
        w(f"<li>Difference (B - A) per participant: <b>{_money(sm['delta_per_participant'])}</b> = work GPCI "
          f"{_money(sm['from_work'])} + practice-expense GPCI {_money(sm['from_pe'])} + malpractice GPCI "
          f"{_money(sm['from_mp'])} + overhead on those {_money(sm['delta_overhead'])} + rounding "
          f"{_money(sm['rounding'])}</li></ul>")
        w("<table><thead><tr><th>Code</th><th>Item</th><th class='n'>Times per participant</th><th class='n'>A each</th>"
          "<th class='n'>B each</th><th class='n'>Difference each</th><th>Why</th></tr></thead><tbody>")
        for r in c["rows"]:
            w(f"<tr><td>{e(r['code'] or '-')}</td><td>{e(r['label'])}</td><td class='n'>{r['n_fixed']}</td>"
              f"<td class='n'>{_money(r['unit_a'])}</td><td class='n'>{_money(r['unit_b'])}</td>"
              f"<td class='n'>{_money(r['delta_unit'])}</td><td class='prov'>{e(r['why'])}</td></tr>")
        w("</tbody></table>")
    w("<h2>Sources and assumptions</h2><ul>")
    for src in p["sources"]:
        w(f"<li>Registry {e(src['field'])}: &ldquo;{e(src['quote'])}&rdquo; (used for: {e(src['used_for'])})</li>")
    for a in p["assumptions"]:
        w(f"<li>Assumption: {e(a)}</li>")
    w("<li>Codes are shown with Concord's own short labels, not AMA CPT descriptors.</li>")
    w("<li>PFS amounts are non-facility amounts (global service). Hospital outpatient departments are paid for the "
      "technical part under OPPS; the PFS amount is the published benchmark used here.</li></ul>")
    w("<h2>Proposed agreement terms</h2><ul>")
    for a in medicare.ACTA_TERMS:
        w(f"<li>{e(a)}</li>")
    w(f"</ul><p><i>{e(DISCLAIMER)}</i></p></body></html>")
    return "".join(h)
