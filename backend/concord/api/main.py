"""Concord HTTP API.

    uvicorn concord.api.main:app --reload --port 8000

Every analysis endpoint takes the same scenario parameters (service.Params) either as a
JSON body (POST /api/clear) or as query parameters (GET endpoints).
"""

from __future__ import annotations

import json
import hashlib
import sqlite3
from dataclasses import asdict

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from concord import service
from concord.api import findings as findings_api
from concord.analysis.robustness import path_for
from concord.compiler.eligibility import eligible_fraction, extract_criteria
from concord.compiler.protocol import demo_protocol
from concord.paths import DB_PATH, RAW_DIR
from concord.ratecard import medicare

app = FastAPI(title="Concord", version="0.2.0",
              description="Clearing mechanism for clinical-trial enrollment capacity (HackHarvard 2026)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(__import__("concord.api.terms", fromlist=["router"]).router)  # protocol to terms (W2)


class Scenario(BaseModel):
    region: str = "US-Northeast"
    as_of: str | None = None
    sponsor: str | None = None
    beta: float | None = None
    low_history: str = "model"
    universe: str = "registered"
    activation_lag: float = 0.0
    overlap_scale: float = 1.0
    capacity_scale: float = 1.0
    max_trials: int | None = None

    def params(self) -> service.Params:
        if self.region not in service.REGIONS:
            raise HTTPException(400, f"unknown region {self.region}; one of {list(service.REGIONS)}")
        if self.low_history not in ("model", "prior", "exclude"):
            raise HTTPException(400, "low_history must be model | prior | exclude")
        if self.universe not in ("registered", "history"):
            raise HTTPException(400, "universe must be registered | history")
        return service.Params(**self.model_dump())


def scenario_q(region: str = "US-Northeast", as_of: str | None = None, sponsor: str | None = None,
               beta: float | None = None, low_history: str = "model", universe: str = "registered",
               activation_lag: float = 0.0, overlap_scale: float = 1.0, capacity_scale: float = 1.0,
               max_trials: int | None = None) -> Scenario:
    return Scenario(region=region, as_of=as_of, sponsor=sponsor, beta=beta, low_history=low_history,
                    universe=universe, activation_lag=activation_lag, overlap_scale=overlap_scale,
                    capacity_scale=capacity_scale, max_trials=max_trials)


def _clear(p: service.Params) -> dict:
    try:
        return service.clear(p)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


def _meta() -> dict:
    con = sqlite3.connect(DB_PATH)
    try:
        return {k: json.loads(v) for k, v in con.execute("SELECT key, value FROM meta")}
    except sqlite3.OperationalError:
        return {}
    finally:
        con.close()


app.include_router(__import__("concord.financial", fromlist=["router"]).router)
app.include_router(__import__("concord.portfolio", fromlist=["router"]).router)
app.include_router(findings_api.router)  # findings landing page (W3)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "db": DB_PATH.exists()}


@app.get("/api/status")
def status() -> dict:
    """Crawl and model build status, backtest, congestion test."""
    crawls = {}
    for d in RAW_DIR.glob("*/_state.json") if RAW_DIR.exists() else []:
        crawls[d.parent.name] = json.loads(d.read_text())
    out: dict = {"crawls": crawls, "db": DB_PATH.exists()}
    if DB_PATH.exists():
        con = sqlite3.connect(DB_PATH)
        out["counts"] = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                         for t in ("trials", "sites", "trial_sites")}
        con.close()
        out["model"] = _meta()
    return out


@app.get("/api/congestion-test")
def congestion_test() -> dict:
    """Does competition at the same sites slow enrollment? (concord.analysis.congestion)"""
    m = _meta().get("congestion_test")
    if not m:
        raise HTTPException(503, "run python -m concord.analysis.congestion")
    return m


@app.get("/api/regions")
def regions() -> list[str]:
    return list(service.REGIONS)


@app.get("/api/sponsors")
def sponsors(region: str = "US", as_of: str | None = None, min_trials: int = 2) -> list[dict]:
    """Sponsors with several concurrent industry Phase II/III lung trials (portfolio-clearing candidates)."""
    if region not in service.REGIONS:
        raise HTTPException(400, f"unknown region {region}")
    from concord.model.recruitment import ENROLL_FRACTION
    con = sqlite3.connect(DB_PATH)
    # Same definitions as the instance builder: region by site state, as_of = inside the enrollment window.
    states = service.REGIONS[region]
    region_sql = "s.country='United States'" + (f" AND s.state IN ({','.join('?' * len(states))})" if states else "")
    when = (f"t.status NOT IN ('WITHDRAWN') AND t.start_date <= ? AND julianday(t.start_date) + {ENROLL_FRACTION} * (julianday(COALESCE("
            "t.primary_completion_date, t.completion_date, '2100-01-01')) - julianday(t.start_date)) > julianday(?)"
            if as_of else "t.status='RECRUITING'")
    rows = con.execute(f"""SELECT t.sponsor, COUNT(DISTINCT t.nct_id) FROM trials t JOIN trial_model tm USING(nct_id)
                           JOIN trial_sites ts USING(nct_id) JOIN sites s USING(site_id)
                           WHERE {service.BASE_FILTER} AND {when} AND {region_sql}
                           GROUP BY t.sponsor HAVING COUNT(DISTINCT t.nct_id) >= ?
                           ORDER BY 2 DESC LIMIT 40""",
                       ([as_of, as_of] if as_of else []) + list(states or []) + [min_trials]).fetchall()
    con.close()
    return [{"sponsor": s, "trials": n} for s, n in rows]


