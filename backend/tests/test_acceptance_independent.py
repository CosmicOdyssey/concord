import json
import numpy as np
import pytest
from fastapi.testclient import TestClient
from concord import portfolio as p
from concord import portfolio_simulation as sim
from concord.api.main import app
from .acceptance_reference import cases, schedule, enumerate_optimum


def test_fractional_completion_without_explicit_horizon(tmp_path,monkeypatch):
    monkeypatch.setattr(p,'STORE',tmp_path)
    body=cases()['fractional_default_horizon']
    response=TestClient(app).post('/api/portfolio-command/compare',json=body)
    assert response.status_code==200
    for scenario in response.json()['scenarios']:
        assert scenario['trials'][0]['expected_months']==3.5


@pytest.mark.parametrize('name',list(cases()))
def test_independent_exact_cases(name):
    request=p.PortfolioRequest.model_validate(cases()[name])
    result=p.run(request)
    exact=enumerate_optimum(request.model_dump(mode='json'),[c['totals'] for c in result['coverage']])
    for scenario in result['scenarios']:
        if scenario['policy']['operations_investment'] or scenario['policy']['additional_support']:continue
        reference=schedule(request.model_dump(mode='json'),set(scenario['selected_edges']))
        assert [t['expected_months'] for t in scenario['trials']]==pytest.approx([reference['times'][t.id] for t in request.trials],abs=.0051)
        assert all(s['peak_rate']<= (s['capacity'] or 0)+1e-8 for s in scenario['sites'])
        if scenario['feasible']:
            assert reference['complete']
            assert scenario['ledger']['budget_commitment']<=request.budget+.005
            assert all(abs(t['expected_enrolled']-t['remaining'])<.0051 for t in scenario['trials'])
    # Quantify heuristic gaps separately; a documented heuristic need not be globally optimal.
    actual=result['scenarios'][4]
    if actual['feasible']:
        assert exact is not None
        assert actual['objective_value']>=exact['score']-.0051


def test_many_seeded_schedules_against_independent_reference():
    body=cases()['priority_weighted_max']
    rng=np.random.default_rng(2849)
    for _ in range(35):
        request=p.PortfolioRequest.model_validate(body)
        for e in request.edges:e.rate=float(rng.uniform(.4,6));e.lag=float(rng.uniform(0,8))
        shocks=rng.lognormal(0,.3,(1,len(request.edges)))
        normalized=request.model_dump(mode='json')
        for j,e in enumerate(normalized['edges']):e['rate']*=float(shocks[0,j])
        selected={j for j in range(len(request.edges)) if rng.random()>.2}
        reference=schedule(normalized,selected)
        out=sim.simulate(request,selected,shocks)
        assert out['times'][0].tolist()==pytest.approx(list(reference['times'].values()),abs=1e-7)
        for j in selected:
            assert out['enrollments'][0,j]==pytest.approx(reference['enrolled'][j],abs=1e-7)


def test_savings_without_useful_reinvestment():
    body=cases()['budget_increase_no_candidates']
    body['savings_realized']=True
    body['trials'][0]['admin']=100000
    result=p.run(p.PortfolioRequest.model_validate(body))
    assert result['available_admin_savings']==25000
    assert {s['expected_makespan'] for s in result['scenarios']}=={3.5}
    assert result['scenarios'][0]['ledger']['expected_commitment']-result['scenarios'][1]['ledger']['expected_commitment']==25000


def test_coverage_and_transfer_resource_conservation():
    from concord import financial as f
    req=f.FinanceRequest(target=10,draws=100)
    cov=f.coverage(req)
    assert all(sum(item[k] for k in ['sponsor_per_participant','payer_per_participant','patient_per_participant','reserve_per_participant'])==pytest.approx(item['unit_rate'],abs=.011) for item in cov['items'])
    plan={'breakdown':dict(activation=10000,operating=2000,site_variable=3000,procedures=(cov['totals']['sponsor']+cov['totals']['reserve'])*10,support=5000,administration=1000)}
    plan['sponsor_total']=sum(plan['breakdown'].values())
    econ=f.economics(req,plan,cov)
    assert sum(econ['party_transfer_balances'].values())==pytest.approx(0,abs=.01)
    assert econ['consolidated_resource_cost']==pytest.approx(.8*15000+cov['totals']['resource']*10+1000+300+5000,abs=.01)
    # Paying less as sponsor by shifting a routine line to participants is not a resource saving.
    line=next(i for i in cov['items'] if i['status']=='POTENTIALLY_PAYER_COVERED')
    shifted=f.coverage(req.model_copy(update={'coverage_overrides':{line['id']:f.Responsibility.PATIENT}}))
    assert shifted['totals']['resource']==cov['totals']['resource']
    assert shifted['totals']['patient']>cov['totals']['patient']


