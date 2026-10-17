"""Sponsor-budget arithmetic for a fixed participant target over a budgeted contract period.

Every input is an operator assumption (site costs, stated capacities, the contract
period). Nothing here models recruitment, enrollment pace, site activation timing or
trial length, and nothing ranks or recommends a network. The contract period is an
input that prices monthly site costs; it is not a forecast.
"""

from __future__ import annotations

import itertools
import math


ASSUMPTIONS = [
    "Operator-supplied site costs, stated capacities and feasibility flags; no empirical validation.",
    "Participants are allocated across the selected sites in proportion to each site's stated capacity "
    "(largest-remainder integer rounding, ties broken by site id). When an existing network that lacks "
    "capacity is extended, the existing sites are filled to their stated capacity first and only the "
    "shortfall is split across the added sites by capacity. Stated capacity is an input, not a "
    "measured or predicted enrollment.",
    "Operating cost = each selected site's monthly cost x the budgeted contract period (an input).",
    "Site per-participant cost covers only site costs not itemized in the coverage worksheet (for example "
    "coordinator time and data entry); it must exclude every worksheet procedure, or that procedure is "
    "counted twice.",
    "Activation for baseline-active sites is sunk and excluded; activation for added sites is included.",
    "A plan is feasible when stated capacity covers the target, the sponsor commitment is within budget, "
    "every selected site is operator-flagged feasible and support meets the floor.",
]


