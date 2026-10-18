"""Bounded local operational proposal evaluator; no Factory SDK/model execution.

Each candidate is evaluated by the existing Concord event simulation and ledger
on the same seeded draw bank. Clinical criteria are never inputs to these tools.
Uncalibrated outreach spending has zero assumed enrollment effect.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any, Literal
import uuid

import numpy as np
from pydantic import Field
from concord import hackharvard_demo as demo
from concord import portfolio as p
from concord.agents.boundary import StrictModel, ProposedAmendment, inspect_protocol_safely, validate_amendment_constraints


_AGENT_PATHS = [Path(__file__), Path(__file__).with_name("boundary.py"), Path(__file__).with_name("factory_tools.py"), Path(__file__).with_name("sponsor_runtime.py"), p.ROOT / "scripts/factory-droid-runner.mjs"]
_EXECUTED_AGENT_SOURCES = {str(path.relative_to(p.ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in _AGENT_PATHS}


def now():
    return datetime.now(timezone.utc).isoformat()


class DroidToolAction(StrictModel):
    tool_name: str
    arguments: dict[str, Any]
    output_summary: str
    timestamp: str


class RefinementIteration(StrictModel):
    iteration_index: int
    proposed_amendment: dict[str, Any]
    simulation_metrics: dict[str, Any]
    chalk_score: float
    feedback: str
    decision: str


class DroidRecommendation(StrictModel):
    recommendation_id: str
    trial_id: str
    trial_title: str
    created_at: str
    runtime_agent: str
    total_iterations: int
    baseline_makespan_months: float
    recommended_makespan_months: float
    expected_makespan_delta_months: float
    budget_commitment_usd: float
    budget_ceiling_usd: float
    feasibility_status: Literal["FEASIBLE", "INFEASIBLE_BUDGET", "INFEASIBLE_CAPACITY"]
    clinical_safety_status: Literal["PASSED_NO_CLINICAL_MUTATION", "VIOLATION_REJECTED"]
    chalk_evaluation_score: float
    executive_summary: str
    human_approval_status: Literal["PENDING_HUMAN_REVIEW", "APPROVED", "REJECTED"]
    iterations: list[RefinementIteration]
    tool_trace: list[DroidToolAction]
    request_id: str
    scenario_id: str = "hackharvard-bundled-portfolio"
    provider_status: str = "NOT_INVOKED"
    execution_mode: str = "LOCAL_DETERMINISTIC"
    disposition: str
    provenance: dict[str, Any]
    error: dict[str, str] | None = None
    review_audit: list[dict[str, str]] = Field(default_factory=list)
    readiness: str = "LOCAL_SIMULATION_ONLY"
    auth_status: str = "NOT_VERIFIED"
    missing_prerequisites: list[str] = Field(default_factory=list)
    runtime_receipt: dict[str, Any] | None = None


def tool_inspect_protocol(trial_id: str, trace: list[DroidToolAction]) -> dict[str, Any]:
    info = inspect_protocol_safely(trial_id)
    trace.append(DroidToolAction(tool_name="inspect_protocol", arguments={"trial_id": trial_id},
        output_summary=f"Registry: {info['registry_status']}; clinical criteria and enrollment evidence: UNKNOWN.", timestamp=now()))
    return info


def tool_identify_operational_bottlenecks(trial_id: str, trace: list[DroidToolAction]) -> dict[str, Any]:
    req = demo.request()
    edges = [e for e in req.edges if e.trial == trial_id and e.baseline]
    levers = {"assumption_only": True, "baseline_activation_lags": [e.lag for e in edges],
              "outreach_enrollment_effect": "UNKNOWN; zero effect assumed", "candidate_improvements": ["reduce an existing activation lag, if positive", "outreach spending without assumed benefit may be rejected"]}
    trace.append(DroidToolAction(tool_name="identify_operational_bottlenecks", arguments={"trial_id": trial_id},
        output_summary="Inspected bundled operational assumptions; no verified real-world bottleneck is inferred.", timestamp=now()))
    return levers


def _evaluate_fixed(req):
    demo.require_isolated_data()
    if {**p.EXECUTED_SOURCES, **_EXECUTED_AGENT_SOURCES} != {str(path.relative_to(p.ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in [*p.RUNTIME_SOURCES, *_AGENT_PATHS]}:
        raise ValueError("Source changed since runtime start; restart before computing evidence")
    selected = frozenset(i for i, edge in enumerate(req.edges) if edge.baseline)
    shocks = np.random.default_rng(req.seed).lognormal(-req.spread**2 / 2, req.spread, (req.draws, len(req.edges)))
    simulation = p.sim.simulate(req, selected, shocks)
    finances = p.financial_inputs(req)
    ledger = p.price(req, selected, simulation, [p.fin.coverage(f) for f in finances], finances)
    violations = p.sim.network_errors(req, selected)
    if ledger["budget_commitment"] > req.budget + .005:
        violations.append("Conservative sponsor commitment exceeds fixed budget")
    if not simulation["complete"].all():
        violations.append("Incomplete assumed enrollment")
    if any(row["economics"]["hospital"]["net_contribution"] < req.hospital_floor - .005 for row in ledger["trials"]):
        violations.append("Hospital contribution below selected floor")
    return {"makespan": float(simulation["makespan"].mean()), "commitment": ledger["budget_commitment"],
            "feasible": not violations, "violations": violations}


def tool_simulate_operational_variant(trial_id: str, activation_lag: float, outreach_budget: float,
                                       trace: list[DroidToolAction]) -> dict[str, Any]:
    amendment = ProposedAmendment(proposal_id="local-tool-candidate", trial_id=trial_id, category="OPERATIONAL",
        description="Paired fixed-network operational assumption", activation_lag_months=activation_lag,
        monthly_outreach_budget=outreach_budget)
    if not validate_amendment_constraints(amendment)[0]:
        raise ValueError("Unsupported proposal")
    original = demo.request()
    if trial_id not in {trial.id for trial in original.trials}:
        raise ValueError("Unknown trial: no operational assumptions available")
    base = _evaluate_fixed(original)
    raw = original.model_dump(mode="python")
    for edge in raw["edges"]:
        if edge["trial"] == trial_id and edge["baseline"]:
            edge["lag"] = min(edge["lag"], activation_lag)
    for trial in raw["trials"]:
        if trial["id"] == trial_id:
            trial["admin"] += outreach_budget * 12
    changed = p.PortfolioRequest.model_validate(raw)
    candidate = _evaluate_fixed(changed)
    out = {"trial_id": trial_id, "baseline_makespan": base["makespan"],
        "simulated_makespan": candidate["makespan"], "makespan_delta": candidate["makespan"] - base["makespan"],
        "baseline_commitment": base["commitment"], "simulated_commitment": candidate["commitment"],
        "budget_ceiling": original.budget, "feasible": candidate["feasible"], "violations": candidate["violations"],
        "is_simulated_assumption": True, "seed": original.seed, "draws": original.draws,
        "assumptions": "Fixed baseline network; lag may only decrease an existing entered lag. Outreach is charged for 12 months with zero assumed recruitment effect; no clinical evidence supports an effect."}
    trace.append(DroidToolAction(tool_name="simulate_operational_variant",
        arguments={"trial_id": trial_id, "activation_lag": activation_lag, "outreach_budget": outreach_budget},
        output_summary=f"Original Concord engine, paired seed {original.seed}: delta {out['makespan_delta']:.6f} mo; feasible {out['feasible']}.", timestamp=now()))
    return out


def tool_evaluate_with_chalk(simulation_result: dict[str, Any], trace: list[DroidToolAction]) -> float:
    # Kept as a compatibility tool name, explicitly local and unrelated to remote Chalk.
    accepted = simulation_result["feasible"] and simulation_result["makespan_delta"] < -1e-8
    trace.append(DroidToolAction(tool_name="evaluate_with_chalk", arguments={"execution_mode": "LOCAL_DETERMINISTIC"},
        output_summary=f"Local feasibility and benefit checks; acceptable: {accepted}. No Chalk service called.", timestamp=now()))
    return float(accepted)


def execute_droid_protocol_agent(trial_id: str = "NCT05800015", max_iterations: int = 3, *, simulation_tool=None, proposals: list[ProposedAmendment] | None = None) -> DroidRecommendation:
    if not 1 <= max_iterations <= 3:
        raise ValueError("max_iterations must be between 1 and 3")
    rec_id = f"local-rec-{uuid.uuid4().hex}"
    trace: list[DroidToolAction] = []
    iterations = []
    info = tool_inspect_protocol(trial_id, trace)
    original = demo.request()
    if trial_id not in {trial.id for trial in original.trials}:
        raise ValueError("Unknown trial: no operational assumptions available")
    tool_identify_operational_bottlenecks(trial_id, trace)
    base = _evaluate_fixed(original)
    accepted = []
    error = None
    candidates = proposals if proposals is not None else [ProposedAmendment(proposal_id=f"candidate-{i}", trial_id=trial_id, category="OPERATIONAL",
        description="Illustrative operational proposal; evaluate rather than assume benefit.", activation_lag_months=lag,
        monthly_outreach_budget=outreach) for i, (lag, outreach) in enumerate([(2., 10000.), (1.8, 15000.), (1.7, 16000.)], 1)]
    for i, proposal in enumerate(candidates[:max_iterations], 1):
        if proposal.trial_id != trial_id or not validate_amendment_constraints(proposal)[0] or proposal.site_slot_delta is not None:
            error = {"code": "UNSUPPORTED_PROPOSAL", "message": "Candidate is outside approved operational tools; retained baseline."}
            break
        lag = proposal.activation_lag_months if proposal.activation_lag_months is not None else 12.
        outreach = proposal.monthly_outreach_budget if proposal.monthly_outreach_budget is not None else 0.
        try:
            metrics = (simulation_tool or tool_simulate_operational_variant)(trial_id, lag, outreach, trace)
            score = tool_evaluate_with_chalk(metrics, trace)
        except Exception:
            error = {"code": "REFINEMENT_FAILED", "message": "Local refinement failed; no failed or partial proposal is recommended."}
            iterations.append(RefinementIteration(iteration_index=i, proposed_amendment=proposal.model_dump(),
                simulation_metrics={}, chalk_score=0., feedback=error["message"], decision="STOPPED_EXECUTION_ERROR"))
            break
        if not metrics["feasible"]:
            decision, feedback = "REJECTED_CONSTRAINT_VIOLATION", "Candidate violates modeled constraints; retained baseline."
        elif metrics["makespan_delta"] >= -1e-8:
            decision, feedback = "REJECTED_NO_BENEFIT", "No modeled completion improvement; additional outreach spending is not a benefit. Retained baseline."
        else:
            decision, feedback = "FEASIBLE_IMPROVEMENT_REQUIRES_REVIEW", "Paired synthetic improvement only; not clinical evidence."
            accepted.append(metrics)
        iterations.append(RefinementIteration(iteration_index=i, proposed_amendment=proposal.model_dump(),
            simulation_metrics=metrics, chalk_score=score, feedback=feedback, decision=decision))
        # Do not recursively spend on variations of a failed, unsupported benefit.
        if not score:
            break
    best = min(accepted, key=lambda x: (x["simulated_makespan"], x["simulated_commitment"])) if accepted and not error else None
    disposition = "FAILED_RETAINED_BASELINE" if error else "PROPOSED_FOR_REVIEW" if best else "NO_BENEFICIAL_CHANGE"
    makespan = best["simulated_makespan"] if best else base["makespan"]
    commitment = best["simulated_commitment"] if best else base["commitment"]
    return DroidRecommendation(recommendation_id=rec_id, request_id=rec_id, trial_id=trial_id,
        trial_title=info.get("title") or trial_id, created_at=now(), runtime_agent="Concord local deterministic proposal evaluator (Factory not invoked)",
        total_iterations=len(iterations), baseline_makespan_months=base["makespan"], recommended_makespan_months=makespan,
        expected_makespan_delta_months=makespan-base["makespan"], budget_commitment_usd=commitment,
        budget_ceiling_usd=original.budget, feasibility_status="FEASIBLE" if base["feasible"] else "INFEASIBLE_BUDGET",
        clinical_safety_status="PASSED_NO_CLINICAL_MUTATION", chalk_evaluation_score=1. if best else 0.,
        executive_summary=f"Local deterministic evaluation: {disposition}. Paired synthetic makespan {makespan:.2f} months; modeled commitment ${commitment:,.0f}. No Factory or Chalk service called; no clinical criteria changed or clinical benefit established.",
        human_approval_status="PENDING_HUMAN_REVIEW" if best else "REJECTED", iterations=iterations,
        tool_trace=trace, disposition=disposition, error=error,
        provenance={"fixture_sha256": hashlib.sha256(demo.FIXTURE.read_bytes()).hexdigest(), "seed": original.seed,
                    "draws": original.draws, "data_mode": "SYNTHETIC_OPERATIONAL_ASSUMPTIONS", "clinical_evidence": "UNKNOWN", "canonical_protocol_mutated": False,
                    "input_sha256": hashlib.sha256(json.dumps(original.model_dump(mode="json"), sort_keys=True).encode()).hexdigest(),
                    "executed_source_sha256": {**p.EXECUTED_SOURCES, **_EXECUTED_AGENT_SOURCES}})


def get_droid_status():
    import os
    import shutil
    required = {"FACTORY_API_KEY": bool(os.environ.get("FACTORY_API_KEY")),
        "FACTORY_MODEL_ID": bool(os.environ.get("FACTORY_MODEL_ID")), "node executable": bool(shutil.which("node")),
        "droid executable": bool(shutil.which(os.environ.get("FACTORY_DROID_EXEC_PATH", "droid"))), "Factory SDK installation": (p.ROOT / "frontend/node_modules/@factory/droid-sdk/package.json").exists()}
    missing = [name for name, configured in required.items() if not configured]
    return {"provider_status": "IMPLEMENTED_UNVERIFIED", "readiness": "MISSING_CREDENTIALS" if missing else "CONFIGURED_UNVERIFIED",
        "missing_prerequisites": missing, "auth_status": "NOT_VERIFIED", "runtime": "@factory/droid-sdk/node 0.9.1",
        "live_execution_enabled": os.environ.get("CONCORD_ALLOW_FACTORY_RUN") == "1", "local_fallback_available": True}


def execute_live_factory(trial_id: str, max_iterations: int):
    """Explicitly gated by the API caller. SDK output proposes; engine decides."""
    import os
    import signal
    import subprocess
    import sys
    if os.environ.get("CONCORD_ALLOW_FACTORY_RUN") != "1" or get_droid_status()["missing_prerequisites"]:
        raise ValueError("Factory prerequisites are missing")
    if not 1 <= max_iterations <= 3 or trial_id not in {t.id for t in demo.request().trials}:
        raise ValueError("Unsupported Factory request")
    _evaluate_fixed(demo.request())  # Fence stale sources/pricing before any SDK or model request.
    environment = {key: os.environ[key] for key in ("PATH", "FACTORY_API_KEY", "FACTORY_MODEL_ID", "CONCORD_ALLOW_FACTORY_RUN", "FACTORY_DROID_EXEC_PATH") if key in os.environ}
    environment.update(CONCORD_BACKEND_PYTHON=sys.executable, PYTHONPATH=str(p.ROOT / "backend"))
    process = subprocess.Popen(["node", str(p.ROOT / "scripts/factory-droid-runner.mjs"), "--trial-id", trial_id,
        "--max-iterations", str(max_iterations)], cwd=p.ROOT, env=environment, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        output, _ = process.communicate(timeout=150)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
        raise ValueError("Factory execution timed out; process tree stopped") from None
    if process.returncode or len(output) > 1_000_000:
        raise ValueError("Factory execution failed; no live result claimed")
    try:
        receipt = json.loads(output)
        if receipt.get("status") != "SUCCEEDED" or not receipt.get("session_id"):
            raise ValueError("No successful terminal SDK result")
        proposals = [ProposedAmendment.model_validate(item) for item in receipt["proposals"]]
        if not proposals or len(proposals) > max_iterations:
            raise ValueError("Unsupported proposal count")
    except (ValueError, KeyError, TypeError):
        raise ValueError("Factory result did not satisfy the proposal contract") from None
    recommendation = execute_droid_protocol_agent(trial_id, max_iterations, proposals=proposals)
    recommendation.runtime_agent = "Factory Droid SDK 0.9.1 proposal; independently checked by Concord engine"
    recommendation.provider_status = "EXECUTED"
    recommendation.execution_mode = "LIVE_FACTORY_PROPOSAL_LOCAL_ENGINE_VALIDATION"
    recommendation.readiness = "CONNECTED_AND_VERIFIED"
    recommendation.auth_status = "TERMINAL_SDK_RESULT_RECEIVED"
    # Model prose is not an evidence report; retain only structural receipt and actual usage.
    recommendation.runtime_receipt = {key: receipt.get(key) for key in ("session_id", "status", "duration_ms", "turn_count", "token_usage", "tool_trace")}
    recommendation.executive_summary = f"Factory produced {len(proposals)} bounded operational proposal(s); Concord independently computed {recommendation.disposition}. Synthetic inputs only; no clinical benefit established."
    return recommendation
