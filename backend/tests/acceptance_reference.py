"""Independent scalar reference; no Concord simulation, price or search calls.

Production functions are imported only in audit() to compare against this oracle.
Coverage totals are held fixed as inputs, then independently reconciled elsewhere.
"""
from __future__ import annotations
import copy
import itertools
import json
from fractions import Fraction as F
from pathlib import Path


def schedule(request, selected):
    trials = request['trials']; edges = request['edges']; sites = request['sites']
    horizon = F(str(request.get('horizon',36)))
    remaining = {t['id']:F(t['target']-t.get('enrolled',0)) for t in trials}
    done = {}; clock = F(0)
    enrollment = {j:F(0) for j in selected}; billable = {j:F(0) for j in selected}
    peaks = {s['id']:F(0) for s in sites}
    while remaining and clock < horizon:
        active = [j for j in selected if edges[j]['trial'] in remaining and F(str(edges[j]['lag'])) <= clock]
        flow = {j:F(str(edges[j]['rate'] or 0)) for j in active}
        for site in sites:
            own = [j for j in active if edges[j]['site']==site['id']]
            aggregate = sum((flow[j] for j in own),F(0))
            capacity = F(str(site['capacity'] or 0))
            if aggregate>capacity:
                flow.update({j:flow[j]*capacity/aggregate for j in own})
            peaks[site['id']] = max(peaks[site['id']],sum((flow[j] for j in own),F(0)))
        trial_flow = {t:sum((flow[j] for j in active if edges[j]['trial']==t),F(0)) for t in remaining}
        events = [horizon-clock]
        events += [F(str(edges[j]['lag']))-clock for j in selected if edges[j]['trial'] in remaining and F(str(edges[j]['lag']))>clock]
        events += [remaining[t]/rate for t,rate in trial_flow.items() if rate>0]
        step = min(events)
        if step<=0: raise AssertionError('Reference failed to advance')
        for j in active:
            enrollment[j] += flow[j]*step; billable[j] += step
        clock += step
        for t in list(remaining):
            remaining[t] -= trial_flow[t]*step
            if remaining[t]==0:
                done[t]=clock; del remaining[t]
    times = {t['id']:float(done.get(t['id'],horizon)) for t in trials}
    return {'times':times,'complete':not remaining,
            'enrolled':{j:float(x) for j,x in enrollment.items()},
            'months':{j:float(x) for j,x in billable.items()},'peak':{s:float(x) for s,x in peaks.items()}}


def objective(request, times):
    weights = {t['id']:t['priority'] for t in request['trials']}
    weighted = [weights[k]*v for k,v in times.items()]
    return sum(weighted) if request['objective']=='sum_duration' else max(weighted)


def cost(request, selected, out, coverage):
    expected = committed = 0
    hospitals = []
    for t,cov in zip(request['trials'],coverage):
        n=t['target']-t['enrolled']; own=[j for j in selected if request['edges'][j]['trial']==t['id']]
        startup=sum(request['edges'][j]['activation'] for j in own if not request['edges'][j]['baseline'])
        operating=sum((request['edges'][j]['operating']+request['edges'][j]['monitoring'])*out['months'][j] for j in own)
        variable=sum((request['edges'][j]['participant']+request['edges'][j]['screening'])*out['enrolled'][j] for j in own)
        care=(cov['sponsor']+cov['reserve'])*n
        expected+=startup+operating+variable+care+t['support']*n+t['admin']
        committed+=startup+sum((request['edges'][j]['operating']+request['edges'][j]['monitoring'])*request['horizon'] for j in own)+max((request['edges'][j]['participant']+request['edges'][j]['screening'] for j in own),default=0)*n+care+t['support']*n+t['admin']
        resources=.8*(startup+operating+variable)+cov['resource']*n
        revenues=startup+operating+variable+(cov['sponsor']+cov['payer']+cov['patient'])*n
        hospitals.append(revenues-resources)
    return expected,committed,hospitals


def enumerate_optimum(request,coverage):
    edges=request['edges']; baseline={j for j,e in enumerate(edges) if e['baseline']}
    base=schedule(request,baseline)
    candidates=[]
    for bits in itertools.product((False,True),repeat=len(edges)):
        selected={j for j,b in enumerate(bits) if b}
        if any(not any(edges[j]['trial']==t['id'] for j in selected) for t in request['trials']):continue
        if any(sum(edges[j]['site']==s['id'] for j in selected)>s['slots'] for s in request['sites']):continue
        if any(edges[j]['feasibility']!='ASSUMED_FEASIBLE' or edges[j]['rate_basis']!='ASSUMED' or edges[j]['rate'] is None for j in selected):continue
        if any(s['capacity_basis']!='ASSUMED' or s['capacity'] is None for s in request['sites'] if any(edges[j]['site']==s['id'] for j in selected)):continue
        out=schedule(request,selected)
        expected,committed,hospitals=cost(request,selected,out,coverage)
        if not out['complete'] or round(committed,2)>request['budget']+.005 or any(v<request['hospital_floor']-.005 for v in hospitals):continue
        if request['no_loser'] and any(out['times'][t]>base['times'][t]+1e-8 for t in out['times']):continue
        if request['objective']=='min_cost_deadline' and any(out['times'][t['id']]>t['deadline']+1e-8 for t in request['trials']):continue
        score=expected if request['objective']=='min_cost_deadline' else objective(request,out['times'])
        candidates.append({'selected':sorted(selected),'score':score,'expected_cost':expected,'committed':committed,'times':out['times']})
    return min(candidates,key=lambda c:(c['score'],c['expected_cost'],c['selected'])) if candidates else None


