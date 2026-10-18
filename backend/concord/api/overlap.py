"""Portfolio overlap audit endpoints (concord.overlap). Descriptive only: counts, dates and
eligibility shares on the synthetic population; no enrollment forecasts.

    GET /api/overlap/sponsors?as_of=YYYY-MM-DD&region=US
    GET /api/overlap?sponsor=...&as_of=YYYY-MM-DD&region=US
    GET /api/overlap/self-overlap        (data/findings/self_overlap.json, built by python -m concord.overlap)
    GET /api/overlap/indications         (lung + extra indications whose DB file exists; concord.indications)

`indication` (sponsors and audit): omitted, "" or "lung" = the lung audit, unchanged. Another slug reads that
indication's own DB file and returns shared registered sites and months both recruiting only (no eligibility
overlap; concord.indications.sites); only its snapshot date is served.

`region` is a service.REGIONS key; omit it (or pass "" / "all") for every registered site worldwide.
`as_of` defaults to the registry snapshot (the CT.gov download date, returned as snapshot_date); a later
date is refused with 400, because the audit describes the registry and never projects forward.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from concord import indications, overlap
from concord.indications import sites as indication_sites

router = APIRouter(prefix="/api/overlap", tags=["portfolio overlap"])

_WORLD = ("", "all", "world", "worldwide")


def _region(region: str | None) -> str | None:
    return None if region is None or region.strip().lower() in _WORLD else region


def _other(indication: str | None) -> str | None:
    """The extra indication's slug, or None for lung (the default)."""
    return None if indication is None or indication.strip().lower() in ("", indications.LUNG) else indication


def _call(fn, *args):
    try:
        return fn(*args)
    except indication_sites.UnknownIndication as e:
        raise HTTPException(404, str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(503, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/indications")
def overlap_indications() -> dict:
    """Lung (eligibility overlap) and each extra indication fetched into its own DB (site overlap only)."""
    return {"indications": _call(indication_sites.available), "site_only_label": indications.SITE_ONLY_LABEL}


@router.get("/sponsors")
def overlap_sponsors(as_of: str | None = None, region: str | None = None, indication: str | None = None) -> dict:
    """Industry lead sponsors with >= 2 lung trials recruiting on the date (estimated enrollment window)."""
    if slug := _other(indication):
        return _call(indication_sites.sponsors, slug, as_of, _region(region))
    return _call(overlap.sponsors, as_of, _region(region))


@router.get("/self-overlap")
def self_overlap() -> dict:
    """Same-sponsor concurrent pairs sharing >= 10 sites with >= 0.8 eligibility overlap (precomputed)."""
    if not overlap.SELF_OVERLAP_OUT.exists():
        raise HTTPException(404, "not computed; run python -m concord.overlap")
    return json.loads(overlap.SELF_OVERLAP_OUT.read_text(encoding="utf-8"))


@router.get("")
def overlap_audit(sponsor: str, as_of: str | None = None, region: str | None = None,
                  indication: str | None = None) -> dict:
    """One sponsor's lung trials recruiting on the date, and every pair: shared registered sites,
    eligibility overlap both ways, months both recruiting (estimated) and a criteria diff."""
    if slug := _other(indication):
        res = _call(indication_sites.audit, slug, sponsor, as_of, _region(region))
        if not res["sponsor_known"]:
            raise HTTPException(404, f"no {res['indication_label'].lower()} trials with lead sponsor {sponsor!r}")
        return res
    res = _call(overlap.audit, sponsor, as_of, _region(region))
    if not res["sponsor_known"]:
        raise HTTPException(404, f"no lung trials with lead sponsor {sponsor!r}")
    return res