def test_future_completed_trial_is_in_legacy_training_sample():
    import sqlite3
    from concord.model.recruitment import load_history
    con=sqlite3.connect(':memory:')
    con.executescript("CREATE TABLE trials(nct_id TEXT,is_lung INT,enrollment_type TEXT,enrollment INT,primary_completion_type TEXT,start_date TEXT,primary_completion_date TEXT,n_sites INT,completion_date TEXT); CREATE TABLE trial_sites(nct_id TEXT,site_id TEXT);")
    con.execute("INSERT INTO trials VALUES('SYN-FUTURE',1,'ACTUAL',100,'ACTUAL','2017-01-01','2022-01-01',1,'2022-01-01')")
    con.execute("INSERT INTO trial_sites VALUES('SYN-FUTURE','SYN-SITE')")
    # Audit evidence of unresolved leakage, not an endorsement or a historical-data repair.
    assert 'SYN-FUTURE' in load_history(con,before='2018-01-01').trial_ids


def test_legacy_robustness_rejects_incompatible_artifact():
    client=TestClient(app)
    accepted=client.get('/api/robustness',params={'region':'US-Northeast'})
    assert accepted.status_code==200
    assert accepted.json()['execution_mode']=='artifact_replay'
    assert accepted.json()['artifact_evidence']['historical_predictive_status']=='UNVERIFIED'
    for changes in [{'activation_lag':25},{'capacity_scale':10},{'overlap_scale':2},{'max_trials':1},{'low_history':'exclude'}]:
        changed=client.get('/api/robustness',params={'region':'US-Northeast',**changes})
        assert changed.status_code==409


def test_unverified_historical_speedups_not_used_as_headlines():
    result=TestClient(app).get('/api/findings').json()
    finding=next(f for f in result['findings'] if f['id']=='allocation')
    assert finding['validation_status']=='UNVERIFIED'
    assert 'UNVERIFIED' in finding['headline']
    assert '1.05x' not in finding['headline']
    assert '1.05x' in finding['archived_headline']


def test_historical_prediction_error_is_also_unverified():
    result=TestClient(app).get('/api/findings').json()
    finding=next(f for f in result['findings'] if f['id']=='implication')
    assert finding['validation_status']=='UNVERIFIED'
    assert finding['status']=='provisional'
    assert all('UNVERIFIED' in table['title'] for table in finding['tables'])


def test_saved_delivery_is_labeled_as_replay(tmp_path,monkeypatch):
    monkeypatch.setattr(p,'STORE',tmp_path)
    client=TestClient(app)
    result=client.post('/api/portfolio-command/compare',json=cases()['one_trial_two_sites']).json()
    base='/api/portfolio-command/runs/'+result['run_id']
    saved=client.get(base)
    assert saved.json()==result
    assert saved.headers.get('x-concord-delivery-mode')=='artifact-replay'
    report=client.get(base+'/report/html')
    assert 'Computation evidence snapshot' in report.text
    assert report.headers.get('x-concord-delivery-mode')=='artifact-replay'


def test_financial_cost_shifting_counterfactuals():
    from .acceptance_financial import run
    assert len(run())==3


def test_missing_prices_and_invalid_costs_are_explicit(monkeypatch):
    from concord import financial as f
    from pydantic import ValidationError
    monkeypatch.setattr(f.terms,'_price_code',lambda *_:None)
    coverage=f.coverage(f.FinanceRequest())
    assert all(i['rate_kind']!='verified_fee_schedule_benchmark' for i in coverage['items'])
    assert all(i['unit_rate']>=0 for i in coverage['items'])
    with pytest.raises(ValidationError):f.FinanceRequest(admin_cost=-1)
    with pytest.raises(ValidationError):f.Site(id='A',name='A',activation_cost=-1)
    assert f.FinanceRequest(admin_cost=0,drug_contingency_per_participant=0).admin_cost==0


def test_budget_and_sensitivity_counterfactuals():
    req=p.PortfolioRequest.model_validate(cases()['one_trial_two_sites'])
    normal=p.run(req)
    limited=p.run(req.model_copy(update={'budget':normal['scenarios'][0]['ledger']['budget_commitment']}))
    assert normal['scenarios'][4]['expected_makespan']<limited['scenarios'][4]['expected_makespan']
    delayed=req.model_copy(deep=True);delayed.edges[1].lag=10
    assert p.run(delayed)['scenarios'][4]['expected_makespan']>=normal['scenarios'][4]['expected_makespan']
    uncertain=p.run(req.model_copy(update={'spread':.6}))
    assert uncertain['scenarios'][0]['interval'][0]<uncertain['scenarios'][0]['interval'][2]
    assert normal['scenarios'][0]['interval'][0]==normal['scenarios'][0]['interval'][2]
    assert p.run(req)['scenarios']==normal['scenarios']
