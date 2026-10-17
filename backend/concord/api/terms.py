"""Protocol-to-terms endpoints (concord.terms). No forecasting: schedules, coverage labels and prices
from published fee schedules only.

Every pricing endpoint takes the same query parameters:
  site_id      a registered U.S. site of the trial (GET /sites lists them)
  multiplier   fraction of Medicare applied to coded items (1.0 = 100%)
  overrides    JSON object {node_id: "routine" | "research"} (reviewer overrides)
  standard     JSON object {item_id: amount} (edits to the proposed standard schedule; overhead as a fraction)
budget and compare also take band_lo / band_hi (fractions of Medicare, default 1.0 / 1.5; an assumption): the
low-high range on coded lines and totals (concord.anchoring).
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, PlainTextResponse

from concord import terms

router = APIRouter(prefix="/api/terms-flow", tags=["protocol to terms"])


def _json_map(raw: str | None, name: str) -> dict:
    if not raw:
        return {}
    try:
        v = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"{name} must be a JSON object: {e}") from e
    if not isinstance(v, dict):
        raise HTTPException(400, f"{name} must be a JSON object")
    return v


def _call(fn, *args, **kw):
    try:
        return fn(*args, **kw)
    except terms.NotFound as e:
        raise HTTPException(404, str(e)) from e
    except (terms.TermsError, ValueError, TypeError) as e:
        raise HTTPException(400, str(e)) from e


@router.get("/trials")
def list_trials() -> list[dict]:
    """Demo trials with an authored schedule of assessments."""
    return _call(terms.trials)


@router.get("/{nct}/protocol")
def protocol(nct: str) -> dict:
    """Schedule of assessments (visits x procedures, windows), coverage rules and node labels."""
    return _call(terms.protocol_view, nct.upper())


@router.get("/{nct}/sites")
def sites(nct: str) -> dict:
    """Registered U.S. sites with their Medicare locality, and the preselected comparison pair."""
    return _call(terms.sites, nct.upper())


@router.get("/{nct}/budget")
def budget(nct: str, site_id: str, multiplier: float = 1.0, overrides: str | None = None,
           standard: str | None = None, band_lo: float = 1.0, band_hi: float = 1.5) -> dict:
    """Per-visit payments at one site, every line with provenance, anchoring and a low-high band."""
    return _call(terms.budget, nct.upper(), site_id, multiplier, _json_map(overrides, "overrides"),
                 _json_map(standard, "standard"), band_lo, band_hi)


@router.get("/{nct}/compare")
def compare(nct: str, site_a: str, site_b: str, multiplier: float = 1.0, overrides: str | None = None,
            standard: str | None = None, band_lo: float = 1.0, band_hi: float = 1.5) -> dict:
    """The same protocol at two sites; every difference decomposed into GPCI differences."""
    return _call(terms.compare, nct.upper(), site_a, site_b, multiplier, _json_map(overrides, "overrides"),
                 _json_map(standard, "standard"), band_lo, band_hi)


def _sheet(nct: str, site_id: str, multiplier: float, overrides: str | None, standard: str | None,
           compare_site: str | None) -> dict:
    return _call(terms.termsheet, nct.upper(), site_id, multiplier, _json_map(overrides, "overrides"),
                 _json_map(standard, "standard"), compare_site or None)


@router.get("/{nct}/termsheet.md", response_class=PlainTextResponse)
def termsheet_md(nct: str, site_id: str, multiplier: float = 1.0, overrides: str | None = None,
                 standard: str | None = None, compare_site: str | None = Query(None),
                 download: bool = True) -> PlainTextResponse:
    """Markdown term sheet (download)."""
    ts = _sheet(nct, site_id, multiplier, overrides, standard, compare_site)
    headers = {"Content-Disposition": f'attachment; filename="{ts["filename"]}"'} if download else {}
    return PlainTextResponse(terms.termsheet_markdown(ts), media_type="text/markdown; charset=utf-8", headers=headers)


@router.get("/{nct}/termsheet.html", response_class=HTMLResponse)
def termsheet_html(nct: str, site_id: str, multiplier: float = 1.0, overrides: str | None = None,
                   standard: str | None = None, compare_site: str | None = Query(None)) -> HTMLResponse:
    """Print-friendly term sheet (print to PDF from the browser)."""
    ts = _sheet(nct, site_id, multiplier, overrides, standard, compare_site)
    return HTMLResponse(terms.termsheet_html(ts))


# ---------------------------------------------------------------- locality distribution and spreads (P2.5, P2.6)

from concord import terms_spread  # noqa: E402 - kept with the routes it serves


@router.get("/{nct}/locality-distribution")
def locality_distribution(nct: str, site_a: str | None = None, site_b: str | None = None,
                          overrides: str | None = None) -> dict:
    """Per-participant procedure cost in every Medicare locality at 100% of Medicare, sites marked."""
    return _call(terms_spread.locality_distribution, nct.upper(), site_a or None, site_b or None,
                 _json_map(overrides, "overrides"))


@router.get("/{nct}/spreads")
def spreads(nct: str, site_a: str, site_b: str | None = None, mult_lo: float = 1.0, mult_hi: float = 1.5,
            fee_lo: float = 0.75, fee_hi: float = 1.25, overrides: str | None = None,
            standard: str | None = None) -> dict:
    """Per-participant ranges from geography, the multiplier band and a band on non-procedure fees."""
    return _call(terms_spread.spreads, nct.upper(), site_a, site_b or None, mult_lo, mult_hi, fee_lo, fee_hi,
                 _json_map(overrides, "overrides"), _json_map(standard, "standard"))
