"""Offline contracts for real adapters. Every external boundary is intercepted."""
import json
from pathlib import Path
import subprocess
import sys

import httpx
import pytest
from fastapi.testclient import TestClient
from concord.api.main import app
from concord.api import photon as photon_api
from concord.agents.photon import PhotonSMSAgent, InboundSMSMessage
from concord.evals.chalk_connection import validate_remote_rows
from concord.evals.chalk_eval import CHALK_SCENARIOS
from concord.paths import ROOT


@pytest.fixture
def client(monkeypatch):
    for variable in ('CONCORD_ALLOW_PHOTON_SEND', 'CONCORD_ALLOW_FACTORY_RUN', 'CONCORD_ALLOW_CHALK_RUN', 'CONCORD_SPONSOR_OPERATOR_TOKEN'):
        monkeypatch.delenv(variable, raising=False)
    return TestClient(app)


def test_ordinary_app_import_never_imports_deploying_chalk_module(client):
    assert 'concord.evals.chalk_remote' not in sys.modules
    assert client.get('/api/evals/chalk/status').status_code == 200
    assert 'concord.evals.chalk_remote' not in sys.modules


@pytest.mark.parametrize('endpoint,body', [('/api/agents/photon/send', {'body':'HELP','message_id':'bounded-send-1','confirm_live':True}),
    ('/api/agents/droid/run', {'execution_mode':'LIVE_FACTORY'}), ('/api/evals/chalk/remote-run', {'confirm_live':True})])
def test_live_paths_require_operator_and_explicit_switch(client, endpoint, body, monkeypatch):
    assert client.post(endpoint, json=body).status_code == 503
    for variable in ('CONCORD_ALLOW_PHOTON_SEND', 'CONCORD_ALLOW_FACTORY_RUN', 'CONCORD_ALLOW_CHALK_RUN'):
        monkeypatch.setenv(variable, '1')
    monkeypatch.setenv('CONCORD_SPONSOR_OPERATOR_TOKEN', 'offline-test-operator')
    assert client.post(endpoint, json=body).status_code == 401
    assert 'concord.evals.chalk_remote' not in sys.modules


def test_photon_provider_acceptance_is_not_delivery_and_replay_never_sends_twice(tmp_path, monkeypatch):
    monkeypatch.setenv('CONCORD_ALLOW_PHOTON_SEND','1')
    worker=PhotonSMSAgent(tmp_path/'dedupe.sqlite3')
    worker._api_key='offline-test-key'
    worker._project_id='pho_prj_approved'
    worker._space_id='pho_spc_approved'
    worker._agent_user_id='pho_usr_approved'
    real_client=httpx.Client
    requests=[]
    def handle(request):
        requests.append(request)
        assert request.url.path == '/v1/projects/pho_prj_approved/messages'
        assert json.loads(request.content)['spaceId']=='pho_spc_approved'
        assert json.loads(request.content)['senderId']=='pho_usr_approved'
        return httpx.Response(202, json={'id':'pho_msg_actual-test-receipt'})
    monkeypatch.setattr(httpx,'Client',lambda **kwargs:real_client(transport=httpx.MockTransport(handle)))
    message=InboundSMSMessage(message_id='bounded-send',sender='+16175550199',recipient='+16175550200',body='HELP')
    result=worker.send_reply(message)
    assert result.status=='ACCEPTED'
    assert result.provider_message_id=='pho_msg_actual-test-receipt'
    assert result.provider_status=='API_ACCEPTED'
    assert 'UNVERIFIED' in result.delivery_note
    assert worker.send_reply(message).status=='ACCEPTED'
    assert len(requests)==1
    # A new process/object reads the durable outbound reservation too.
    second=PhotonSMSAgent(worker._store_path)
    second._api_key,second._project_id,second._space_id,second._agent_user_id=worker._api_key,worker._project_id,worker._space_id,worker._agent_user_id
    assert second.send_reply(message).status=='ACCEPTED'
    assert len(requests)==1


def test_photon_timeout_is_unknown_without_automatic_retry(tmp_path,monkeypatch):
    monkeypatch.setenv('CONCORD_ALLOW_PHOTON_SEND','1')
    worker=PhotonSMSAgent(tmp_path/'dedupe.sqlite3')
    worker._api_key='offline-test-key'; worker._project_id='pho_prj_test';worker._space_id='pho_spc_test';worker._agent_user_id='pho_usr_test'
    real_client=httpx.Client
    count=[]
    def fail(request):
        count.append(1)
        raise httpx.ReadTimeout('potentially sensitive provider error')
    monkeypatch.setattr(httpx,'Client',lambda **kwargs:real_client(transport=httpx.MockTransport(fail)))
    message=InboundSMSMessage(message_id='ambiguous-send',sender='+16175550199',recipient='+16175550200',body='HELP')
    result=worker.send_reply(message)
    assert result.status=='DELIVERY_UNKNOWN'
    assert 'sensitive' not in result.model_dump_json()
    assert worker.send_reply(message).status=='DELIVERY_UNKNOWN'
    assert count==[1]


