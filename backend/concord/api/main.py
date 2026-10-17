"""Concord HTTP API.

    uvicorn concord.api.main:app --reload --port 8000
"""

from __future__ import annotations

import json
import sqlite3

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from concord import service
from concord.compiler.eligibility import eligible_fraction, extract_criteria
from concord.compiler.protocol import demo_protocol
from concord.paths import DB_PATH, RAW_DIR
from concord.ratecard import medicare

app = FastAPI(title="Concord", version="0.1.0",
              description="Clearing mechanism for clinical-trial enrollment capacity (HackHarvard 2026)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _params(region: str, activation_lag: float, overlap_scale: float, capacity_scale: float,
            max_trials: int | None) -> service.Params:
    if region not in service.REGIONS:
        raise HTTPException(400, f"unknown region {region}; one of {list(service.REGIONS)}")
    return service.Params(region=region, activation_lag=activation_lag, overlap_scale=overlap_scale,
                          capacity_scale=capacity_scale, max_trials=max_trials)


def _clear(p: service.Params) -> dict:
    try:
        return service.clear(p)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))


class ClearRequest(BaseModel):
    region: str = "US-Northeast"
    activation_lag: float = 6.0
    overlap_scale: float = 1.0
    capacity_scale: float = 1.0
    max_trials: int | None = None


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "db": DB_PATH.exists()}


@app.get("/api/status")
def status() -> dict:
    """Crawl and model build status, plus the backtest."""
    crawls = {}
    for d in RAW_DIR.glob("*/_state.json") if RAW_DIR.exists() else []:
        crawls[d.parent.name] = json.loads(d.read_text())
    out: dict = {"crawls": crawls, "db": DB_PATH.exists()}
    if DB_PATH.exists():
        con = sqlite3.connect(DB_PATH)
        out["counts"] = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                         for t in ("trials", "sites", "trial_sites")}
        try:
            out["model"] = {k: json.loads(v) for k, v in con.execute("SELECT key, value FROM meta")}
        except sqlite3.OperationalError:
            out["model"] = None
        con.close()
    return out


@app.get("/api/regions")
def regions() -> list[str]:
    return list(service.REGIONS)


@app.post("/api/clear")
def clear(req: ClearRequest) -> dict:
    """Run actual vs independent vs coordinated allocation for a region."""
    p = _params(req.region, req.activation_lag, req.overlap_scale, req.capacity_scale, req.max_trials)
    return _clear(p)["result"]


@app.get("/api/trials/{nct_id}/price-tags")
def price_tags(nct_id: str, region: str = "US-Northeast", activation_lag: float = 6.0, overlap_scale: float = 1.0,
               capacity_scale: float = 1.0, max_trials: int | None = None) -> dict:
    p = _params(region, activation_lag, overlap_scale, capacity_scale, max_trials)
    run = _clear(p)
    if nct_id not in run["built"].inst.trial_ids:
        raise HTTPException(404, f"{nct_id} is not in the {region} instance")
    return service.price_tags(p, nct_id)


@app.get("/api/slot-values")
def slot_values(region: str = "US-Northeast", activation_lag: float = 6.0, overlap_scale: float = 1.0,
                capacity_scale: float = 1.0, max_trials: int | None = None, top: int = Query(12, le=40)) -> list[dict]:
    p = _params(region, activation_lag, overlap_scale, capacity_scale, max_trials)
    _clear(p)
    return service.slot_values(p, top=top)


@app.get("/api/protocol/demo")
def protocol() -> dict:
    proto = demo_protocol()
    return {**proto.model_dump(), "requirements": proto.requirements()}


@app.get("/api/termsheet")
def termsheet(site_id: str, nct_id: str | None = None, region: str = "US-Northeast", multiplier: float = 1.0) -> dict:
    """Pre-cleared terms for a (demo protocol, site) match. If nct_id is given, expected patients
    come from that trial's cleared allocation at the site."""
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    row = con.execute("SELECT * FROM sites WHERE site_id=?", (site_id,)).fetchone()
    con.close()
    if row is None:
        raise HTTPException(404, "unknown site")
    site = dict(row)
    expected = 10.0
    if nct_id:
        run = _clear(service.Params(region=region))
        inst, x = run["built"].inst, run["x_coord"]
        if nct_id in inst.trial_ids and site_id in inst.site_ids:
            s, p = inst.site_ids.index(site_id), inst.trial_ids.index(nct_id)
            if x[s, p]:
                from concord.allocator.core import State
                st = State(inst, x)
                share = (inst.base[s, p] / (1 + st.load[s, p])) / max(st.R[p], 1e-12)
                expected = float(inst.N[p] * share)
    return medicare.term_sheet(demo_protocol(), site, expected, multiplier)


class EligibilityText(BaseModel):
    text: str


@app.post("/api/compile/eligibility")
def compile_eligibility(body: EligibilityText) -> dict:
    """Free-text criteria -> predicates with provenance (rule-based MVP; review required)."""
    crit = extract_criteria(body.text)
    pop = service.population()
    return {"criteria": [c.to_dict() for c in crit], "eligible_fraction": eligible_fraction(crit, pop),
            "parser": "rule-based v0", "review_required": True}
