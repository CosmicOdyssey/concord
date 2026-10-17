"""Sponsor-budget comparison on authored protocols; never a claim, coverage approval or timeline.

Five scenarios are compared at a fixed participant target over a budgeted contract period.
They are listed, not ranked. In this worksheet payer assumptions (payer type, payer share, the
commercial-rate assumption) change only the insurer and participant lines; a line moves onto the sponsor
through coverage review or a contract term, and off it only when coverage analysis finds it billable
routine care, never through the insurer's payment amount.
"""
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
from concord.financial_allocation import capacity_network, evaluate_plan

router = APIRouter(prefix="/api/financial", tags=["financial coordination"])
SOURCES = [
    {"id":"medicare-310.1","url":"https://www.cms.gov/files/document/r12590ncd.pdf","title":"CMS NCD 310.1, current manual revision 12590 (2024)","kind":"verified_policy_reference","checked":"2026-10-17","scope":"Which routine costs in qualifying trials Medicare covers; excludes sponsor-free and research-only items. Administration may qualify depending on circumstances; R1 is a conservative sponsor agreement assumption, not an NCD prohibition."},
    {"id":"medicaid","url":"https://www.medicaid.gov/federal-policy-guidance/downloads/smd21005.pdf","title":"CMS SMD 21-005: routine patient costs in qualifying clinical trials","kind":"verified_policy_reference","checked":"2026-10-17","scope":"Federal qualifying-trial benefit; state, beneficiary, service and plan implementation require review."},
    {"id":"commercial","url":"https://www.cancer.gov/research/participate/clinical-trials/paying","title":"NCI: insurance coverage for clinical trials","kind":"policy_reference","checked":"2026-10-17","scope":"Plan and network requirements apply. No commercial allowed amount is inferred without an explicit assumption."},
]

# Payer framing (product owner ruling, 17 Oct): payer amounts are benchmarks and negotiation inputs;
# who is billed follows the protocol, coverage rules and the site contract; an insurer's payment amount
# is not a lever over the sponsor commitment.
PAYER_BENCHMARKS = ("Medicare and insurer amounts for routine care are benchmarks: they inform fair-market-value "
                    "reasoning and are inputs to the sponsor's budget negotiation with each site or hospital.")
PAYER_BILLING = ("Whether an item may be billed to an insurer follows the protocol and coverage rules (for "
                 "Medicare, NCD 310.1 routine costs in qualifying trials): research-only items are the sponsor's "
                 "and are never billed to an insurer or participant. The site contract can still have the sponsor "
                 "pay for a routine item (mark it SPONSOR here), and an item the sponsor pays for or supplies free "
                 "is then not billed to the insurer. Insurer payment amounts are not a lever over who is billed.")
PAYER_INDEPENDENCE = ("In this worksheet, payer type, payer share and the commercial-rate assumption change only the "
                      "insurer and participant lines; the sponsor commitment does not fall because an insurer pays "
                      "more for routine care. A line moves onto the sponsor through coverage review or a contract term "
                      "(for example, the site contract has the sponsor pay for a routine item), and off the sponsor "
                      "only when coverage analysis finds it is billable routine care that the contract and consent "
                      "form do not promise to provide free; never through the insurer's payment amount. Payer and "
                      "Medicare amounts can still inform the rate negotiated for research items (benchmark x the "
                      "sponsor-site negotiated rate).")
ACCESS_SUPPORT = ("Access support reimburses trial-related travel and lodging; it is not netted against, and does not "
                  "pay, insurer cost sharing. Whether a sponsor may cover a beneficiary's cost sharing is a separate "
                  "compliance question this worksheet does not model.")
NOT_A_BILLING_REVIEW = ("Each worksheet line is assigned to one party (sponsor, insurer, participant or sponsor "
                        "contingency). That is not a billing-compliance review and does not establish that no item "
                        "is billed twice. Site per-participant costs must exclude every itemized worksheet procedure, "
                        "or that procedure is counted twice.")
# The one sentence allowed to name the time quantities this tab does not produce.
NO_TIME_MODEL = ("Nothing here models negotiation length, enrollment speed, time to fill sites or trial duration, "
                 "and no scenario is ranked or recommended; the budgeted contract period is an input that "
                 "prices monthly site costs.")
