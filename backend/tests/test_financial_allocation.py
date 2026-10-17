"""Arithmetic and constraint checks on explicitly assumed financial inputs."""

import pytest

from concord.financial_allocation import evaluate_plan, optimize_plan


def sites():
    return [dict(id="a", name="A", baseline_active=True, feasible=True, activation_cost=500,
                 monthly_cost=10, per_participant_cost=20, rate=10, capacity=100, activation_lag_months=0),
            dict(id="b", name="B", baseline_active=False, feasible=True, activation_cost=200,
                 monthly_cost=30, per_participant_cost=40, rate=10, capacity=100, activation_lag_months=2)]


def args(**overrides):
    return dict(target=100, horizon_months=12, budget=20000, procedure_per_participant=50,
                admin_cost=100, support_per_participant=10, **overrides)


def test_exact_financial_arithmetic_and_core_time():
    result = evaluate_plan(sites(), ["b", "a"], **args())
    assert result["feasible"]
    assert result["modeled_months"] == 7  # assigned late site finishes 50 / 10 + 2; core lower bound remains 6
    assert [r["participants"] for r in result["site_rows"]] == [50, 50]
    assert result["breakdown"] == dict(activation=200, operating=280, site_variable=3000,
                                       procedures=5000, support=1000, administration=100)
    assert result["sponsor_total"] == 9580
    assert sum(r["total"] for r in result["site_rows"]) + 100 == 9580
    assert result["unspent_budget"] == 10420
    assert result["cost_per_participant"] == 95.8


def test_budget_and_support_floor_are_constraints():
    values = args()
    values["budget"] = 9579
    assert not evaluate_plan(sites(), ["a", "b"], **values)["feasible"]
    values["budget"] = 9580
    assert evaluate_plan(sites(), ["a", "b"], **values)["feasible"]
    values["minimum_support"] = 11
    assert not evaluate_plan(sites(), ["a", "b"], **values)["feasible"]


def test_capacity_redistributes_integer_target_and_horizon_rejects():
    values = sites()
    values[0]["capacity"] = 20
    result = evaluate_plan(values, ["a", "b"], **args())
    assert result["feasible"]
    assert [r["participants"] for r in result["site_rows"]] == [20, 80]
    values[1]["capacity"] = 79
    result = evaluate_plan(values, ["a", "b"], **args())
    assert not result["feasible"]
    assert result["projected_capacity"] == 99
    values = args()
    values["horizon_months"] = 4
    assert not evaluate_plan(sites(), ["a", "b"], **values)["feasible"]


def test_deterministic_subset_optimization_and_no_loser():
    result = optimize_plan(sites(), **args())
    assert result["selected_ids"] == ["a", "b"]
    assert result["evaluated_subsets"] == 3
    assert result == optimize_plan(list(reversed(sites())), **args())
    rejected = optimize_plan(sites(), max_months=6.9, **args())
    assert not rejected["feasible"]
    assert rejected["sponsor_total"] is None
    assert "Nominal no-loser timing bound exceeded" in rejected["violations"]
    assert optimize_plan(sites(), max_months=7, **args())["feasible"]


def test_required_sites_and_explicit_infeasible():
    values = args()
    values["budget"] = 1
    result = optimize_plan(sites(), required_ids=["b"], **values)
    assert not result["feasible"]
    assert result["feasible_subsets"] == 0
    assert result["evaluated_subsets"] == 2
    assert result["site_rows"] == []
    values = sites()
    values[1]["feasible"] = False
    assert optimize_plan(values, required_ids=["b"], **args())["feasible"] is False


def test_activation_sunk_only_when_baseline_active():
    first = evaluate_plan(sites(), ["a"], **args())
    values = sites()
    values[0]["baseline_active"] = False
    second = evaluate_plan(values, ["a"], **args())
    assert second["sponsor_total"] - first["sponsor_total"] == 500


@pytest.mark.parametrize("field,value", [("budget", float("nan")), ("horizon_months", 0), ("target", 1.5), ("budget", True)])
def test_invalid_inputs_fail_closed(field, value):
    values = args()
    values[field] = value
    with pytest.raises(ValueError):
        optimize_plan(sites(), **values)


def test_bound_and_invalid_selection():
    with pytest.raises(ValueError):
        optimize_plan([dict(sites()[0], id=str(i)) for i in range(9)], **args())
    with pytest.raises(ValueError):
        evaluate_plan(sites(), ["a", "a"], **args())
    with pytest.raises(ValueError):
        evaluate_plan(sites(), ["missing"], **args())


def test_integer_tie_break_and_zero_allocation_cannot_inflate_rates():
    values = sites()
    for site in values:
        site["activation_lag_months"] = 0
    options = args()
    options["target"] = 3
    result = evaluate_plan(values, ["b", "a"], **options)
    assert [r["participants"] for r in result["site_rows"]] == [2, 1]
    options["target"] = 1
    assert not evaluate_plan(values, ["a", "b"], **options)["feasible"]


def test_assigned_sites_can_finish_by_the_costed_duration():
    candidate=sites()
    candidate[0]['capacity']=20
    result=evaluate_plan(candidate,['a','b'],**args())
    assert result['modeled_months']==10
    assert result['core_modeled_months']==6
    for row in result['site_rows']:
        site=next(s for s in candidate if s['id']==row['id'])
        assert site['rate']*(result['modeled_months']-site['activation_lag_months']) >= row['participants']
