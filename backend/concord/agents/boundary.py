"""Typed, local sponsor tools. They never write clinical criteria or infer evidence."""
from __future__ import annotations

import json
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field

from concord import portfolio as p
from concord import hackharvard_demo as demo


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class PortfolioQuery(StrictModel):
    include_baseline: bool = True
    include_registry_context: bool = True
    include_financials: bool = True


class SimulationRequest(StrictModel):
    budget_ceiling: float = Field(3_000_000.0, ge=100_000.0, le=10_000_000.0)
    seed: int = Field(7, ge=0, le=2**31 - 1)
    draws: int = Field(32, ge=32, le=128)
    realized_admin_savings: bool = False
    rate_boost: float = Field(0.0, ge=0.0, le=0.5)


class ProposedAmendment(StrictModel):
    proposal_id: str = Field(min_length=3, max_length=64)
    trial_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")
    category: Literal["OPERATIONAL", "SITE_ACTIVATION", "VISIT_BURDEN", "ELIGIBILITY_HYPOTHETICAL"]
    description: str = Field(min_length=10, max_length=500)
    activation_lag_months: float | None = Field(None, ge=0.0, le=12.0)
    monthly_outreach_budget: float | None = Field(None, ge=0.0, le=50_000.0)
    site_slot_delta: int | None = Field(None, ge=-2, le=2)
    modifies_clinical_inclusion_exclusion: bool = False
    clinical_safety_reviewed: bool = False
    validation_status: Literal["VALIDATED_OPERATIONAL", "UNVALIDATED_ELIGIBILITY", "REJECTED_SAFETY_VIOLATION"] = "VALIDATED_OPERATIONAL"


class AgentExecutionTrace(StrictModel):
    trace_id: str
    agent_name: str
    timestamp: str
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    initial_proposal: dict[str, Any] | None = None
    refinements: list[dict[str, Any]] = Field(default_factory=list)
    final_disposition: str
    safety_violations: list[str] = Field(default_factory=list)
    human_approval_required: bool = True
    human_approval_status: Literal["PENDING", "APPROVED", "REJECTED"] = "PENDING"


def get_portfolio_status(query: PortfolioQuery) -> dict[str, Any]:
    base = demo.baseline()
    response = {key: base.get(key) for key in ("data_mode", "scope", "historical_predictive_performance", "fixture_sha256")}
    if query.include_baseline:
        response["baseline"] = base["baseline"]
        if not query.include_financials:
            response["baseline"] = {key: value for key, value in base["baseline"].items() if key != "ledger"}
    if query.include_registry_context:
        response["registry_context"] = base["registry_context"]
    return response


def run_safe_simulation(sim_req: SimulationRequest) -> dict[str, Any]:
    raw = demo.request().model_dump(mode="python")
    raw.update(budget=sim_req.budget_ceiling, seed=sim_req.seed, draws=sim_req.draws,
               savings_realized=sim_req.realized_admin_savings, operations_rate_effect=sim_req.rate_boost)
    return p.save(p.run(p.PortfolioRequest.model_validate(raw)))


def inspect_protocol_safely(trial_id: str) -> dict[str, Any]:
    context = json.loads(p.CONTEXT.read_text())
    trials = context if isinstance(context, list) else context.get("trials", [])
    matched = next((t for t in trials if t.get("nct_id") == trial_id or t.get("id") == trial_id), None)
    return {
        "trial_id": trial_id,
        "title": matched.get("title") if matched else None,
        "sponsor": matched.get("sponsor") if matched else None,
        "source_url": matched.get("source", matched.get("source_url")) if matched else None,
        "captured_at": matched.get("captured_at") if matched else None,
        "registry_status": "CONTEXT_ONLY" if matched else "NOT_FOUND",
        "eligibility_status": "UNKNOWN",
        "enrollment_evidence_status": "UNKNOWN",
        "hard_clinical_constraints": [],
        "candidate_operational_levers": ["Explicitly assumed activation lag", "Explicitly assumed outreach cost"],
        "limitations": "Registry context contains no verified clinical criteria, patient pool, enrollment outcomes or site capability evidence.",
    }


def validate_amendment_constraints(amendment: ProposedAmendment) -> tuple[bool, list[str]]:
    violations = []
    if amendment.modifies_clinical_inclusion_exclusion or amendment.category == "ELIGIBILITY_HYPOTHETICAL":
        violations.append("CRITICAL SAFETY VIOLATION: Autonomous mutation of clinical inclusion/exclusion criteria is prohibited.")
    amendment.validation_status = "REJECTED_SAFETY_VIOLATION" if violations else "VALIDATED_OPERATIONAL"
    return not violations, violations


def evidence_available_as_of(record: dict[str, Any], evaluation_date: str) -> bool:
    """Context capture dates alone do not establish a historical feature snapshot."""
    from datetime import datetime
    try:
        captured = datetime.fromisoformat(record["captured_at"].replace("Z", "+00:00"))
        evaluation = datetime.fromisoformat(evaluation_date.replace("Z", "+00:00"))
        return record.get("use") == "HISTORICAL_AS_OF_FEATURES" and captured <= evaluation
    except (KeyError, TypeError, ValueError):
        return False
