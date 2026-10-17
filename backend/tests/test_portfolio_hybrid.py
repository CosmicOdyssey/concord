"""Hybrid optimization acceptance against a separate scalar/exhaustive oracle."""
import copy
import itertools

import numpy as np
import pytest
from fastapi.testclient import TestClient
from concord import portfolio as p
from concord import portfolio_search as search
from concord.api.main import app
from .acceptance_reference import cases, schedule, cost, objective, enumerate_optimum


def test_original_twelve_versus_four_counterexample_is_proven_optimal():
    req=p.PortfolioRequest.model_validate(cases()['bounded_search_plateau'])
    result=p.run(req)
    exact=enumerate_optimum(req.model_dump(mode='json'),[c['totals'] for c in result['coverage']])
    for scenario in result['scenarios'][2::2]:  # C and E; F checked below
        assert scenario['expected_makespan']==4
        assert scenario['objective_unrounded']==pytest.approx(exact['score'])
        assert scenario['optimization']['status']=='OPTIMAL'
        assert scenario['optimization']['termination']=='exhausted_all_subsets'
        assert scenario['optimization']['absolute_gap']==0
        assert len(scenario['selected_edges'])==12
    assert result['scenarios'][5]['expected_makespan']==4


@pytest.mark.parametrize('seed',range(18))
def test_small_random_portfolios_match_independent_exhaustive_reference(seed):
    rng=np.random.default_rng(4100+seed)
    body=copy.deepcopy(cases()['priority_weighted_max'])
    body['objective']=['weighted_makespan','sum_duration','min_cost_deadline'][seed%3]
    body['no_loser']=seed%2==0
    for t in body['trials']:
        t.update(target=int(rng.integers(3,22)),priority=float(rng.uniform(.3,4)),deadline=float(rng.uniform(4,20)))
    for s in body['sites']:
        s.update(capacity=float(rng.uniform(2,8)),slots=int(rng.integers(1,3)))
    for e in body['edges']:
        e.update(rate=float(rng.uniform(.5,6)),lag=float(rng.uniform(0,5)),activation=int(rng.integers(0,15000)),participant=int(rng.integers(0,800)))
    body['budget']=float(rng.integers(10000,250000))
    req=p.PortfolioRequest.model_validate(body);result=p.run(req)
    exact=enumerate_optimum(req.model_dump(mode='json'),[c['totals'] for c in result['coverage']])
    actual=result['scenarios'][4]
    if exact is None:
        assert actual['optimization']['status']=='INFEASIBLE_PROVEN'
        assert not actual['feasible']
    else:
        assert actual['optimization']['status']=='OPTIMAL'
        assert actual['objective_unrounded']==pytest.approx(exact['score'],abs=.011)
        assert actual['selected_edges']==exact['selected']
        assert actual['ledger']['budget_commitment']<=req.budget+.005
        assert all(s['peak_rate']<=s['capacity']+1e-8 for s in actual['sites'])


def stochastic_oracle(request,coverage):
    """Exhaust subsets and every seeded draw with Fraction timing, never production simulation."""
    shocks=np.random.default_rng(request['seed']).lognormal(-request['spread']**2/2,request['spread'],(request['draws'],len(request['edges'])))
    base={i for i,e in enumerate(request['edges']) if e['baseline']}
    def draws(selected):
        rows=[]
        for shock in shocks:
            normalized=copy.deepcopy(request)
            for j,e in enumerate(normalized['edges']):e['rate']*=float(shock[j])
            rows.append(schedule(normalized,selected))
        return rows
    baseline=draws(base);best=None
    for bits in itertools.product((False,True),repeat=len(request['edges'])):
        selected={i for i,b in enumerate(bits) if b}
        if any(not any(request['edges'][j]['trial']==t['id'] for j in selected) for t in request['trials']):continue
        if any(sum(request['edges'][j]['site']==s['id'] for j in selected)>s['slots'] for s in request['sites']):continue
        rows=draws(selected)
        if not all(o['complete'] for o in rows):continue
        means={t['id']:np.mean([o['times'][t['id']] for o in rows]) for t in request['trials']}
        if request['no_loser'] and any(means[t['id']]>np.mean([o['times'][t['id']] for o in baseline])+1e-8 for t in request['trials']):continue
        # Pricing is linear in edge months and enrollments, so averaging per-draw costs is equivalent.
        prices=[cost(request,selected,o,coverage) for o in rows]
        committed=prices[0][1]
        if round(committed,2)>request['budget']+.005 or any(np.mean([row[2][i] for row in prices])<request['hospital_floor']-.005 for i in range(len(request['trials']))):continue
        expected=float(np.mean([row[0] for row in prices]))
        if request['objective']=='min_cost_deadline':
            if any(means[t['id']]>t['deadline']+1e-8 for t in request['trials']):continue
            score=round(expected+1e-9,2)
        else:score=float(np.mean([objective(request,o['times']) for o in rows]))
        ranked=(score,round(expected+1e-9,2),sorted(selected))
        if best is None or ranked<best:best=ranked
    return best


