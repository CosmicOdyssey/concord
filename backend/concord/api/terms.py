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
def proposal_sample(nct: str) -> dict | None:
    """The SYNTHETIC sample proposal for this trial (invented to demonstrate the check; not a real site's); null
    for a known trial without one (404 only for an unknown trial)."""
    _call(terms.load_protocol, nct.upper())
    if not proposal.sample_path(nct.upper()).exists():
        return None
    return _call(proposal.sample, nct.upper())


@router.post("/{nct}/counter-proposal.html", response_class=HTMLResponse)
def counter_proposal(nct: str, body: ProposalIn) -> HTMLResponse:
    """Printable counter-proposal (print to PDF from the browser). Simple: summary and flagged lines;
    detailed: every line."""
    res = _check(nct, body)
    name = (f"counter-proposal_{res['nct_id']}_{res['site']['site_id']}"
            f"{'_SYNTHETIC' if res.get('synthetic') else ''}.html")
    return HTMLResponse(proposal.counter_proposal_html(res, body.detail),
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------------------------------------------------------------- one line, step by step (concord.line_detail)

from concord import line_detail as _line_detail  # noqa: E402 - kept with the route it serves


@router.get("/{nct}/line-detail")
def line_detail(nct: str, node_id: str, site_a: str, site_b: str | None = None, multiplier: float = 1.0,
                overrides: str | None = None, standard: str | None = None) -> dict:
    """One term-sheet line's price, step by step: CMS units x each site's regional adjustments x the conversion
    factor = Medicare rate, then x multiplier + overhead (assumptions) = sponsor price, reconciled with Budget."""
    return _call(_line_detail.line_detail, nct.upper(), node_id, site_a, site_b or None, multiplier,
                 _json_map(overrides, "overrides"), _json_map(standard, "standard"))


# ---------------------------------------------------------------- any trial: add by NCT ID, SoA CSV (trial_import)

from concord import trial_import  # noqa: E402 - kept with the routes it serves


class AddTrialIn(BaseModel):
    nct_id: str = Field(max_length=20)


class SoaIn(BaseModel):
    csv: str = Field(max_length=trial_import.MAX_CSV_CHARS)


@router.post("/add-trial")
def add_trial(body: AddTrialIn) -> dict:
    """Fetch a trial once from the public ClinicalTrials.gov API v2 into the data dir's cache and draft its
    schedule from the registry (every drafted item cited). 404 for an unknown NCT ID."""
    return _call(trial_import.add_trial, body.nct_id)


@router.get("/soa-template.csv", response_class=PlainTextResponse)
def soa_template() -> PlainTextResponse:
    """Schedule of assessments CSV template (visit, day, procedure, code, repeats)."""
    return PlainTextResponse(trial_import.template_csv(), media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": 'attachment; filename="schedule-of-assessments_template.csv"'})


@router.get("/{nct}/soa.csv", response_class=PlainTextResponse)
def soa_export(nct: str) -> PlainTextResponse:
    """Any trial's current schedule in the template format (edit it and upload it back for an added trial)."""
    text = _call(trial_import.export_csv, nct.upper())
    return PlainTextResponse(text, media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="schedule-of-assessments_{nct.upper()}.csv"'})


@router.post("/{nct}/soa-csv")
def soa_upload(nct: str, body: SoaIn) -> dict:
    """Replace an added trial's schedule with an uploaded schedule of assessments (CSV)."""
    return _call(trial_import.upload_soa, nct.upper(), body.csv)


@router.post("/{nct}/soa-draft")
def soa_draft(nct: str) -> dict:
    """Go back to the draft from the registry for an added trial."""
    return _call(trial_import.reset_draft, nct.upper())
