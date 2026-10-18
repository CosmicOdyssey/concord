"""Financial decision-support invariants, independent of trial-history databases.

The API fixture is intentionally the labeled synthetic financial demonstration;
these tests establish accounting and execution behavior, not realized savings or
clinical validation. They also pin the product owner's ruling (decisions.md #24):
in this worksheet payer assumptions do not move the sponsor commitment (only a line's
coverage status does), and nothing here outputs a time, speed or recommendation.
"""

from copy import deepcopy
from decimal import Decimal, ROUND_HALF_EVEN
import html
import itertools
import json
import re
import sqlite3

import pytest
from fastapi.testclient import TestClient

from concord.financial import (ACCESS_SUPPORT, NO_TIME_MODEL, NOT_A_BILLING_REVIEW, PAYER_BILLING,
                               PAYER_INDEPENDENCE)


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


def by_id(result):
    return {s["id"]: s for s in result["scenarios"]}


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
    assert [s["id"] for s in result["scenarios"]] == list("ABCDE")
    assert result["comparison"]["reference_scenario_id"] == "A"
    feasible = [s for s in result["scenarios"] if s["plan"]["feasible"]]
    assert len(feasible) == 5
    for scenario in feasible:
        plan, economics = scenario["plan"], scenario["economics"]
        assert plan["sponsor_total"] <= request_body["budget"] + 0.01
        assert sum(r["participants"] for r in plan["site_rows"]) == request_body["target"]
        assert economics["sponsor"]["budget_commitment"] == pytest.approx(plan["sponsor_total"], abs=0.02)
        assert economics["insurer"]["downstream_clinical_cost"] is None


def test_scenarios_are_the_stated_sponsor_budget_levers_and_nothing_else(client, request_body):
    s = by_id(compare(client, request_body))
    target = request_body["target"]
    baseline = sorted(x["id"] for x in request_body["sites"] if x["baseline_active"])
    for ident in "ABCDE":
        assert s[ident]["plan"]["selected_ids"] == baseline  # demo network has enough stated capacity
    assert s["C"]["plan"]["network_search"]["base_has_capacity"]
    assert s["C"]["plan"]["breakdown"] == s["A"]["plan"]["breakdown"]  # C differs only when A lacks capacity
    reduction = request_body["admin_cost"] * request_body["admin_reduction"]
    extra = request_body["extra_support"] * target
    assert s["B"]["budget_reallocation"]["line_changes"] == {
        "activation": 0, "operating": 0, "site_variable": 0, "procedures": 0, "support": 0,
        "administration": -reduction}
    assert s["D"]["budget_reallocation"]["line_changes"]["support"] == extra
    assert s["D"]["budget_reallocation"]["incremental_cost"] == extra
    assert s["E"]["budget_reallocation"]["incremental_cost"] == pytest.approx(extra - reduction, abs=0.01)
    assert s["E"]["inputs"] == {"network_rule": "capacity_rule", "admin_cost": s["B"]["inputs"]["admin_cost"],
                                "support_per_participant": s["D"]["inputs"]["support_per_participant"]}
    for ident in "ABCDE":
        assert s[ident]["budget_reallocation"]["additional_sites"] == []
        assert s[ident]["definition"]


def test_participants_are_split_by_stated_capacity(client, request_body):
    request_body["sites"][0]["capacity"] = 45
    request_body["sites"][1]["capacity"] = 15
    rows = by_id(compare(client, request_body))["A"]["plan"]["site_rows"]
    assert {r["id"]: r["participants"] for r in rows} == {"SYN-A": 45, "SYN-B": 15}
    assert all(r["participants"] <= r["capacity"] for r in rows)