def cases():
    trial=lambda i,n=10:dict(id=i,title='Independent synthetic audit',target=n,enrolled=0,priority=1,deadline=12,admin=1000,support=200)
    site=lambda i,cap=10:dict(id=i,name='Independent synthetic hospital',capacity=cap,capacity_basis='ASSUMED',slots=2)
    edge=lambda t,s,r,b=False,a=0,c=1000:dict(trial=t,site=s,rate=r,baseline=b,lag=a,activation=c,operating=100,monitoring=20,participant=50,screening=10,feasibility='ASSUMED_FEASIBLE',rate_basis='ASSUMED')
    base=dict(budget=1000000,horizon=36,draws=32,spread=0,operations_rate_effect=0,support_rate_effect=0,no_loser=True,objective='weighted_makespan',trials=[trial('T',7)],sites=[site('A'),site('B')],edges=[edge('T','A',2,True),edge('T','B',4,False,1)])
    out={}
    def add(name,r=None):out[name]=copy.deepcopy(r or base);return out[name]
    add('one_trial_two_sites')
    r=add('fractional_default_horizon');del r['horizon'];r['edges']=r['edges'][:1];r['sites']=r['sites'][:1]
    r=add('two_trials_one_shared_hospital');r.update(trials=[trial('T1',2),trial('T2',10)],sites=[site('A',4)],edges=[edge('T1','A',4,True),edge('T2','A',4,True)])
    r=add('independent_hospitals');r.update(trials=[trial('T1'),trial('T2',20)],edges=[edge('T1','A',2,True),edge('T2','B',4,True)])
    r=add('staggered_activation');r['edges'][1]['lag']=4;r['trials'][0]['target']=20
    r=add('fast_site_unaffordable');r['edges'][1]['activation']=2000000
    r=add('cheap_but_too_slow');r['objective']='min_cost_deadline';r['trials'][0]['deadline']=2;r['edges'][0]['rate']=.5
    r=add('unknown_capacity');r['sites'][1]['capacity_basis']='UNKNOWN';r['sites'][1]['capacity']=None
    r=add('no_feasible_sites');r['edges']=[{**r['edges'][0],'feasibility':'INFEASIBLE'}]
    r=add('budget_below_minimum');r['budget']=1
    r=add('late_expensive_activation');r['edges'][1].update(lag=35,activation=800000)
    r=add('different_variable_cost');r['edges'][1].update(participant=20000,activation=0)
    r=add('budget_increase_no_candidates');r['budget']=5000000;r['edges']=r['edges'][:1]
    r=add('one_dominant_trial');r['trials']=[trial('T1',80),trial('T2',2)];r['edges']=[edge('T1','A',8,True),edge('T2','B',2,True)];r['budget']=3000000
    r=add('priority_weighted_max');r['trials']=[trial('T1'),trial('T2')];r['trials'][0]['priority']=4;r['sites']=[site('A',3),site('B',4)];r['edges']=[edge('T1','A',3,True),edge('T2','A',3,True),edge('T1','B',4,False,2),edge('T2','B',4,False,2)]
    r=add('priority_weighted_sum',out['priority_weighted_max']);r['objective']='sum_duration'
    r=add('losers_disclosed',out['priority_weighted_max']);r['no_loser']=False;r['sites'][1]['slots']=1
    r=add('same_no_loser_enabled',r);r['no_loser']=True
    r=add('bounded_search_plateau')
    r['trials']=[trial(f'T{i}',12) for i in range(4)]
    r['sites']=[{**site(s,100),'slots':4} for s in ('A','B','C')]
    r['edges']=[edge(t['id'],s['id'],1,s['id']=='A') for t in r['trials'] for s in r['sites']]
    return out


def audit(output):
    from concord import portfolio as p
    from concord import portfolio_simulation as sim
    import numpy as np
    rows=[]
    for name,body in cases().items():
        request=p.PortfolioRequest.model_validate(body)
        result=p.run(request)
        normalized=request.model_dump(mode='json')
        exact=enumerate_optimum(normalized,[c['totals'] for c in result['coverage']])
        actual=result['scenarios'][4]
        reference=schedule(normalized,set(actual['selected_edges']))
        rows.append({'case':name,'request':normalized,'baseline':result['scenarios'][0],
                     'concord_allocation':actual,'exact_optimum':exact,
                     'reference_times_for_concord':reference['times'],
                     'absolute_gap':actual['objective_value']-exact['score'] if exact and actual['feasible'] else None,
                     'false_infeasible':exact is not None and not actual['feasible'],
                     'time_mismatch':any(abs(t['expected_months']-reference['times'][t['id']])>.011 for t in actual['trials'])})
    # Preserve the actual default-constructor dtype defect, without normalizing it away.
    request=p.PortfolioRequest(trials=[p.Trial(id='T',title='Audit',target=7)],sites=[p.SharedSite(id='A',name='Audit',capacity=10,capacity_basis='ASSUMED')],edges=[p.Edge(trial='T',site='A',rate=2,baseline=True,feasibility='ASSUMED_FEASIBLE',rate_basis='ASSUMED')],draws=32,spread=0,operations_rate_effect=0)
    times=sim.simulate(request,{0},np.ones((1,1)))['times']
    Path(output).write_text(json.dumps({'oracle':'Scalar Fraction event integrator and exhaustive subset enumeration; no production simulator/search/pricing calls in reference functions','cases':rows,'default_horizon_probe':{'horizon_type':type(request.horizon).__name__,'dtype':str(times.dtype),'expected':3.5,'actual':times.tolist()}},indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'false_infeasible':[r['case'] for r in rows if r['false_infeasible']],'time_mismatches':[r['case'] for r in rows if r['time_mismatch']],'default_horizon':times.tolist()}))


if __name__=='__main__':
    import sys
    audit(sys.argv[1])
