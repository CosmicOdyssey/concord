"""Integration and Security Invariant Tests for Sponsor Agents."""
import os
import pytest
from fastapi.testclient import TestClient

from concord.api.main import app
from concord.paths import ROOT


@pytest.fixture
def client():
    return TestClient(app)


def test_original_hackharvard_demo_is_intact(client):
    """The original 180-second Regeneron demo endpoint must remain fully functional."""
    res = client.get("/api/hackharvard-demo")
    assert res.status_code == 200
    data = res.json()
    assert "baseline" in data
    assert data["baseline"]["expected_makespan"] == pytest.approx(15.13, abs=0.05)


def test_no_secrets_or_tokens_committed_in_agent_code():
    """Verify that no API tokens, private keys, or passwords exist in agent source files."""
    agent_dir = ROOT / "backend/concord/agents"
    import ast
    import re
    # Inspect literal credential-shaped values, not the legal dynamic HTTP
    # authorization scheme "Bearer ". A protocol header is not a secret.
    patterns = [r"sk-[A-Za-z0-9_-]{20,}", r"ghp_[A-Za-z0-9]{20,}",
                r"(?i)bearer\s+[A-Za-z0-9._-]{20,}", r"-----BEGIN .*PRIVATE KEY-----"]
    for py_file in agent_dir.glob("*.py"):
        values = [node.value for node in ast.walk(ast.parse(py_file.read_text()))
                  if isinstance(node, ast.Constant) and isinstance(node.value, str)]
        for value in values:
            assert not any(re.search(pattern, value) for pattern in patterns), f"Credential-shaped literal in {py_file.name}"



def test_no_phi_in_evaluation_scenarios():
    """Verify that no patient identifiable information exists in evaluation datasets."""
    eval_file = ROOT / "backend/concord/evals/chalk_eval.py"
    content = eval_file.read_text().lower()
    phi_indicators = ["ssn", "mrn", "date of birth", "patient_name", "home_address"]
    for phi in phi_indicators:
        assert phi not in content, f"PHI indicator '{phi}' found in Chalk evaluation dataset."


def test_agent_boundary_read_only_protection():
    """Agent boundary must fail closed on invalid inputs without modifying engine data."""
    from pydantic import ValidationError
    from concord.agents.boundary import ProposedAmendment, validate_amendment_constraints
    
    # Negative activation lag is rejected at schema level by Pydantic
    with pytest.raises(ValidationError):
        ProposedAmendment(
            proposal_id="prop-inv-01",
            trial_id="NCT05800015",
            category="SITE_ACTIVATION",
            description="Invalid negative lag",
            activation_lag_months=-2.5
        )
    
    # Clinical criteria mutation is rejected by constraint validator
    unsafe = ProposedAmendment(
        proposal_id="prop-inv-02",
        trial_id="NCT05800015",
        category="ELIGIBILITY_HYPOTHETICAL",
        description="Attempt to mutate inclusion criteria",
        modifies_clinical_inclusion_exclusion=True,
    )
    is_safe, violations = validate_amendment_constraints(unsafe)
    assert is_safe is False
    assert any("CRITICAL SAFETY VIOLATION" in v for v in violations)


def test_stale_evaluation_runtime_is_explicit_conflict(monkeypatch):
    from fastapi.testclient import TestClient
    from concord.api.main import app
    from concord.api import chalk_eval
    def stale():
        raise ValueError("Source changed since runtime start; restart before evaluation")
    monkeypatch.setattr(chalk_eval, "run_chalk_evaluations", stale)
    response = TestClient(app).post("/api/evals/chalk/run")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "STALE_RUNTIME"


def test_latest_evaluation_rejects_changed_source(monkeypatch):
    from fastapi.testclient import TestClient
    from concord.api.main import app
    from concord.api import chalk_eval
    with TestClient(app) as client:
        assert client.post("/api/evals/chalk/run").status_code == 200
        monkeypatch.setattr(chalk_eval, "runtime_sources_current", lambda: False)
        response = client.get("/api/evals/chalk/latest")
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "STALE_EVALUATION"