def test_capacity_rule_extends_a_short_network_at_the_lowest_commitment(client, request_body):
    request_body["sites"][0]["capacity"] = 20
    request_body["sites"][1]["capacity"] = 20
    s = by_id(compare(client, request_body))
    for ident in "ABD":  # the existing network cannot hold the target: no price is invented for it
        assert not s[ident]["plan"]["costed"] and s[ident]["plan"]["sponsor_total"] is None
        assert "Stated capacity of the selected sites is below the participant target" in s[ident]["plan"]["violations"]
        assert s[ident]["economics"] is None and s[ident]["budget_reallocation"] is None
    c = s["C"]
    assert c["plan"]["feasible"] and not c["plan"]["network_search"]["base_has_capacity"]
    # SYN-C (activation 35k, 1.6k/month, 2.4k/participant) is cheaper than SYN-D (50k, 2.2k, 2.8k).
    assert c["plan"]["selected_ids"] == ["SYN-A", "SYN-B", "SYN-C"]
    # The already-active sites are filled to stated capacity; only the shortfall goes to the new site
    # (a proportional split would have been 12 / 12 / 36 and cost 6,400 more in site per-participant cost).
    assert {r["id"]: r["participants"] for r in c["plan"]["site_rows"]} == {"SYN-A": 20, "SYN-B": 20, "SYN-C": 20}
    assert c["plan"]["participant_split"] == "existing_sites_at_stated_capacity_then_added_sites_by_capacity"
    assert c["plan"]["breakdown"]["site_variable"] == 20 * 2000 + 20 * 2000 + 20 * 2400
    realloc = c["budget_reallocation"]
    assert realloc["additional_sites"] == ["SYN-C"]
    assert realloc["additional_activations"] == 1
    assert realloc["incremental_cost"] is None  # A has no commitment to compare against
    # ... but what the added capacity costs is still stated.
    assert realloc["added_sites_cost"] == {"activation": 35000, "operating": 1600 * request_body["budget_period_months"],
                                           "site_variable": 20 * 2400, "site_total": 35000 + 1600 * 24 + 20 * 2400,
                                           "participants": 20}
    assert c["delta"] is None
    assert s["E"]["plan"]["selected_ids"] == c["plan"]["selected_ids"]
    assert s["E"]["budget_reallocation"]["added_sites_cost"] == realloc["added_sites_cost"]


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
        # The sponsor supplies the investigational product: its reserve is a sponsor-side supply proxy,
        # not a hospital resource cost (the hospital is not paid for it either).
        n, b = request_body["target"], scenario["plan"]["breakdown"]
        drug = next(i for i in result["coverage"]["items"] if i["id"] == "drug-contingency")
        assert economics["sponsor"]["supply_resource_proxy"] == pytest.approx(drug["resource_cost_per_participant"] * n, abs=0.01)
        assert economics["hospital"]["resource_cost"] == pytest.approx(
            0.8 * (b["activation"] + b["operating"] + b["site_variable"])
            + (result["coverage"]["totals"]["resource"] - drug["resource_cost_per_participant"]) * n, abs=0.02)
        # Count actual modeled resources once, while excluding the matching payment receipts.
        assert economics["consolidated_resource_cost"] == pytest.approx(
            economics["hospital"]["resource_cost"] + economics["sponsor"]["supply_resource_proxy"]
            + b["administration"] + economics["insurer"]["administration"] + economics["patient"]["access_support"], abs=0.02)


def test_investigational_supply_is_never_a_hospital_receipt_or_cost(client, request_body):
    default = by_id(compare(client, request_body))["A"]["economics"]
    assert default["sponsor"]["supply_resource_proxy"] > 0
    # Ratecard is optional: reconcile receipts/resources instead of a CMS-file-dependent golden.
    assert default["hospital"]["revenue"] == pytest.approx(sum(t["amount"] for t in default["transfers"] if t["to"] == "Hospital"), abs=.02)
    assert default["hospital"]["net_contribution"] == pytest.approx(default["hospital"]["revenue"] - default["hospital"]["resource_cost"], abs=.02)
    request_body["coverage_overrides"] = {"drug-contingency": "SPONSOR"}
    paid = by_id(compare(client, request_body))["A"]["economics"]
    assert paid["sponsor"]["contingency_reserve"] == default["sponsor"]["contingency_reserve"] - default["sponsor"]["supply_resource_proxy"]
    assert paid["sponsor"]["budget_commitment"] == default["sponsor"]["budget_commitment"]
    assert paid["transfers"] == default["transfers"]  # a sponsor-paid supply amount is not paid to the hospital
    assert paid["hospital"] == default["hospital"]
    assert paid["consolidated_resource_cost"] == default["consolidated_resource_cost"]