LIMITATIONS = [
    "Synthetic financial demonstration: all candidate sites, capacities, costs, margins and payer shares are hypothetical, not registered site facts or negotiated prices.",
    "The real trial identifier links an existing illustrative authored schedule; the registry does not publish the complete protocol. This is not a sponsor-approved protocol budget.",
    PAYER_BENCHMARKS,
    PAYER_BILLING,
    PAYER_INDEPENDENCE,
    NO_TIME_MODEL,
    "Routine coverage is potential, subject to qualifying-trial, beneficiary, jurisdiction, plan, network and service review. No insurer participates or commits funding.",
    "Unknown responsibility is held as sponsor contingency, not billed to insurers or participants. Unresolved patient exposure is unknown, not evidence of zero liability.",
    "Only the authored non-repeating visits (screening, cycles 1-8, end of treatment, safety follow-up) are priced. Actual drug acquisition/manufacturing, later treatment, complications and downstream outcomes are unknown; the drug contingency is an assumption, not a complete trial cost.",
    ACCESS_SUPPORT,
    NOT_A_BILLING_REVIEW,
    "Participants are split across selected sites in proportion to stated capacity, an operator input; when an existing network that lacks capacity is extended, existing sites are filled to their stated capacity first and only the shortfall goes to added sites. It is not a measured or predicted enrollment.",
    "Sensitivity varies only site cost inputs (seeded lognormal spread); the ranges are not calibrated intervals.",
    "Sponsor-to-hospital payments are transfers. Consolidated resource costs use separate explicit cost assumptions; a lower sponsor payment is not automatically a system or payer saving.",
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


# Statuses an operator may give a line. Research items (authored SPONSOR) and the investigational-supply
# reserve stay on the sponsor side: never billed to an insurer or participant (coverage rules).
ALL_STATUSES = [str(r) for r in Responsibility]
SPONSOR_SIDE_STATUSES = [str(r) for r in (Responsibility.SPONSOR, Responsibility.CONDITIONAL, Responsibility.UNKNOWN,
                                          Responsibility.REVIEW)]
CLFS_MEDICARE = ("; Medicare pays clinical diagnostic lab tests at 100% of the CLFS amount (no Part B deductible or "
                 "coinsurance), so the participant share is 0")


class Site(Strict):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")
    name: str = Field(min_length=1, max_length=120)
    baseline_active: bool = False
    feasible: bool = True
    activation_cost: float = Field(30000, ge=0, le=1e7)
    monthly_cost: float = Field(1000, ge=0, le=1e6)
    per_participant_cost: float = Field(2000, ge=0, le=1e6, description="Site per-participant costs NOT itemized in the coverage worksheet (e.g. coordinator time, data entry); must exclude every worksheet procedure")
    capacity: int = Field(60, ge=1, le=10000, description="Stated participant capacity (operator input, not a forecast)")


def default_sites():
    return [Site(id="SYN-A",name="Synthetic site A",baseline_active=True),
            Site(id="SYN-B",name="Synthetic site B",baseline_active=True,monthly_cost=1200),
            Site(id="SYN-C",name="Synthetic site C",activation_cost=35000,monthly_cost=1600,per_participant_cost=2400),
            Site(id="SYN-D",name="Synthetic site D",activation_cost=50000,monthly_cost=2200,per_participant_cost=2800)]


class FinanceRequest(Strict):
    trial_id: Literal["NCT05800015","NCT06627647"] = "NCT05800015"
    budget: float = Field(1500000, gt=0, le=1e9)
    target: int = Field(60, ge=1, le=1000)
    budget_period_months: float = Field(24, gt=0, le=60, description="Budgeted contract period: monthly site costs are priced over it. An input, not a forecast.")
    admin_cost: float = Field(120000, ge=0, le=1e8)
    admin_reduction: float = Field(.25, ge=0, le=1, description="Scenario B's assumed fractional cut in sponsor administration; not measured savings")
    support_per_participant: float = Field(500, ge=0, le=100000)
    minimum_support: float = Field(200, ge=0, le=100000)
    extra_support: float = Field(300, ge=0, le=100000)
    seed: int = Field(7, ge=0, le=2**32-1)
    draws: int = Field(256, ge=100, le=1000)
    cost_spread: float = Field(.25, ge=0, le=1, description="Log-scale spread of the mean-one lognormal multipliers on site activation, monthly and per-participant costs")
    payer_kind: Literal["Medicare","commercial","Medicaid"] = "Medicare"
    jurisdiction: str = Field("MA",min_length=2,max_length=80)
    payer_plan: str = Field("UNVERIFIED DEMO",min_length=1,max_length=120)
    payer_fraction: float = Field(.8,ge=0,le=1,description="Insurer share of the routine-care benchmark (Medicare, assumed commercial); not applied to Medicaid, whose enrollee cost sharing is shown as 0, nor to Medicare clinical diagnostic lab tests (CLFS), paid at 100%")
    commercial_rate_assumption: bool = False
    sponsor_rate_multiplier: float = Field(1, ge=.1, le=5, description="Sponsor-site negotiated rate for research items as a multiple of the fee-schedule benchmark")
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


def maybe_money(x):
    return None if x is None else money(x)


def coverage(req: FinanceRequest):
    terms.medicare._cms.cache_clear()  # refresh fee inputs for each financial request
    p = terms.load_protocol(req.trial_id)
    procs = {x['id']:x for x in p['procedures']}
    cov = terms._coverage(p,{})  # reuse existing authored rules, qualify their financial interpretation below
    std = terms.standard_schedule()
    unknown_ids = set(req.coverage_overrides)-{n['id'] for n in p['nodes']}-{'drug-contingency'}
    if unknown_ids:
        raise ValueError("Unknown coverage node IDs")
    insurer_amount_assumed = req.payer_kind!='commercial' or req.commercial_rate_assumption
    items=[]
    for node in p['nodes']:
        # Price the authored non-repeating visits only: screening, C1-8, end/safety follow-up.
        visit=next(v for v in p['visits'] if v['id']==node['visit'])
        if visit['kind']=='repeat':
            continue
        proc=procs[node['procedure']]
        default = Responsibility.SPONSOR if cov[node['id']]['coverage']=='research' else Responsibility.PAYER
        status=req.coverage_overrides.get(node['id'],default)
        if default==Responsibility.SPONSOR and status in (Responsibility.PAYER,Responsibility.PATIENT):
            raise ValueError("Authored research services cannot be shifted to insurers or participants by this worksheet")
        price=terms._price_code(proc['code'],None) if proc.get('code') else None
        clfs=False
        if price and price.get('amount') is not None:
            benchmark=float(price['amount'])
            verified=not price.get('placeholder',True)
            source=price.get('source') or 'Existing Concord ratecard fallback'
            clfs=price.get('schedule')=='CLFS'
        else:
            pricing=proc.get('pricing','')
            benchmark=float(std.get(pricing.removeprefix('standard:'),{}).get('amount') or 75)
            verified=False
            source=terms.STANDARD_SOURCE if pricing.startswith('standard:') else 'Synthetic $75 unpriced-line assumption'
        # The benchmark informs the sponsor-site negotiated rate (FMV reasoning); the insurer pays its own amount.
        sponsor_rate=benchmark*req.sponsor_rate_multiplier
        sponsor=reserve=0.
        payer=patient=0.
        reason='Operator-selected interpretation' if node['id'] in req.coverage_overrides else 'Preliminary authored rule '+node['rule']
        if status==Responsibility.SPONSOR:
            sponsor=sponsor_rate
            reason+='; research item paid by the sponsor at the negotiated rate (benchmark x sponsor rate multiplier)'
        elif status==Responsibility.PAYER and insurer_amount_assumed and req.payer_kind=='Medicaid':
            payer,patient=money(benchmark),0.
            reason+=('; routine care billed per coverage rules; illustrative Medicaid payment at the benchmark; enrollee '
                     'cost sharing shown as 0 (nominal or zero for many services, 42 CFR 447.50-447.57)')
        elif status==Responsibility.PAYER and req.payer_kind=='Medicare' and clfs:
            # SSA 1833(a)(1)(D) and (b)(3): no Part B deductible or coinsurance on CLFS clinical lab tests.
            payer,patient=money(benchmark),0.
            reason+='; routine care billed per coverage rules'+CLFS_MEDICARE
        elif status==Responsibility.PAYER and insurer_amount_assumed:
            payer=money(benchmark*req.payer_fraction)
            patient=money(benchmark-payer)
            reason+='; routine care billed per coverage rules; illustrative insurer/participant split of the benchmark at the stated payer share'
        elif status==Responsibility.PAYER:
            payer=patient=None
            reason+='; routine care billed per plan coverage rules; commercial allowed amount UNKNOWN (no assumption set); not moved to the sponsor'
        elif status==Responsibility.PATIENT:
            patient=benchmark
            reason+='; hypothetical exposure only, beneficiary agreement and plan review required'
            if req.payer_kind=='Medicaid':
                reason+='; Medicaid limits what an enrollee may be billed (42 CFR 447.50-447.57)'
        else:
            reserve=sponsor_rate
            reason+='; unresolved; held as sponsor contingency at the negotiated rate without assigning a bill'
        items.append({'id':node['id'],'label':proc['label'],'code':proc.get('code'),'trial_id':req.trial_id,
            'protocol_reference':f"compiler/protocols/{req.trial_id}.json",'quantity':1,'frequency':visit['label'],
            'schedule':visit.get('window'),'unit_rate':money(benchmark),'sponsor_unit_rate':money(sponsor_rate),
            'rate_kind':'verified_fee_schedule_benchmark' if verified else 'hypothetical_rate',
            'source':source,'year':2026,'status':str(status),'coverage_determination_status':'NOT_DETERMINED',
            'review_status':'operator_interpretation' if node['id'] in req.coverage_overrides else 'REVIEW_REQUIRED',
            'explanation':reason,'sponsor_per_participant':money(sponsor),'payer_per_participant':maybe_money(payer),
            'patient_per_participant':maybe_money(patient),'reserve_per_participant':money(reserve),
            'insurer_amount_known':payer is not None,
            'allowed_statuses':SPONSOR_SIDE_STATUSES if default==Responsibility.SPONSOR else ALL_STATUSES,
            'resource_cost_per_participant':money(benchmark*.7),'resource_cost_kind':'explicit_synthetic_70_percent_of_benchmark',
            'jurisdiction':req.jurisdiction,'payer_plan':req.payer_plan})
    if set(req.coverage_overrides)-{i['id'] for i in items}-{'drug-contingency'}:
        raise ValueError('Coverage edit is outside the explicitly priced visits')
    # Nonzero reserve avoids silently treating sponsor-supplied investigational products as free resources.
    status=req.coverage_overrides.get('drug-contingency',Responsibility.UNKNOWN)
    if status not in (Responsibility.UNKNOWN,Responsibility.REVIEW,Responsibility.CONDITIONAL,Responsibility.SPONSOR):
        raise ValueError("Investigational supply contingency cannot be assigned to insurers or participants")
    drug=req.drug_contingency_per_participant
    items.append({'id':'drug-contingency','label':'Investigational supply: hypothetical reserve; acquisition cost UNKNOWN',
        'code':None,'trial_id':req.trial_id,'protocol_reference':f"compiler/protocols/{req.trial_id}.json",'quantity':1,
        'frequency':'Per participant within the priced visits','schedule':'Fixed demo schedule','unit_rate':drug,'sponsor_unit_rate':drug,
        'rate_kind':'synthetic_contingency','source':'Operator contingency assumption, not a drug price','year':2026,
        'status':str(status),'coverage_determination_status':'UNKNOWN','review_status':'REVIEW_REQUIRED',
        'explanation':'Actual manufacturing/acquisition cost unknown; the sponsor supplies the investigational product, so this is a sponsor-side supply proxy (site handling is priced as its own line), assumed consumed. Not a complete supply budget.',
        'sponsor_per_participant':drug if status==Responsibility.SPONSOR else 0.,'payer_per_participant':0.,
        'patient_per_participant':0.,'reserve_per_participant':0. if status==Responsibility.SPONSOR else drug,
        'insurer_amount_known':True,'allowed_statuses':SPONSOR_SIDE_STATUSES,
        'resource_cost_per_participant':drug,'resource_cost_kind':'synthetic_proxy_for_unknown_supply_cost',
        'jurisdiction':req.jurisdiction,'payer_plan':req.payer_plan})

    def total(field):
        values=[i[field] for i in items]
        return None if any(v is None for v in values) else money(sum(values))
    totals={k:total(field) for k,field in [('sponsor','sponsor_per_participant'),('payer','payer_per_participant'),('patient','patient_per_participant'),('reserve','reserve_per_participant'),('resource','resource_cost_per_participant')]}
    if req.payer_kind=='commercial':
        payer_note=('Commercial allowed amounts are assumed equal to the Medicare benchmark, for illustration only.' if req.commercial_rate_assumption
                    else 'Commercial allowed amounts are UNKNOWN (no assumption set): routine lines show no insurer or participant amount and are not moved to the sponsor.')
    elif req.payer_kind=='Medicaid':
        payer_note=('Medicaid amounts use the Medicare benchmark as a stand-in; state rates and qualifying-trial, service and beneficiary eligibility remain unverified. '
                    'Medicaid enrollee cost sharing is nominal or zero for many services (42 CFR 447.50-447.57); the participant share is shown as 0 and payer_fraction is not applied.')
    else:
        payer_note=('Medicare qualifying-trial, service and beneficiary eligibility remain unverified. Clinical diagnostic lab '
                    'tests priced from the CLFS are paid at 100% with no participant share; the payer share applies to the other routine lines.')
    return {'items':items,'totals':totals,'insurer_amounts_unknown':sum(1 for i in items if not i['insurer_amount_known']),
        'warnings':['Every coverage determination and price requires review. Insurer and participant figures are illustrative splits, not approvals.',
                    payer_note, PAYER_INDEPENDENCE]}


def economics(req, plan, cov):
    if not plan['costed']:
        return None
    n=req.target
    b=plan['breakdown']
    drug=next(i for i in cov['items'] if i['id']=='drug-contingency')
    reserve=money(cov['totals']['reserve']*n)
    support=b['support']
    # The sponsor supplies the investigational product: neither its reserve nor a sponsor-paid supply amount
    # is a payment to the hospital or a hospital resource cost (site handling is its own worksheet line).
    supply_paid=money(drug['sponsor_per_participant']*n)
    supply=money(drug['resource_cost_per_participant']*n)
    research=money(plan['sponsor_total']-reserve-support-b['administration']-supply_paid)
    payer=maybe_money(None if cov['totals']['payer'] is None else cov['totals']['payer']*n)
    patient=maybe_money(None if cov['totals']['patient'] is None else cov['totals']['patient']*n)
    hospital_revenue=None if payer is None or patient is None else money(research+payer+patient)
    resources=money(.8*(b['activation']+b['operating']+b['site_variable'])+(cov['totals']['resource']-drug['resource_cost_per_participant'])*n)
    admin=money(req.payer_admin_per_participant*n)
    transfers=[{'from':'Sponsor','to':'Hospital','amount':research},
               {'from':'Sponsor','to':'Participant','amount':support},
               {'from':'Insurer','to':'Hospital','amount':payer},
               {'from':'Participant','to':'Hospital','amount':patient}]
    balances={k:0. for k in ('Sponsor','Hospital','Insurer','Participant')}
    for t in transfers:
        if t['amount'] is not None:  # an UNKNOWN amount is reported, never guessed
            balances[t['from']]-=t['amount'];balances[t['to']]+=t['amount']
    return {'sponsor':{'expenditure':money(plan['sponsor_total']-reserve),'contingency_reserve':reserve,'budget_commitment':plan['sponsor_total'],
            'supply_resource_proxy':supply},
        'hospital':{'revenue':hospital_revenue,'resource_cost':resources,'net_contribution':None if hospital_revenue is None else money(hospital_revenue-resources)},
        'insurer':{'payments':payer,'administration':admin,'total':None if payer is None else money(payer+admin),'downstream_clinical_cost':None},
        'patient':{'cost_sharing':patient,'access_support':support,'unresolved_exposure':None},
        'transfers':transfers,'party_transfer_balances':{k:money(v) for k,v in balances.items()},'transfer_balance':money(sum(balances.values())),
        'consolidated_resource_cost':money(resources+supply+b['administration']+admin+support),
        'resource_assumptions':['Hospital site operating/activation and non-procedure variable resource costs = 80% of corresponding negotiated-payment assumptions.',
            "Procedure delivery resource costs = 70% of benchmark, regardless of payer or negotiated rate. The investigational-supply reserve is a sponsor-side supply proxy (the sponsor supplies the product; site handling is its own line), so it is outside the hospital's revenue and resource cost.",
            'Sponsor and insurer administration treated as resource consumption. Access support assumed fully consumed on trial-related travel and lodging; it is not netted against participant cost sharing.',
            'Money transfers are excluded from consolidated resource sum. No external-care/downstream resource cost known. UNKNOWN insurer or participant amounts are left out of transfer balances, not set to zero.']}


def delta(econ, base_econ):
    if not econ or not base_econ:
        return None
    def d(a,b):
        return None if a is None or b is None else money(a-b)
    return {'sponsor_expenditure':d(econ['sponsor']['expenditure'],base_econ['sponsor']['expenditure']),
        'resources':d(econ['consolidated_resource_cost'],base_econ['consolidated_resource_cost']),
        'hospital_contribution':d(econ['hospital']['net_contribution'],base_econ['hospital']['net_contribution']),
        'insurer_expenditure':d(econ['insurer']['total'],base_econ['insurer']['total']),
        'patient_cost_sharing':d(econ['patient']['cost_sharing'],base_econ['patient']['cost_sharing']),
        'access_support':d(econ['patient']['access_support'],base_econ['patient']['access_support'])}


def budget_reallocation(plan, base, baseline_ids):
    if not plan['costed']:
        return None
    added=sorted(set(plan['selected_ids'])-set(baseline_ids))
    rows=[r for r in plan['site_rows'] if r['id'] in added]
    comparable=base['costed']
    # Defined even when A cannot be costed, so a capacity extension always shows what the added sites cost.
    site_cost={k:money(sum(r[f] for r in rows)) for k,f in (('activation','activation'),('operating','operating'),('site_variable','variable'))}
    return {'additional_sites':added,'additional_activations':len(added),
        'added_sites_cost':{**site_cost,'site_total':money(sum(site_cost.values())),'participants':sum(r['participants'] for r in rows)},
        'line_changes':{k:money(v-base['breakdown'][k]) for k,v in plan['breakdown'].items()} if comparable else None,
        'incremental_cost':money(plan['sponsor_total']-base['sponsor_total']) if comparable else None}


VARIED_COSTS = ('activation', 'monthly', 'per_participant')


def cost_draws(req):
    """Mean-one lognormal multipliers, one matrix per varied cost input, columns in request site order."""
    rng=np.random.default_rng(req.seed)
    s=req.cost_spread
    return {k:rng.lognormal(-s*s/2,s,(req.draws,len(req.sites))) for k in VARIED_COSTS}


def sensitivity(req, plan, draws):
    if not plan['costed']:
        return None
    index={s.id:i for i,s in enumerate(req.sites)}
    rows=plan['site_rows']
    cols=[index[r['id']] for r in rows]
    # Same multipliers for a site in every scenario; fixed network and participant split; no reselection.
    lines={'activation':np.array([r['activation'] for r in rows]),  # zero for sunk baseline activation
           'monthly':np.array([r['operating'] for r in rows]),
           'per_participant':np.array([r['variable'] for r in rows])}
    shift=sum((draws[k][:,cols]-1)@lines[k] for k in VARIED_COSTS)
    totals=plan['sponsor_total']+shift
    return {'sponsor_total_quantiles':[money(x) for x in np.quantile(totals,[.1,.5,.9])],
        'probability_budget_exceeded':float(np.mean(totals>req.budget+.005)),
        'seed':req.seed,'draws':req.draws,'cost_spread':req.cost_spread,
        'varied_inputs':['site activation cost (added sites; baseline activation is sunk)','site monthly cost','site per-participant cost'],
        'method':'Paired independent mean-one lognormal multipliers on each site\'s activation, monthly and per-participant costs; the same draws for every scenario; fixed networks and participant split; not calibrated intervals',
        'calibration_status':'not_established'}


def code_evidence():
    try:
        commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
    except (OSError,subprocess.CalledProcessError):
        commit=None;dirty=None
    paths=[Path(__file__),Path(__file__).with_name('financial_allocation.py'),Path(terms.__file__),Path(terms.medicare.__file__)]
    return {'commit':commit,'dirty':dirty,'source_sha256':digest({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}),
        'ratecard_sha256':hashlib.sha256((terms.medicare.DATA_DIR/'ratecard.json').read_bytes()).hexdigest() if (terms.medicare.DATA_DIR/'ratecard.json').exists() else None,
        'protocol_sha256':None,'financial_input_kind':'synthetic','historical_evaluation':'not_executed; later registry records not used as historical predictions',
        'cache_policy':'No mutable scenario cache; every request fully recomputed from all validated inputs',
        'currency':'USD','consolidation_boundary':'Modeled study services, administration, access and assumed supply resource proxy only'}


def compare(req: FinanceRequest):
    cov=coverage(req)
    sites=[s.model_dump() for s in req.sites]
    baseline_ids=[s.id for s in req.sites if s.baseline_active]
    reduced_admin=money(req.admin_cost*(1-req.admin_reduction))
    more_support=req.support_per_participant+req.extra_support
    kw={'sites':sites,'target':req.target,'budget_period_months':req.budget_period_months,'budget':req.budget,
        'procedure_per_participant':cov['totals']['sponsor']+cov['totals']['reserve'],
        'admin_cost':req.admin_cost,'support_per_participant':req.support_per_participant,'minimum_support':req.minimum_support}
    existing=lambda **o: evaluate_plan(selected_ids=baseline_ids,**{**kw,**o})
    by_capacity=lambda **o: capacity_network(base_ids=baseline_ids,**{**kw,**o})
    specs=[
        ('A','Existing site network','existing_network',req.admin_cost,req.support_per_participant,
         'Baseline-active sites as entered, with the entered administrative cost and participant support.',existing),
        ('B','Lower sponsor administrative cost','existing_network',reduced_admin,req.support_per_participant,
         'A with sponsor administration cut by the admin_reduction input. An assumption, not measured savings.',existing),
        ('C','Site network with enough stated capacity','capacity_rule',req.admin_cost,req.support_per_participant,
         'The existing network if its stated capacity covers the target; otherwise the capacity-sufficient network of existing plus operator-feasible sites with the lowest sponsor commitment. Identical to A when A has enough capacity.',by_capacity),
        ('D','Expanded participant access support','existing_network',req.admin_cost,more_support,
         'A with participant support raised by extra_support per participant.',existing),
        ('E','B + C + D combined','capacity_rule',reduced_admin,more_support,
         "B's administrative cost, C's network rule and D's participant support together.",by_capacity)]
    draws=cost_draws(req)
    scenarios=[]
    base=base_econ=None
    for ident,label,rule,admin,support,definition,build in specs:
        plan=build(admin_cost=admin,support_per_participant=support)
        plan.setdefault('network_search',None)
        econ=economics(req,plan,cov)
        if ident=='A':
            base,base_econ=plan,econ
        scenarios.append({'id':ident,'label':label,'definition':definition,
            'inputs':{'network_rule':rule,'admin_cost':admin,'support_per_participant':support},
            'plan':plan,'economics':econ,'delta':delta(econ,base_econ),
            'sensitivity':sensitivity(req,plan,draws),
            'budget_reallocation':budget_reallocation(plan,base,baseline_ids)})
    evidence=code_evidence()
    protocol_path=terms.PROTOCOL_DIR/f'{req.trial_id}.json'
    evidence['protocol_sha256']=hashlib.sha256(protocol_path.read_bytes()).hexdigest()
    input_hash=digest({'request':req.model_dump(mode='json'),'coverage':cov,'code':evidence['source_sha256'],'protocol':evidence['protocol_sha256']})
    p=terms.load_protocol(req.trial_id)
    result={'request':req.model_dump(mode='json'),'input_sha256':input_hash,'run_id':input_hash[:24],
        'execution_mode':'synthetic_financial_demo','trial':{'id':req.trial_id,'title':p['short_title'],'protocol_label':p['label'],
        'registry_url':f'https://clinicaltrials.gov/study/{req.trial_id}','source_type':'existing authored illustrative protocol, real public identifier'},
        'coverage':cov,'scenarios':scenarios,
        'comparison':{'reference_scenario_id':'A','ordering':'Scenarios are listed A to E and are not ranked; none is preferred.',
            'basis':'Same participant target, budget and budgeted contract period in every scenario; only the inputs listed per scenario differ.'},
        'evidence':evidence,'sources':SOURCES,
        'assumptions':{'active_site_activation':'Sunk activation for baseline-active sites is excluded equally from alternatives; activation for added sites is included.',
            'sponsor_administration':'Sponsor administration is an operator input (for example study management, CRO and coordination costs). Scenario B applies the admin_reduction input to it as an assumption; no source of the reduction is modeled and no saving is claimed.',
            'contract_period':'The budgeted contract period is an operator input: each selected site\'s monthly cost is multiplied by it. It is not a forecast of how long the trial runs.',
            'participant_split':'Participants are split across selected sites in proportion to stated capacity (largest-remainder rounding, ties by site id). When C or E extends an existing network that lacks capacity, existing sites are filled to their stated capacity first and only the shortfall is split across added sites by capacity (plan.participant_split names the rule used). Capacity is an operator input.',
            'site_per_participant_cost':'Site per-participant cost covers only site costs not itemized in the coverage worksheet (for example coordinator time and data entry); it must exclude every worksheet procedure, or that procedure is counted twice.',
            'access_support':ACCESS_SUPPORT,
            'feasibility':'Feasible = stated capacity covers the target, sponsor commitment within budget, every selected site operator-flagged feasible, support at or above the floor. Actual site capabilities UNKNOWN.',
            'hospital_payment':'Synthetic negotiated site costs for financial mechanics only; no claim of fair compensation or FMV.',
            'fee_benchmarks':'Fee-schedule amounts are benchmarks. Research items the sponsor pays, and held contingency, are priced at benchmark x sponsor_rate_multiplier, an explicit stand-in for the rate negotiated with the site. Insurer and participant routine amounts use the benchmark, or are UNKNOWN for a commercial plan without the commercial-rate assumption.',
            'payer_benchmarks':PAYER_BENCHMARKS,'payer_billing':PAYER_BILLING,'payer_independence':PAYER_INDEPENDENCE,
            'trial_target':'Fixed demo target within every comparison, unrelated to the registered trial enrollment target.',
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


def usd(x):
    return 'UNKNOWN' if x is None else f'${x:,.2f}'


def signed_usd(x):
    return 'n/a' if x is None else ('+' if x > 0 else '−' if x < 0 else '±') + f'${abs(x):,.2f}'


def report_html(req: FinanceRequest, result: dict) -> str:
    e=lambda x:html.escape(str(x),quote=True)
    scenarios=result['scenarios']
    def state(plan):
        return 'Yes' if plan['feasible'] else 'No: '+'; '.join(plan['violations'])
    def change(s):
        realloc=s['budget_reallocation']
        return signed_usd(realloc['incremental_cost'] if realloc else None)
    def added(s):
        realloc=s['budget_reallocation']
        if not realloc:
            return 'n/a'
        if not realloc['additional_sites']:
            return 'None'
        cost=realloc['added_sites_cost']
        return f"{', '.join(realloc['additional_sites'])}: {cost['participants']} participants, site costs {usd(cost['site_total'])}"
    rows=''.join(f"<tr><td><b>{e(s['id'])} · {e(s['label'])}</b><br><small>{e(s['definition'])}</small></td><td>{e(', '.join(s['plan']['selected_ids']))}</td><td>{e(s['plan']['stated_capacity'])}</td><td>{e(state(s['plan']))}</td><td>{e(usd(s['plan']['sponsor_total']))}</td><td>{e(change(s))}</td><td>{e(added(s))}</td><td>{e(usd(s['plan']['unspent_budget']))}</td></tr>" for s in scenarios)
    lines=('activation','operating','site_variable','procedures','support','administration')
    line_rows=''.join(f"<tr><td>{e(s['id'])}</td>{''.join('<td>'+e(usd(s['plan']['breakdown'][k]))+'</td>' for k in lines)}<td>{e(usd(s['plan']['sponsor_total']))}</td></tr>" for s in scenarios if s['plan']['costed'])
    ledger_rows=''.join(f"<tr><td>{e(s['id'])}</td><td>{e(usd(s['economics']['sponsor']['expenditure']))}</td><td>{e(usd(s['economics']['sponsor']['contingency_reserve']))}</td><td>{e(usd(s['economics']['hospital']['net_contribution']))}</td><td>{e(usd(s['economics']['insurer']['total']))}</td><td>{e(usd(s['economics']['patient']['cost_sharing']))}</td><td>{e(usd(s['economics']['patient']['access_support']))}</td></tr>" for s in scenarios if s['economics'])
    coverage_rows=''.join(f"<tr><td>{e(i['id'])}: {e(i['label'])}<br>{e(i['code'])}</td><td>{e(i['status'])}<br>{e(i['review_status'])}</td><td>{e(usd(i['unit_rate']))} / {e(usd(i['sponsor_unit_rate']))}</td><td>{e(usd(i['sponsor_per_participant']))} / {e(usd(i['payer_per_participant']))} / {e(usd(i['patient_per_participant']))} / {e(usd(i['reserve_per_participant']))}</td><td>{e(i['rate_kind'])}<br>{e(i['source'])}</td></tr>" for i in result['coverage']['items'])
    uncertainty_rows=''.join(f"<tr><td>{e(s['id'])}</td><td>{e(' / '.join(usd(q) for q in s['sensitivity']['sponsor_total_quantiles']))}</td><td>{e(s['sensitivity']['probability_budget_exceeded'])}</td></tr>" for s in scenarios if s['sensitivity'])
    return f"""<!doctype html><html lang='en'><meta charset='utf-8'><title>Concord financial evidence</title><style>body{{font:16px/1.6 system-ui;max-width:1100px;margin:30px auto;padding:20px;color:#183047}}table{{border-collapse:collapse;width:100%}}th,td{{padding:10px;text-align:left;border-bottom:1px solid #ccd7dc;vertical-align:top}}pre,code{{white-space:pre-wrap;overflow-wrap:anywhere}}.warn{{background:#fff1d6;padding:20px}}@media print{{body{{margin:0}}}}</style>
    <h1>Concord · Financial Coordination</h1><p>{e(req.trial_id)} · Run {e(result['run_id'])}</p>
    <div class='warn'><b>SYNTHETIC FINANCIAL DEMO · sponsor-budget arithmetic, no binding coverage determination.</b><ul>{''.join('<li>'+e(x)+'</li>' for x in LIMITATIONS)}</ul></div>
    <h2>Sponsor budget comparison</h2><p>Fixed sponsor budget {e(usd(req.budget))} · participant target {e(req.target)} · budgeted contract period of {e(f'{req.budget_period_months:g}')} months. {e(result['comparison']['ordering'])} Commitments include held contingency. Changes are against scenario A.</p>
    <table><tr><th>Scenario</th><th>Sites</th><th>Stated capacity</th><th>Feasible</th><th>Sponsor commitment</th><th>Change vs A</th><th>Added sites</th><th>Unspent budget</th></tr>{rows}</table>
    <h3>Budget lines (USD)</h3><p>Operating = each site's monthly cost x the budgeted contract period. Site per-participant costs are only those not itemized in the coverage worksheet. Procedures include held contingency. Baseline-site activation is sunk.</p><table><tr><th>Scenario</th><th>Activation</th><th>Operating</th><th>Site per-participant (not itemized)</th><th>Procedures and contingency</th><th>Participant support</th><th>Administration</th><th>Total</th></tr>{line_rows}</table>
    <h2>Three-party economics</h2><p>Payments are transfers. Resource costs are separately modeled once. The investigational-supply reserve is a sponsor-side supply proxy, outside the hospital's revenue and costs. {e(ACCESS_SUPPORT)} Unknown downstream clinical costs, unresolved participant exposure and any insurer amount not assumed remain UNKNOWN.</p><table><tr><th>Scenario</th><th>Sponsor cash spending</th><th>Held contingency</th><th>Hospital revenue minus assumed cost</th><th>Conditional insurer costs</th><th>Participant routine cost sharing (illustrative)</th><th>Sponsor access support</th></tr>{ledger_rows}</table>
    <h2>Cost-input sensitivity</h2><p>Seed {e(req.seed)}, {e(req.draws)} paired draws; log spread {e(req.cost_spread)} on site activation, monthly and per-participant costs. Fixed networks and participant split. Ranges are q10 / q50 / q90, not calibrated intervals.</p><table><tr><th>Scenario</th><th>Sponsor commitment q10 / q50 / q90</th><th>Share of draws over budget</th></tr>{uncertainty_rows}</table>
    <h2>Preliminary coverage worksheet (per participant)</h2><p>{e(PAYER_BENCHMARKS)} {e(PAYER_BILLING)} {e(PAYER_INDEPENDENCE)}</p><p>Only the authored non-repeating visits are priced. No binding coverage determination and no claims. {e(NOT_A_BILLING_REVIEW)}</p><table><tr><th>Procedure / code</th><th>Responsibility / review</th><th>Benchmark / sponsor negotiated rate</th><th>Sponsor / potential insurer / potential participant / reserve</th><th>Price provenance</th></tr>{coverage_rows}</table>
    <h2>Sources</h2><ul>{''.join('<li><a href="'+e(s['url'])+'">'+e(s['title'])+'</a>: '+e(s['scope'])+'</li>' for s in SOURCES)}</ul>
    <h2>Reproducibility</h2><p>Input SHA-256: <code>{e(result['input_sha256'])}</code><br>Result SHA-256: <code>{e(result['result_sha256'])}</code><br>Code commit: {e(result['evidence']['commit'])} (dirty: {e(result['evidence']['dirty'])})</p><p>Recompute by posting the exact request in the evidence below to /api/financial/compare on this exact source revision and rate-card inputs. No database or model inference is required.</p>
    <details><summary>Full evidence: assumptions, per-site split, ledger and cost sensitivity</summary><pre>{e(json.dumps(result,indent=2,ensure_ascii=False))}</pre></details></html>"""


@router.post('/report')
def report_api(req:FinanceRequest,format:Literal['json','html']=Query('json')):
    result=compare_api(req)
    headers={'Content-Disposition':f'attachment; filename="concord-financial-{result["run_id"]}.{format}"'}
    if format=='json':
        return JSONResponse(result,headers=headers)
    return HTMLResponse(report_html(req,result),headers=headers)


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
