"""Arithmetic and constraint checks on explicitly assumed sponsor-budget inputs."""

import re

import pytest

from concord.financial_allocation import allocate_by_capacity, capacity_network, evaluate_plan


def sites():
    return [dict(id="a", name="A", baseline_active=True, feasible=True, activation_cost=500,
                 monthly_cost=10, per_participant_cost=20, capacity=100),
            dict(id="b", name="B", baseline_active=False, feasible=True, activation_cost=200,
                 monthly_cost=30, per_participant_cost=40, capacity=100)]


def args(**overrides):
    return dict(target=100, budget_period_months=12, budget=20000, procedure_per_participant=50,
                admin_cost=100, support_per_participant=10, **overrides)


def test_exact_sponsor_budget_arithmetic():
    result = evaluate_plan(sites(), ["b", "a"], **args())
    assert result["feasible"] and result["costed"]
    assert [r["participants"] for r in result["site_rows"]] == [50, 50]
    # operating = (10 + 30) monthly x 12-month budgeted period; a's activation is sunk.
    assert result["breakdown"] == dict(activation=200, operating=480, site_variable=3000,
                                       procedures=5000, support=1000, administration=100)
    assert result["sponsor_total"] == 9780
    assert sum(r["total"] for r in result["site_rows"]) + 100 == 9780
    assert result["unspent_budget"] == 10220
    assert result["cost_per_participant"] == 97.8
    assert result["stated_capacity"] == 200


def test_operating_cost_is_monthly_cost_times_the_budgeted_period_and_nothing_else_moves():
    short = evaluate_plan(sites(), ["a", "b"], **args())
    values = args()
    values["budget_period_months"] = 24
    long = evaluate_plan(sites(), ["a", "b"], **values)
    assert long["breakdown"]["operating"] == 2 * short["breakdown"]["operating"] == 960
    for key in ("activation", "site_variable", "procedures", "support", "administration"):
        assert long["breakdown"][key] == short["breakdown"][key]
    assert [r["participants"] for r in long["site_rows"]] == [r["participants"] for r in short["site_rows"]]


def test_budget_and_support_floor_are_constraints_but_over_budget_is_still_costed():
    values = args()
    values["budget"] = 9779
    over = evaluate_plan(sites(), ["a", "b"], **values)
    assert not over["feasible"] and over["costed"]
    assert over["sponsor_total"] == 9780 and over["unspent_budget"] == -1
    assert over["violations"] == ["Sponsor commitment exceeds budget"]
    values["budget"] = 9780
    assert evaluate_plan(sites(), ["a", "b"], **values)["feasible"]
    values["minimum_support"] = 11
    assert not evaluate_plan(sites(), ["a", "b"], **values)["feasible"]


def test_participants_split_in_proportion_to_stated_capacity_with_exact_integer_rounding():
    values = sites()
    values[0]["capacity"] = 20
    values[1]["capacity"] = 80
    result = evaluate_plan(values, ["a", "b"], **{**args(), "target": 50})
    assert [r["participants"] for r in result["site_rows"]] == [10, 40]
    # 2 x 1/3 = 0.67 and 2 x 2/3 = 1.33: floors 0 and 1, the larger remainder (a) gets the last one.
    assert allocate_by_capacity([dict(id="a", capacity=1), dict(id="b", capacity=2)], 2) == [1, 1]
    # Equal remainders go to the lower site id, whatever the input order.
    assert allocate_by_capacity([dict(id="b", capacity=1), dict(id="a", capacity=1)], 1) == [0, 1]
    for caps, target in (([3, 5, 7], 11), ([1, 1, 1], 3), ([9, 1], 10), ([4, 6, 10], 7)):
        split = allocate_by_capacity([dict(id=str(i), capacity=c) for i, c in enumerate(caps)], target)
        assert sum(split) == target and all(0 <= n <= c for n, c in zip(split, caps))


def test_insufficient_stated_capacity_is_uncosted_not_partially_priced():
    values = sites()
    values[0]["capacity"] = 20
    values[1]["capacity"] = 79
    result = evaluate_plan(values, ["a", "b"], **args())
    assert not result["feasible"] and not result["costed"]
    assert result["stated_capacity"] == 99
    assert result["sponsor_total"] is None and result["site_rows"] == []
    assert "Stated capacity of the selected sites is below the participant target" in result["violations"]


