"""Financial decision-support invariants, independent of trial-history databases.

The API fixture is intentionally the labeled synthetic financial demonstration;
these tests establish accounting and execution behavior, not realized savings or
clinical validation.
"""

from copy import deepcopy
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    def forbidden_database(*args, **kwargs):
        raise AssertionError("financial demonstration must not open historical SQLite data")

    monkeypatch.setattr(sqlite3, "connect", forbidden_database)
    from concord.api.main import app
    return TestClient(app)


@pytest.fixture
def request_body(client):
    response = client.get("/api/financial/demo")
    assert response.status_code == 200
    return deepcopy(response.json()["request"])


def compare(client, body):
    response = client.post("/api/financial/compare", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_demo_has_explicit_financial_assumptions_and_public_protocol_source(client):
    response = client.get("/api/financial/demo")
    assert response.status_code == 200
    data = response.json()
    text = json.dumps(data).lower()
    assert "synthetic" in text
    assert "NCT05800015" in json.dumps(data)
    assert "not" in text and "coverage" in text
    assert compare(client, data["request"])["trial"]["registry_url"] == "https://clinicaltrials.gov/study/NCT05800015"


def test_financial_journey_needs_no_database_and_respects_budget(client, request_body):
    result = compare(client, request_body)
    assert {s["id"] for s in result["scenarios"]} == set("ABCDE")
    feasible = [s for s in result["scenarios"] if s["plan"]["feasible"]]
    assert len(feasible) >= 2
    for scenario in feasible:
        plan, economics = scenario["plan"], scenario["economics"]
        assert plan["sponsor_total"] <= request_body["budget"] + 0.01
        assert economics["sponsor"]["budget_commitment"] == pytest.approx(plan["sponsor_total"], abs=0.02)
        assert economics["insurer"]["downstream_clinical_cost"] is None


def test_payments_conserve_and_resource_costs_are_not_payment_totals(client, request_body):
    result = compare(client, request_body)
    for scenario in result["scenarios"]:
        if not scenario["plan"]["feasible"]:
            continue
        economics = scenario["economics"]
        assert economics["transfer_balance"] == pytest.approx(0, abs=0.001)
        transfers = economics["transfers"]
        assert transfers and all(t["amount"] >= 0 for t in transfers)
        hospital_receipts = sum(t["amount"] for t in transfers if t["to"] == "Hospital")
        assert economics["hospital"]["revenue"] == pytest.approx(hospital_receipts, abs=0.02)
        assert economics["hospital"]["net_contribution"] == pytest.approx(
            economics["hospital"]["revenue"] - economics["hospital"]["resource_cost"], abs=0.02)
        # Count actual modeled resources once, while excluding the matching payment receipts.
        assert economics["consolidated_resource_cost"] == pytest.approx(
            economics["hospital"]["resource_cost"] + scenario["plan"]["breakdown"]["administration"]
            + economics["insurer"]["administration"] + economics["patient"]["access_support"], abs=0.02)


def test_repeated_requests_and_paired_sensitivity_are_reproducible(client, request_body):
    a = compare(client, request_body)
    b = compare(client, deepcopy(request_body))
    assert a == b
    changed = deepcopy(request_body)
    changed["support_per_participant"] += 1
    c = compare(client, changed)
    assert a["input_sha256"] != c["input_sha256"]
    assert a["run_id"] != c["run_id"]
    assert all(s["sensitivity"] == b["scenarios"][i]["sensitivity"]
               for i, s in enumerate(a["scenarios"]))


def test_changed_seed_changes_uncertainty_but_not_nominal_plan(client, request_body):
    a = compare(client, request_body)
    request_body["seed"] += 1
    b = compare(client, request_body)
    assert a["input_sha256"] != b["input_sha256"]
    for left, right in zip(a["scenarios"], b["scenarios"]):
        assert left["plan"] == right["plan"]
    assert any(a["scenarios"][i]["sensitivity"] != s["sensitivity"]
               for i, s in enumerate(b["scenarios"]) if s["plan"]["feasible"])


def test_each_procedure_is_attributed_once_and_unknowns_are_reserved(client, request_body):
    coverage = compare(client, request_body)["coverage"]
    items = coverage["items"]
    assert len({i["id"] for i in items}) == len(items)
    for item in items:
        allocations = [item[f"{party}_per_participant"] for party in ("sponsor", "payer", "patient", "reserve")]
        assert all(amount >= 0 for amount in allocations)
        assert sum(allocations) == pytest.approx(item["unit_rate"] * item["quantity"], abs=0.02)
        if item["sponsor_per_participant"]:
            assert item["payer_per_participant"] == item["patient_per_participant"] == 0
        if item["status"] in ("UNKNOWN", "CONDITIONAL", "REVIEW_REQUIRED"):
            assert item["reserve_per_participant"] == item["unit_rate"]
            assert item["payer_per_participant"] == item["patient_per_participant"] == 0
        assert item["source"] and item["year"]
        assert item["coverage_determination_status"] in ("NOT_DETERMINED", "UNKNOWN")
    assert any(i["status"] == "UNKNOWN" for i in items)


def test_commercial_without_explicit_rate_mapping_assigns_no_routine_bills(client, request_body):
    request_body["payer_kind"] = "commercial"
    request_body["commercial_rate_assumption"] = False
    result = compare(client, request_body)
    assert result["coverage"]["totals"]["payer"] == 0
    assert result["coverage"]["totals"]["patient"] == 0
    routine = [i for i in result["coverage"]["items"] if i["status"] == "POTENTIALLY_PAYER_COVERED"]
    assert routine and all(i["reserve_per_participant"] == i["unit_rate"] for i in routine)
    assert all(s["economics"]["patient"]["unresolved_exposure"] is None
               for s in result["scenarios"] if s["plan"]["feasible"])


def test_operator_can_mark_routine_unknown_but_cannot_shift_research_to_payer(client, request_body):
    items = compare(client, request_body)["coverage"]["items"]
    routine = next(i for i in items if i["status"] == "POTENTIALLY_PAYER_COVERED")
    request_body["coverage_overrides"] = {routine["id"]: "UNKNOWN"}
    reviewed = compare(client, request_body)
    item = next(i for i in reviewed["coverage"]["items"] if i["id"] == routine["id"])
    assert item["review_status"] == "operator_interpretation"
    assert item["reserve_per_participant"] == item["unit_rate"]
    assert item["payer_per_participant"] == item["patient_per_participant"] == 0
    research = next(i for i in items if i["status"] == "SPONSOR")
    request_body["coverage_overrides"] = {research["id"]: "POTENTIALLY_PAYER_COVERED"}
    assert client.post("/api/financial/compare", json=request_body).status_code == 422
    request_body["coverage_overrides"] = {"not-a-procedure": "SPONSOR"}
    assert client.post("/api/financial/compare", json=request_body).status_code == 422


def test_budget_cannot_be_met_by_silently_reassigning_unresolved_costs(client, request_body):
    request_body["budget"] = 1
    result = compare(client, request_body)
    assert not any(s["plan"]["feasible"] for s in result["scenarios"])
    assert result["recommended_scenario_id"] is None
    assert result["coverage"]["totals"]["reserve"] > 0
    assert all(s["economics"] is None and s["delta"] is None and s["sensitivity"] is None
               for s in result["scenarios"])


def test_paired_shocks_give_identical_timing_for_same_network_and_lower_admin_costs(client, request_body):
    result = compare(client, request_body)
    scenarios = {s["id"]: s for s in result["scenarios"]}
    baseline, lower_admin = scenarios["A"], scenarios["B"]
    assert baseline["plan"]["feasible"] and lower_admin["plan"]["feasible"]
    assert baseline["plan"]["selected_ids"] == lower_admin["plan"]["selected_ids"]
    assert baseline["sensitivity"]["modeled_months_quantiles"] == lower_admin["sensitivity"]["modeled_months_quantiles"]
    assumed_reduction = request_body["admin_cost"] * request_body["admin_reduction"]
    assert lower_admin["delta"]["sponsor_expenditure"] == -assumed_reduction
    for old, new in zip(baseline["sensitivity"]["sponsor_total_quantiles"], lower_admin["sensitivity"]["sponsor_total_quantiles"]):
        assert old - new == pytest.approx(assumed_reduction, abs=0.02)
    assert lower_admin["delta"]["insurer_expenditure"] == 0


@pytest.mark.parametrize("field,value", [
    ("budget", -1), ("target", -1), ("horizon_months", 0),
    ("admin_reduction", 1.1), ("payer_fraction", -0.1),
    ("rate_multiplier", -1), ("draws", 0),
])
def test_invalid_financial_assumptions_are_rejected(client, request_body, field, value):
    request_body[field] = value
    assert client.post("/api/financial/compare", json=request_body).status_code in (400, 422)


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity"])
def test_nonfinite_assumptions_are_rejected_without_json_serialization_crash(client, request_body, token):
    text = json.dumps(request_body).replace('"budget": 1500000', f'"budget": {token}', 1)
    # Construct nonstandard numeric JSON deliberately: httpx's json= forbids NaN before it reaches the API.
    if text == json.dumps(request_body):
        request_body["budget"] = float(token)
        text = json.dumps(request_body)
    response = client.post("/api/financial/compare", content=text,
                           headers={"Content-Type": "application/json"})
    assert response.status_code in (400, 422)


def test_report_recomputes_same_evidence_and_escapes_untrusted_names(client, request_body):
    request_body["sites"][0]["name"] = '<script>alert("x")</script>'
    result = compare(client, request_body)
    response = client.post("/api/financial/report?format=json", json=request_body)
    assert response.status_code == 200
    assert response.json() == result
    report = client.post("/api/financial/report?format=html", json=request_body)
    assert report.status_code == 200
    assert "<script>" not in report.text
    assert "&lt;script&gt;" in report.text
    assert result["input_sha256"] in report.text
    assert "clinicaltrials.gov" in report.text
    assert "synthetic" in report.text.lower()


def test_unknown_report_format_is_rejected(client, request_body):
    assert client.post("/api/financial/report?format=csv", json=request_body).status_code in (400, 422)


def test_rate_benchmark_reuses_existing_ratecard_and_preserves_synthetic_label(client,request_body,monkeypatch):
    from concord import terms
    monkeypatch.setattr(terms,'_price_code',lambda *args:{'amount':123.45,'verified':True,'placeholder':False,'source':'TEST ONLY published benchmark'})
    result=compare(client,request_body)
    coded=[i for i in result['coverage']['items'] if i['code']]
    assert coded and all(i['unit_rate']==123.45 for i in coded)
    assert all(i['rate_kind']=='verified_fee_schedule_benchmark' for i in coded)
    assert result['execution_mode']=='synthetic_financial_demo'


def test_all_infeasible_sites_and_second_protocol_fail_honestly_or_run(client,request_body):
    request_body['trial_id']='NCT06627647'
    result=compare(client,request_body)
    assert result['trial']['id']=='NCT06627647'
    assert all(i['trial_id']=='NCT06627647' for i in result['coverage']['items'])
    for site in request_body['sites']: site['feasible']=False
    result=compare(client,request_body)
    assert result['recommended_scenario_id'] is None
    assert all(not s['plan']['feasible'] for s in result['scenarios'])
