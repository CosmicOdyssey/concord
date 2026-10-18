"""Independent acceptance executes production boundaries; no remote result claims."""
import hashlib
import json
import pytest
from fastapi.testclient import TestClient
from concord.api.main import app
from concord.api import chalk_eval as api
from concord.evals import chalk_eval as evaluations


def test_dataset_is_versioned_hashed_and_covers_all_fifteen_cases():
    encoded = json.dumps([s.model_dump(mode="json") for s in evaluations.CHALK_SCENARIOS], sort_keys=True, separators=(",", ":")).encode()
    assert evaluations.DATASET_SHA256 == hashlib.sha256(encoded).hexdigest()
    assert len(evaluations.CHALK_SCENARIOS) == 15
    assert len({s.id for s in evaluations.CHALK_SCENARIOS}) == 15
    assert evaluations.DATASET_SHA256 != hashlib.sha256(b"").hexdigest()


def test_all_acceptance_cases_execute_and_keep_actual_trajectories(monkeypatch):
    monkeypatch.setenv("CHALK_API_TOKEN", "present-does-not-prove-execution")
    report = evaluations.run_chalk_evaluations()
    assert report.total_scenarios == report.passed_scenarios == 15
    assert report.failed_scenarios == report.hard_safety_violations == 0
    assert report.overall_pass_rate == 1.
    assert report.engine_mode.startswith("LOCAL_DETERMINISTIC")
    assert report.provider_status == "NOT_IMPLEMENTED"
    assert report.remote_receipt is None and report.provider_usage is None
    assert all(s.trajectory_sample is not None for s in report.scenarios)


def test_failure_and_missing_outputs_cannot_silently_pass(monkeypatch):
    monkeypatch.setattr(evaluations, "execute_concord_agent_task", lambda scenario: {})
    report = evaluations.run_chalk_evaluations()
    assert report.passed_scenarios == 0
    assert report.failed_scenarios == 15
    assert len(report.failed_trajectories) == 15


def test_failing_task_is_caught_and_not_a_fake_success(monkeypatch):
    def fail(scenario):
        raise RuntimeError("secret exception contents")
    monkeypatch.setattr(evaluations, "execute_concord_agent_task", fail)
    result = evaluations.run_chalk_evaluations()
    assert result.passed_scenarios == 0
    assert "secret exception" not in result.model_dump_json()


def test_remote_credentials_never_upgrade_local_mode_and_get_does_not_compute(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(api, "_LATEST_REPORT", None)
    assert client.get("/api/evals/chalk/latest").status_code == 404
    assert client.get("/api/evals/chalk/scenarios").json()["scenarios_count"] == 15
    response = client.post("/api/evals/chalk/run")
    assert response.status_code == 200
    assert response.json()["passed_scenarios"] == 15
    assert client.get("/api/evals/chalk/latest").json() == response.json()


@pytest.mark.parametrize("scorer", [evaluations.score_budget_compliance, evaluations.score_capacity_compliance, evaluations.score_clinical_safety, evaluations.score_financial_conservation, evaluations.score_adversarial_defense, evaluations.score_solver_truthfulness])
def test_compatibility_scorers_require_explicit_evidence(scorer):
    assert scorer(evaluations.CHALK_SCENARIOS[0], {}).passed is False
