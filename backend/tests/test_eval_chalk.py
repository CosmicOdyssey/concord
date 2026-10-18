"""Tests for Chalk Evaluation Engine and Objective Scorers."""
import pytest
from fastapi.testclient import TestClient

from concord.api.main import app
from concord.evals.chalk_eval import (
    CHALK_SCENARIOS,
    DATASET_VERSION,
    execute_concord_agent_task,
    run_chalk_evaluations,
    score_adversarial_defense,
    score_budget_compliance,
    score_capacity_compliance,
    score_clinical_safety,
    score_financial_conservation,
    score_solver_truthfulness,
)


@pytest.fixture
def client():
    return TestClient(app)


def test_chalk_scenarios_count_and_structure(client):
    res = client.get("/api/evals/chalk/scenarios")
    assert res.status_code == 200
    data = res.json()
    assert data["scenarios_count"] == 12
    assert len(data["scenarios"]) == 12
    assert data["dataset_version"] == DATASET_VERSION

    # Verify scenario IDs
    scenario_ids = [s["id"] for s in data["scenarios"]]
    assert "scenario-01-adequate-budget" in scenario_ids
    assert "scenario-02-infeasible-budget" in scenario_ids
    assert "scenario-03-capacity-exhaustion" in scenario_ids
    assert "scenario-07-amendment-violates-safety" in scenario_ids
    assert "scenario-12-persuasion-prompt-injection" in scenario_ids


def test_chalk_budget_compliance_scorer():
    scen_ok = CHALK_SCENARIOS[0]
    res_ok = score_budget_compliance(scen_ok, {"budget_commitment": 1_200_000.0, "feasible": True})
    assert res_ok.passed is True
    assert res_ok.score == 1.0

    scen_bad = CHALK_SCENARIOS[1]
    res_bad = score_budget_compliance(scen_bad, {"budget_commitment": 950_000.0, "feasible": False})
    # For infeasible budget, agent should report feasible: False
    assert res_bad.passed is True


def test_chalk_clinical_safety_scorer():
    scen_safe = CHALK_SCENARIOS[6]
    # Agent catches safety violation and rejects
    res = score_clinical_safety(scen_safe, {"hard_safety_violation_caught": True, "rejected": True})
    assert res.passed is True

    # Failure mode: agent failed to catch violation
    res_fail = score_clinical_safety(scen_safe, {"hard_safety_violation_caught": False, "rejected": False})
    assert res_fail.passed is False
    assert res_fail.hard_constraint_violated is True


def test_chalk_adversarial_prompt_injection_defense():
    scen_adv = CHALK_SCENARIOS[11]
    res = score_adversarial_defense(scen_adv, {"fabrication_refused": True, "claim_made": False})
    assert res.passed is True

    # Failed defense
    res_fail = score_adversarial_defense(scen_adv, {"fabrication_refused": False, "claim_made": True})
    assert res_fail.passed is False


def test_chalk_solver_truthfulness_scorer():
    scen_exact = CHALK_SCENARIOS[8]
    res = score_solver_truthfulness(scen_exact, {"status": "OPTIMAL"})
    assert res.passed is True

    scen_heur = CHALK_SCENARIOS[9]
    res_heur = score_solver_truthfulness(scen_heur, {"status": "FEASIBLE_HEURISTIC"})
    assert res_heur.passed is True


def test_chalk_full_evaluation_run(client):
    res = client.post("/api/evals/chalk/run")
    assert res.status_code == 200
    report = res.json()
    assert report["total_scenarios"] == 12
    assert report["passed_scenarios"] == 12
    assert report["failed_scenarios"] == 0
    assert report["hard_safety_violations"] == 0
    assert report["overall_pass_rate"] == 1.0
    assert len(report["scenarios"]) == 12


def test_chalk_latest_endpoint(client):
    res = client.get("/api/evals/chalk/latest")
    assert res.status_code == 200
    data = res.json()
    assert "run_id" in data
    assert data["total_scenarios"] == 12
