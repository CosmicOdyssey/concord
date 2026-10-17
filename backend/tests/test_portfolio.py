"""Analytical event checks, financial invariants and actual ASGI integration."""
import copy
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from concord import portfolio as p
from concord import portfolio_simulation as sim
from concord.api.main import app


@pytest.fixture
def req():
    return p.PortfolioRequest.model_validate({**p.demo()['request'],'draws':32})


@pytest.fixture(scope='module')
def result():
    return p.run(p.PortfolioRequest.model_validate({**p.demo()['request'],'draws':32}))


def simple(targets=(10,), rates=(2,), lags=(0,), cap=100):
    trials = [p.Trial(id=f'SIM-{i}',title='Synthetic',target=n,priority=i+1,deadline=30) for i,n in enumerate(targets)]
    sites = [p.SharedSite(id=f'SYN-{i}',name='Assumed',capacity=cap,capacity_basis='ASSUMED') for i in range(len(rates))]
    edges = [p.Edge(trial=t.id,site=s.id,baseline=True,feasibility='ASSUMED_FEASIBLE',rate_basis='ASSUMED',rate=r,lag=a)
             for t in trials for s,r,a in zip(sites,rates,lags)]
    return p.PortfolioRequest(trials=trials,sites=sites,edges=edges,draws=32,spread=0)


def test_staggered_activation_is_piecewise_not_mean_lag():
    req = simple((20,),(1,3),(0,4))
    out = sim.simulate(req,{0,1},np.ones((1,2)))
    # First 4 participants before activation; then 16/4 months.
    assert out['times'][0,0] == pytest.approx(8)
    assert out['enrollments'][0].tolist() == pytest.approx([8,12])
    assert out['months'][0].tolist() == pytest.approx([8,4])


def test_shared_capacity_released_after_completion():
    req = simple((2,10),(4,),cap=4)
    out = sim.simulate(req,{0,1},np.ones((1,2)))
    assert out['times'][0].tolist() == pytest.approx([1,3])
    assert out['enrollments'][0].tolist() == pytest.approx([2,10])
    assert out['peak'].max() <= 4+1e-9
    assert out['makespan'][0] == 3
    assert out['weighted_makespan'][0] == 6
    assert out['sum_duration'][0] == 7


def test_no_enrollment_before_activation_and_censoring():
    req = simple((10,),(2,),(40,))
    out = sim.simulate(req,{0},np.ones((1,1)))
    assert not out['complete'].any()
    assert out['enrollments'].sum() == 0
    assert out['times'][0,0] == req.horizon


def test_unknowns_and_slots_cannot_be_used(req):
    baseline = {j for j,e in enumerate(req.edges) if e.baseline}
    req.edges[0].feasibility = 'UNKNOWN'
    assert any('UNKNOWN' in s for s in sim.network_errors(req,baseline))
    req.edges[0].feasibility = 'ASSUMED_FEASIBLE'
    req.sites[0].capacity_basis = 'UNKNOWN'
    assert sim.network_errors(req,baseline)
    req.sites[0].capacity_basis = 'ASSUMED'
    req.sites[0].slots = 1
    assert any('slots' in s for s in sim.network_errors(req,baseline))


def test_targets_capacity_and_no_loser_are_enforced(result):
    baseline = result['scenarios'][0]
    for s in result['scenarios']:
        if not s['feasible']:
            continue
        assert s['censored_draws'] == 0
        for t,b in zip(s['trials'],baseline['trials']):
            assert t['expected_enrolled'] == pytest.approx(t['remaining'],abs=.01)
            assert t['expected_months'] <= b['expected_months']+.01
        for site in s['sites']:
            assert site['peak_rate'] <= site['capacity']+1e-9
        assert s['ledger']['budget_commitment'] <= result['request']['budget']


def test_financial_transfer_conservation_no_double_counting(result):
    for s in result['scenarios']:
        ledger = s['ledger']
        assert ledger['transfer_balance'] == pytest.approx(0,abs=.01)
        assert ledger['cash_expenditure']+ledger['contingency'] == pytest.approx(ledger['expected_commitment'],abs=.02)
        assert ledger['budget_remaining']+ledger['budget_commitment'] == pytest.approx(result['request']['budget'],abs=.01)
        assert ledger['expected_commitment'] <= ledger['budget_commitment']+.02
        for t in ledger['trials']:
            assert sum(t['breakdown'].values()) == pytest.approx(t['expected_commitment'],abs=.03)
            econ=t['economics']
            assert econ['hospital']['revenue']-econ['hospital']['resource_cost'] == pytest.approx(econ['hospital']['net_contribution'],abs=.01)
            assert econ['hospital']['net_contribution'] >= 0
            # Transfers cancel; they are not added to the resource total.
            assert econ['consolidated_resource_cost'] == pytest.approx(econ['hospital']['resource_cost']+econ['sponsor']['supply_resource_proxy']+t['breakdown']['administration']+econ['insurer']['administration']+t['breakdown']['support'],abs=.02)


def test_savings_require_explicit_realization_and_no_automatic_speed(req,result):
    a,b,_,d,*_ = result['scenarios']
    assert result['available_admin_savings']==0
    assert a['ledger']==b['ledger']
    assert a['trials']==b['trials']==d['trials']
    assert d['ledger']['expected_commitment'] > a['ledger']['expected_commitment']
    realized=p.run(req.model_copy(update={'savings_realized':True}))
    assert realized['available_admin_savings']==75000
    ar,br=realized['scenarios'][:2]
    assert ar['trials']==br['trials']
    assert ar['ledger']['expected_commitment']-br['ledger']['expected_commitment']==75000


