"""Presentation adapter only: fixed inputs, original simulation/search/accounting.

No registry, SQLite, AI or other external service is consulted at presentation time.
The baseline evaluates its fixed network only; optimization happens on explicit POST.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from time import perf_counter

from fastapi import APIRouter, HTTPException
import numpy as np

from concord import portfolio as p

router = APIRouter(prefix='/api/hackharvard-demo', tags=['HackHarvard demo'])
FIXTURE = Path(__file__).resolve().parents[2] / 'data/demo/hackharvard-request.json'


def request():
    # Versioned complete input, not the user's general-app or saved scenario state.
    return p.PortfolioRequest.model_validate(json.loads(FIXTURE.read_text()))


def fixture():
    req = request()
    return {'request': req.model_dump(mode='json'),
            'fixture_sha256': hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
            'registry_context': json.loads(p.CONTEXT.read_text()),
            'limitations': p.LIMITATIONS,
            'data_mode': 'Bundled registry context; synthetic operations; approximate placeholder procedure rates',
            'historical_predictive_performance': 'UNVERIFIED',
            'scope': 'Weighted makespan on 32 seeded in-sample assumption draws; not a clinical prediction'}


def require_isolated_data():
    if (p.fin.terms.medicare.DATA_DIR / 'ratecard.json').exists():
        raise HTTPException(409, 'Demo requires the documented isolated fixture data directory (no ambient CMS ratecard).')


def baseline():
    require_isolated_data()
    started = perf_counter()
    req = request()
    finances = p.financial_inputs(req)
    coverage = [p.fin.coverage(f) for f in finances]
    shocks = np.random.default_rng(req.seed).lognormal(-req.spread**2/2, req.spread, (req.draws, len(req.edges)))
    selected = frozenset(j for j, e in enumerate(req.edges) if e.baseline)
    out = p.sim.simulate(req, selected, shocks)
    ledger = p.price(req, selected, out, coverage, finances)
    errors = p.sim.network_errors(req, selected)
    if not out['complete'].all():
        errors.append('Incomplete enrollment in assumed draws')
    if ledger['budget_commitment'] > req.budget + .005:
        errors.append('Budget exceeded')
    if any(row['economics']['hospital']['net_contribution'] < req.hospital_floor - .005 for row in ledger['trials']):
        errors.append('Hospital contribution floor violated')
    return {**fixture(), 'baseline': {
        'id': 'A', 'label': 'Fixed baseline', 'feasible': not errors, 'violations': errors,
        'selected_edges': sorted(selected), 'ledger': ledger,
        'expected_makespan': p.fin.money(out['makespan'].mean()),
        'interval': np.round(np.quantile(out['makespan'], [.1, .5, .9]), 3).tolist(),
        'censored_draws': int((~out['complete'].all(axis=1)).sum()),
        'trials': [{'id': t.id, 'expected_months': p.fin.money(out['times'][:, i].mean())} for i, t in enumerate(req.trials)],
        'sites': [{'id': s.id, 'peak_rate': float(out['peak'][:, i].max()), 'capacity': s.capacity,
                   'reserved_slots': sum(req.edges[j].site == s.id for j in selected)} for i, s in enumerate(req.sites)]},
        'baseline_compute_ms': round(1000*(perf_counter()-started), 3)}


@router.get('')
def get_baseline():
    return baseline()


@router.post('/optimize')
def optimize():
    # General Portfolio Command remains unchanged. This route cannot import edited inputs.
    # An ambient CMS ratecard would change the demonstration economics: fail closed,
    # never silently mix a different price source with the bundled saved fallback.
    require_isolated_data()
    started = perf_counter()
    result = p.save(p.run(request()))
    return {'result': result, 'compute_ms': round(1000*(perf_counter()-started), 3),
            'computed_at': datetime.now(timezone.utc).isoformat(),
            'delivery_mode': 'LIVE_COMPUTATION', 'fixture_sha256': fixture()['fixture_sha256']}