def test_access_support_is_not_netted_against_participant_cost_sharing(client, request_body):
    s = by_id(compare(client, request_body))
    extra = request_body["extra_support"] * request_body["target"]
    for ident in "ABCDE":
        patient = s[ident]["economics"]["patient"]
        assert set(patient) == {"cost_sharing", "access_support", "unresolved_exposure"}
        assert patient["cost_sharing"] == s["A"]["economics"]["patient"]["cost_sharing"]
        assert s[ident]["delta"]["patient_cost_sharing"] == 0
        assert "patient_exposure" not in s[ident]["delta"]
    assert s["D"]["delta"]["access_support"] == s["E"]["delta"]["access_support"] == extra
    assert s["D"]["economics"]["patient"]["access_support"] == s["A"]["economics"]["patient"]["access_support"] + extra
    result = compare(client, request_body)
    assert ACCESS_SUPPORT in result["limitations"] and result["assumptions"]["access_support"] == ACCESS_SUPPORT


def sponsor_side(result):
    return [{"plan": s["plan"], "sponsor": s["economics"] and s["economics"]["sponsor"],
             "budget_reallocation": s["budget_reallocation"], "sensitivity": s["sensitivity"]}
            for s in result["scenarios"]]


def test_sponsor_commitment_is_invariant_to_every_payer_assumption(client, request_body):
    """An insurer paying more (or less, or an unknown amount) never changes what the sponsor commits."""
    reference = None
    insurer_payments = set()
    default_totals = compare(client, request_body)["coverage"]["totals"]
    for kind, fraction, commercial_rate in itertools.product(
            ("Medicare", "Medicaid", "commercial"), (0.0, 0.5, 0.8, 1.0), (False, True)):
        body = deepcopy(request_body)
        body.update(payer_kind=kind, payer_fraction=fraction, commercial_rate_assumption=commercial_rate)
        result = compare(client, body)
        for key in ("sponsor", "reserve"):
            assert result["coverage"]["totals"][key] == default_totals[key]
        side = sponsor_side(result)
        reference = reference or side
        assert side == reference, (kind, fraction, commercial_rate)
        insurer_payments.add(by_id(result)["A"]["economics"]["insurer"]["payments"])
    # Not vacuous: the payer assumptions do move the insurer line, including to UNKNOWN.
    assert None in insurer_payments and len(insurer_payments - {None}) >= 4


def test_payer_share_moves_only_insurer_and_participant_lines(client, request_body):
    low, high = deepcopy(request_body), deepcopy(request_body)
    low["payer_fraction"], high["payer_fraction"] = 0.2, 1.0
    a_low, a_high = by_id(compare(client, low))["A"], by_id(compare(client, high))["A"]
    assert a_high["economics"]["insurer"]["payments"] > a_low["economics"]["insurer"]["payments"]
    assert a_high["economics"]["patient"]["cost_sharing"] < a_low["economics"]["patient"]["cost_sharing"]
    assert a_high["plan"]["sponsor_total"] == a_low["plan"]["sponsor_total"]
    assert a_high["economics"]["sponsor"] == a_low["economics"]["sponsor"]
    assert a_high["economics"]["hospital"]["revenue"] == pytest.approx(a_low["economics"]["hospital"]["revenue"], abs=0.02)


def test_medicaid_shows_no_enrollee_cost_sharing_whatever_the_payer_share(client, request_body):
    request_body["payer_kind"] = "Medicaid"
    seen = []
    for fraction in (0.0, 0.5, 0.8, 1.0):
        request_body["payer_fraction"] = fraction
        result = compare(client, request_body)
        routine = [i for i in result["coverage"]["items"] if i["status"] == "POTENTIALLY_PAYER_COVERED"]
        assert routine and all(i["patient_per_participant"] == 0 and i["payer_per_participant"] == i["unit_rate"]
                               for i in routine)
        assert result["coverage"]["totals"]["patient"] == 0
        assert by_id(result)["A"]["economics"]["patient"]["cost_sharing"] == 0
        assert "42 CFR 447.50-447.57" in result["coverage"]["warnings"][1]
        seen.append(sponsor_side(result))
    assert all(side == seen[0] for side in seen)


