"""Load real CMS fee schedules into a small rate table.

    python -m concord.ratecard.cms --rvu data/raw/cms/rvu26d/rvu26d.zip [--clfs data/raw/cms/26clabq4.zip]

PFS (physician fee schedule): payment = (work RVU x work GPCI + non-facility PE RVU x PE GPCI
+ MP RVU x MP GPCI) x conversion factor; national amount uses GPCIs of 1. Source: the RVU file
(PPRRVU nonQPP) and GPCI file from https://www.cms.gov/medicare/payment/fee-schedules/physician/
pfs-relative-value-files. Public download.

CLFS (clinical lab fee schedule): national limitation amounts, not geographically adjusted.
CMS serves it behind an AMA CPT license click-through, so it is only loaded from a zip the user
downloaded after accepting that license.

Output: data/ratecard.json with numbers only (CPT descriptions are AMA-copyrighted and are not
copied out of the CMS files).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from pathlib import Path

from concord.paths import DATA_DIR

OUT = DATA_DIR / "ratecard.json"

STATE_ABBR = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI",
    "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Puerto Rico": "PR", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN",
    "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
    "Wisconsin": "WI", "Wyoming": "WY",
}


def _csv_from_zip(z: zipfile.ZipFile, startswith: str) -> list[list[str]]:
    name = next(n for n in z.namelist() if n.startswith(startswith) and n.endswith(".csv"))
    return list(csv.reader(io.StringIO(z.read(name).decode("latin-1"))))


def load_pfs(zip_path: Path, codes: set[str] | None = None) -> dict:
    z = zipfile.ZipFile(zip_path)
    rows = _csv_from_zip(z, "PPRRVU")
    hdr = next(i for i, r in enumerate(rows) if r and r[0] == "HCPCS")
    title = next((r[2] for r in rows[:hdr] if len(r) > 2 and "Relative Value File" in r[2]), zip_path.name)
    out = {}
    cf = None
    for r in rows[hdr + 1:]:
        if not r or not r[0] or r[1]:  # skip modifier rows (-26 / -TC): global service only
            continue
        if codes and r[0] not in codes:
            continue
        work, pe_nf, mp, cf_s = float(r[5] or 0), float(r[6] or 0), float(r[10] or 0), r[25]
        cf = float(cf_s) if cf_s else cf
        out[r[0]] = {"status": r[3], "work": work, "pe_nf": pe_nf, "mp": mp,
                     "national": round((work + pe_nf + mp) * float(cf_s), 2) if cf_s else None}

    g = _csv_from_zip(z, "GPCI")
    ghdr = next(i for i, r in enumerate(g) if r and r[0].startswith("Medicare Administrative"))
    localities = []
    for r in g[ghdr + 1:]:
        if len(r) >= 7 and r[1] and r[4]:
            localities.append({"state": r[1].strip(), "locality": r[2].strip(), "name": r[3].strip().rstrip("*"),
                               "gpci_work": float(r[4]), "gpci_pe": float(r[5]), "gpci_mp": float(r[6])})
    return {"source": f"CMS PFS {title} (nonQPP, non-facility), {zip_path.name}", "conversion_factor": cf,
            "codes": out, "localities": localities}


def load_clfs(zip_path: Path, codes: set[str] | None = None) -> dict:
    z = zipfile.ZipFile(zip_path)
    name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
    rows = list(csv.reader(io.StringIO(z.read(name).decode("latin-1"))))
    hdr = next(i for i, r in enumerate(rows) if r and any(c.strip().upper() == "HCPCS" for c in r))
    cols = [c.strip().upper() for c in rows[hdr]]
    i_code, i_mod = cols.index("HCPCS"), cols.index("MOD") if "MOD" in cols else None
    i_rate = next(i for i, c in enumerate(cols) if c in ("RATE", "NLA", "NATIONAL LIMIT"))
    out = {}
    for r in rows[hdr + 1:]:
        if len(r) <= i_rate or not r[i_code] or (i_mod is not None and r[i_mod].strip()):
            continue
        if codes and r[i_code] not in codes:
            continue
        try:
            out[r[i_code]] = {"national": round(float(r[i_rate]), 2)}
        except ValueError:
            continue
    return {"source": f"CMS CLFS {zip_path.name} (national limitation amounts)", "codes": out}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rvu", type=Path, required=True)
    ap.add_argument("--clfs", type=Path, default=None)
    a = ap.parse_args()
    data = {"pfs": load_pfs(a.rvu)}
    if a.clfs:
        data["clfs"] = load_clfs(a.clfs)
    OUT.write_text(json.dumps(data))
    print(f"wrote {OUT}: {len(data['pfs']['codes'])} PFS codes, CF {data['pfs']['conversion_factor']}, "
          f"{len(data['pfs']['localities'])} localities" + (f", {len(data['clfs']['codes'])} CLFS codes" if a.clfs else ""))


if __name__ == "__main__":
    main()
