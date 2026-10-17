"""Raw CT.gov pages -> SQLite tables (trials, sites, trial_sites).

    python -m concord.ingest.normalize --name nsclc

Site identity is (normalized facility, city, state, country). Sponsors that
anonymize their sites ("Research Site", "Local Institution", ...) collapse to
one pseudo-site per city and are flagged `anonymized`, because they cannot be
tied to a real center from public data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from pathlib import Path

from concord.paths import DB_PATH, RAW_DIR

ANON_PATTERNS = re.compile(
    r"^(research site|local institution|clinical study site|study site|site\b|investigational site|"
    r"investigative site|clinical site|.* investigational site|.* investigative site|.* research site|"
    r"for additional information.*|.*call center.*|.*1-8\d\d-.*|recruiting site|site \d+.*|"
    r"research facility|.* clinical site \d*|novartis.*|pfizer.*|gsk.*|.*sponsor.*)$",
    re.I,
)
AMC_PATTERNS = re.compile(
    r"universit|college|school of medicine|academic|memorial sloan|md anderson|dana[- ]farber|mayo clinic|"
    r"johns hopkins|cleveland clinic|massachusetts general|brigham|fred hutch|city of hope|moffitt|"
    r"yale|stanford|ucla|ucsf|uc san diego|ucsd|emory|vanderbilt|duke|northwestern|penn medicine|"
    r"sidney kimmel|roswell|huntsman|karmanos|fox chase|lineberger|siteman|knight cancer|"
    r"gustave roussy|charit|hospital universit|national cancer (center|institute)",
    re.I,
)
LUNG_PATTERN = re.compile(r"nsclc|non[- ]?small|lung|thoracic", re.I)


def _norm(s: str | None) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _date(struct: dict | None) -> str | None:
    if not struct or not struct.get("date"):
        return None
    d = struct["date"]
    return d if len(d) == 10 else f"{d}-15"  # month-only dates -> mid-month


def site_key(facility: str | None, city: str | None, state: str | None, country: str | None) -> tuple[str, bool]:
    fac = (facility or "").strip()
    anonymized = not fac or bool(ANON_PATTERNS.match(fac))
    fac_norm = "anonymized site" if anonymized else _norm(fac)
    raw = "|".join([fac_norm, _norm(city), _norm(state), _norm(country)])
    return hashlib.sha1(raw.encode()).hexdigest()[:12], anonymized


GENERIC_TOKENS = set(
    "the of and at for in a s inc llc pc pa university univ hospital hospitals medical center centre centers cancer "
    "institute health healthcare system clinic clinical clinics research oncology dept department school medicine "
    "comprehensive care foundation services associates group network regional".split()
)


def _dedupe_sites(sites: dict[str, tuple]) -> dict[str, str]:
    """Merge name variants of one center within a city ("MD Anderson Cancer Center" vs
    "The University of Texas MD Anderson Cancer Center"): if one name's distinctive tokens
    are a subset of another's, they are the same site. Returns {duplicate_id: canonical_id}.

    Deliberately conservative: the shorter name must contain a token that is rare in that
    city (so "New York ..." does not swallow every NYC center), and a name with two
    candidate parents in different clusters is left alone rather than chained."""
    by_city: dict[tuple, list[tuple[str, frozenset]]] = {}
    for sid, row in sites.items():
        if row[8]:  # anonymized
            continue
        city_toks = set(_norm(row[2]).split()) | set(_norm(row[3]).split())
        toks = frozenset(_norm(row[1]).replace("m d ", "md ").split()) - GENERIC_TOKENS - city_toks
        if toks:
            by_city.setdefault((_norm(row[2]), _norm(row[3]), _norm(row[5])), []).append((sid, toks))

    alias: dict[str, str] = {}
    for members in by_city.values():
        if len(members) < 2:
            continue
        freq: dict[str, int] = {}
        for _, t in members:
            for tok in t:
                freq[tok] = freq.get(tok, 0) + 1
        members.sort(key=lambda m: len(m[1]))
        for i, (b, tb) in enumerate(members):
            roots = {
                alias.get(a, a)
                for a, ta in members[:i]
                if ta <= tb and (len(ta) >= 2 or any(freq[tok] <= 3 and len(tok) > 2 for tok in ta))
            }
            if len(roots) == 1:
                alias[b] = roots.pop()
    return alias


SCHEMA = """
DROP TABLE IF EXISTS trials;
DROP TABLE IF EXISTS sites;
DROP TABLE IF EXISTS trial_sites;
CREATE TABLE trials (
    nct_id TEXT PRIMARY KEY, title TEXT, acronym TEXT, status TEXT, phases TEXT,
    sponsor TEXT, sponsor_class TEXT, start_date TEXT, primary_completion_date TEXT,
    primary_completion_type TEXT, completion_date TEXT, enrollment INTEGER, enrollment_type TEXT,
    n_sites INTEGER, conditions TEXT, keywords TEXT, eligibility_text TEXT, min_age TEXT,
    max_age TEXT, sex TEXT, is_lung INTEGER, has_results INTEGER, last_update TEXT, indication TEXT
);
CREATE TABLE sites (
    site_id TEXT PRIMARY KEY, facility TEXT, city TEXT, state TEXT, zip TEXT, country TEXT,
    lat REAL, lon REAL, anonymized INTEGER, is_amc INTEGER
);
CREATE TABLE trial_sites (
    nct_id TEXT, site_id TEXT, site_status TEXT, PRIMARY KEY (nct_id, site_id)
);
CREATE INDEX ix_ts_site ON trial_sites(site_id);
CREATE INDEX ix_trials_status ON trials(status);
"""


def normalize(name: str, db_path: Path = DB_PATH) -> dict:
    src = RAW_DIR / name
    pages = sorted(src.glob("page_*.json"))
    if not pages:
        raise SystemExit(f"no raw pages in {src}; run the crawler first")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)
    con.executescript(SCHEMA)

    sites: dict[str, tuple] = {}
    n_trials = 0
    for page in pages:
        for study in json.loads(page.read_text(encoding="utf-8")):
            p = study["protocolSection"]
            ident, status = p["identificationModule"], p["statusModule"]
            sponsor = p.get("sponsorCollaboratorsModule", {}).get("leadSponsor", {})
            design = p.get("designModule", {})
            cond = p.get("conditionsModule", {})
            elig = p.get("eligibilityModule", {})
            locs = p.get("contactsLocationsModule", {}).get("locations", [])
            title = ident.get("officialTitle") or ident.get("briefTitle") or ""
            text_blob = " ".join([title, ident.get("briefTitle", ""), *cond.get("conditions", []), *cond.get("keywords", [])])
            enroll = design.get("enrollmentInfo", {})
            nct = ident["nctId"]

            trial_site_rows = {}
            for loc in locs:
                sid, anon = site_key(loc.get("facility"), loc.get("city"), loc.get("state"), loc.get("country"))
                geo = loc.get("geoPoint") or {}
                if sid not in sites:
                    fac = "Anonymized site" if anon else (loc.get("facility") or "").strip()
                    sites[sid] = (sid, fac, loc.get("city"), loc.get("state"), loc.get("zip"), loc.get("country"),
                                  geo.get("lat"), geo.get("lon"), int(anon),
                                  int(not anon and bool(AMC_PATTERNS.search(fac))))
                trial_site_rows[sid] = (nct, sid, loc.get("status"))

            con.execute(
                "INSERT OR REPLACE INTO trials VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    nct, title, ident.get("acronym"), status.get("overallStatus"),
                    json.dumps(design.get("phases", [])), sponsor.get("name"), sponsor.get("class"),
                    _date(status.get("startDateStruct")), _date(status.get("primaryCompletionDateStruct")),
                    (status.get("primaryCompletionDateStruct") or {}).get("type"),
                    _date(status.get("completionDateStruct")), enroll.get("count"), enroll.get("type"),
                    len(trial_site_rows), json.dumps(cond.get("conditions", [])), json.dumps(cond.get("keywords", [])),
                    elig.get("eligibilityCriteria"), elig.get("minimumAge"), elig.get("maximumAge"), elig.get("sex"),
                    int(bool(LUNG_PATTERN.search(text_blob))), int(bool(study.get("hasResults"))),
                    (status.get("lastUpdatePostDateStruct") or {}).get("date"), name,
                ),
            )
            con.executemany("INSERT OR REPLACE INTO trial_sites VALUES (?,?,?)", trial_site_rows.values())
            n_trials += 1

    alias = _dedupe_sites(sites)
    for old, new in alias.items():
        con.execute("UPDATE OR IGNORE trial_sites SET site_id=? WHERE site_id=?", (new, old))
        con.execute("DELETE FROM trial_sites WHERE site_id=?", (old,))  # leftovers were duplicates of `new`
        sites.pop(old)
    con.executemany("INSERT OR REPLACE INTO sites VALUES (?,?,?,?,?,?,?,?,?,?)", sites.values())
    con.execute("UPDATE trials SET n_sites=(SELECT COUNT(*) FROM trial_sites ts WHERE ts.nct_id=trials.nct_id)")
    con.commit()
    stats = {
        "trials": n_trials,
        "lung_trials": con.execute("SELECT COUNT(*) FROM trials WHERE is_lung=1").fetchone()[0],
        "sites": len(sites),
        "anonymized_sites": sum(s[8] for s in sites.values()),
        "trial_site_links": con.execute("SELECT COUNT(*) FROM trial_sites").fetchone()[0],
    }
    con.close()
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="nsclc")
    args = ap.parse_args()
    print(json.dumps(normalize(args.name), indent=2))


if __name__ == "__main__":
    main()