def test_coverage_status_not_insurer_payment_moves_a_line_onto_the_sponsor(client, request_body):
    """A contract term can make the sponsor pay a routine item; it is then not billed to the insurer."""
    base = compare(client, request_body)
    routine = next(i for i in base["coverage"]["items"] if i["status"] == "POTENTIALLY_PAYER_COVERED")
    request_body["coverage_overrides"] = {routine["id"]: "SPONSOR"}
    paid = compare(client, request_body)
    item = next(i for i in paid["coverage"]["items"] if i["id"] == routine["id"])
    assert item["sponsor_per_participant"] == item["sponsor_unit_rate"] > 0
    assert item["payer_per_participant"] == item["patient_per_participant"] == 0
    assert paid["coverage"]["totals"]["sponsor"] == pytest.approx(base["coverage"]["totals"]["sponsor"] + item["sponsor_unit_rate"], abs=0.02)
    assert by_id(paid)["A"]["plan"]["sponsor_total"] > by_id(base)["A"]["plan"]["sponsor_total"]


def test_medicare_pays_clinical_lab_tests_in_full_with_no_participant_share(client, request_body):
    """SSA 1833(a)(1)(D) and (b)(3): CLFS clinical diagnostic lab tests carry no Part B deductible or coinsurance."""
    from concord import terms
    result = compare(client, request_body)
    routine = [i for i in result["coverage"]["items"] if i["status"] == "POTENTIALLY_PAYER_COVERED"]
    clfs = [i for i in routine if (terms._price_code(i["code"], None) or {}).get("schedule") == "CLFS"]
    other = [i for i in routine if i not in clfs]
    assert clfs and other
    for item in clfs:
        assert item["payer_per_participant"] == item["unit_rate"] and item["patient_per_participant"] == 0
        assert item["explanation"].endswith("Medicare pays clinical diagnostic lab tests at 100% of the CLFS amount "
                                            "(no Part B deductible or coinsurance), so the participant share is 0")
    fraction = request_body["payer_fraction"]
    for item in other:  # the stated payer share still splits the other routine lines
        assert item["payer_per_participant"] == pytest.approx(item["unit_rate"] * fraction, abs=0.01)
    # Independently sum the priced routine lines. This must work with both optional CMS
    # data and the documented approximate placeholder rates in a clean offline checkout.
    expected_payer = sum(i["unit_rate"] for i in clfs) + sum(round(i["unit_rate"] * fraction + 1e-9, 2) for i in other)
    expected_patient = sum(round(i["unit_rate"] * (1-fraction) + 1e-9, 2) for i in other)
    assert result["coverage"]["totals"]["payer"] == pytest.approx(expected_payer, abs=.02)
    assert result["coverage"]["totals"]["patient"] == pytest.approx(expected_patient, abs=.02)
    a = by_id(result)["A"]["economics"]
    assert a["insurer"]["payments"] == pytest.approx(expected_payer * request_body["target"], abs=.02)
    assert a["patient"]["cost_sharing"] == pytest.approx(expected_patient * request_body["target"], abs=.02)
    all_payer = deepcopy(request_body)
    all_payer["payer_fraction"] = 1
    # Redistributing routine charges between payer and participant does not
    # change their sum, hospital receipts or hospital net contribution.
    assert by_id(compare(client, all_payer))["A"]["economics"]["hospital"] == a["hospital"]
    # Commercial (with the rate assumption) still splits lab tests by the stated share.
    request_body.update(payer_kind="commercial", commercial_rate_assumption=True)
    commercial = {i["id"]: i for i in compare(client, request_body)["coverage"]["items"]}
    assert all(commercial[i["id"]]["patient_per_participant"] > 0 for i in clfs if i["unit_rate"] >= 1)


def test_research_items_and_the_supply_reserve_offer_only_sponsor_side_statuses(client, request_body):
    items = compare(client, request_body)["coverage"]["items"]
    sponsor_side = ["SPONSOR", "CONDITIONAL", "UNKNOWN", "REVIEW_REQUIRED"]
    research = [i for i in items if i["status"] == "SPONSOR"]
    routine = [i for i in items if i["status"] == "POTENTIALLY_PAYER_COVERED"]
    drug = next(i for i in items if i["id"] == "drug-contingency")
    assert research and routine
    assert all(i["allowed_statuses"] == sponsor_side for i in research) and drug["allowed_statuses"] == sponsor_side
    assert all(len(i["allowed_statuses"]) == 6 for i in routine)
    # The offered statuses are exactly the ones the API accepts.
    for item in (research[0], drug, routine[0]):
        for status in ("SPONSOR", "POTENTIALLY_PAYER_COVERED", "POTENTIALLY_PATIENT_COST_SHARING", "CONDITIONAL",
                       "UNKNOWN", "REVIEW_REQUIRED"):
            request_body["coverage_overrides"] = {item["id"]: status}
            code = client.post("/api/financial/compare", json=request_body).status_code
            assert code == (200 if status in item["allowed_statuses"] else 422), (item["id"], status, code)


