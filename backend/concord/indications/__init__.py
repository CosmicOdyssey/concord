"""Extra indications for Portfolio overlap: site overlap only (no eligibility overlap).

Each indication lives in its own SQLite file under the data dir (never data/concord.db), fetched from the
ClinicalTrials.gov API v2 by `python -m concord.indications.fetch --slug <slug>` and normalized with the same
site-identity and dedupe rules as the lung DB (concord.ingest.normalize, called as a library), so a site's id is
the same hash of (normalized facility, city, state, country) in both files.

Lung cancer stays in data/concord.db and is served by concord.overlap unchanged.
"""

from __future__ import annotations

from pathlib import Path

from concord.paths import DATA_DIR

LUNG = "lung"
SITE_ONLY_LABEL = "site overlap only; eligibility overlap is available for lung cancer"
# CT.gov statuses fetched: open or active at the download. Filtered server-side (filter.overallStatus).
FETCH_STATUSES = ("RECRUITING", "ACTIVE_NOT_RECRUITING", "ENROLLING_BY_INVITATION")

INDICATIONS: dict[str, dict] = {
    # Oncology like lung, so its sites are the same cancer-center network; 387 trials matched the fetch query on
    # 2026-10-17 (type 2 diabetes 120, heart failure 111, atrial fibrillation 42): a few hundred, many sponsors with
    # several concurrent trials.
    "breast-cancer": {
        "label": "Breast cancer",
        "noun": "breast cancer",
        "cond": "breast cancer",
    },
}


def indications_dir() -> Path:
    return DATA_DIR / "work" / "indications"


def db_path(slug: str) -> Path:
    return indications_dir() / f"{slug}.db"


def fetch_query(slug: str | None = None, cond: str | None = None) -> dict:
    """The exact CT.gov API v2 parameters the fetch sends (shown as the source in the UI)."""
    return {
        "query.cond": cond or INDICATIONS[slug]["cond"],
        "filter.advanced": ('AREA[StudyType]INTERVENTIONAL AND AREA[LeadSponsorClass]INDUSTRY AND '
                            'AREA[LocationCountry]"United States"'),
        "filter.overallStatus": ",".join(FETCH_STATUSES),
    }
