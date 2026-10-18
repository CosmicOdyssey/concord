"""Real local tools, unsupported evidence and proposal rejection boundaries."""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from concord.api.main import app
from concord.api import droid as api
from concord.agents import droid
from concord.agents.boundary import ProposedAmendment, inspect_protocol_safely, validate_amendment_constraints


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("CONCORD_REVIEW_TOKEN", raising=False)
    api._STORED_RECOMMENDATIONS.clear()
    return TestClient(app)


def test_protocol_inspection_never_invents_clinical_constraints():
    info = droid.tool_inspect_protocol("NCT05800015", [])
    assert info["registry_status"] == "CONTEXT_ONLY"
    assert info["source_url"].startswith("https://clinicaltrials.gov/")
    assert info["eligibility_status"] == "UNKNOWN"
    assert info["hard_clinical_constraints"] == []
    absent = inspect_protocol_safely("NCT09999999_NONEXISTENT")
    assert absent["registry_status"] == "NOT_FOUND"
    assert absent["title"] is None
    assert absent["hard_clinical_constraints"] == []


def test_simulation_uses_actual_engine_and_no_assumed_outreach_benefit():
    result = droid.tool_simulate_operational_variant("NCT05800015", 2., 10000., [])
    assert result["simulated_makespan"] == result["baseline_makespan"]
    assert result["simulated_commitment"] - result["baseline_commitment"] == pytest.approx(120000.)
    assert result["seed"] == 7 and result["draws"] == 32
    assert result["is_simulated_assumption"] is True


@pytest.mark.parametrize("mutation,category", [(True, "OPERATIONAL"), (False, "ELIGIBILITY_HYPOTHETICAL")])
def test_clinical_mutations_rejected_even_when_flag_is_false(mutation, category):
    candidate = ProposedAmendment(proposal_id="adverse-clinical", trial_id="T1", category=category,
        description="Unsupported eligibility adjustment", modifies_clinical_inclusion_exclusion=mutation)
    safe, errors = validate_amendment_constraints(candidate)
    assert not safe and errors
    assert candidate.validation_status == "REJECTED_SAFETY_VIOLATION"


def test_proposal_schema_rejects_hidden_fields_nonfinite_and_bounds():
    common = dict(proposal_id="test-proposal", trial_id="T1", category="OPERATIONAL", description="Operational adjustment")
    for extra in ({"activation_lag_months": -1}, {"monthly_outreach_budget": float("nan")}, {"override_clinical_protocol": True}):
        with pytest.raises(ValidationError):
            ProposedAmendment(**common, **extra)


def test_no_beneficial_change_is_rejected_without_manufacturing_improvement():
    result = droid.execute_droid_protocol_agent()
    assert result.disposition == "NO_BENEFICIAL_CHANGE"
    assert result.human_approval_status == "REJECTED"
    assert result.expected_makespan_delta_months == 0
    assert result.recommended_makespan_months == result.baseline_makespan_months
    assert result.total_iterations == 1
    assert result.iterations[0].decision == "REJECTED_NO_BENEFIT"
    assert result.provider_status == "NOT_INVOKED"
    assert result.execution_mode == "LOCAL_DETERMINISTIC"
    assert result.provenance["canonical_protocol_mutated"] is False


def test_recursive_tool_failure_retains_baseline():
    def fail(*args):
        raise RuntimeError("sensitive detail")
    result = droid.execute_droid_protocol_agent(simulation_tool=fail)
    assert result.disposition == "FAILED_RETAINED_BASELINE"
    assert result.human_approval_status == "REJECTED"
    assert result.expected_makespan_delta_months == 0
    assert result.total_iterations == 1
    assert result.error["code"] == "REFINEMENT_FAILED"
    assert "sensitive" not in result.model_dump_json()


def test_infeasible_candidate_never_becomes_best(monkeypatch):
    real = droid.tool_simulate_operational_variant
    def infeasible(*args):
        out = real(*args)
        return {**out, "simulated_makespan": 1., "makespan_delta": -14., "feasible": False}
    result = droid.execute_droid_protocol_agent(simulation_tool=infeasible)
    assert result.disposition == "NO_BENEFICIAL_CHANGE"
    assert result.expected_makespan_delta_months == 0
    assert result.human_approval_status == "REJECTED"


def test_iteration_limits_and_unknown_trial(client):
    assert client.post("/api/agents/droid/run", json={"max_iterations": 4}).status_code == 422
    assert client.post("/api/agents/droid/run", json={"trial_id": "NCT09999999_NONEXISTENT"}).status_code == 422
    with pytest.raises(ValueError):
        droid.execute_droid_protocol_agent(max_iterations=0)


def test_authenticated_review_cannot_approve_rejected_or_repeat_decision(client, monkeypatch):
    rec = client.post("/api/agents/droid/run", json={}).json()
    request = {"recommendation_id": rec["recommendation_id"], "decision": "APPROVED", "reviewer_notes": "Reviewer opinion"}
    assert client.post("/api/agents/droid/review", json=request).status_code == 503
    monkeypatch.setenv("CONCORD_REVIEW_TOKEN", "review-test-only")
    assert client.post("/api/agents/droid/review", json=request).status_code == 401
    headers = {"X-Concord-Review-Token": "review-test-only"}
    assert client.post("/api/agents/droid/review", json=request, headers=headers).status_code == 409
    # A synthetic review state isolates the authentication/transition test; this
    # does not manufacture a scientific benefit or exercise a provider.
    stored = api._STORED_RECOMMENDATIONS[rec["recommendation_id"]]
    stored.disposition = "PROPOSED_FOR_REVIEW"
    stored.human_approval_status = "PENDING_HUMAN_REVIEW"
    response = client.post("/api/agents/droid/review", json={**request, "decision": "REJECTED"}, headers=headers)
    assert response.status_code == 200
    assert response.json()["review_audit"][0]["scope"] == "AUTHENTICATED_LOCAL_REVIEW_ONLY"
    assert client.post("/api/agents/droid/review", json=request, headers=headers).status_code == 409