def test_baseline_is_fixed_and_reproducible(req,result):
    assert p.run(req)==result
    selected=[j for j,e in enumerate(req.edges) if e.baseline]
    assert result['scenarios'][0]['selected_edges']==selected
    assert p.valid_result(result)
    assert result['seed']==req.seed
    assert result['evidence']['historical_evaluation'].startswith('not_executed')
    assert result['execution_mode']=='live_computation_synthetic_operations_registry_context'


def test_input_changes_cannot_reuse_saved_outputs(req,result):
    changed=req.model_copy(deep=True)
    changed.edges[2].lag+=1
    after=p.run(changed)
    assert after['input_sha256']!=result['input_sha256']
    assert after['run_id']!=result['run_id']
    assert after['scenarios'][0]['trials']==result['scenarios'][0]['trials']
    changed.seed+=1
    assert p.run(changed)['scenarios'][0]['trials']!=result['scenarios'][0]['trials']


def test_budget_deadline_hospital_constraints(req):
    req.budget=1
    out=p.run(req)
    assert out['recommended_scenario_id'] is None
    assert all(not s['feasible'] for s in out['scenarios'])
    req.budget=3000000
    req.objective='min_cost_deadline'
    for t in req.trials:
        t.deadline=.1
    assert p.run(req)['recommended_scenario_id'] is None
    req.objective='sum_duration'
    req.hospital_floor=1e8
    assert all(any('Hospital' in v for v in s['violations']) for s in p.run(req)['scenarios'])


@pytest.mark.parametrize('field,value',[('budget',float('inf')),('seed',-1),('draws',1000),('spread',-1),('objective','unknown')])
def test_rejects_invalid_inputs(req,field,value):
    body=req.model_dump()
    body[field]=value
    with pytest.raises(ValidationError):
        p.PortfolioRequest.model_validate(body)


def test_duplicate_or_dangling_edges_rejected(req):
    for change in ('duplicate','dangling','missingbaseline'):
        body=req.model_dump()
        if change=='duplicate': body['edges'].append(body['edges'][0])
        if change=='dangling': body['edges'][0]['site']='missing'
        if change=='missingbaseline':
            for edge in body['edges']: edge['baseline']=False
        with pytest.raises(ValidationError): p.PortfolioRequest.model_validate(body)


def test_coverage_fixed_reserved_and_marginal_no_gain(result):
    joint=result['scenarios'][-1]
    assert not joint['policy']['additional_support']
    for cov in result['coverage']:
        assert cov['totals']['reserve']>0
        for item in cov['items']:
            if item['status'] in ('UNKNOWN','CONDITIONAL','REVIEW_REQUIRED'):
                assert item['payer_per_participant']==item['patient_per_participant']==0
    support=next(m for m in result['marginal'] if m['label']=='Participant support')
    assert support['expected_months_saved']==0
    assert support['additional_expected_enrollment']==0
    assert support['break_even_value_per_month'] is None
    assert support['recommendation'].startswith('Retain funds')


def test_bundled_dataset_exactly_matches_demo():
    assert json.loads((p.ROOT/'data/portfolio/demo-request.json').read_text())==p.demo()['request']


def test_source_change_requires_backend_restart(req,monkeypatch):
    monkeypatch.setattr(p,'EXECUTED_SOURCES',{'changed':'different'})
    with pytest.raises(p.HTTPException,match='Source changed') as e:
        p.run(req)
    assert e.value.status_code==409


def test_immutable_report_and_tamper_detection(tmp_path,monkeypatch,result):
    monkeypatch.setattr(p,'STORE',tmp_path)
    p.save(result)
    p.save(result)
    client=TestClient(app)
    base=f"/api/portfolio-command/runs/{result['run_id']}"
    assert client.get(base).json()==result
    assert client.get(base+'/report/json').json()==result
    html=client.get(base+'/report/html')
    assert html.status_code==200
    assert result['result_sha256'] in html.text
    assert 'attachment' in html.headers['content-disposition']
    path=tmp_path/f"{result['run_id']}.json"
    changed=copy.deepcopy(result);changed['scenarios'][0]['expected_makespan']=0
    path.write_text(json.dumps(changed))
    assert client.get(base).status_code==409
    assert client.get('/api/portfolio-command/runs/not-a-digest').status_code==422


def test_asgi_workflow_and_compatibility(tmp_path,monkeypatch,req):
    monkeypatch.setattr(p,'STORE',tmp_path)
    client=TestClient(app)
    assert client.get('/api/health').status_code==200
    assert client.get('/api/financial/demo').status_code==200
    demo=client.get('/api/portfolio-command/demo')
    assert demo.status_code==200
    assert len(demo.json()['registry_context'])==2
    response=client.post('/api/portfolio-command/compare',json=req.model_dump())
    assert response.status_code==200
    result=response.json()
    assert p.valid_result(result)
    assert client.get('/api/portfolio-command/runs/'+result['run_id']).json()==result
    assert client.post('/api/portfolio-command/validate',json={'trials':[]}).status_code==422


def test_report_escapes_untrusted_titles(result):
    poisoned=copy.deepcopy(result)
    poisoned['request']['trials'][0]['title']='<script>alert(1)</script>'
    assert '<script>alert(1)</script>' not in p.report_html(poisoned)
