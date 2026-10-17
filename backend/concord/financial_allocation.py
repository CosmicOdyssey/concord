"""Bounded financial scenario screening around the existing nominal timing model.

Inputs are operator assumptions, not measured clinical capabilities or validated
recruitment forecasts. This module neither fits rates nor changes the optimizer.
"""

from __future__ import annotations

import itertools
import math

import numpy as np

from concord.allocator.core import Instance, evaluate


ASSUMPTIONS = [
    "Operator-supplied rates, costs, eligibility and capacities; no empirical validation.",
    "Existing core timing is retained as a lower bound; financial duration also allows every assigned site to finish its integer participant allocation after activation. No competition modeled.",
    "Participant counts are integer rate-weighted allocations bounded by horizon deliverability and site capacity.",
    "Baseline-active activation costs are sunk and excluded; all selected sites incur monthly costs for the full modeled duration.",
    "Minimum support is a per-participant floor; no-loser checks constrain nominal modeled timing only.",
    "Constant hypothetical rates and deterministic assigned counts only; no actual clinical outcome simulation.",
]


def _number(value, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    result = float(value)
    if not math.isfinite(result) or result < 0 or (positive and result <= 0):
        raise ValueError(f"{name} must be finite and {'positive' if positive else 'nonnegative'}")
    return result


def _validate(sites, target, horizon_months, budget, procedure_per_participant,
              admin_cost, support_per_participant, minimum_support):
    if not isinstance(sites, list) or not 1 <= len(sites) <= 8:
        raise ValueError("Supply between one and eight sites")
    if isinstance(target, bool) or not isinstance(target, int) or target <= 0:
        raise ValueError("target must be a positive integer")
    for name, value in (("horizon_months", horizon_months), ("budget", budget),
                        ("procedure_per_participant", procedure_per_participant),
                        ("admin_cost", admin_cost), ("support_per_participant", support_per_participant),
                        ("minimum_support", minimum_support)):
        _number(value, name, positive=name == "horizon_months")
    ids = []
    for site in sites:
        if not isinstance(site, dict) or not isinstance(site.get("id"), str) or not site["id"]:
            raise ValueError("Every site must have a nonempty string id")
        ids.append(site["id"])
        for flag in ("baseline_active", "feasible"):
            if not isinstance(site.get(flag), bool):
                raise ValueError(f"{site['id']}.{flag} must be boolean")
        for field in ("activation_cost", "monthly_cost", "per_participant_cost", "rate", "activation_lag_months"):
            _number(site.get(field), f"{site['id']}.{field}")
        capacity = site.get("capacity")
        if isinstance(capacity, bool) or not isinstance(capacity, int) or capacity < 0:
            raise ValueError(f"{site['id']}.capacity must be a nonnegative integer")
    if len(set(ids)) != len(ids):
        raise ValueError("Site ids must be unique")


def _allocate(sites: list[dict], caps: list[int], target: int) -> list[int]:
    """Capped proportional apportionment with deterministic largest remainders."""
    allocation = [0] * len(sites)
    remaining = target
    while remaining:
        active = [i for i in range(len(sites)) if allocation[i] < caps[i] and sites[i]["rate"] > 0]
        if not active:
            raise ValueError("Insufficient deliverable capacity")
        weights = sum(sites[i]["rate"] for i in active)
        quotas = {i: remaining * sites[i]["rate"] / weights for i in active}
        capped = [i for i in active if quotas[i] >= caps[i] - allocation[i]]
        if capped:
            for i in capped:
                delta = caps[i] - allocation[i]
                allocation[i] += delta
                remaining -= delta
            continue
        for i in active:
            count = math.floor(quotas[i])
            allocation[i] += count
            remaining -= count
        for i in sorted(active, key=lambda j: (-(quotas[j] % 1), sites[j]["id"]))[:remaining]:
            allocation[i] += 1
        remaining = 0
    return allocation


def _empty(ids, violations, projected_capacity=0):
    return {"feasible": False, "violations": violations, "selected_ids": ids,
            "site_rows": [], "sponsor_total": None, "breakdown": None,
            "projected_capacity": projected_capacity, "modeled_months": None,
            "cost_per_participant": None, "budget_utilization": None,
            "unspent_budget": None, "assumptions": list(ASSUMPTIONS)}


def evaluate_plan(sites: list[dict], selected_ids: list[str], target: int,
                  horizon_months: float, budget: float, procedure_per_participant: float,
                  admin_cost: float, support_per_participant: float,
                  minimum_support: float = 0) -> dict:
    """Evaluate one operator-defined subset; all currency amounts are dollars."""
    _validate(sites, target, horizon_months, budget, procedure_per_participant,
              admin_cost, support_per_participant, minimum_support)
    if not isinstance(selected_ids, list) or any(not isinstance(x, str) for x in selected_ids):
        raise ValueError("selected_ids must be a list of site ids")
    if len(set(selected_ids)) != len(selected_ids):
        raise ValueError("selected_ids must be unique")
    by_id = {s["id"]: s for s in sites}
    if any(site_id not in by_id for site_id in selected_ids):
        raise ValueError("Unknown selected site id")
    ids = sorted(selected_ids)
    chosen = [by_id[site_id] for site_id in ids]
    violations = []
    if not chosen:
        return _empty(ids, ["No sites selected"])
    if any(not s["feasible"] for s in chosen):
        violations.append("Selected site is not operator-assumed feasible")
    if support_per_participant < minimum_support:
        violations.append("Per-participant support is below the minimum support floor")
    caps = [min(s["capacity"], math.floor(s["rate"] * max(0, horizon_months - s["activation_lag_months"]) + 1e-9))
            for s in chosen]
    if sum(caps) < target:
        violations.append("Insufficient deliverable participant capacity within the horizon")
        return _empty(ids, violations, sum(caps))
    if any(s["rate"] <= 0 or cap <= 0 for s, cap in zip(chosen, caps)):
        violations.append("Every selected site must have positive rate and horizon capacity")
        return _empty(ids, violations, sum(caps))
    counts = _allocate(chosen, caps, target)
    # Selected zero-allocation sites may not inflate the core summed-rate timing.
    if any(count == 0 for count in counts):
        violations.append("Every selected site must receive at least one participant")
        return _empty(ids, violations, sum(caps))
    size = len(chosen)
    inst = Instance(lam=np.array([s["rate"] for s in chosen], dtype=float),
                    a=np.array([s["activation_lag_months"] for s in chosen], dtype=float),
                    k=np.ones(size, dtype=int), f=np.ones(1), N=np.array([target]),
                    n_max=np.array([size]), w=np.ones(1), o=np.zeros((1, 1)),
                    feasible=np.ones((size, 1), dtype=bool), site_ids=ids, beta=0)
    core_duration = float(evaluate(inst, np.ones((size, 1), dtype=bool))[0])
    site_completion = max(s["activation_lag_months"] + count / s["rate"] for s, count in zip(chosen, counts))
    duration = max(core_duration, site_completion)
    if duration > horizon_months + 1e-9:
        violations.append("Nominal modeled duration exceeds the horizon")
    # The core caps extreme times at NO_SITES_T. Reject instead of exposing that sentinel as a forecast.
    exact_duration = sum(s["activation_lag_months"] for s in chosen) / size + target / sum(s["rate"] for s in chosen)
    if abs(core_duration - exact_duration) > 1e-7:
        violations.append("Timing exceeds the existing core model's supported range")
    rows = []
    for site, count, cap in zip(chosen, counts, caps):
        row = {"id": site["id"], "name": site.get("name", site["id"]),
               "participants": count, "rate": site["rate"], "projected_capacity": cap,
               "activation": 0.0 if site["baseline_active"] else float(site["activation_cost"]),
               "operating": site["monthly_cost"] * duration,
               "variable": count * site["per_participant_cost"],
               "procedure": count * procedure_per_participant,
               "support": count * support_per_participant,
               "activation_sunk": site["baseline_active"]}
        row["total"] = sum(row[key] for key in ("activation", "operating", "variable", "procedure", "support"))
        rows.append(row)
    breakdown = {key: sum(row[field] for row in rows) for key, field in
                 (("activation", "activation"), ("operating", "operating"),
                  ("site_variable", "variable"), ("procedures", "procedure"), ("support", "support"))}
    breakdown["administration"] = float(admin_cost)
    total = sum(breakdown.values())
    if total > budget + 1e-7:
        violations.append("Sponsor total exceeds budget")
    return {"feasible": not violations, "violations": violations, "selected_ids": ids,
            "site_rows": rows, "sponsor_total": total, "breakdown": breakdown,
            "projected_capacity": sum(caps), "modeled_months": duration,
            "core_modeled_months": core_duration, "site_completion_months": site_completion,
            "cost_per_participant": total / target,
            "budget_utilization": total / budget if budget else (0.0 if total == 0 else None),
            "unspent_budget": budget - total, "assumptions": list(ASSUMPTIONS)}


def optimize_plan(sites: list[dict], *, target: int, horizon_months: float, budget: float,
                  procedure_per_participant: float, admin_cost: float,
                  support_per_participant: float, minimum_support: float = 0,
                  required_ids: list[str] | None = None, max_months: float | None = None) -> dict:
    """Enumerate at most 255 subsets; select fastest feasible, then cheapest, then ids."""
    _validate(sites, target, horizon_months, budget, procedure_per_participant,
              admin_cost, support_per_participant, minimum_support)
    ids = sorted(s["id"] for s in sites)
    required = required_ids if required_ids is not None else []
    if not isinstance(required, list) or any(not isinstance(x, str) or x not in ids for x in required):
        raise ValueError("required_ids must contain known site ids")
    if len(set(required)) != len(required):
        raise ValueError("required_ids must be unique")
    if max_months is not None:
        _number(max_months, "max_months", positive=True)
    candidates = []
    evaluated = 0
    reasons = set()
    for size in range(1, len(ids) + 1):
        for selected in itertools.combinations(ids, size):
            if not set(required).issubset(selected):
                continue
            evaluated += 1
            result = evaluate_plan(sites, list(selected), target, horizon_months, budget,
                                   procedure_per_participant, admin_cost, support_per_participant, minimum_support)
            if max_months is not None and result["modeled_months"] is not None and result["modeled_months"] > max_months + 1e-9:
                result["feasible"] = False
                result["violations"].append("Nominal no-loser timing bound exceeded")
            reasons.update(result["violations"])
            if result["feasible"]:
                candidates.append(result)
    if candidates:
        best = min(candidates, key=lambda r: (r["modeled_months"], r["sponsor_total"], r["selected_ids"]))
    else:
        best = _empty([], ["No feasible subset under the supplied assumptions", *sorted(reasons)])
    best.update({"evaluated_subsets": evaluated, "feasible_subsets": len(candidates),
                 "required_ids": sorted(required), "nominal_max_months": max_months,
                 "selection_rule": "Fastest feasible nominal time; then sponsor total; then sorted site ids"})
    return best
