"""Registry fallback for Protocol-to-terms trials that are not in the database.

The database covers lung-cancer trials only and is not rebuilt for the terms demo. A trial outside it (for
example the geographic atrophy protocol NCT06541704) ships a static snapshot of its ClinicalTrials.gov record
next to its protocol: compiler/protocols/registry/<NCT>.json, written once by
concord.compiler.registry_snapshot with the source URL and fetch date. concord.terms reads trial facts and
registered U.S. sites from the database first and from this file only when the database has none.

Locality rule for snapshot sites: the county crosswalk or a one-locality state, never a city-name guess.
A site whose county is not in the crosswalk, in a state with several Medicare localities, stays unresolved
and says so; its coded lines are priced at national amounts, labelled as such.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

REGISTRY_DIR = Path(__file__).parent / "compiler" / "protocols" / "registry"


@lru_cache(maxsize=8)
def snapshot(nct: str) -> dict | None:
    path = REGISTRY_DIR / f"{nct}.json"
    if not nct.startswith("NCT") or not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def source_text(snap: dict) -> str:
    return f"ClinicalTrials.gov record {snap['source_url']}, fetched {snap['fetched']} (static snapshot)"


def trial_facts(nct: str) -> dict:
    """Same shape as terms._trial_facts from the database, plus where the facts came from."""
    snap = snapshot(nct)
    if not snap:
        return {}
    t = snap["trial"]
    us = [s for s in snap["sites"] if s["country"] == "United States"]
    return {"nct_id": t["nct_id"], "title": t["title"], "acronym": t.get("acronym"), "status": t["status"],
            "phases": t.get("phases", []), "sponsor": t["sponsor"], "sponsor_class": t.get("sponsor_class"),
            "start_date": t.get("start_date"), "n_sites": t.get("n_sites"), "n_us_sites": len(us),
            "n_us_sites_withdrawn": sum(1 for s in us if s.get("site_status") == "WITHDRAWN"),
            "conditions": t.get("conditions", []), "source": source_text(snap), "in_database": False}


def site_rows(nct: str) -> list[dict]:
    """Rows in the shape of terms._site_rows (database columns), sorted the same way."""
    snap = snapshot(nct)
    if not snap:
        return []
    rows = [{"site_id": s["site_id"], "facility": s["facility"], "city": s["city"], "state": s["state"],
             "zip": s.get("zip"), "country": s["country"], "anonymized": s.get("anonymized", 0),
             "is_amc": s.get("is_amc", 0), "site_status": s.get("site_status"), "from_snapshot": True}
            for s in snap["sites"] if s["country"] == "United States"]
    return sorted(rows, key=lambda r: (r["state"] or "", r["city"] or "", r["facility"] or ""))


def unresolved_note(city: str | None, state_abbr: str) -> str:
    return (f"Medicare locality not resolved: {state_abbr} has several Medicare localities and the county of "
            f"{city or 'this city'} is not in Concord's county crosswalk, so it is left unresolved rather than "
            f"guessed. Coded lines use national amounts.")
