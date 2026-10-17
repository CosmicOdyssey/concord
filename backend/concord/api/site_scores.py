"""Site scores endpoints (concord.site_scores): historical, registry-based site enrollment scores with their
breakdown and observed-outcome validation. Not forecasts for a new trial, and not a ranking of sites to pick.

    GET /api/site-scores            U.S. non-anonymized sites with at least one fitted trial (filter, sort, page)
    GET /api/site-scores/summary    method, prior, history-depth buckets, score histogram, validation block
    GET /api/site-scores/{site_id}  full breakdown of one site's score, with its contributing trials
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from concord import site_scores

router = APIRouter(prefix="/api/site-scores", tags=["site scores"])


def _call(fn, *args, **kw):
    try:
        return fn(*args, **kw)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e)) from e
    except site_scores.NotFound as e:
        raise HTTPException(404, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("")
def list_sites(region: str = "US", state: str | None = None, q: str | None = None,
               min_trials: int = Query(1, ge=1), sort: str = "-n_fit", limit: int = Query(50, ge=1, le=500),
               offset: int = Query(0, ge=0)) -> dict:
    """Default sort is fitted trials, most first (history depth), not score."""
    return _call(site_scores.list_sites, region=region, state=state, q=q, min_trials=min_trials, sort=sort,
                 limit=limit, offset=offset)


@router.get("/summary")
def summary() -> dict:
    return _call(site_scores.summary)


@router.get("/{site_id}")
def site(site_id: str) -> dict:
    return _call(site_scores.site_detail, site_id)
