"""Hybrid subset search over the existing portfolio event/accounting evaluator.

Exactness concerns the supplied finite draw bank, objective and constraints only.
The deterministic admission bound limits work before search; no time-based partial
search is ever labeled exact. Larger requests use the retained bounded beam.
"""
from itertools import combinations

EXACT_MAX_EDGES = 12
EXACT_MAX_EVENT_WORK = 500_000
BEAM_WIDTH = 3
BEAM_DEPTH = 3
BEAM_MAX_VISITED = 96


def rank(result):
    return result['objective'], result['ledger']['expected_commitment'], result['selected']


def solve(req, baseline, evaluate, usable, network_errors, neighbors, effective_draws,
          efficient=False, support=False, operations=False, add_only=False):
    eligible = sorted(j for j, edge in enumerate(req.edges) if usable(req, edge))
    work = (2 ** len(eligible)) * effective_draws * (len(req.edges) + len(req.trials) + 2)
    exact = len(eligible) <= EXACT_MAX_EDGES and work <= EXACT_MAX_EVENT_WORK
    start = evaluate(baseline, efficient, support, operations)
    best = start if start['feasible'] else None
    visited = evaluated = 0
    termination = 'exhausted_all_subsets'

    def consider(network):
        nonlocal best, evaluated
        if network_errors(req, network):
            return None
        result = evaluate(network, efficient, support, operations)
        evaluated += 1
        if result['feasible'] and (best is None or rank(result) < rank(best)):
            best = result
        return result

    if exact:
        for size in range(len(eligible) + 1):
            for subset in combinations(eligible, size):
                network = frozenset(subset)
                visited += 1
                if add_only and not baseline.issubset(network):
                    continue
                consider(network)
    else:
        frontier = [(baseline, start)]
        seen = {baseline}
        evaluated = 1
        termination = 'depth_limit'
        for _ in range(BEAM_DEPTH):
            candidates = []
            limit = False
            for selected, _result in frontier:
                for network in neighbors(req, selected):
                    if network in seen or (add_only and not baseline.issubset(network)):
                        continue
                    if len(seen) >= BEAM_MAX_VISITED:
                        limit = True
                        break
                    seen.add(network)
                    candidate = consider(network)
                    if candidate is not None:
                        candidates.append((network, candidate))
                if limit:
                    break
            if limit:
                termination = 'visited_limit'
                break
            if not candidates:
                termination = 'frontier_exhausted'
                break
            frontier = sorted(candidates, key=lambda pair: (len(pair[1]['violations']), *rank(pair[1])))[:BEAM_WIDTH]
        visited = len(seen)
    result = best if best is not None else start
    return {**result, 'optimization': {
        'method': 'exact_enumeration' if exact else 'bounded_beam',
        'status': ('OPTIMAL' if best is not None else 'INFEASIBLE_PROVEN') if exact else
                  ('FEASIBLE_HEURISTIC' if best is not None else 'NO_FEASIBLE_FOUND'),
        'optimality_scope': 'Supplied finite draw bank and entered model constraints; fixed policy flags and add-only restriction where specified',
        'objective_lower_bound': best['objective'] if exact and best is not None else None,
        'absolute_gap': 0.0 if exact and best is not None else None,
        'relative_gap': 0.0 if exact and best is not None else None,
        'termination': termination, 'visited_networks': visited, 'evaluated_networks': evaluated,
        'eligible_edges': len(eligible), 'effective_draws': effective_draws,
        'event_work_bound': work, 'exact_max_edges': EXACT_MAX_EDGES,
        'exact_max_event_work': EXACT_MAX_EVENT_WORK, 'add_only': add_only,
    }}
