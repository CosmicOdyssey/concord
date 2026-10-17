"""Event-based enrollment with shared capacity. No historical model is fitted here.

The original allocator's Instance supplies the feasibility/slot/target contract.
Timing is a separate adapter because the original mean-lag equation cannot express
staggered activation and release of capacity at a trial's completion.
"""
from __future__ import annotations

import numpy as np
from concord.allocator.core import Instance


def instance(req):
    sites, trials = req.sites, req.trials
    mask = np.zeros((len(sites), len(trials)), dtype=bool)
    for e in req.edges:
        s = next(i for i, x in enumerate(sites) if x.id == e.site)
        p = next(i for i, x in enumerate(trials) if x.id == e.trial)
        mask[s, p] = usable(req, e)
    return Instance(lam=np.ones(len(sites)), a=np.zeros(len(sites)),
                    k=np.array([s.slots for s in sites]), f=np.ones(len(trials)),
                    N=np.array([t.target-t.enrolled for t in trials], dtype=float),
                    n_max=np.full(len(trials), len(sites)), w=np.array([t.priority for t in trials]),
                    o=np.zeros((len(trials), len(trials))), feasible=mask,
                    site_ids=[s.id for s in sites], trial_ids=[t.id for t in trials], beta=0)


def usable(req, edge):
    site = next(s for s in req.sites if s.id == edge.site)
    return (edge.feasibility == 'ASSUMED_FEASIBLE' and edge.rate_basis == 'ASSUMED'
            and edge.rate is not None and site.capacity_basis == 'ASSUMED'
            and site.capacity is not None)


def network_errors(req, selected):
    inst = instance(req)
    x = np.zeros_like(inst.feasible)
    errors = []
    for j in selected:
        e = req.edges[j]
        s, p = inst.site_ids.index(e.site), inst.trial_ids.index(e.trial)
        x[s, p] = True
        if not inst.feasible[s, p]:
            errors.append(f'UNKNOWN or infeasible input: {e.trial}/{e.site}')
    if np.any(x.sum(axis=1) > inst.k):
        errors.append('Concurrent trial slots exceeded (conservative static reservation)')
    if np.any(x.sum(axis=0) == 0):
        errors.append('Every unfinished trial requires a usable site')
    return errors


def simulate(req, selected, shocks, boost=0.):
    """Return completion times, edge enrollments, edge billable months, peak site rates.

    Proportional sharing at each site: q_e=r_e*min(1,C_s/sum_e r_e).
    The next event is a site activation, trial completion, or the finite horizon.
    Capacity is immediately reallocated when a trial finishes. Enrollment is a
    continuous fluid approximation, not a count of observed participants.
    """
    pids = [t.id for t in req.trials]
    sids = [s.id for s in req.sites]
    edges = req.edges
    ep = np.array([pids.index(e.trial) for e in edges])
    es = np.array([sids.index(e.site) for e in edges])
    chosen = np.zeros(len(edges), dtype=bool)
    chosen[list(selected)] = True
    lags = np.array([e.lag for e in edges])
    raw = np.array([e.rate or 0 for e in edges]) * (1+boost)
    caps = np.array([s.capacity or 0 for s in req.sites])
    targets = np.array([t.target-t.enrolled for t in req.trials], dtype=float)
    times = np.full((len(shocks), len(pids)), req.horizon)
    complete = np.zeros_like(times, dtype=bool)
    enrollments = np.zeros((len(shocks), len(edges)))
    months = np.zeros_like(enrollments)
    peak = np.zeros((len(shocks), len(sids)))
    for d, shock in enumerate(shocks):
        remaining = targets.copy()
        now = 0.
        # At least one new activation or completion occurs per iteration.
        for _ in range(len(edges)+len(pids)+2):
            unfinished = remaining > 1e-8
            active = chosen & (lags <= now+1e-9) & unfinished[ep]
            rates = raw * shock * active
            totals = np.bincount(es, weights=rates, minlength=len(sids))
            scale = np.minimum(1., np.divide(caps, totals, out=np.ones_like(caps), where=totals>0))
            rates *= scale[es]
            site_rates = np.bincount(es, weights=rates, minlength=len(sids))
            peak[d] = np.maximum(peak[d], site_rates)
            trial_rates = np.bincount(ep, weights=rates, minlength=len(pids))
            durations = np.divide(remaining, trial_rates, out=np.full_like(remaining, np.inf), where=trial_rates>0)
            future = lags[chosen & (lags > now+1e-9) & unfinished[ep]]
            step = min(req.horizon-now, float(durations.min()), float(future.min()-now) if len(future) else np.inf)
            if not np.isfinite(step) or step < 1e-10:
                break
            enrollments[d] += rates*step
            months[d] += active*step
            remaining = np.maximum(0, remaining-trial_rates*step)
            now += step
            finished = unfinished & (remaining <= 1e-8)
            times[d, finished] = now
            complete[d, finished] = True
            if now >= req.horizon-1e-9 or not np.any(remaining>1e-8):
                break
    weights = np.array([t.priority for t in req.trials])
    return {'times':times, 'complete':complete, 'enrollments':enrollments,
            'months':months, 'peak':peak, 'makespan':times.max(axis=1),
            'weighted_makespan':(times*weights).max(axis=1), 'sum_duration':(times*weights).sum(axis=1)}


def candidate_networks(req, baseline):
    """Deterministic bounded beam neighborhoods; caller scores with common draws."""
    eligible = {i for i, e in enumerate(req.edges) if usable(req, e)}
    for j in sorted(eligible-baseline):
        yield frozenset(baseline | {j})
    for j in sorted(baseline):
        yield frozenset(baseline-{j})
        for k in sorted(eligible-baseline):
            yield frozenset((baseline-{j})|{k})