def _number(value, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    result = float(value)
    if not math.isfinite(result) or result < 0 or (positive and result <= 0):
        raise ValueError(f"{name} must be finite and {'positive' if positive else 'nonnegative'}")
    return result


def _validate(sites, target, budget_period_months, budget, procedure_per_participant,
              admin_cost, support_per_participant, minimum_support):
    if not isinstance(sites, list) or not 1 <= len(sites) <= 8:
        raise ValueError("Supply between one and eight sites")
    if isinstance(target, bool) or not isinstance(target, int) or target <= 0:
        raise ValueError("target must be a positive integer")
    for name, value in (("budget_period_months", budget_period_months), ("budget", budget),
                        ("procedure_per_participant", procedure_per_participant),
                        ("admin_cost", admin_cost), ("support_per_participant", support_per_participant),
                        ("minimum_support", minimum_support)):
        _number(value, name, positive=name == "budget_period_months")
    ids = []
    for site in sites:
        if not isinstance(site, dict) or not isinstance(site.get("id"), str) or not site["id"]:
            raise ValueError("Every site must have a nonempty string id")
        ids.append(site["id"])
        for flag in ("baseline_active", "feasible"):
            if not isinstance(site.get(flag), bool):
                raise ValueError(f"{site['id']}.{flag} must be boolean")
        for field in ("activation_cost", "monthly_cost", "per_participant_cost"):
            _number(site.get(field), f"{site['id']}.{field}")
        capacity = site.get("capacity")
        if isinstance(capacity, bool) or not isinstance(capacity, int) or capacity < 0:
            raise ValueError(f"{site['id']}.capacity must be a nonnegative integer")
    if len(set(ids)) != len(ids):
        raise ValueError("Site ids must be unique")


def allocate_by_capacity(sites: list[dict], target: int) -> list[int]:
    """Split ``target`` across ``sites`` in proportion to stated capacity.

    Exact integer largest-remainder apportionment: floor(target * cap / total) each, then one
    more to the largest remainders, ties by site id. Requires total capacity >= target, so no
    site ever receives more than its stated capacity.
    """
    caps = [s["capacity"] for s in sites]
    total = sum(caps)
    if total < target:
        raise ValueError("Stated capacity is below the participant target")
    allocation = [target * cap // total for cap in caps]
    remainders = [target * cap % total for cap in caps]
    order = sorted(range(len(sites)), key=lambda i: (-remainders[i], sites[i]["id"]))
    for i in order[:target - sum(allocation)]:
        allocation[i] += 1
    return allocation


PROPORTIONAL = "proportional_to_stated_capacity"
EXISTING_FIRST = "existing_sites_at_stated_capacity_then_added_sites_by_capacity"


def _split(chosen: list[dict], target: int, base_ids) -> tuple[list[int], str]:
    """Participant counts for ``chosen`` (sorted by id) and the rule that produced them.

    Proportional to stated capacity, except when ``base_ids`` (the existing network) cannot hold the
    target on its own: then each existing site takes its full stated capacity and only the shortfall
    is split across the added sites by capacity. Under-filling already-active sites to push
    participants to new ones would not be a sponsor's plan and would inflate the cost of the shortfall.
    """
    if base_ids is not None:
        base = [s for s in chosen if s["id"] in base_ids]
        added = [s for s in chosen if s["id"] not in base_ids]
        base_capacity = sum(s["capacity"] for s in base)
        if added and base_capacity < target:
            extra = iter(allocate_by_capacity(added, target - base_capacity))
            return [s["capacity"] if s["id"] in base_ids else next(extra) for s in chosen], EXISTING_FIRST
    return allocate_by_capacity(chosen, target), PROPORTIONAL


def _uncosted(ids, violations, stated_capacity):
    return {"feasible": False, "costed": False, "violations": violations, "selected_ids": ids,
            "participant_split": None, "site_rows": [], "sponsor_total": None, "breakdown": None,
            "stated_capacity": stated_capacity, "cost_per_participant": None,
            "budget_utilization": None, "unspent_budget": None, "assumptions": list(ASSUMPTIONS)}


def evaluate_plan(sites: list[dict], selected_ids: list[str], target: int,
                  budget_period_months: float, budget: float, procedure_per_participant: float,
                  admin_cost: float, support_per_participant: float,
                  minimum_support: float = 0, base_ids: list[str] | None = None) -> dict:
    """Sponsor commitment for one operator-defined site network; all amounts are dollars.

    ``base_ids`` names the existing sites within ``selected_ids`` when the network extends an
    existing one; it only changes the participant split (see ``_split``).
    """
    _validate(sites, target, budget_period_months, budget, procedure_per_participant,
              admin_cost, support_per_participant, minimum_support)
    if not isinstance(selected_ids, list) or any(not isinstance(x, str) for x in selected_ids):
        raise ValueError("selected_ids must be a list of site ids")
    if len(set(selected_ids)) != len(selected_ids):
        raise ValueError("selected_ids must be unique")
    by_id = {s["id"]: s for s in sites}
    if any(site_id not in by_id for site_id in selected_ids):
        raise ValueError("Unknown selected site id")
    if base_ids is not None and (not isinstance(base_ids, list) or not set(base_ids) <= set(selected_ids)):
        raise ValueError("base_ids must be a list of selected site ids")
    ids = sorted(selected_ids)
    chosen = [by_id[site_id] for site_id in ids]
    if not chosen:
        return _uncosted(ids, ["No sites selected"], 0)
    violations = []
    if any(not s["feasible"] for s in chosen):
        violations.append("Selected site is not operator-assumed feasible")
    if support_per_participant < minimum_support:
        violations.append("Per-participant support is below the minimum support floor")
    capacity = sum(s["capacity"] for s in chosen)
    if capacity < target:
        violations.append("Stated capacity of the selected sites is below the participant target")
        return _uncosted(ids, violations, capacity)
    counts, split = _split(chosen, target, None if base_ids is None else set(base_ids))
    rows = []
    for site, count in zip(chosen, counts):
        row = {"id": site["id"], "name": site.get("name", site["id"]),
               "participants": count, "capacity": site["capacity"],
               "activation": 0.0 if site["baseline_active"] else float(site["activation_cost"]),
               "activation_sunk": site["baseline_active"],
               "operating": site["monthly_cost"] * budget_period_months,
               "variable": count * site["per_participant_cost"],
               "procedure": count * procedure_per_participant,
               "support": count * support_per_participant}
        row["total"] = sum(row[key] for key in ("activation", "operating", "variable", "procedure", "support"))
        rows.append(row)
    breakdown = {key: sum(row[field] for row in rows) for key, field in
                 (("activation", "activation"), ("operating", "operating"),
                  ("site_variable", "variable"), ("procedures", "procedure"), ("support", "support"))}
    breakdown["administration"] = float(admin_cost)
    total = sum(breakdown.values())
    if total > budget + 1e-7:
        violations.append("Sponsor commitment exceeds budget")
    return {"feasible": not violations, "costed": True, "violations": violations, "selected_ids": ids,
            "participant_split": split, "site_rows": rows, "sponsor_total": total, "breakdown": breakdown,
            "stated_capacity": capacity, "cost_per_participant": total / target,
            "budget_utilization": total / budget if budget else (0.0 if total == 0 else None),
            "unspent_budget": budget - total, "assumptions": list(ASSUMPTIONS)}


CAPACITY_RULE = ("Keep the existing network if its stated capacity covers the target; otherwise add "
                 "operator-feasible sites, choosing the capacity-sufficient network with the lowest "
                 "sponsor commitment (ties: fewer sites, then sorted ids), with the existing sites filled "
                 "to their stated capacity and only the shortfall placed at added sites. Budget does not "
                 "change the choice.")


def capacity_network(sites: list[dict], *, base_ids: list[str], target: int,
                     budget_period_months: float, budget: float, procedure_per_participant: float,
                     admin_cost: float, support_per_participant: float,
                     minimum_support: float = 0) -> dict:
    """Scenario C's network rule: the existing network, extended only when it lacks stated capacity."""
    _validate(sites, target, budget_period_months, budget, procedure_per_participant,
              admin_cost, support_per_participant, minimum_support)
    ids = {s["id"] for s in sites}
    if not isinstance(base_ids, list) or any(not isinstance(x, str) or x not in ids for x in base_ids):
        raise ValueError("base_ids must contain known site ids")
    if len(set(base_ids)) != len(base_ids):
        raise ValueError("base_ids must be unique")
    kw = dict(target=target, budget_period_months=budget_period_months, budget=budget,
              procedure_per_participant=procedure_per_participant, admin_cost=admin_cost,
              support_per_participant=support_per_participant, minimum_support=minimum_support)
    base_capacity = sum(s["capacity"] for s in sites if s["id"] in base_ids)
    search = {"rule": CAPACITY_RULE, "base_ids": sorted(base_ids),
              "base_has_capacity": base_capacity >= target,
              "candidate_networks_evaluated": 0, "capacity_sufficient_networks": 0}
    if base_capacity >= target:
        plan = evaluate_plan(sites, list(base_ids), **kw)
        plan["network_search"] = search
        return plan
    extras = sorted(s["id"] for s in sites if s["id"] not in base_ids and s["feasible"])
    candidates = []
    for size in range(1, len(extras) + 1):
        for added in itertools.combinations(extras, size):
            search["candidate_networks_evaluated"] += 1
            plan = evaluate_plan(sites, [*base_ids, *added], base_ids=list(base_ids), **kw)
            if plan["costed"]:
                candidates.append(plan)
    search["capacity_sufficient_networks"] = len(candidates)
    if candidates:
        plan = min(candidates, key=lambda p: (p["sponsor_total"], len(p["selected_ids"]), p["selected_ids"]))
    else:
        plan = _uncosted(sorted(base_ids), ["No network of existing plus operator-feasible sites has "
                                            "enough stated capacity for the participant target"], base_capacity)
    plan["network_search"] = search
    return plan
