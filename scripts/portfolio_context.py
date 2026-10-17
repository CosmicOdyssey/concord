"""Refresh registry context only; never creates operational inputs or historical predictions."""
import datetime
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parents[1]
rows = []
for nct in ("NCT05800015", "NCT05785767"):
    url = f"https://clinicaltrials.gov/api/v2/studies/{nct}"
    with urlopen(Request(url, headers={"User-Agent": "Concord-public-context/1.0"}), timeout=30) as response:
        raw = response.read()
    p = json.loads(raw)["protocolSection"]
    rows.append({"id": nct, "title": p["identificationModule"]["briefTitle"],
                 "sponsor": p["sponsorCollaboratorsModule"]["leadSponsor"]["name"],
                 "registered_start": p["statusModule"].get("startDateStruct"),
                 "source": url, "response_sha256": hashlib.sha256(raw).hexdigest(),
                 "captured_at": datetime.datetime.now(datetime.UTC).isoformat(),
                 "use": "Registry context only; current capture is not an as-of historical snapshot. No site, outcome or operational inputs imported."})
path = root / "data/portfolio/context.json"
path.write_text(json.dumps(rows, indent=2) + "\n")
print(path)
