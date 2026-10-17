"""Bounded, reproducible portfolio planning; synthetic operations, registry context only."""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import platform
import tempfile
from importlib.metadata import version
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import Field, model_validator

from concord import financial as fin
from concord import portfolio_simulation as sim
from concord.paths import ROOT, DATA_DIR

router = APIRouter(prefix='/api/portfolio-command', tags=['Portfolio Command'])
STORE = DATA_DIR / 'work' / 'portfolio'
CONTEXT = ROOT / 'data' / 'portfolio' / 'context.json'
RUNTIME_SOURCES = [Path(__file__),Path(sim.__file__),Path(fin.__file__),
                   Path(fin.core.__file__),Path(fin.terms.__file__),Path(fin.terms.medicare.__file__),
                   Path(fin.__file__).with_name('financial_allocation.py')]
EXECUTED_SOURCES = {str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in RUNTIME_SOURCES}


class Trial(fin.Strict):
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,40}$')
    title: str = Field(min_length=1, max_length=240)
    sponsor: str = Field('Hypothetical sponsor', min_length=1, max_length=120)
    target: int = Field(40, ge=1, le=1000)
    enrolled: int = Field(0, ge=0, le=999)
    progress_basis: Literal['SIMULATED'] = 'SIMULATED'
    priority: float = Field(1, gt=0, le=10)
    deadline: float = Field(24, gt=0, le=60)
    financial_template: Literal['NCT05800015', 'NCT06627647'] = 'NCT05800015'
    admin: float = Field(150000, ge=0, le=1e7)
    support: float = Field(500, ge=200, le=100000)

    @model_validator(mode='after')
    def remaining(self):
        if self.enrolled >= self.target:
            raise ValueError('Planning trials require positive remaining enrollment')
        return self


class SharedSite(fin.Strict):
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,40}$')
    name: str = Field(min_length=1, max_length=120)
    capacity: float | None = Field(None, gt=0, le=100)
    capacity_basis: Literal['UNKNOWN', 'ASSUMED'] = 'UNKNOWN'
    slots: int = Field(2, ge=1, le=4)


class Edge(fin.Strict):
    trial: str
    site: str
    baseline: bool = False
    feasibility: Literal['UNKNOWN', 'ASSUMED_FEASIBLE', 'INFEASIBLE'] = 'UNKNOWN'
    rate_basis: Literal['UNKNOWN', 'ASSUMED'] = 'UNKNOWN'
    rate: float | None = Field(None, gt=0, le=100)
    lag: float = Field(0, ge=0, le=60)
    activation: float = Field(30000, ge=0, le=1e7)
    operating: float = Field(1000, ge=0, le=1e6)
    monitoring: float = Field(300, ge=0, le=1e6)
    participant: float = Field(1800, ge=0, le=1e6)
    screening: float = Field(200, ge=0, le=1e6)


class PortfolioRequest(fin.Strict):
    budget: float = Field(3000000, gt=0, le=1e9)
    objective: Literal['weighted_makespan', 'sum_duration', 'min_cost_deadline'] = 'weighted_makespan'
    horizon: float = Field(36, gt=0, le=60)
    seed: int = Field(7, ge=0, le=2**32-1)
    draws: int = Field(128, ge=32, le=256)
    spread: float = Field(.25, ge=0, le=1)
    savings_realized: bool = False
    admin_reduction: float = Field(.25, ge=0, le=1)
    extra_support: float = Field(300, ge=0, le=10000)
    support_rate_effect: float = Field(0, ge=0, le=1)
    operations_rate_effect: float = Field(.15, ge=0, le=1)
    operations_cost: float = Field(25000, ge=0, le=1e7)
    no_loser: bool = True
    hospital_floor: float = Field(0, ge=0, le=1e8)
    trials: list[Trial] = Field(min_length=1, max_length=4)
    sites: list[SharedSite] = Field(min_length=1, max_length=6)
    edges: list[Edge] = Field(min_length=1, max_length=12)

    @model_validator(mode='after')
    def links(self):
        tids, sids = {t.id for t in self.trials}, {s.id for s in self.sites}
        if len(tids) != len(self.trials) or len(sids) != len(self.sites):
            raise ValueError('Trial/site IDs must be unique')
        pairs = [(e.trial,e.site) for e in self.edges]
        if len(set(pairs)) != len(pairs):
            raise ValueError('Duplicate trial/site edge')
        if any(e.trial not in tids or e.site not in sids for e in self.edges):
            raise ValueError('Edge references unknown trial or site')
        if any(not any(e.trial == t.id and e.baseline for e in self.edges) for t in self.trials):
            raise ValueError('Every trial needs a fixed baseline allocation')
        return self