def test_capacity_rule_keeps_the_existing_network_when_it_has_capacity():
    result = capacity_network(sites(), base_ids=["a"], **args())
    assert result["selected_ids"] == ["a"]
    assert result["network_search"]["base_has_capacity"]
    assert result["network_search"]["candidate_networks_evaluated"] == 0
    assert result["sponsor_total"] == evaluate_plan(sites(), ["a"], **args())["sponsor_total"]


def test_capacity_rule_adds_the_lowest_commitment_capacity_sufficient_sites():
    values = sites() + [dict(id="c", name="C", baseline_active=False, feasible=True, activation_cost=100,
                             monthly_cost=5, per_participant_cost=40, capacity=30),
                        dict(id="d", name="D", baseline_active=False, feasible=True, activation_cost=0,
                             monthly_cost=0, per_participant_cost=0, capacity=500)]
    values[0]["capacity"] = 60
    values[3]["feasible"] = False  # the free, huge site is operator-flagged infeasible: never added
    result = capacity_network(values, base_ids=["a"], **args())
    assert result["costed"]
    # {a,c} has capacity 90 < 100; {a,b} (10,020) and {a,b,c} (10,320) cover it; c adds activation
    # and monthly cost at b's per-participant cost, so {a,b} is the lower commitment.
    assert result["selected_ids"] == ["a", "b"]
    assert result["sponsor_total"] == 10020
    search = result["network_search"]
    assert not search["base_has_capacity"]
    assert search["candidate_networks_evaluated"] == 3  # {b}, {c}, {b,c} added to a
    assert search["capacity_sufficient_networks"] == 2
    expected = min((evaluate_plan(values, ids, **args()) for ids in (["a", "b"], ["a", "b", "c"])),
                   key=lambda p: p["sponsor_total"])
    assert result["sponsor_total"] == expected["sponsor_total"]
    assert result == capacity_network(list(reversed(values)), base_ids=["a"], **args())


def test_capacity_rule_choice_ignores_budget_and_reports_overrun():
    values = sites()
    values[0]["capacity"] = 60
    tight = args()
    tight["budget"] = 1
    result = capacity_network(values, base_ids=["a"], **tight)
    assert result["selected_ids"] == ["a", "b"] and result["costed"] and not result["feasible"]
    assert "Sponsor commitment exceeds budget" in result["violations"]


def test_capacity_rule_with_no_sufficient_network_is_explicit():
    values = sites()
    values[0]["capacity"] = 10
    values[1]["capacity"] = 10
    result = capacity_network(values, base_ids=["a"], **args())
    assert not result["feasible"] and not result["costed"]
    assert result["selected_ids"] == ["a"]
    assert result["network_search"]["capacity_sufficient_networks"] == 0


def test_activation_sunk_only_when_baseline_active():
    first = evaluate_plan(sites(), ["a"], **args())
    values = sites()
    values[0]["baseline_active"] = False
    second = evaluate_plan(values, ["a"], **args())
    assert second["sponsor_total"] - first["sponsor_total"] == 500


def test_plan_outputs_carry_no_time_or_speed_fields():
    outputs = [evaluate_plan(sites(), ["a", "b"], **args()), capacity_network(sites(), base_ids=["a"], **args())]
    pattern = re.compile(r"month|duration|speed|fast|time|rate|lag|recommend", re.I)

    def keys(obj):
        if isinstance(obj, dict):
            for key, value in obj.items():
                yield key
                yield from keys(value)
        elif isinstance(obj, list):
            for value in obj:
                yield from keys(value)
    assert not [k for result in outputs for k in keys(result) if pattern.search(k)]


@pytest.mark.parametrize("field,value", [("budget", float("nan")), ("budget_period_months", 0),
                                         ("target", 1.5), ("budget", True)])
def test_invalid_inputs_fail_closed(field, value):
    values = args()
    values[field] = value
    with pytest.raises(ValueError):
        evaluate_plan(sites(), ["a"], **values)
    with pytest.raises(ValueError):
        capacity_network(sites(), base_ids=["a"], **values)


def test_bound_and_invalid_selection():
    with pytest.raises(ValueError):
        capacity_network([dict(sites()[0], id=str(i)) for i in range(9)], base_ids=["0"], **args())
    with pytest.raises(ValueError):
        evaluate_plan(sites(), ["a", "a"], **args())
    with pytest.raises(ValueError):
        evaluate_plan(sites(), ["missing"], **args())
    with pytest.raises(ValueError):
        capacity_network(sites(), base_ids=["missing"], **args())
    with pytest.raises(ValueError):
        allocate_by_capacity([dict(id="a", capacity=1)], 2)