@app.post("/api/clear")
def clear(req: Scenario) -> dict:
    """Registered vs independent vs coordinated (free and no-loser) allocations."""
    return _clear(req.params())["result"]


@app.get("/api/robustness")
def robustness(sc: Scenario = Depends(scenario_q), compute: bool = False) -> dict:
    """Headline under each congestion elasticity x site-rate rule. Served from the precomputed file
    (python -m concord.analysis.robustness); compute=true runs it now (minutes)."""
    p = sc.params()
    path = path_for(p)
    if path.exists() and not compute:
        raw = path.read_bytes()
        artifact = json.loads(raw)
        # The legacy filename omits parameters. Never reuse an incompatible run.
        requested = json.loads(json.dumps(asdict(p)))
        if artifact.get('params') != requested:
            raise HTTPException(409, 'Saved robustness artifact does not match all requested inputs; regenerate explicitly with the required dataset')
        return {**artifact, 'execution_mode':'artifact_replay',
                'artifact_evidence':{'sha256':hashlib.sha256(raw).hexdigest(),
                                     'params_match':True,
                                     'historical_predictive_status':'UNVERIFIED'}}
    if not compute:
        raise HTTPException(404, f"not precomputed; run python -m concord.analysis.robustness --region {p.region}"
                                 + (f" --sponsor '{p.sponsor}'" if p.sponsor else "")
                                 + (f" --as-of {p.as_of}" if p.as_of else "") + " or pass compute=true")
    return service.robustness(p)


@app.get("/api/trials/{nct_id}/price-tags")
def price_tags(nct_id: str, sc: Scenario = Depends(scenario_q)) -> dict:
    p = sc.params()
    run = _clear(p)
    if nct_id not in run["built"].inst.trial_ids:
        raise HTTPException(404, f"{nct_id} is not in this instance")
    return service.price_tags(p, nct_id)


@app.get("/api/slot-values")
def slot_values(sc: Scenario = Depends(scenario_q), top: int = Query(12, le=40)) -> list[dict]:
    p = sc.params()
    _clear(p)
    return service.slot_values(p, top=top)


@app.get("/api/protocol/demo")
def protocol() -> dict:
    proto = demo_protocol()
    return {**proto.model_dump(), "requirements": proto.requirements()}


@app.get("/api/termsheet")
def termsheet(site_id: str, nct_id: str | None = None, multiplier: float = 1.0,
              sc: Scenario = Depends(scenario_q)) -> dict:
    """Pre-cleared terms for a (demo protocol, site) match. If nct_id is given, expected patients
    come from that trial's share of enrollment at the site in the headline (no-loser) allocation."""
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    row = con.execute("SELECT * FROM sites WHERE site_id=?", (site_id,)).fetchone()
    con.close()
    if row is None:
        raise HTTPException(404, "unknown site")
    site = dict(row)
    expected, expected_source = 10.0, "placeholder: no cleared match given"
    if nct_id:
        run = _clear(sc.params())
        inst, x = run["built"].inst, run["x"]["coord"]
        if nct_id in inst.trial_ids and site_id in inst.site_ids:
            s, p = inst.site_ids.index(site_id), inst.trial_ids.index(nct_id)
            if x[s, p]:
                from concord.allocator.core import State
                st = State(inst, x)
                share = inst.base[s, p] * inst.g(st.load[s, p]) / max(st.R[p], 1e-12)
                expected, expected_source = float(inst.N[p] * share), "headline allocation"
            else:
                expected_source = "placeholder: pair not in the headline allocation"
    return {**medicare.term_sheet(demo_protocol(), site, expected, multiplier), "expected_source": expected_source}


class EligibilityText(BaseModel):
    text: str


@app.post("/api/compile/eligibility")
def compile_eligibility(body: EligibilityText) -> dict:
    """Free-text criteria -> predicates with provenance (rule-based MVP; review required)."""
    crit = extract_criteria(body.text)
    pop = service.population()
    return {"criteria": [c.to_dict() for c in crit],
            "eligible_fraction": eligible_fraction(crit, pop) if crit else None,  # unknown is never 100%
            "parser": "rule-based v0", "review_required": True}


from concord.api.overlap import router as overlap_router  # noqa: E402  portfolio overlap audit
app.include_router(overlap_router)
app.include_router(__import__("concord.api.site_scores", fromlist=["router"]).router)  # site scores tab