def test_payer_independence_does_not_say_a_contract_term_moves_a_line_off_the_sponsor():
    assert "onto or off" not in PAYER_INDEPENDENCE and "sponsor_rate_multiplier" not in PAYER_INDEPENDENCE
    assert "off the sponsor only when coverage analysis finds it is billable routine care" in PAYER_INDEPENDENCE
    assert PAYER_INDEPENDENCE.startswith("In this worksheet, payer type, payer share and the commercial-rate assumption "
                                         "change only the insurer and participant lines; the sponsor commitment does "
                                         "not fall because an insurer pays more for routine care.")


def test_sponsor_rate_multiplier_prices_research_items_not_insurer_payments(client, request_body):
    base = compare(client, request_body)
    request_body["sponsor_rate_multiplier"] = 1.5
    marked_up = compare(client, request_body)
    assert marked_up["coverage"]["totals"]["sponsor"] == pytest.approx(1.5 * base["coverage"]["totals"]["sponsor"], abs=0.5)
    assert marked_up["coverage"]["totals"]["payer"] == base["coverage"]["totals"]["payer"]
    assert marked_up["coverage"]["totals"]["patient"] == base["coverage"]["totals"]["patient"]
    assert by_id(marked_up)["A"]["plan"]["sponsor_total"] > by_id(base)["A"]["plan"]["sponsor_total"]
    for item in marked_up["coverage"]["items"]:
        if item["status"] == "POTENTIALLY_PAYER_COVERED":
            assert item["payer_per_participant"] + item["patient_per_participant"] == pytest.approx(item["unit_rate"], abs=0.02)


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


def test_paired_cost_draws_shift_same_network_scenarios_by_exactly_their_lever(client, request_body):
    s = by_id(compare(client, request_body))
    reduction = request_body["admin_cost"] * request_body["admin_reduction"]
    extra = request_body["extra_support"] * request_body["target"]
    for old, low_admin, more_support in zip(s["A"]["sensitivity"]["sponsor_total_quantiles"],
                                            s["B"]["sensitivity"]["sponsor_total_quantiles"],
                                            s["D"]["sensitivity"]["sponsor_total_quantiles"]):
        assert old - low_admin == pytest.approx(reduction, abs=0.02)
        assert more_support - old == pytest.approx(extra, abs=0.02)
    assert s["B"]["delta"]["sponsor_expenditure"] == pytest.approx(-reduction, abs=0.01)
    assert s["B"]["delta"]["insurer_expenditure"] == 0
    q10, q50, q90 = s["A"]["sensitivity"]["sponsor_total_quantiles"]
    assert q10 < q50 < q90
    assert s["A"]["sensitivity"]["cost_spread"] == request_body["cost_spread"]


def test_zero_cost_spread_collapses_sensitivity_to_the_nominal_commitment(client, request_body):
    request_body["cost_spread"] = 0
    for scenario in compare(client, request_body)["scenarios"]:
        total = round(scenario["plan"]["sponsor_total"], 2)
        assert scenario["sensitivity"]["sponsor_total_quantiles"] == pytest.approx([total] * 3, abs=0.01)
        assert scenario["sensitivity"]["probability_budget_exceeded"] == 0


