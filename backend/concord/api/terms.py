"""Protocol-to-terms endpoints (concord.terms). No forecasting: schedules, coverage labels and prices
from published fee schedules only.

Every pricing endpoint takes the same query parameters:
  site_id      a registered U.S. site of the trial (GET /sites lists them)
  multiplier   fraction of Medicare applied to coded items (1.0 = 100%)
  overrides    JSON object {node_id: "routine" | "research"} (reviewer overrides)
  standard     JSON object {item_id: amount} (edits to the proposed standard schedule; overhead as a fraction)
"""

from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, PlainTextResponse
from pydantic import BaseModel, Field

from concord import proposal, terms

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
           standard: str | None = None) -> dict:
    """Per-visit payments at one site, every line with provenance."""
    return _call(terms.budget, nct.upper(), site_id, multiplier, _json_map(overrides, "overrides"),
                 _json_map(standard, "standard"))


@router.get("/{nct}/compare")
def compare(nct: str, site_a: str, site_b: str, multiplier: float = 1.0, overrides: str | None = None,
            standard: str | None = None) -> dict:
    """The same protocol at two sites; every difference decomposed into GPCI differences."""
    return _call(terms.compare, nct.upper(), site_a, site_b, multiplier, _json_map(overrides, "overrides"),
                 _json_map(standard, "standard"))


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


# ---------------------------------------------------------------- site proposal check (concord.proposal)

class ProposalIn(BaseModel):
    """A site's proposed prices as CSV text (item or code, amount), checked at one registered site."""
    site_id: str
    csv: str = Field(max_length=proposal.MAX_CSV_CHARS)
    band_low: float = proposal.BAND_DEFAULT[0]
    band_high: float = proposal.BAND_DEFAULT[1]
    multiplier: float = 1.0
    overrides: dict[str, str] = Field(default_factory=dict)
    standard: dict[str, float] = Field(default_factory=dict)
    detail: Literal["simple", "detailed"] = "simple"


def _check(nct: str, body: ProposalIn) -> dict:
    return _call(proposal.check, nct.upper(), body.site_id, body.csv, body.band_low, body.band_high,
                 body.multiplier, body.overrides, body.standard)


@router.post("/{nct}/proposal-check")
def proposal_check(nct: str, body: ProposalIn) -> dict:
    """Each row of a site's proposal matched to the protocol at that site and flagged against the Medicare
    amount x band (an assumption) or marked for itemized justification."""
    return _check(nct, body)


@router.get("/{nct}/proposal-sample")
def proposal_sample(nct: str) -> dict:
    """The SYNTHETIC sample proposal for this trial (invented to demonstrate the check; not a real site's)."""
    return _call(proposal.sample, nct.upper())


@router.post("/{nct}/counter-proposal.html", response_class=HTMLResponse)
def counter_proposal(nct: str, body: ProposalIn) -> HTMLResponse:
    """Printable counter-proposal (print to PDF from the browser). Simple: summary and flagged lines;
    detailed: every line."""
    res = _check(nct, body)
    name = f"counter-proposal_{res['nct_id']}_{res['site']['site_id']}.html"
    return HTMLResponse(proposal.counter_proposal_html(res, body.detail),
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})