LIMITATIONS = [
    'Live computation on explicitly synthetic operational inputs; registry records supply identifiers, titles and sponsors only. No live Regeneron relationship or actual recruitment progress.',
    'Current registry captures are retrospective context, never historical as-of features. No clinical outcomes, historical backtest or acceleration evidence is inferred.',
    'Independent mean-one lognormal edge-rate shocks and continuous enrollment are assumptions. P10–P90 ranges and deadline draw fractions are not calibrated predictive probabilities.',
    'Bounded deterministic beam search is a heuristic, not a global optimum. Objective selection and no-loser compare expected horizon-capped times on the same assumed draws.',
    'Site capacity is shared proportionally between activated unfinished trials. Static concurrent-trial slots are reserved for the whole network; outside trials and eligibility overlap are unknown.',
    'Budget feasibility reserves operating/monitoring costs for the full horizon and maximum selected per-participant cost for all remaining participants. Budget assurance is limited to the modeled cost scope and horizon.',
    'Unfinished draws are censored at the horizon. Their capped durations are lower bounds; no complete-time estimate is claimed and such networks are ineligible for recommendation.',
    'Both Regeneron-context trials use the NCT05800015 illustrative authored financial schedule; it is an explicit proxy for NCT05785767, not its actual protocol.',
    'Potential payer costs, participant cost sharing and reserves reuse Financial Coordination. Coverage is fixed across scenarios and never optimized; no reduction of care or cost shifting is used.',
    'Additional support does not change rates unless an explicit hypothetical effect is supplied. Administrative reductions release budget only when marked realized.',
    'Hospital contribution uses the inherited 80% operating-resource and 70% procedure-resource assumptions. A nonnegative contribution is an economic scenario constraint, not a fair-market-value or legal determination.',
    *fin.LIMITATIONS[:5],
]


def demo():
    context = json.loads(CONTEXT.read_text())
    trials = [Trial(id=r['id'],title=r['title'][:240],sponsor=r['sponsor'],
                    deadline=24 if i == 0 else 20, priority=1.2 if i == 0 else 1)
              for i, r in enumerate(context)]
    sites = [SharedSite(id=f'SYN-{c}',name=f'Synthetic hospital {c}',capacity=cap,capacity_basis='ASSUMED')
             for c, cap in [('A',3),('B',3),('C',4),('D',2)]]
    edges = []
    for i, t in enumerate(trials):
        for j,s in enumerate(sites):
            edges.append(Edge(trial=t.id,site=s.id,baseline=j<2,
                              feasibility='ASSUMED_FEASIBLE',rate_basis='ASSUMED',
                              rate=[2.3,1.7,2.6,.8][j]*(1 if i==0 else .85),
                              lag=0 if j<2 else 3,activation=30000 if j<3 else 50000))
    return {'request':PortfolioRequest(trials=trials,sites=sites,edges=edges).model_dump(mode='json'),
            'registry_context':context,'limitations':LIMITATIONS}


def financial_inputs(req):
    return [fin.FinanceRequest(trial_id=t.financial_template,target=t.target-t.enrolled,
                              budget=req.budget,admin_cost=t.admin,support_per_participant=t.support)
            for t in req.trials]


