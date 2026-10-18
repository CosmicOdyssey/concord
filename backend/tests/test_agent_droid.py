"""Tests for Factory Droid SDK Protocol Planning Agent."""
import pytest
from fastapi.testclient import TestClient

from concord.api.main import app
from concord.agents.droid import (
    execute_droid_protocol_agent,
    tool_identify_operational_bottlenecks,
    tool_inspect_protocol,
    tool_simulate_operational_variant,
)
from concord.agents.boundary import ProposedAmendment, validate_amendment_constraints


@pytest.fixture
def client():
    return TestClient(app)


def test_droid_protocol_inspection_tool():
    trace = []
    info = tool_inspect_protocol("NCT05800015", trace)
    assert info["trial_id"] == "NCT05800015"
    assert len(info["hard_clinical_constraints"]) >= 4
    assert len(trace) == 1
    assert trace[0].tool_name == "inspect_protocol"


def test_droid_operational_bottlenecks_tool():
    trace = []
    bottlenecks = tool_identify_operational_bottlenecks("NCT05800015", trace)
    assert "site_activation_lag_months" in bottlenecks
    assert len(bottlenecks["candidate_improvements"]) == 3
    assert len(trace) == 1
    assert trace[0].tool_name == "identify_operational_bottlenecks"


def test_droid_simulation_tool():
    trace = []
    sim = tool_simulate_operational_variant("NCT05800015", activation_lag=2.0, outreach_budget=10_000.0, trace=trace)
    assert sim["trial_id"] == "NCT05800015"
    assert sim["simulated_makespan"] < sim["baseline_makespan"]
    assert sim["simulated_commitment"] > 0
    assert sim["feasible"] is True
    assert len(trace) == 1


def test_droid_safety_guardrails_prevent_clinical_criteria_mutation():
    # Attempting to mutate clinical inclusion/exclusion criteria must trigger hard safety rejection
    unsafe_amendment = ProposedAmendment(
        proposal_id="prop-fail-clinical",
        trial_id="NCT05800015",
        category="ELIGIBILITY_HYPOTHETICAL",
        description="Relax hepatic lab cutoff",
        modifies_clinical_inclusion_exclusion=True,
    )
    is_safe, violations = validate_amendment_constraints(unsafe_amendment)
    assert is_safe is False
    assert any("CRITICAL SAFETY VIOLATION" in v for v in violations)
    assert unsafe_amendment.validation_status == "REJECTED_SAFETY_VIOLATION"


def test_droid_recursive_refinement_loop():
    rec = execute_droid_protocol_agent(trial_id="NCT05800015", max_iterations=3)
    assert rec.trial_id == "NCT05800015"
    assert rec.total_iterations in (2, 3)
    assert rec.recommended_makespan_months < rec.baseline_makespan_months
    assert rec.clinical_safety_status == "PASSED_NO_CLINICAL_MUTATION"
    assert rec.feasibility_status == "FEASIBLE"
    assert rec.human_approval_status == "PENDING_HUMAN_REVIEW"
    assert len(rec.iterations) >= 2
    assert len(rec.tool_trace) >= 4


def test_droid_api_endpoints_and_human_review_gate(client):
    # Run Droid
    run_res = client.post("/api/agents/droid/run", json={
        "trial_id": "NCT05800015",
        "max_iterations": 3
    })
    assert run_res.status_code == 200
    data = run_res.json()
    rec_id = data["recommendation_id"]
    assert data["human_approval_status"] == "PENDING_HUMAN_REVIEW"

    # Inspect list
    list_res = client.get("/api/agents/droid/recommendations")
    assert list_res.status_code == 200
    assert any(r["recommendation_id"] == rec_id for r in list_res.json())

    # Submit Human Review Approval
    rev_res = client.post("/api/agents/droid/review", json={
        "recommendation_id": rec_id,
        "decision": "APPROVED",
        "reviewer_notes": "Operational parameter adjustments verified; clinical protocol unchanged."
    })
    assert rev_res.status_code == 200
    rev_data = rev_res.json()
    assert rev_data["human_approval_status"] == "APPROVED"

    # Confirm updated status
    get_res = client.get(f"/api/agents/droid/recommendations/{rec_id}")
    assert get_res.status_code == 200
    assert get_res.json()["human_approval_status"] == "APPROVED"


def test_droid_status_endpoint(client):
    res = client.get("/api/agents/droid/status")
    assert res.status_code == 200
    data = res.json()
    assert "runtime" in data
    assert "@factory/droid-sdk" in data["runtime"]
    assert "readiness" in data
    assert "mcp_tools" in data
    assert "inspect_protocol" in data["mcp_tools"]
    assert "hard_safety_invariants" in data


def test_droid_readiness_missing_credentials(monkeypatch):
    monkeypatch.delenv("FACTORY_API_KEY", raising=False)
    rec = execute_droid_protocol_agent("NCT05800015", max_iterations=2)
    assert rec.readiness == "MISSING_CREDENTIALS"
    assert "BLOCKED — AUTHENTICATION" in rec.auth_status
    assert "FACTORY_API_KEY" in rec.missing_prerequisites


def test_droid_readiness_configured(monkeypatch):
    monkeypatch.setenv("FACTORY_API_KEY", "fact_mock_test_key_12345")
    from concord.agents.droid import get_droid_status
    status = get_droid_status()
    assert status["readiness"] == "CONFIGURED_UNVERIFIED"
    assert status["auth_status"] == "CONFIGURED_PENDING_VERIFICATION"
    assert status["missing_prerequisites"] == []

