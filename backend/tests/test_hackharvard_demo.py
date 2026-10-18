"""Demo adapter: actual existing engine, independent arithmetic/timing oracle, no network."""
import copy
import socket

import numpy as np
import pytest
from fastapi.testclient import TestClient
from concord import hackharvard_demo as d, portfolio as p
from concord.api.main import app
from .acceptance_reference import schedule, cost
from .test_portfolio_hybrid import stochastic_oracle


@pytest.fixture(scope='module')
def computed():
    return p.run(d.request())


def test_fixture_is_deterministic_scoped_and_honestly_synthetic():
    a = d.fixture(); b = d.fixture()
    assert a == b
    req = a['request']
    assert req['seed'] == 7 and req['draws'] == 32 and req['spread'] == .25
    assert req['budget'] == 3_000_000
    assert req['operations_rate_effect'] == req['support_rate_effect'] == 0
    assert req['savings_realized'] is False
    assert len(req['trials']) == 2 and len(req['sites']) == 4 and len(req['edges']) == 8
    assert all(s['name'].startswith('Synthetic') and s['capacity_basis'] == 'ASSUMED' for s in req['sites'])
    assert a['historical_predictive_performance'] == 'UNVERIFIED'
    assert 'placeholder' in a['data_mode']


def test_baseline_does_not_run_optimization(monkeypatch):
    monkeypatch.setattr(p, 'run', lambda *_: pytest.fail('Baseline must not optimize'))
    b = d.baseline()
    assert b['baseline']['selected_edges'] == [0, 1, 4, 5]
    assert b['baseline']['expected_makespan'] > 0 and b['baseline_compute_ms'] > 0


def test_baseline_matches_complete_engine_output(computed):
    a = computed['scenarios'][0]; b = d.baseline()['baseline']
    for k in ('selected_edges', 'ledger', 'interval', 'expected_makespan', 'sites', 'feasible', 'violations', 'censored_draws'):
        assert a[k] == b[k], k
    assert b['trials'] == [{'id': t['id'], 'expected_months': t['expected_months']} for t in a['trials']]


def test_recommendation_matches_independent_exhaustive_fraction_oracle(computed):
    # Different scalar Fraction event simulator and cost implementation, not production functions.
    req = d.request().model_dump(mode='json')
    oracle = stochastic_oracle(req, [c['totals'] for c in computed['coverage']])
    chosen = computed['scenarios'][4]  # unrestricted allocation search E
    assert oracle is not None
    assert chosen['selected_edges'] == oracle[2]
    assert chosen['objective_unrounded'] == pytest.approx(oracle[0], abs=.011)
    assert chosen['ledger']['expected_commitment'] == pytest.approx(oracle[1], abs=.011)
    assert chosen['optimization']['status'] == 'OPTIMAL'
    assert chosen['optimization']['absolute_gap'] == 0


def test_every_selected_draw_obeys_capacity_slots_targets_and_cash_arithmetic(computed):
    req = computed['request']; selected = computed['scenarios'][4]['selected_edges']
    shocks = np.random.default_rng(req['seed']).lognormal(-req['spread']**2/2, req['spread'], (req['draws'],len(req['edges'])))
    for shock in shocks:
        one = copy.deepcopy(req)
        for j,e in enumerate(one['edges']): e['rate'] *= float(shock[j])
        actual = schedule(one, set(selected))
        assert actual['complete']
        assert all(actual['peak'][s['id']] <= s['capacity'] + 1e-8 for s in req['sites'])
        assert all(sum(req['edges'][j]['site'] == s['id'] for j in selected) <= s['slots'] for s in req['sites'])
        assert cost(req, selected, actual, [c['totals'] for c in computed['coverage']])[1] <= req['budget']
    for scenario in computed['scenarios']:
        ledger = scenario['ledger']
        assert ledger['expected_commitment'] == pytest.approx(ledger['cash_expenditure'] + ledger['contingency'], abs=.02)
        assert ledger['expected_commitment'] == pytest.approx(sum(sum(t['breakdown'].values()) for t in ledger['trials']),abs=.02)
        assert ledger['transfer_balance'] == 0
        assert ledger['budget_commitment'] <= req['budget']
    base, chosen = computed['scenarios'][0], computed['scenarios'][4]
    assert chosen['ledger']['cash_expenditure'] > base['ledger']['cash_expenditure']  # reinvestment, not savings
    assert computed['available_admin_savings'] == 0
    for a, b in zip(base['ledger']['trials'],chosen['ledger']['trials']):
        assert a['economics']['patient'] == b['economics']['patient']
        assert a['economics']['insurer'] == b['economics']['insurer']


def test_no_external_or_sqlite_dependency_and_fresh_rerun(monkeypatch,tmp_path):
    monkeypatch.setattr(socket, 'create_connection', lambda *_a,**_k: pytest.fail('No outbound network allowed'))
    monkeypatch.setattr(p, 'STORE', tmp_path)
    client = TestClient(app)
    b = client.get('/api/hackharvard-demo').json()
    a = client.post('/api/hackharvard-demo/optimize').json()
    again = client.post('/api/hackharvard-demo/optimize').json()
    assert a['delivery_mode'] == again['delivery_mode'] == 'LIVE_COMPUTATION'
    assert a['computed_at'] != again['computed_at']
    assert a['compute_ms'] > 0
    assert a['fixture_sha256'] == b['fixture_sha256']
    assert a['result'] == again['result']
    r = a['result']; assert p.valid_result(r)
    report = client.get(f"/api/portfolio-command/runs/{r['run_id']}/report/html")
    assert report.status_code == 200
    assert report.headers['X-Concord-Delivery-Mode'] == 'artifact-replay'
    assert r['run_id'] in report.text and r['result_sha256'] in report.text
    saved = client.get(f"/api/portfolio-command/runs/{r['run_id']}").json()
    assert saved == r
    # A fresh baseline never restores an optimized result.
    assert client.get('/api/hackharvard-demo').json()['baseline'] == b['baseline']


def test_ambient_ratecard_is_not_silently_mixed(monkeypatch,tmp_path):
    monkeypatch.setattr(p.fin.terms.medicare, 'DATA_DIR', tmp_path)
    (tmp_path/'ratecard.json').write_text('{}')
    assert TestClient(app).post('/api/hackharvard-demo/optimize').status_code == 409
    assert TestClient(app).get('/api/hackharvard-demo').status_code == 409


def test_saved_rehearsal_is_genuine_integrity_checked_evidence(computed):
    import hashlib
    import json
    root = d.FIXTURE.parents[2]
    raw = (root/'frontend/public/demo/saved-result.json').read_bytes()
    capture = json.loads(raw)
    r = capture['run']['result']
    assert p.valid_result(r)
    assert capture['run']['delivery_mode'] == 'SAVED_RESULT_REPLAY'
    assert r['evidence']['dirty'] is False
    assert r['scenarios'] == computed['scenarios']
    assert r['request'] == d.request().model_dump(mode='json')
    assert capture['bundle']['baseline']['ledger'] == r['scenarios'][0]['ledger']
    assert hashlib.sha256(raw).hexdigest() in (root/'frontend/src/demoSavedDigest.ts').read_text()
    report = (root/'frontend/public/demo/saved-report.html').read_text()
    assert 'SAVED REHEARSAL — NOT LIVE COMPUTATION' in report and r['result_sha256'] in report
