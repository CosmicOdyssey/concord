"""ClinicalTrials.gov API v2 crawler.

Pulls every interventional study for a condition (all statuses, so completed
trials are available for the backtest) and writes raw pages to disk. Resumable:
the next page token is checkpointed after every page, so a crash or Ctrl-C
picks up where it left off.

Standard library only, so it runs before the rest of the backend is installed.

    python -m concord.ingest.ctgov --name nsclc --cond "non-small cell lung cancer"
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://clinicaltrials.gov/api/v2/studies"
DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "raw" / "ctgov"
# CT.gov asks for ~50 req/min; stay under it.
MIN_INTERVAL_S = 1.4
PAGE_SIZE = 200
USER_AGENT = "concord-hackharvard/0.1 (research prototype)"


def _get(params: dict, retries: int = 6) -> dict:
    url = f"{BASE}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    delay = 5.0
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            code = getattr(e, "code", None)
            if code is not None and 400 <= code < 500 and code != 429:
                raise
            print(f"  request failed ({e}); retry {attempt + 1}/{retries} in {delay:.0f}s", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 120)
    raise RuntimeError(f"giving up on {url}")


def crawl(name: str, cond: str, extra_filter: str | None = None) -> Path:
    out = DATA_DIR / name
    out.mkdir(parents=True, exist_ok=True)
    state_path = out / "_state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if state.get("done"):
        print(f"[{name}] already complete ({state.get('studies', 0)} studies); delete {state_path} to re-crawl")
        return out

    advanced = "AREA[StudyType]INTERVENTIONAL"
    if extra_filter:
        advanced = f"({advanced}) AND ({extra_filter})"
    params = {
        "query.cond": cond,
        "filter.advanced": advanced,
        "fields": "protocolSection,hasResults",
        "pageSize": PAGE_SIZE,
        "countTotal": "true",
        "format": "json",
    }

    page = state.get("page", 0)
    token = state.get("next")
    studies = state.get("studies", 0)
    total = state.get("total")
    if page and not token:
        state["done"] = True
        state_path.write_text(json.dumps(state, indent=2))
        return out

    last = 0.0
    while True:
        wait = MIN_INTERVAL_S - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
        p = dict(params)
        if token:
            p["pageToken"] = token
        last = time.monotonic()
        data = _get(p)
        total = data.get("totalCount", total)
        batch = data.get("studies", [])
        page += 1
        (out / f"page_{page:05d}.json").write_text(json.dumps(batch), encoding="utf-8")
        studies += len(batch)
        token = data.get("nextPageToken")
        state = {
            "name": name,
            "cond": cond,
            "filter": advanced,
            "page": page,
            "next": token,
            "studies": studies,
            "total": total,
            "updated": datetime.now(timezone.utc).isoformat(),
            "done": token is None,
        }
        state_path.write_text(json.dumps(state, indent=2))
        print(f"[{name}] page {page}: {studies}/{total} studies", flush=True)
        if token is None:
            break

    print(f"[{name}] done: {studies} studies in {page} pages -> {out}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", default="nsclc", help="output folder name under data/raw/ctgov")
    ap.add_argument("--cond", default="non-small cell lung cancer", help="CT.gov condition query")
    ap.add_argument("--filter", default=None, help="extra Essie expression ANDed into filter.advanced")
    args = ap.parse_args()
    crawl(args.name, args.cond, args.filter)


if __name__ == "__main__":
    main()
