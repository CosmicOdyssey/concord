"""Portfolio overlap audit endpoints (concord.overlap). Descriptive only: counts, dates and
eligibility shares on the synthetic population; no enrollment forecasts.

    GET /api/overlap/sponsors?as_of=YYYY-MM-DD&region=US
    GET /api/overlap?sponsor=...&as_of=YYYY-MM-DD&region=US
    GET /api/overlap/self-overlap        (data/findings/self_overlap.json, built by python -m concord.overlap)

`region` is a service.REGIONS key; omit it (or pass "" / "all") for every registered site worldwide.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from concord import overlap

router = APIRouter(prefix="/api/overlap", tags=["portfolio overlap"])

_WORLD = ("", "all", "world", "worldwide")


def _region(region: str | None) -> str | None:
    return None if region is None or region.strip().lower() in _WORLD else region


def _call(fn, *args):
    try:
        return fn(*args)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/sponsors")
def overlap_sponsors(as_of: str | None = None, region: str | None = None) -> dict:
    """Industry lead sponsors with >= 2 lung trials recruiting on the date (estimated enrollment window)."""
    return _call(overlap.sponsors, as_of, _region(region))


@router.get("/self-overlap")
def self_overlap() -> dict:
    """Same-sponsor concurrent pairs sharing >= 10 sites with >= 0.8 eligibility overlap (precomputed)."""
    if not overlap.SELF_OVERLAP_OUT.exists():
        raise HTTPException(404, "not computed; run python -m concord.overlap")
    return json.loads(overlap.SELF_OVERLAP_OUT.read_text(encoding="utf-8"))


@router.get("")
def overlap_audit(sponsor: str, as_of: str | None = None, region: str | None = None) -> dict:
    """One sponsor's lung trials recruiting on the date, and every pair: shared registered sites,
    eligibility overlap both ways, months both recruiting (estimated) and a criteria diff."""
    res = _call(overlap.audit, sponsor, as_of, _region(region))
    if not res["sponsor_known"]:
        raise HTTPException(404, f"no lung trials with lead sponsor {sponsor!r}")
    return res
