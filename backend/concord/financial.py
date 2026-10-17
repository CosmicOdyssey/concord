"""Bounded financial planning on authored protocols; never claims or coverage approval."""
from __future__ import annotations

import hashlib
import html
import json
import subprocess
from enum import StrEnum
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from concord import terms
from concord.paths import ROOT
from concord.allocator import core
from concord.financial_allocation import evaluate_plan, optimize_plan

router = APIRouter(prefix="/api/financial", tags=["financial coordination"])
SOURCES = [
    {"id":"medicare-310.1","url":"https://www.cms.gov/files/document/r12590ncd.pdf","title":"CMS NCD 310.1, current manual revision 12590 (2024)","kind":"verified_policy_reference","checked":"2026-10-17","scope":"Qualifying trial routine costs subject to Medicare rules; excludes sponsor-free and research-only items. Administration may qualify depending on circumstances; R1 is a conservative sponsor agreement assumption, not an NCD prohibition."},
    {"id":"medicaid","url":"https://www.medicaid.gov/federal-policy-guidance/downloads/smd21005.pdf","title":"CMS SMD 21-005: routine patient costs in qualifying clinical trials","kind":"verified_policy_reference","checked":"2026-10-17","scope":"Federal qualifying-trial benefit; state, beneficiary, service and plan implementation require review."},
    {"id":"commercial","url":"https://www.cancer.gov/research/participate/clinical-trials/paying","title":"NCI: insurance coverage for clinical trials","kind":"policy_reference","checked":"2026-10-17","scope":"Plan and network requirements apply. No commercial allowed amount is inferred without an explicit assumption."},
]
LIMITATIONS = [
    "Synthetic financial demonstration: all candidate sites, rates, capacities, costs, margins and payer shares are hypothetical, not registered site facts or negotiated prices.",
    "The real trial identifier links an existing illustrative authored schedule; the registry does not publish the complete protocol. This is not a sponsor-approved protocol budget.",
    "Routine coverage is potential, subject to qualifying-trial, beneficiary, jurisdiction, plan, network and service review. No insurer participates or commits funding.",
    "Unknown responsibility is held as sponsor contingency, not billed to insurers or participants. Unresolved patient exposure is unknown, not evidence of zero liability.",
    "Only the authored fixed visit horizon is priced. Actual drug acquisition/manufacturing, treatment beyond this horizon, complications and downstream outcomes are unknown; the drug contingency is an assumption, not a complete trial cost.",
    "Recruitment rates and time scenarios are synthetic engineering assumptions using the existing Concord equations; no historical backtest, clinical benefit or trial acceleration is established.",
    "Modeled no-loser applies only to the single trial's nominal duration versus the selected baseline; no protection for other trials or uncertain realizations is claimed.",
    "Sensitivity uses paired assumed site-rate shocks, not calibrated clinical prediction intervals. Additional site reach does not authorize enrollment-target expansion.",
    "Sponsor-to-hospital payments are transfers. Consolidated resource costs use separate explicit cost assumptions; reduced sponsor payments are not automatically system or payer savings.",
    "No claims, reimbursements, coverage authorizations, contracts or patient-identifiable records are transmitted. Operator corrections are interpretations, not clinical or payer attestations.",
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Responsibility(StrEnum):
    SPONSOR = "SPONSOR"
    PAYER = "POTENTIALLY_PAYER_COVERED"
    PATIENT = "POTENTIALLY_PATIENT_COST_SHARING"
    CONDITIONAL = "CONDITIONAL"
    UNKNOWN = "UNKNOWN"
    REVIEW = "REVIEW_REQUIRED"


class Site(Strict):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")
    name: str = Field(min_length=1, max_length=120)
    baseline_active: bool = False
    feasible: bool = True
    activation_cost: float = Field(30000, ge=0, le=1e7)
    monthly_cost: float = Field(1000, ge=0, le=1e6)
    per_participant_cost: float = Field(2000, ge=0, le=1e6)
    rate: float = Field(2, gt=0, le=100)
    capacity: int = Field(60, ge=1, le=10000)
    activation_lag_months: float = Field(2, ge=0, le=24)


def default_sites():
    return [Site(id="SYN-A",name="Synthetic site A",baseline_active=True,rate=2.0,activation_lag_months=0),
            Site(id="SYN-B",name="Synthetic site B",baseline_active=True,rate=1.5,monthly_cost=1200,activation_lag_months=0),
            Site(id="SYN-C",name="Synthetic site C",rate=2.5,activation_cost=35000,monthly_cost=1600,per_participant_cost=2400),
            Site(id="SYN-D",name="Synthetic site D",rate=.8,activation_cost=50000,monthly_cost=2200,per_participant_cost=2800)]


class FinanceRequest(Strict):
    trial_id: Literal["NCT05800015","NCT06627647"] = "NCT05800015"
    budget: float = Field(1500000, gt=0, le=1e9)
    target: int = Field(60, ge=1, le=1000)
    horizon_months: float = Field(24, gt=0, le=60)
    admin_cost: float = Field(120000, ge=0, le=1e8)
    admin_reduction: float = Field(.25, ge=0, le=1)
    support_per_participant: float = Field(500, ge=0, le=100000)
    minimum_support: float = Field(200, ge=0, le=100000)
    extra_support: float = Field(300, ge=0, le=100000)
    seed: int = Field(7, ge=0, le=2**32-1)
    draws: int = Field(256, ge=100, le=1000)
    rate_spread: float = Field(.25, ge=0, le=1)
    no_loser: bool = True
    payer_kind: Literal["Medicare","commercial","Medicaid"] = "Medicare"
    jurisdiction: str = Field("MA",min_length=2,max_length=80)
    payer_plan: str = Field("UNVERIFIED DEMO",min_length=1,max_length=120)
    payer_fraction: float = Field(.8,ge=0,le=1)
    commercial_rate_assumption: bool = False
    rate_multiplier: float = Field(1, ge=.1,le=5)
    payer_admin_per_participant: float = Field(30,ge=0,le=10000)
    drug_contingency_per_participant: float = Field(2500,ge=0,le=1e7)
    coverage_overrides: dict[str,Responsibility] = Field(default_factory=dict,max_length=200)
    sites: list[Site] = Field(default_factory=default_sites,min_length=1,max_length=8)

    @model_validator(mode="after")
    def unique(self):
        if len({s.id for s in self.sites}) != len(self.sites):
            raise ValueError("Site IDs must be unique")
        if not any(s.baseline_active for s in self.sites):
            raise ValueError("At least one baseline-active site is required")
        if self.support_per_participant < self.minimum_support:
            raise ValueError("Participant support cannot fall below the explicit access safeguard")
        return self


def digest(obj):
    return hashlib.sha256(json.dumps(obj,sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()


def money(x):
    return round(float(x)+1e-9,2)


def coverage(req: FinanceRequest):
    terms.medicare._cms.cache_clear()  # refresh fee inputs for each financial request
    p = terms.load_protocol(req.trial_id)
    procs = {x['id']:x for x in p['procedures']}
    cov = terms._coverage(p,{})  # reuse existing authored rules, qualify their financial interpretation below
    std = terms.standard_schedule()
    unknown_ids = set(req.coverage_overrides)-{n['id'] for n in p['nodes']}-{'drug-contingency'}
    if unknown_ids:
        raise ValueError("Unknown coverage node IDs")
    items=[]
    for node in p['nodes']:
        # Reuse the existing budget's finite horizon: screening, C1-8, end/safety follow-up only.
        visit=next(v for v in p['visits'] if v['id']==node['visit'])
        if visit['kind']=='repeat':
            continue
        proc=procs[node['procedure']]
        default = Responsibility.SPONSOR if cov[node['id']]['coverage']=='research' else Responsibility.PAYER
        status=req.coverage_overrides.get(node['id'],default)
        if default==Responsibility.SPONSOR and status in (Responsibility.PAYER,Responsibility.PATIENT):
            raise ValueError("Authored research services cannot be shifted to insurers or participants by this pilot")
        price=terms._price_code(proc['code'],None) if proc.get('code') else None
        if price and price.get('amount') is not None:
            rate=float(price['amount'])*req.rate_multiplier
            verified=not price.get('placeholder',True)
            source=price.get('source') or 'Existing Concord ratecard fallback'
        else:
            pricing=proc.get('pricing','')
            rate=float(std.get(pricing.removeprefix('standard:'),{}).get('amount') or 75)*req.rate_multiplier
            verified=False
            source=terms.STANDARD_SOURCE if pricing.startswith('standard:') else 'Synthetic $75 unpriced-line assumption'
        # Always distinguish a fee-schedule benchmark from an allowed commercial amount or site cost.
        sponsor=payer=patient=reserve=0.
        reason='Operator-selected interpretation' if node['id'] in req.coverage_overrides else 'Preliminary authored rule '+node['rule']
        if status==Responsibility.SPONSOR:
            sponsor=rate
        elif status==Responsibility.PAYER and (req.payer_kind!='commercial' or req.commercial_rate_assumption):
            payer=money(rate*req.payer_fraction)
            patient=money(rate-payer)
            reason+='; conditional payment split using an explicit hypothetical payer share'
        elif status==Responsibility.PATIENT:
            patient=rate
            reason+='; hypothetical exposure only, beneficiary agreement and plan review required'
        else:
            reserve=rate
            reason+='; unresolved; held as sponsor contingency without assigning a bill'
        items.append({'id':node['id'],'label':proc['label'],'code':proc.get('code'),'trial_id':req.trial_id,
            'protocol_reference':f"compiler/protocols/{req.trial_id}.json",'quantity':1,'frequency':visit['label'],
            'schedule':visit.get('window'),'unit_rate':money(rate),'rate_kind':'verified_fee_schedule_benchmark' if verified else 'hypothetical_rate',
            'source':source,'year':2026,'status':str(status),'coverage_determination_status':'NOT_DETERMINED',
            'review_status':'operator_interpretation' if node['id'] in req.coverage_overrides else 'REVIEW_REQUIRED',
            'explanation':reason,'sponsor_per_participant':money(sponsor),'payer_per_participant':money(payer),
            'patient_per_participant':money(patient),'reserve_per_participant':money(reserve),
            'resource_cost_per_participant':money(rate*.7),'resource_cost_kind':'explicit_synthetic_70_percent_of_benchmark',
            'jurisdiction':req.jurisdiction,'payer_plan':req.payer_plan})
    if set(req.coverage_overrides)-{i['id'] for i in items}-{'drug-contingency'}:
        raise ValueError('Coverage edit is outside the explicitly priced visit horizon')
    # Nonzero reserve avoids silently treating sponsor-supplied investigational products as free resources.
    status=req.coverage_overrides.get('drug-contingency',Responsibility.UNKNOWN)
    if status not in (Responsibility.UNKNOWN,Responsibility.REVIEW,Responsibility.CONDITIONAL,Responsibility.SPONSOR):
        raise ValueError("Investigational supply contingency cannot be assigned to insurers or participants")
    drug=req.drug_contingency_per_participant
    items.append({'id':'drug-contingency','label':'Investigational supply: hypothetical reserve; acquisition cost UNKNOWN',
        'code':None,'trial_id':req.trial_id,'protocol_reference':f"compiler/protocols/{req.trial_id}.json",'quantity':1,
        'frequency':'Per participant within priced horizon','schedule':'Fixed demo horizon','unit_rate':drug,
        'rate_kind':'synthetic_contingency','source':'Operator contingency assumption, not a drug price','year':2026,
        'status':str(status),'coverage_determination_status':'UNKNOWN','review_status':'REVIEW_REQUIRED',
        'explanation':'Actual manufacturing/acquisition cost unknown; resource proxy assumes this reserve is consumed. Not a complete supply budget.',
        'sponsor_per_participant':drug if status==Responsibility.SPONSOR else 0.,'payer_per_participant':0.,
        'patient_per_participant':0.,'reserve_per_participant':0. if status==Responsibility.SPONSOR else drug,
        'resource_cost_per_participant':drug,'resource_cost_kind':'synthetic_proxy_for_unknown_supply_cost',
        'jurisdiction':req.jurisdiction,'payer_plan':req.payer_plan})
    totals={k:money(sum(i[field] for i in items)) for k,field in [('sponsor','sponsor_per_participant'),('payer','payer_per_participant'),('patient','patient_per_participant'),('reserve','reserve_per_participant'),('resource','resource_cost_per_participant')]}
    return {'items':items,'totals':totals,'warnings':['Every coverage determination and price requires review. Potential payer and patient figures are assumed scenarios, not approvals.', 'Commercial benchmark mapping is '+('explicitly assumed' if req.commercial_rate_assumption else 'disabled; routine lines are reserved') if req.payer_kind=='commercial' else 'Medicare/Medicaid qualifying trial, service and beneficiary eligibility remain unverified.']}


def economics(req, plan, cov):
    n=req.target
    reserve=money(cov['totals']['reserve']*n)
    support=plan['breakdown']['support']
    research=money(plan['sponsor_total']-reserve-support-plan['breakdown']['administration'])
    payer=money(cov['totals']['payer']*n)
    patient=money(cov['totals']['patient']*n)
    hospital_revenue=money(research+payer+patient)
    resources=money(.8*(plan['breakdown']['activation']+plan['breakdown']['operating']+plan['breakdown']['site_variable'])+cov['totals']['resource']*n)
    admin=money(req.payer_admin_per_participant*n)
    transfers=[{'from':'Sponsor','to':'Hospital','amount':research},
               {'from':'Sponsor','to':'Participant','amount':support},
               {'from':'Insurer','to':'Hospital','amount':payer},
               {'from':'Participant','to':'Hospital','amount':patient}]
    balances={k:0. for k in ('Sponsor','Hospital','Insurer','Participant')}
    for t in transfers:
        balances[t['from']]-=t['amount'];balances[t['to']]+=t['amount']
    return {'sponsor':{'expenditure':money(plan['sponsor_total']-reserve),'contingency_reserve':reserve,'budget_commitment':plan['sponsor_total']},
        'hospital':{'revenue':hospital_revenue,'resource_cost':resources,'net_contribution':money(hospital_revenue-resources)},
        'insurer':{'payments':payer,'administration':admin,'total':money(payer+admin),'downstream_clinical_cost':None},
        'patient':{'cost_sharing':patient,'access_support':support,'net_cash_exposure':money(patient-support),'unresolved_exposure':None},
        'transfers':transfers,'party_transfer_balances':{k:money(v) for k,v in balances.items()},'transfer_balance':money(sum(balances.values())),
        'consolidated_resource_cost':money(resources+plan['breakdown']['administration']+admin+support),
        'resource_assumptions':['Hospital site operating/activation and non-procedure variable resource costs = 80% of corresponding negotiated-payment assumptions.',
            'Procedure delivery resource costs = 70% of benchmark, regardless of payer; drug reserve used as an unverified supply-resource proxy.',
            'Sponsor and insurer administration treated as resource consumption. Access payments assumed fully consumed on transport/support resources.',
            'Money transfers are excluded from consolidated resource sum. No external-care/downstream resource cost known.']}


def sensitivity(req, plan, common_draws, cov):
    if not plan['feasible']:
        return None
    ids={s.id:i for i,s in enumerate(req.sites)}
    selected=[ids[i] for i in plan['selected_ids']]
    sites=[req.sites[i] for i in selected]
    rates=np.array([s.rate for s in sites])
    lag=np.mean([s.activation_lag_months for s in sites])
    # Same shocks, same selected allocation; no prescience or reoptimization.
    shocked=common_draws[:,selected]*rates
    aggregate=lag+req.target/shocked.sum(axis=1)
    counts=np.array([r["participants"] for r in plan["site_rows"]])
    # selected IDs/site rows are sorted; align assumptions and shocks to that same order.
    lags=np.array([s.activation_lag_months for s in sites])
    months=np.maximum(aggregate,(lags+counts/shocked).max(axis=1))
    monthly=sum(s.monthly_cost for s in sites)
    costs=plan['sponsor_total']+monthly*(months-plan['modeled_months'])
    return {'modeled_months_quantiles':[money(x) for x in np.quantile(months,[.1,.5,.9])],
        'sponsor_total_quantiles':[money(x) for x in np.quantile(costs,[.1,.5,.9])],
        'probability_budget_exceeded':float(np.mean(costs>req.budget+.005)),
        'probability_horizon_exceeded':float(np.mean(months>req.horizon_months)),
        'seed':req.seed,'draws':req.draws,'method':'Paired independent lognormal site-rate shocks, mean 1; fixed site networks and participant-cost allocation; no reoptimization; not calibrated intervals',
        'calibration_status':'not_established'}


def code_evidence():
    try:
        commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
    except (OSError,subprocess.CalledProcessError):
        commit=None;dirty=None
    paths=[Path(__file__),Path(__file__).with_name('financial_allocation.py'),Path(core.__file__),Path(terms.__file__),Path(terms.medicare.__file__)]
    return {'commit':commit,'dirty':dirty,'source_sha256':digest({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}),
        'ratecard_sha256':hashlib.sha256((terms.medicare.DATA_DIR/'ratecard.json').read_bytes()).hexdigest() if (terms.medicare.DATA_DIR/'ratecard.json').exists() else None,
        'protocol_sha256':None,'financial_input_kind':'synthetic','historical_evaluation':'not_executed; later registry records not used as historical predictions',
        'cache_policy':'No mutable scenario cache; every request fully recomputed from all validated inputs',
        'currency':'USD','consolidation_boundary':'Modeled study services, administration, access and assumed supply resource proxy only'}


def compare(req: FinanceRequest):
    cov=coverage(req)
    sites=[s.model_dump() for s in req.sites]
    baseline_ids=[s.id for s in req.sites if s.baseline_active]
    kw={'sites':sites,'target':req.target,'horizon_months':req.horizon_months,'budget':req.budget,
        'procedure_per_participant':cov['totals']['sponsor']+cov['totals']['reserve'],
        'admin_cost':req.admin_cost,'support_per_participant':req.support_per_participant,'minimum_support':req.minimum_support}
    base=evaluate_plan(selected_ids=baseline_ids,**kw)
    reduced={**kw,'admin_cost':money(req.admin_cost*(1-req.admin_reduction))}
    max_months=base.get('modeled_months') if req.no_loser and base.get('feasible') else None
    plans=[('A','Existing allocation',base),
        ('B','Lower administrative expense',evaluate_plan(selected_ids=baseline_ids,**reduced)),
        ('C','Additional feasible sites',optimize_plan(required_ids=baseline_ids,max_months=max_months,**reduced)),
        ('D','Expanded participant support',evaluate_plan(selected_ids=baseline_ids,**{**reduced,'support_per_participant':req.support_per_participant+req.extra_support})),
        ('E','Combined funding and site comparison',optimize_plan(required_ids=[],max_months=max_months,**{**reduced,'support_per_participant':req.support_per_participant+req.extra_support}))]
    rng=np.random.default_rng(req.seed)
    draws=rng.lognormal(-req.rate_spread**2/2,req.rate_spread,(req.draws,len(sites)))
    scenarios=[]
    base_econ=economics(req,base,cov) if base['feasible'] else None
    for ident,label,plan in plans:
        econ=economics(req,plan,cov) if plan['feasible'] else None
        delta=({'sponsor_expenditure':money(econ['sponsor']['expenditure']-base_econ['sponsor']['expenditure']),
            'resources':money(econ['consolidated_resource_cost']-base_econ['consolidated_resource_cost']),
            'hospital_contribution':money(econ['hospital']['net_contribution']-base_econ['hospital']['net_contribution']),
            'insurer_expenditure':money(econ['insurer']['total']-base_econ['insurer']['total']),
            'patient_exposure':money(econ['patient']['net_cash_exposure']-base_econ['patient']['net_cash_exposure'])} if econ and base_econ else None)
        extra=sorted(set(plan.get('selected_ids',[]))-set(baseline_ids))
        scenarios.append({'id':ident,'label':label,'plan':plan,'economics':econ,'delta':delta,
            'sensitivity':sensitivity(req,plan,draws,cov),
            'reinvestment':{'additional_sites':extra,'additional_activations':len(extra),'incremental_ongoing_cost':money(plan['breakdown']['operating']-base['breakdown']['operating']),
                'modeled_time_change':money(plan['modeled_months']-base['modeled_months'])} if plan['feasible'] and base['feasible'] else None})
    feasible=[s for s in scenarios if s['plan']['feasible']]
    best=min(feasible,key=lambda s:(s['plan']['modeled_months'],s['plan']['sponsor_total'],s['id'])) if feasible else None
    evidence=code_evidence()
    protocol_path=terms.PROTOCOL_DIR/f'{req.trial_id}.json'
    evidence['protocol_sha256']=hashlib.sha256(protocol_path.read_bytes()).hexdigest()
    input_hash=digest({'request':req.model_dump(mode='json'),'coverage':cov,'code':evidence['source_sha256'],'protocol':evidence['protocol_sha256']})
    p=terms.load_protocol(req.trial_id)
    result={'request':req.model_dump(mode='json'),'input_sha256':input_hash,'run_id':input_hash[:24],
        'execution_mode':'synthetic_financial_demo','trial':{'id':req.trial_id,'title':p['short_title'],'protocol_label':p['label'],
        'registry_url':f'https://clinicaltrials.gov/study/{req.trial_id}','source_type':'existing authored illustrative protocol, real public identifier'},
        'coverage':cov,'scenarios':scenarios,'recommended_scenario_id':best['id'] if best else None,'evidence':evidence,'sources':SOURCES,
        'assumptions':{'active_site_activation':'Sunk activation for baseline-active sites is excluded equally from alternatives; new-site activation included.',
            'sponsor_pilot':'Administrative budget includes a hypothetical sponsor-funded coordination pilot; reduction is an input, not measured savings.',
            'hospital_payment':'Synthetic negotiated costs for financial mechanics only; no claim of fair compensation or FMV.',
            'trial_target':'Fixed demo target within every comparison, unrelated to the registered trial enrollment target.',
            'feasibility':'Synthetic operator feasibility flag; actual site capabilities UNKNOWN.',
            'resource_costs':'Separate synthetic 80% site/70% procedure cost assumptions, never inferred hospital margins.'},
        'limitations':LIMITATIONS}
    result['result_sha256']=digest(result)
    return result


def demo():
    req=FinanceRequest()
    return {'request':req.model_dump(mode='json'),'trials':[{'id':n,'title':terms.load_protocol(n)['short_title']} for n in ('NCT05800015','NCT06627647')],
        'coverage':coverage(req),'limitations':LIMITATIONS}


@router.get('/demo')
def demo_api():
    return demo()


@router.post('/compare')
def compare_api(req:FinanceRequest):
    try:
        return compare(req)
    except ValueError as e:
        raise HTTPException(422,str(e)) from e


@router.post('/report')
def report_api(req:FinanceRequest,format:Literal['json','html']=Query('json')):
    result=compare_api(req)
    headers={'Content-Disposition':f'attachment; filename="concord-financial-{result["run_id"]}.{format}"'}
    if format=='json':
        return JSONResponse(result,headers=headers)
    e=lambda x:html.escape(str(x),quote=True)
    rows=''.join(f"<tr><td>{e(s['id'])} · {e(s['label'])}</td><td>{e(s['plan']['feasible'])}</td><td>{e(s['plan'].get('sponsor_total'))}</td><td>{e(s['plan'].get('modeled_months'))}</td><td>{e(s['economics']['consolidated_resource_cost'] if s['economics'] else 'Unavailable')}</td></tr>" for s in result['scenarios'])
    ledger_rows=''.join(f"<tr><td>{e(s['id'])}</td><td>{e(s['economics']['sponsor']['expenditure'])}</td><td>{e(s['economics']['sponsor']['contingency_reserve'])}</td><td>{e(s['economics']['hospital']['net_contribution'])}</td><td>{e(s['economics']['insurer']['total'])}</td><td>{e(s['economics']['patient']['net_cash_exposure'])}</td></tr>" for s in result['scenarios'] if s['economics'])
    coverage_rows=''.join(f"<tr><td>{e(i['id'])}: {e(i['label'])}<br>{e(i['code'])}</td><td>{e(i['status'])}<br>{e(i['review_status'])}</td><td>{e(i['sponsor_per_participant'])} / {e(i['payer_per_participant'])} / {e(i['patient_per_participant'])} / {e(i['reserve_per_participant'])}</td><td>{e(i['rate_kind'])}<br>{e(i['source'])}</td></tr>" for i in result['coverage']['items'])
    uncertainty_rows=''.join(f"<tr><td>{e(s['id'])}</td><td>{e(s['sensitivity']['modeled_months_quantiles'])}</td><td>{e(s['sensitivity']['sponsor_total_quantiles'])}</td><td>{e(s['sensitivity']['probability_budget_exceeded'])}</td></tr>" for s in result['scenarios'] if s['sensitivity'])
    body=f"""<!doctype html><html lang='en'><meta charset='utf-8'><title>Concord financial evidence</title><style>body{{font:16px/1.6 system-ui;max-width:1100px;margin:30px auto;padding:20px;color:#183047}}table{{border-collapse:collapse;width:100%}}th,td{{padding:10px;text-align:left;border-bottom:1px solid #ccd7dc}}pre,code{{white-space:pre-wrap;overflow-wrap:anywhere}}.warn{{background:#fff1d6;padding:20px}}@media print{{body{{margin:0}}}}</style>
    <h1>Concord · Financial Coordination</h1><p>{e(req.trial_id)} · Run {e(result['run_id'])}</p>
    <div class='warn'><b>SYNTHETIC FINANCIAL DEMO · decision support, no binding coverage determination.</b><ul>{''.join('<li>'+e(x)+'</li>' for x in LIMITATIONS)}</ul></div>
    <h2>Fixed sponsor budget: ${req.budget:,.2f} · assumed target {req.target}</h2><p>Budget commitment includes contingency. Modeled months use hypothetical rates, not validated trial forecasts.</p>
    <table><tr><th>Scenario</th><th>Feasible</th><th>Sponsor commitment USD</th><th>Modeled months</th><th>Resource cost USD</th></tr>{rows}</table>
    <h2>Three-party economics and participant exposure (USD)</h2><p>Payments are transfers. Resource costs are separately modeled once. Unknown downstream clinical costs and unresolved participant exposure remain UNKNOWN.</p><table><tr><th>Scenario</th><th>Sponsor cash spending</th><th>Held contingency</th><th>Hospital contribution</th><th>Conditional insurer costs</th><th>Specified participant net exposure</th></tr>{ledger_rows}</table>
    <h2>Paired assumption sensitivity</h2><p>Seed {req.seed}, {req.draws} common rate draws; log spread {req.rate_spread}. Fixed networks; no reoptimization. Ranges are q10/q50/q90, not calibrated intervals.</p><table><tr><th>Scenario</th><th>Modeled months</th><th>Sponsor commitment USD</th><th>Fraction above budget</th></tr>{uncertainty_rows}</table>
    <h2>Preliminary coverage worksheet (per participant, USD)</h2><p>Only the authored fixed visit horizon is priced. No binding determination, no claims, no double billing.</p><table><tr><th>Procedure / code</th><th>Responsibility / review</th><th>Sponsor / potential payer / potential patient / reserve</th><th>Price provenance</th></tr>{coverage_rows}</table>
    <h2>Sources</h2><ul>{''.join('<li><a href="'+e(s['url'])+'">'+e(s['title'])+'</a>: '+e(s['scope'])+'</li>' for s in SOURCES)}</ul>
    <h2>Reproducibility</h2><p>Input SHA-256: <code>{e(result['input_sha256'])}</code><br>Result SHA-256: <code>{e(result['result_sha256'])}</code><br>Code commit: {e(result['evidence']['commit'])} (dirty: {e(result['evidence']['dirty'])})</p><p>Recompute by posting the exact request in the evidence below to /api/financial/compare on this exact source revision and rate-card inputs. No database or model inference is required.</p>
    <details><summary>Full evidence: assumptions, per-site allocation, ledger and paired sensitivity</summary><pre>{e(json.dumps(result,indent=2,ensure_ascii=False))}</pre></details></html>"""
    return HTMLResponse(body,headers=headers)


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request',type=Path,help='Exact previously exported request JSON')
    parser.add_argument('--output',type=Path,default=ROOT/'data/work/financial')
    args=parser.parse_args()
    request=FinanceRequest.model_validate_json(args.request.read_text()) if args.request else FinanceRequest()
    args.output.mkdir(parents=True,exist_ok=True)
    for fmt in ('json','html'):
        response=report_api(request,fmt)
        (args.output/f'evidence.{fmt}').write_bytes(response.body)
    (args.output/'request.json').write_text(json.dumps(request.model_dump(mode='json'),indent=2))
    print(json.dumps({'output':str(args.output),'mode':'synthetic_financial_demo','input_sha256':compare(request)['input_sha256']}))
