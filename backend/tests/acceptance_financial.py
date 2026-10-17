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
    req=f.FinanceRequest(target=10,admin_cost=500000,admin_reduction=.8,draws=100,sites=[f.Site(id='A',name='Synthetic A',baseline_active=True,rate=1,capacity=30,monthly_cost=100,activation_lag_months=0),f.Site(id='B',name='Synthetic B',rate=5,capacity=30,activation_cost=100000,monthly_cost=500,activation_lag_months=1)])
    result=f.compare(req); a,c=result['scenarios'][0],result['scenarios'][2]
    assert c['economics']['sponsor']['expenditure']<a['economics']['sponsor']['expenditure']
    assert c['economics']['hospital']['resource_cost']>a['economics']['hospital']['resource_cost']
    return {'responsibility_shift':{'line':line['id'],'classification':'ASSUMPTION-DEPENDENT cost shift; no resource savings','rows':rows},
            'higher_insurer_without_sponsor_savings':{'baseline':normal,'higher_payer_share':higher},
            'lower_sponsor_higher_hospital_cost':{'classification':'ASSUMPTION-DEPENDENT; modeled administration offsets added hospital resources','baseline':a,'more_sites':c}}


if __name__=='__main__':
    import sys
    Path(sys.argv[1]).write_text(json.dumps(run(),indent=2)+'\n')
    print('Financial counterfactual conservation checks passed')
