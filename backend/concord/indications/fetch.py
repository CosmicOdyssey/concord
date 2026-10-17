"""Fetch one extra indication from the ClinicalTrials.gov API v2 into its own SQLite file (site overlap only).

    python -m concord.indications.fetch --slug breast-cancer
    python -m concord.indications.fetch --count "type 2 diabetes" "heart failure"   # totals only, no files

Scope: interventional studies of the condition with an industry lead sponsor, a U.S. location and an overall status
of Recruiting, Active not recruiting or Enrolling by invitation (concord.indications.fetch_query). Raw pages go to
<data>/work/indications/raw/<slug>/, the DB to <data>/work/indications/<slug>.db (both gitignored under data/work/).

Reuses, without editing them, the crawler's rate-limited request helper (concord.ingest.ctgov._get) and the
normalizer (concord.ingest.normalize.normalize: the same site_key hash, anonymized-site collapse and name dedupe
as the lung DB). Never touches data/concord.db.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timezone

from concord import indications as ind
from concord.ingest import ctgov
from concord.ingest import normalize as norm

META_SCHEMA = "DROP TABLE IF EXISTS fetch_meta; CREATE TABLE fetch_meta (key TEXT PRIMARY KEY, value TEXT);"


def count(cond: str) -> int:
    q = ind.fetch_query(cond=cond)
    return int(ctgov._get(q | {"countTotal": "true", "pageSize": 1, "fields": "NCTId", "format": "json"})["totalCount"])


def fetch(slug: str) -> dict:
    if slug not in ind.INDICATIONS:
        raise SystemExit(f"unknown indication {slug!r}; one of {list(ind.INDICATIONS)}")
    raw_root = ind.indications_dir() / "raw"
    raw = raw_root / slug
    if raw.exists():
        shutil.rmtree(raw)
    raw.mkdir(parents=True)
    query = ind.fetch_query(slug)
    params = query | {"fields": "protocolSection,hasResults", "pageSize": ctgov.PAGE_SIZE, "countTotal": "true",
                      "format": "json"}
    t0 = time.monotonic()
    fetched_at = datetime.now(timezone.utc)
    token, page, studies, total, last = None, 0, 0, None, 0.0
    while True:
        wait = ctgov.MIN_INTERVAL_S - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
        last = time.monotonic()
        data = ctgov._get(params | ({"pageToken": token} if token else {}))
        total = data.get("totalCount", total)
        batch = data.get("studies", [])
        page += 1
        (raw / f"page_{page:05d}.json").write_text(json.dumps(batch), encoding="utf-8")
        studies += len(batch)
        print(f"[{slug}] page {page}: {studies}/{total}", flush=True)
        token = data.get("nextPageToken")
        if not token:
            break
    fetch_s = time.monotonic() - t0

    out = ind.db_path(slug)
    tmp = out.with_suffix(".db.tmp")
    if tmp.exists():
        tmp.unlink()
    # The normalizer reads <RAW_DIR>/<name>/page_*.json; point it at this indication's raw folder (a runtime
    # attribute, not an edit to the module).
    norm.RAW_DIR = raw_root
    stats = norm.normalize(slug, tmp)
    meta = {"slug": slug, "fetched_at": fetched_at.isoformat(timespec="seconds"),
            "snapshot_date": fetched_at.date().isoformat(), "fetch_seconds": f"{fetch_s:.1f}",
            "source": "ClinicalTrials.gov API v2 (https://clinicaltrials.gov/api/v2/studies)",
            "query": json.dumps(query), "total_count": str(total), "studies": str(studies), "pages": str(page)}
    con = sqlite3.connect(tmp)
    con.executescript(META_SCHEMA)
    con.executemany("INSERT INTO fetch_meta VALUES (?, ?)", meta.items())
    con.commit()
    con.close()
    tmp.replace(out)
    return {**meta, **stats, "db": str(out)}


def main(argv: list[str] | None = None) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--slug", default="breast-cancer")
    ap.add_argument("--count", nargs="*", help="print totals for these condition queries and exit")
    a = ap.parse_args(argv)
    if a.count:
        for c in a.count:
            print(f"{c}: {count(c)}", flush=True)
            time.sleep(ctgov.MIN_INTERVAL_S)
        return
    print(json.dumps(fetch(a.slug), indent=1))


if __name__ == "__main__":
    main()