def price(req, selected, simulation, covs, finances, efficient=False, support=False, operations=False):
    """Expected ledger plus conservative commitment. Transfers are never added to resources."""
    total, commitment = 0., 0.
    rows = []
    for p, t in enumerate(req.trials):
        n = t.target-t.enrolled
        indices = [j for j in selected if req.edges[j].trial == t.id]
        admin = t.admin*(1-req.admin_reduction if efficient and req.savings_realized else 1)
        ops = req.operations_cost if operations else 0
        b = {'activation':sum(req.edges[j].activation for j in indices if not req.edges[j].baseline)+ops,
             'operating':sum((req.edges[j].operating+req.edges[j].monitoring)*float(simulation['months'][:,j].mean()) for j in indices),
             'site_variable':sum((req.edges[j].participant+req.edges[j].screening)*float(simulation['enrollments'][:,j].mean()) for j in indices),
             'procedures':(covs[p]['totals']['sponsor']+covs[p]['totals']['reserve'])*n,
             'support':(t.support+(req.extra_support if support else 0))*n,'administration':admin}
        committed = (sum(b[k] for k in ('activation','procedures','support','administration'))
                     +sum((req.edges[j].operating+req.edges[j].monitoring)*req.horizon for j in indices)
                     +max((req.edges[j].participant+req.edges[j].screening for j in indices),default=0)*n)
        expected = sum(b.values())
        econ = fin.economics(finances[p],{'sponsor_total':fin.money(expected),'breakdown':b},covs[p])
        rows.append({'trial':t.id,'breakdown':{k:fin.money(v) for k,v in b.items()},
                     'budget_commitment':fin.money(committed),'expected_commitment':fin.money(expected),'economics':econ})
        total += expected
        commitment += committed
    return {'expected_commitment':fin.money(total),'budget_commitment':fin.money(commitment),
            'budget_remaining':fin.money(req.budget-commitment),'trials':rows,
            'transfer_balance':fin.money(sum(r['economics']['transfer_balance'] for r in rows)),
            'resource_cost':fin.money(sum(r['economics']['consolidated_resource_cost'] for r in rows)),
            'cash_expenditure':fin.money(sum(r['economics']['sponsor']['expenditure'] for r in rows)),
            'contingency':fin.money(sum(r['economics']['sponsor']['contingency_reserve'] for r in rows))}