@pytest.mark.parametrize('objective_name',['weighted_makespan','sum_duration','min_cost_deadline'])
def test_exactness_uses_the_complete_common_draw_bank(objective_name):
    body=cases()['priority_weighted_max'];body.update(spread=.25,objective=objective_name)
    req=p.PortfolioRequest.model_validate(body);result=p.run(req)
    best=stochastic_oracle(req.model_dump(mode='json'),[c['totals'] for c in result['coverage']])
    actual=result['scenarios'][4]
    assert best is not None
    assert actual['optimization']['status']=='OPTIMAL'
    assert actual['objective_unrounded']==pytest.approx(best[0],abs=.011)
    assert actual['selected_edges']==best[2]


def test_large_draw_work_remains_honest_deterministic_heuristic():
    body=cases()['bounded_search_plateau'];body.update(spread=.3,draws=32)
    req=p.PortfolioRequest.model_validate(body)
    a=p.run(req);b=p.run(req)
    assert a['scenarios']==b['scenarios']
    for i in [2,4,5]:
        result=a['scenarios'][i];meta=result['optimization']
        assert meta['method']=='bounded_beam'
        assert meta['status'] in {'FEASIBLE_HEURISTIC','NO_FEASIBLE_FOUND'}
        assert meta['absolute_gap'] is None and meta['objective_lower_bound'] is None
        assert meta['event_work_bound']>search.EXACT_MAX_EVENT_WORK
        assert meta['visited_networks']<=search.BEAM_MAX_VISITED
        assert meta['termination'] in {'depth_limit','visited_limit','frontier_exhausted'}


def test_zero_budget_is_a_costed_infeasibility_not_an_exception(tmp_path,monkeypatch):
    monkeypatch.setattr(p,'STORE',tmp_path)
    body=cases()['fractional_default_horizon'];body['budget']=0
    response=TestClient(app).post('/api/portfolio-command/compare',json=body)
    assert response.status_code==200
    result=response.json()
    assert result['recommended_scenario_id'] is None
    assert result['scenarios'][4]['optimization']['status']=='INFEASIBLE_PROVEN'
    assert result['scenarios'][0]['trials'][0]['expected_months']==3.5


def test_equal_cost_alternatives_have_stable_lexicographic_tie_break():
    body=cases()['one_trial_two_sites']
    for e in body['edges']:e.update(rate=2,lag=0,activation=0,operating=0,monitoring=0,participant=0,screening=0)
    result=p.run(p.PortfolioRequest.model_validate(body))
    assert result['scenarios'][4]['selected_edges']==[0,1]
    # Cost objective: every network costs the same and both single-site alternatives meet the deadline.
    body['objective']='min_cost_deadline';body['trials'][0]['deadline']=4
    tied=p.run(p.PortfolioRequest.model_validate(body))
    assert tied['scenarios'][4]['selected_edges']==[0]
    assert tied['scenarios'][4]['optimization']['absolute_gap']==0



def test_joint_policy_proof_covers_optional_rate_interventions():
    body=cases()['one_trial_two_sites'];body.update(support_rate_effect=.2,operations_rate_effect=.1,operations_cost=0,extra_support=0)
    result=p.run(p.PortfolioRequest.model_validate(body));joint=result['scenarios'][5]
    assert joint['optimization']['status']=='OPTIMAL'
    assert joint['optimization']['policy_searches']==4
    assert joint['policy']['additional_support'] and joint['policy']['operations_investment']
    assert joint['objective_unrounded']<=result['scenarios'][4]['objective_unrounded']