def test_each_procedure_is_attributed_once_and_unknowns_are_reserved(client, request_body):
    coverage = compare(client, request_body)["coverage"]
    items = coverage["items"]
    assert len({i["id"] for i in items}) == len(items)
    for item in items:
        allocations = [item[f"{party}_per_participant"] for party in ("sponsor", "payer", "patient", "reserve")]
        assert all(amount >= 0 for amount in allocations)
        if item["status"] == "POTENTIALLY_PAYER_COVERED":  # billed to insurance at the benchmark
            assert item["payer_per_participant"] + item["patient_per_participant"] == pytest.approx(item["unit_rate"], abs=0.02)
            assert item["sponsor_per_participant"] == item["reserve_per_participant"] == 0
        else:  # paid or held by the sponsor at the negotiated rate (or the participant-exposure scenario)
            assert sum(allocations) == pytest.approx(item["sponsor_unit_rate"] if item["status"] != "POTENTIALLY_PATIENT_COST_SHARING"
                                                     else item["unit_rate"], abs=0.02)
        if item["sponsor_per_participant"]:
            assert item["payer_per_participant"] == item["patient_per_participant"] == 0
        if item["status"] in ("UNKNOWN", "CONDITIONAL", "REVIEW_REQUIRED"):
            assert item["reserve_per_participant"] == item["sponsor_unit_rate"]
            assert item["payer_per_participant"] == item["patient_per_participant"] == 0
        assert item["source"] and item["year"]
        assert item["coverage_determination_status"] in ("NOT_DETERMINED", "UNKNOWN")
    assert any(i["status"] == "UNKNOWN" for i in items)


def test_commercial_without_rate_assumption_leaves_routine_amounts_unknown_not_on_the_sponsor(client, request_body):
    medicare = compare(client, request_body)
    request_body["payer_kind"] = "commercial"
    request_body["commercial_rate_assumption"] = False
    result = compare(client, request_body)
    assert result["coverage"]["totals"]["payer"] is None
    assert result["coverage"]["totals"]["patient"] is None
    assert result["coverage"]["totals"]["sponsor"] == medicare["coverage"]["totals"]["sponsor"]
    assert result["coverage"]["totals"]["reserve"] == medicare["coverage"]["totals"]["reserve"]
    routine = [i for i in result["coverage"]["items"] if i["status"] == "POTENTIALLY_PAYER_COVERED"]
    assert routine and result["coverage"]["insurer_amounts_unknown"] == len(routine)
    assert all(i["payer_per_participant"] is None and i["patient_per_participant"] is None
               and i["reserve_per_participant"] == 0 and not i["insurer_amount_known"] for i in routine)
    for scenario in result["scenarios"]:
        economics = scenario["economics"]
        assert economics["insurer"]["payments"] is None and economics["hospital"]["revenue"] is None
        assert economics["patient"]["unresolved_exposure"] is None
        assert economics["transfer_balance"] == pytest.approx(0, abs=0.001)
    assert sponsor_side(result) == sponsor_side(medicare)


def test_operator_can_mark_routine_unknown_but_cannot_shift_research_to_payer(client, request_body):
    items = compare(client, request_body)["coverage"]["items"]
    routine = next(i for i in items if i["status"] == "POTENTIALLY_PAYER_COVERED")
    request_body["coverage_overrides"] = {routine["id"]: "UNKNOWN"}
    reviewed = compare(client, request_body)
    item = next(i for i in reviewed["coverage"]["items"] if i["id"] == routine["id"])
    assert item["review_status"] == "operator_interpretation"
    assert item["reserve_per_participant"] == item["sponsor_unit_rate"]
    assert item["payer_per_participant"] == item["patient_per_participant"] == 0
    research = next(i for i in items if i["status"] == "SPONSOR")
    request_body["coverage_overrides"] = {research["id"]: "POTENTIALLY_PAYER_COVERED"}
    assert client.post("/api/financial/compare", json=request_body).status_code == 422
    request_body["coverage_overrides"] = {"not-a-procedure": "SPONSOR"}
    assert client.post("/api/financial/compare", json=request_body).status_code == 422


def test_budget_cannot_be_met_by_silently_reassigning_unresolved_costs(client, request_body):
    request_body["budget"] = 1
    result = compare(client, request_body)
    assert "recommended_scenario_id" not in result
    assert result["coverage"]["totals"]["reserve"] > 0
    for scenario in result["scenarios"]:
        plan = scenario["plan"]
        assert not plan["feasible"] and plan["costed"]
        assert plan["violations"] == ["Sponsor commitment exceeds budget"]
        assert plan["unspent_budget"] < 0  # the overrun is shown, not hidden
        assert scenario["sensitivity"]["probability_budget_exceeded"] == 1.0