def run(req: PortfolioRequest):
    if EXECUTED_SOURCES != {str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in RUNTIME_SOURCES}:
        raise HTTPException(409,'Source changed since runtime start; restart backend before computing evidence')
    finances = financial_inputs(req)
    covs = [fin.coverage(f) for f in finances]
    rng = np.random.default_rng(req.seed)
    shocks = rng.lognormal(-req.spread**2/2,req.spread,(req.draws,len(req.edges)))
    baseline = frozenset(j for j,e in enumerate(req.edges) if e.baseline)
    memo = {}
    baseline_times = None

    def evaluate(selected, efficient=False, support=False, operations=False):
        key = (tuple(sorted(selected)),efficient,support,operations)
        if key in memo:
            return memo[key]
        errors = sim.network_errors(req,selected)
        out = sim.simulate(req,selected,shocks,
                           (req.support_rate_effect if support else 0)+(req.operations_rate_effect if operations else 0))
        ledger = price(req,selected,out,covs,finances,efficient,support,operations)
        if ledger['budget_commitment'] > req.budget+.005:
            errors.append('Conservative sponsor commitment exceeds fixed budget')
        if not out['complete'].all():
            errors.append('Enrollment incomplete in one or more assumed draws; duration censored')
        if any(r['economics']['hospital']['net_contribution'] < req.hospital_floor-.005 for r in ledger['trials']):
            errors.append('Hospital contribution below selected floor')
        if req.no_loser and baseline_times is not None and np.any(out['times'].mean(axis=0)>baseline_times+1e-8):
            errors.append('Expected per-trial no-loser constraint violated')
        if req.objective == 'min_cost_deadline' and any(out['times'][:,p].mean()>t.deadline+1e-8 for p,t in enumerate(req.trials)):
            errors.append('Expected recruitment deadline exceeded')
        metric = ledger['expected_commitment'] if req.objective=='min_cost_deadline' else float(out[req.objective].mean())
        result = {'selected':sorted(selected),'simulation':out,'ledger':ledger,'violations':errors,'feasible':not errors,'objective':metric,
                  'policy':{'administrative_efficiency':efficient,'additional_support':support,'operations_investment':operations}}
        memo[key] = result
        return result

    base = evaluate(baseline)
    baseline_times = base['simulation']['times'].mean(axis=0)

    def search(efficient=False, support=False, operations=False, add_only=False):
        start = evaluate(baseline,efficient,support,operations)
        frontier = [(baseline,start)]
        seen = {baseline}
        evaluated = [start]
        # Every score uses the same full draw bank; no adaptive fresh inference.
        for _ in range(3):
            candidates = []
            for selected,_ in frontier:
                for network in sim.candidate_networks(req,selected):
                    if network in seen or (add_only and not baseline.issubset(network)):
                        continue
                    seen.add(network)
                    if len(seen)>96:
                        break
                    if sim.network_errors(req,network):
                        continue
                    candidate = evaluate(network,efficient,support,operations)
                    evaluated.append(candidate)
                    candidates.append((network,candidate))
                if len(seen)>96:
                    break
            if not candidates or len(seen)>96:
                break
            frontier = sorted(candidates,key=lambda pair:(len(pair[1]['violations']),pair[1]['objective'],pair[1]['ledger']['expected_commitment'],sorted(pair[0])))[:3]
        feasible = [r for r in evaluated if r['feasible']]
        return min(feasible,key=lambda r:(r['objective'],r['ledger']['expected_commitment'],r['selected'])) if feasible else start

    joint_options = [search(True,support,operations)
                     for support in ([False,True] if req.support_rate_effect>0 else [False])
                     for operations in (False,True)]
    eligible_joint = [r for r in joint_options if r['feasible']]
    joint = min(eligible_joint,key=lambda r:(r['objective'],r['ledger']['expected_commitment'],r['selected'])) if eligible_joint else evaluate(baseline,True)
    plans = [('A','Fixed baseline',base),('B','Financial efficiency',evaluate(baseline,True)),
             ('C','More sites',search(efficient=True,add_only=True)),
             ('D','Participant support',evaluate(baseline,True,True)),
             ('E','Better allocation',search()),('F','Joint portfolio optimization',joint)]

    def summary(result, ident, label):
        out = result['simulation']
        times = out['times']
        critical = np.argmax(times,axis=1)
        return {'id':ident,'label':label,'feasible':result['feasible'],'violations':result['violations'],
                'selected_edges':result['selected'],'ledger':result['ledger'],'policy':result['policy'],
                'objective_value':fin.money(result['objective']),
                'expected_makespan':fin.money(out['makespan'].mean()),
                'weighted_makespan':fin.money(out['weighted_makespan'].mean()),
                'weighted_sum_duration':fin.money(out['sum_duration'].mean()),
                'interval':np.round(np.quantile(out['makespan'],[.1,.5,.9]),3).tolist(),
                'censored_draws':int((~out['complete'].all(axis=1)).sum()),
                'paired_months_saved':fin.money((base['simulation']['makespan']-out['makespan']).mean()),
                'paired_savings_interval':np.round(np.quantile(base['simulation']['makespan']-out['makespan'],[.1,.5,.9]),3).tolist(),
                'trials':[{'id':t.id,'remaining':t.target-t.enrolled,'expected_months':fin.money(times[:,p].mean()),
                           'interval':np.round(np.quantile(times[:,p],[.1,.5,.9]),3).tolist(),
                           'deadline_draw_fraction':float(np.mean(out['complete'][:,p] & (times[:,p]<=t.deadline))),
                           'critical_path_draw_fraction':float(np.mean(critical==p)),
                           'expected_enrolled':fin.money(out['enrollments'][:,[j for j,e in enumerate(req.edges) if e.trial==t.id]].sum(axis=1).mean())} for p,t in enumerate(req.trials)],
                'sites':[{'id':s.id,'peak_rate':float(out['peak'][:,k].max()),'capacity':s.capacity,
                          'reserved_slots':sum(1 for j in result['selected'] if req.edges[j].site==s.id)} for k,s in enumerate(req.sites)],
                'edge_flows':[{'edge':j,'expected_enrolled':fin.money(out['enrollments'][:,j].mean()),
                               'expected_active_months':fin.money(out['months'][:,j].mean()),
                               'activation_cost':fin.money(req.edges[j].activation if not req.edges[j].baseline else 0),
                               'expected_site_payments':fin.money((req.edges[j].activation if not req.edges[j].baseline else 0)
                                   +(req.edges[j].operating+req.edges[j].monitoring)*out['months'][:,j].mean()
                                   +(req.edges[j].participant+req.edges[j].screening)*out['enrollments'][:,j].mean())}
                              for j in result['selected']],
                'expected_cost_per_required_participant':fin.money(result['ledger']['expected_commitment']/sum(t.target-t.enrolled for t in req.trials))}

    scenarios = [summary(r,i,label) for i,label,r in plans]
    # Every individual candidate investment is compared to the untouched baseline.
    marginal = []
    early_req = req.model_copy(update={'horizon':min(12.,req.horizon)})
    baseline_early = sim.simulate(early_req,baseline,shocks)['enrollments'].sum(axis=1)
    options = [(f'Add {e.site} to {e.trial}',evaluate(baseline|{j})) for j,e in enumerate(req.edges) if j not in baseline and sim.usable(req,e)]
    options += [('Participant support',evaluate(baseline,False,True)),('Recruitment operations (assumed effect)',evaluate(baseline,False,False,True))]
    for label,r in options:
        gain = float((base['simulation']['makespan']-r['simulation']['makespan']).mean())
        delta = r['ledger']['expected_commitment']-base['ledger']['expected_commitment']
        # Horizon throughput is useful even when both networks finish the full target.
        early = sim.simulate(early_req,r['selected'],shocks,req.operations_rate_effect if 'operations' in label else req.support_rate_effect if label=='Participant support' else 0)
        enrollment_gain = float((early['enrollments'].sum(axis=1)-baseline_early).mean())
        marginal.append({'label':label,'feasible':r['feasible'],'violations':r['violations'],
                         'additional_expected_cost':fin.money(delta),'additional_budget_reserve':fin.money(r['ledger']['budget_commitment']-base['ledger']['budget_commitment']),
                         'expected_months_saved':fin.money(gain),'paired_savings_interval':np.round(np.quantile(base['simulation']['makespan']-r['simulation']['makespan'],[.1,.9]),3).tolist(),
                         'additional_expected_enrollment_at_month':early_req.horizon,
                         'additional_expected_enrollment':fin.money(enrollment_gain),
                         'expected_enrollment_gain_per_dollar':enrollment_gain/delta if delta>0 else None,
                         'affects_critical_path':gain>1e-6,'break_even_value_per_month':fin.money(delta/gain) if gain>1e-6 and delta>0 else None,
                         'recommendation':'Candidate under assumptions' if r['feasible'] and gain>1e-6 else 'Retain funds; no feasible demonstrated time gain'})
    feasible = [s for s in scenarios if s['feasible']]
    best = min(feasible,key=lambda s:(s['objective_value'],s['ledger']['expected_commitment'],s['id'])) if feasible else None
    pareto = [s['id'] for s in feasible if not any(o['ledger']['expected_commitment']<=s['ledger']['expected_commitment'] and o['expected_makespan']<=s['expected_makespan'] and (o['ledger']['expected_commitment']<s['ledger']['expected_commitment'] or o['expected_makespan']<s['expected_makespan']) for o in feasible)]
    evidence = fin.code_evidence()
    paths = [Path(__file__),Path(sim.__file__),CONTEXT,*[fin.terms.PROTOCOL_DIR/f'{t.financial_template}.json' for t in req.trials]]
    evidence['portfolio_sources'] = {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    evidence['executed_source_sha256'] = EXECUTED_SOURCES
    evidence['algorithm'] = 'Event simulation; original allocator Instance feasibility contract; deterministic beam width 3 / depth 3 / at most 96 visited networks per search'
    evidence['cache_policy'] = 'No scenario result lookup during computation; immutable saved evidence verified by complete result digest'
    evidence['runtime'] = {'python':platform.python_version(),'numpy':np.__version__,'pydantic':version('pydantic'),'fastapi':version('fastapi')}
    evidence['distribution'] = 'Independent mean-one lognormal edge shocks; shared common draw bank across every candidate; optimization uses same bank, so results are in-sample assumption sensitivity'
    request = req.model_dump(mode='json')
    result = {'schema_version':1,'request':request,'execution_mode':'live_computation_synthetic_operations_registry_context',
              'input_sha256':fin.digest({'request':request,'coverage':covs,'evidence':evidence}),
              'scenarios':scenarios,'recommended_scenario_id':best['id'] if best else None,
              'pareto_scenario_ids':pareto,'marginal':marginal,'coverage':covs,
              'feasible_additional_site_assignments':sum(1 for label,r in options if label.startswith('Add ') and r['feasible']),
              'available_admin_savings':fin.money(sum(t.admin for t in req.trials)*req.admin_reduction) if req.savings_realized else 0,
              'potential_admin_savings':fin.money(sum(t.admin for t in req.trials)*req.admin_reduction),
              'search_evaluations':len(memo),'seed':req.seed,'draws':req.draws,
              'evidence':evidence,'registry_context':json.loads(CONTEXT.read_text()),
              'sources':fin.SOURCES,'limitations':LIMITATIONS}
    result['result_sha256'] = fin.digest(result)
    result['run_id'] = result['result_sha256'][:32]
    return result


def valid_result(result):
    copy = dict(result)
    expected = copy.pop('result_sha256')
    ident = copy.pop('run_id')
    return fin.digest(copy)==expected and ident==expected[:32]


def save(result):
    STORE.mkdir(parents=True,exist_ok=True)
    path = STORE / f"{result['run_id']}.json"
    # Publish complete bytes atomically, without replacing existing evidence.
    with tempfile.NamedTemporaryFile(mode='w',dir=STORE,delete=False) as f:
        temporary = Path(f.name)
        json.dump(result,f,sort_keys=True,allow_nan=False)
    try:
        os.link(temporary,path)
    except FileExistsError:
        if load(result['run_id']) != result:
            raise HTTPException(409,'Saved evidence conflict')
    finally:
        temporary.unlink()
    return result


def load(ident):
    if not re.fullmatch(r'[a-f0-9]{32}',ident):
        raise HTTPException(422,'Invalid run identifier')
    path = STORE / f'{ident}.json'
    if not path.exists():
        raise HTTPException(404,'Saved run not found')
    try:
        result = json.loads(path.read_text())
        if not valid_result(result) or result['run_id'] != ident:
            raise ValueError('digest')
    except (ValueError,KeyError,TypeError):
        raise HTTPException(409,'Saved evidence integrity failure')
    return result


def report_html(result):
    esc = html.escape
    rows = ''.join(f"<tr><td>{esc(s['label'])}</td><td>{s['feasible']}</td><td>{s['expected_makespan']}</td><td>{s['ledger']['expected_commitment']:,.2f}</td><td>{s['ledger']['budget_commitment']:,.2f}</td></tr>" for s in result['scenarios'])
    return '<!doctype html><html lang="en"><meta charset="utf-8"><title>Concord portfolio evidence</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:20px}td,th{padding:12px;border:1px solid #ccc}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{color:#165e63}</style><h1>Concord · Portfolio Command</h1><p>Live computation · synthetic operations · registry context only</p><p>Run '+esc(result['run_id'])+'</p><table><tr><th>Scenario</th><th>Feasible</th><th>Expected months (capped)</th><th>Expected USD incl. reserve</th><th>Conservative commitment USD</th></tr>'+rows+'</table><h2>Limitations</h2><ul>'+''.join('<li>'+esc(x)+'</li>' for x in result['limitations'])+'</ul><h2>Complete immutable evidence</h2><pre>'+esc(json.dumps(result,indent=2))+'</pre></html>'


@router.get('/demo')
def get_demo():
    return demo()


@router.post('/compare')
def compare(req: PortfolioRequest):
    return save(run(req))


@router.post('/validate')
def validate(req: PortfolioRequest):
    return req


@router.get('/runs/{ident}')
def saved(ident: str):
    return load(ident)


@router.get('/runs/{ident}/report/{format}')
def report(ident: str, format: Literal['json','html']):
    result = load(ident)
    headers = {'Content-Disposition':f'attachment; filename="concord-portfolio-{ident}.{format}"'}
    return JSONResponse(result,headers=headers) if format=='json' else HTMLResponse(report_html(result),headers=headers)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request',type=Path)
    parser.add_argument('--output',type=Path,default=STORE/'demo')
    args = parser.parse_args()
    req = PortfolioRequest.model_validate(json.loads(args.request.read_text()) if args.request else demo()['request'])
    result = run(req)
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'request.json').write_text(json.dumps(result['request'],indent=2)+'\n')
    (args.output/'evidence.json').write_text(json.dumps(result,indent=2)+'\n')
    (args.output/'evidence.html').write_text(report_html(result))
    print(result['run_id'],result['recommended_scenario_id'])
