"""Static registry snapshot for a Protocol-to-terms trial that is not in the (lung-only) database.

    python -m concord.compiler.registry_snapshot NCT06541704 <study.json> [--fetched YYYY-MM-DD]

<study.json> is the ClinicalTrials.gov API v2 record (https://clinicaltrials.gov/api/v2/studies/<NCT>),
fetched once by hand. The output, compiler/protocols/registry/<NCT>.json, keeps descriptive trial facts and
the registered U.S. locations with the source URL and fetch date. site_id uses the same key as the database
(concord.ingest.normalize.site_key) so a later database build would give the same ids. The database is not
touched: concord.terms reads this file only when the trial is not in the database.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from concord.ingest.normalize import AMC_PATTERNS, site_key

REGISTRY_DIR = Path(__file__).parent / "protocols" / "registry"
API = "https://clinicaltrials.gov/api/v2/studies/{nct}"


def snapshot(study: dict, fetched: str) -> dict:
    ps = study["protocolSection"]
    i, st, de = ps["identificationModule"], ps["statusModule"], ps["designModule"]
    sp = ps["sponsorCollaboratorsModule"]
    locs = ps.get("contactsLocationsModule", {}).get("locations", [])
    sites = []
    for loc in locs:
        if loc.get("country") != "United States":
            continue
        sid, anon = site_key(loc.get("facility"), loc.get("city"), loc.get("state"), loc.get("country"))
        fac = loc.get("facility") or ""
        sites.append({"site_id": sid, "facility": fac, "city": loc.get("city"), "state": loc.get("state"),
                      "zip": loc.get("zip"), "country": loc["country"], "anonymized": int(anon),
                      "is_amc": int(not anon and bool(AMC_PATTERNS.search(fac))), "site_status": loc.get("status")})
    ids = [s["site_id"] for s in sites]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate site ids")
    nct = i["nctId"]
    return {
        "schema": "concord.registry_snapshot/v1",
        "nct_id": nct,
        "source_url": API.format(nct=nct),
        "fetched": fetched,
        "note": ("Static snapshot of the ClinicalTrials.gov record, fetched once because this trial is not in the "
                 "lung-only database (which is not rebuilt). U.S. locations only (protocolSection."
                 "contactsLocationsModule.locations); site_id uses the database key."),
        "registry_last_update": st.get("lastUpdatePostDateStruct", {}).get("date"),
        "trial": {"nct_id": nct, "title": i.get("officialTitle") or i.get("briefTitle"), "acronym": i.get("acronym"),
                  "status": st.get("overallStatus"), "phases": de.get("phases", []),
                  "sponsor": sp["leadSponsor"]["name"], "sponsor_class": sp["leadSponsor"].get("class"),
                  "start_date": st.get("startDateStruct", {}).get("date"), "n_sites": len(locs),
                  "conditions": ps.get("conditionsModule", {}).get("conditions", [])},
        "sites": sites,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("nct")
    ap.add_argument("study_json", type=Path)
    ap.add_argument("--fetched", default=date.today().isoformat())
    a = ap.parse_args()
    doc = snapshot(json.loads(a.study_json.read_text(encoding="utf-8")), a.fetched)
    if doc["nct_id"] != a.nct:
        raise SystemExit(f"{a.study_json} is {doc['nct_id']}, not {a.nct}")
    out = REGISTRY_DIR / f"{a.nct}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out}: {doc['trial']['n_sites']} locations, {len(doc['sites'])} U.S.")


if __name__ == "__main__":
    main()
