"""Reproduce financial counterfactuals; compare resources and transfers separately."""
import json
from pathlib import Path
from concord import financial as f


def run():
    request=f.FinanceRequest(target=10,draws=100)
    base=f.coverage(request)
    line=next(i for i in base['items'] if i['status']=='POTENTIALLY_PAYER_COVERED')
    rows={}
    for name,status in [('sponsor_pays',f.Responsibility.SPONSOR),('patient_pays',f.Responsibility.PATIENT),('unknown_reserve',f.Responsibility.UNKNOWN)]:
        r=f.compare(request.model_copy(update={'coverage_overrides':{line['id']:status}}))
        rows[name]={'coverage':r['coverage']['totals'],'baseline':r['scenarios'][0]['economics']}
    sponsor=rows['sponsor_pays']['baseline']; patient=rows['patient_pays']['baseline']
    assert patient['sponsor']['expenditure']<sponsor['sponsor']['expenditure']
    assert patient['patient']['cost_sharing']>sponsor['patient']['cost_sharing']
    assert patient['consolidated_resource_cost']==sponsor['consolidated_resource_cost']
    higher=f.compare(request.model_copy(update={'payer_fraction':1}))['scenarios'][0]['economics']
    normal=f.compare(request)['scenarios'][0]['economics']
    assert higher['insurer']['payments']>normal['insurer']['payments'] and higher['sponsor']==normal['sponsor']
    from concord import portfolio as p
    req=p.PortfolioRequest(trials=[p.Trial(id='T',title='Explicit synthetic accounting stress',target=10,admin=500000)],
        sites=[p.SharedSite(id=s,name='Synthetic '+s,capacity=10,capacity_basis='ASSUMED') for s in ['A','B']],
        edges=[p.Edge(trial='T',site=s,baseline=s=='A',rate=rate,lag=lag,activation=100000,
            feasibility='ASSUMED_FEASIBLE',rate_basis='ASSUMED') for s,rate,lag in [('A',1,0),('B',5,1)]],
        savings_realized=True,admin_reduction=.8,spread=0,draws=32,operations_rate_effect=0)
    result=p.run(req)
    a,c=[{'economics':result['scenarios'][i]['ledger']['trials'][0]['economics']} for i in [0,2]]
    assert c['economics']['sponsor']['expenditure']<a['economics']['sponsor']['expenditure']
    assert c['economics']['hospital']['resource_cost']>a['economics']['hospital']['resource_cost']
    return {'responsibility_shift':{'line':line['id'],'classification':'ASSUMPTION-DEPENDENT cost shift; no resource savings','rows':rows},
            'higher_insurer_without_sponsor_savings':{'baseline':normal,'higher_payer_share':higher},
            'lower_sponsor_higher_hospital_cost':{'classification':'ASSUMPTION-DEPENDENT; modeled administration offsets added hospital resources','baseline':a,'more_sites':c}}


if __name__=='__main__':
    import sys
    Path(sys.argv[1]).write_text(json.dumps(run(),indent=2)+'\n')
    print('Financial counterfactual conservation checks passed')