def test_responses_contain_no_time_speed_or_recommendation_output(client, request_body):
    """Key scan and text scan over compare JSON, demo JSON and the HTML report.

    Allowed: the request's own input key ``budget_period_months`` (and site ``monthly_cost``), the
    phrase stating that input in the report, and the single vetted NO_TIME_MODEL disclaimer.
    """
    request_body["sites"][0]["capacity"] = 20
    request_body["sites"][1]["capacity"] = 20  # also exercise the capacity-rule path
    result = compare(client, request_body)
    demo = client.get("/api/financial/demo").json()
    report = client.post("/api/financial/report?format=html", json=request_body).text
    key_pattern = re.compile(r"month|duration|speed|fast|accelerat|sooner|shorter|time|lag|recommend|"
                             r"enroll|recruit|horizon|no_loser|completion|quantile.*month", re.I)

    def keys(obj, path=()):
        if isinstance(obj, dict):
            for key, value in obj.items():
                yield path, key
                yield from keys(value, (*path, key))
        elif isinstance(obj, list):
            for value in obj:
                yield from keys(value, path)
    allowed_inputs = {"budget_period_months", "monthly_cost"}
    for payload in (result, demo):
        offending = [(p, k) for p, k in keys(payload) if key_pattern.search(k)
                     and not (p[:1] == ("request",) and k in allowed_inputs)]
        assert not offending
    assert "budget_period_months" in result["request"] and "rate" not in result["request"]["sites"][0]

    text_pattern = re.compile(r"months|faster|fastest|speed|accelerat|sooner|shorter|time[ _-]?change|"
                              r"time[ _-]to[ _-]fill|recommend|duration|enrollment rate|recruitment rate|"
                              r"participants (?:per|/) ?month|activation lag|no[ _-]loser|horizon", re.I)
    # The scans would catch every output the earlier time model produced.
    for old_key in ("modeled_months", "core_modeled_months", "site_completion_months", "modeled_time_change",
                    "modeled_months_quantiles", "nominal_max_months", "probability_horizon_exceeded",
                    "recommended_scenario_id", "activation_lag_months", "no_loser"):
        assert key_pattern.search(old_key), old_key
    for old_text in ("Modeled months", "fastest feasible", "shorter modeled time", "Reinvestment speeds up",
                     "time change", "Nominal modeled duration exceeds the horizon", "recommended"):
        assert text_pattern.search(old_text), old_text
    assert NO_TIME_MODEL in result["limitations"] and NO_TIME_MODEL in report
    for text in (json.dumps(result), json.dumps(demo), report):
        text = text.replace(NO_TIME_MODEL, "").replace("budget_period_months", "")
        text = re.sub(r"budgeted contract period of [\d.,]+ months", "", text)
        assert not sorted({m.group(0) for m in text_pattern.finditer(text)})


@pytest.mark.parametrize("field,value", [
    ("no_loser", True), ("horizon_months", 24), ("rate_spread", 0.25), ("rate_multiplier", 1),
    ("recommended_scenario_id", "C"),
])
def test_removed_time_and_ranking_inputs_are_rejected(client, request_body, field, value):
    request_body[field] = value
    assert client.post("/api/financial/compare", json=request_body).status_code == 422


@pytest.mark.parametrize("field", ["rate", "activation_lag_months"])
def test_removed_site_timing_fields_are_rejected(client, request_body, field):
    request_body["sites"][0][field] = 2
    assert client.post("/api/financial/compare", json=request_body).status_code == 422


@pytest.mark.parametrize("field,value", [
    ("budget", -1), ("target", -1), ("budget_period_months", 0),
    ("admin_reduction", 1.1), ("payer_fraction", -0.1),
    ("sponsor_rate_multiplier", -1), ("draws", 0), ("cost_spread", -0.1),
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
    assert html.escape(PAYER_BILLING) in report.text and html.escape(PAYER_INDEPENDENCE) in report.text
    # No compliance claim the worksheet cannot make; the per-participant cost definition is stated.
    assert "no double billing" not in report.text.lower()
    assert html.escape(NOT_A_BILLING_REVIEW) in report.text and html.escape(ACCESS_SUPPORT) in report.text
    assert "not itemized" in result["assumptions"]["site_per_participant_cost"]
    assert "pilot" not in json.dumps(result).lower() and "pilot" not in report.text.lower()


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
    assert 'recommended_scenario_id' not in result
    assert all(not s['plan']['feasible'] for s in result['scenarios'])
    assert all('Selected site is not operator-assumed feasible' in s['plan']['violations'] for s in result['scenarios'])