def test_chalk_success_status_alone_is_insufficient():
    rows=[{'scenario_id':case.id,'output_error':None,'concord_acceptance_scorer_error':None,'concord_acceptance_scorer_value':1.} for case in CHALK_SCENARIOS]
    assert validate_remote_rows(rows)['complete_and_passing'] is True
    rows[0]['output_error']='Task failed'
    assert validate_remote_rows(rows)['complete_and_passing'] is False
    assert validate_remote_rows(rows[1:])['complete_and_passing'] is False
    rows[0]['output_error']=None
    rows[0]['concord_acceptance_scorer_value']=None
    assert validate_remote_rows(rows)['complete_and_passing'] is False


def test_factory_tool_bridge_rejects_arbitrary_commands_and_clinical_fields():
    from concord.agents.factory_tools import dispatch
    with pytest.raises(ValueError):
        dispatch({'tool':'Execute','trial_id':'NCT05800015'})
    with pytest.raises(ValueError):
        dispatch({'tool':'simulate_operational_variant','trial_id':'NCT05800015','clinical_criteria_override':True})
    actual=dispatch({'tool':'simulate_operational_variant','trial_id':'NCT05800015','activation_lag':2.,'outreach_budget':10000.})
    assert actual['result']['makespan_delta']==0.
    assert actual['result']['simulated_commitment']>actual['result']['baseline_commitment']


def test_factory_sdk_session_contract_offline():
    # Fake only the SDK transport. The real runner calls the real Python engine
    # tool through its private subprocess bridge. No model/provider is invoked.
    code=r'''
    import assert from 'node:assert/strict';
    import {runFactoryDroid,pythonBridge} from './scripts/factory-droid-runner.mjs';
    import {createRequire} from 'node:module';
    const require=createRequire(new URL('./frontend/package.json',import.meta.url));
    const ids=['inspect_protocol','identify_operational_bottlenecks','simulate_operational_variant'].map(x=>'mcp__concord_protocol_tools__'+x);
    let server,closed=false,serverClosed=false,disabled=[];
    const sdk={AutonomyLevel:{Off:'off'},ToolConfirmationOutcome:{ProceedOnce:'once',Cancel:'cancel'},OutputFormatType:{JsonSchema:'json_schema'},
      tool:(name,description,schema,handler)=>({name,handler}),
      createSdkMcpServer:config=>(server={...config,close:async()=>{serverClosed=true;}}),
      createSession:async options=>{
        assert.equal(options.autonomyLevel,'off'); assert.equal(options.disableBuiltinSkills,true);
        assert.equal(options.permissionHandler({toolUses:[{name:'Execute'}],options:[{value:'cancel'}]}),'cancel');
        return {listTools:async()=>[...ids.map(id=>({id,allowed:true})),{id:'Execute',allowed:!disabled.includes('Execute')}],
          updateSettings:async value=>{disabled=value.disabledToolIds;},
          stream:async function*(){
            await server.tools[2].handler({activation_lag:2,outreach_budget:10000});
            yield {type:'result',success:true,subtype:'success',sessionId:'sdk-offline-test',durationMs:1,turnCount:1,tokenUsage:null,
              structuredOutput:{proposals:[{proposal_id:'candidate-test',trial_id:'NCT05800015',category:'OPERATIONAL',description:'Hypothetical operational candidate',activation_lag_months:2,monthly_outreach_budget:10000,modifies_clinical_inclusion_exclusion:false}]}};
          },close:async()=>{closed=true;}};
      }};
    const env={PATH:process.env.PATH,FACTORY_API_KEY:'offline-only',FACTORY_MODEL_ID:'approved-test-model',CONCORD_ALLOW_FACTORY_RUN:'1',CONCORD_BACKEND_PYTHON:process.env.CONCORD_BACKEND_PYTHON};
    const result=await runFactoryDroid('NCT05800015',1,{sdk,zod:require('zod'),env,bridge:args=>pythonBridge(args,env)});
    assert.equal(result.status,'SUCCEEDED');assert.equal(result.token_usage,null);assert.equal(result.tool_trace[0].result.makespan_delta,0);
    assert.deepEqual(disabled,['Execute']);assert.equal(closed,true);assert.equal(serverClosed,true);
    console.log('Offline SDK contract and actual original-engine tool passed');
    '''
    result=subprocess.run(['node','--input-type=module','-e',code],cwd=ROOT,env={'PATH':__import__('os').environ['PATH'],'CONCORD_BACKEND_PYTHON':sys.executable},capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stderr
    assert 'Offline SDK contract' in result.stdout
