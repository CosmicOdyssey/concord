import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeFactoryDroidSession } from '../src/droidClient.ts';
import { sendSimulatedSMS, runChalkEvaluations } from '../src/sponsorAgentsApi.ts';

async function withFetch(handler, body) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { await body(); } finally { globalThis.fetch = original; }
}

test('local proposal helper calls the backend; it does not invoke a Factory runtime', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, '/api/agents/droid/run');
    assert.deepEqual(JSON.parse(init.body), { trial_id: 'NCT05800015', max_iterations: 2 });
    return Response.json({ feasibility_status: 'NO_BENEFICIAL_CHANGE', expected_makespan_delta_months: 0 });
  }, async () => {
    const result = await executeFactoryDroidSession({ maxIterations: 2 });
    assert.equal(result.feasibility_status, 'NO_BENEFICIAL_CHANGE');
    assert.equal(result.expected_makespan_delta_months, 0);
  });
});

test('phone preview calls simulation only and preserves its local delivery disclosure', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, '/api/agents/photon/simulate');
    assert.equal(JSON.parse(init.body).body, 'STATUS');
    return Response.json({ status: 'LOCAL_SIMULATION', provider_status: 'NOT_IMPLEMENTED' });
  }, async () => {
    const result = await sendSimulatedSMS('STATUS');
    assert.equal(result.status, 'LOCAL_SIMULATION');
    assert.equal(result.provider_status, 'NOT_IMPLEMENTED');
  });
});

test('evaluation client preserves actual dataset size and local status; failures remain visible', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, '/api/evals/chalk/run');
    assert.equal(init.method, 'POST');
    return Response.json({ total_scenarios: 15, engine_mode: 'LOCAL_DETERMINISTIC' });
  }, async () => assert.equal((await runChalkEvaluations()).total_scenarios, 15));
  await withFetch(async () => new Response('', {status: 503}), async () => {
    await assert.rejects(runChalkEvaluations(), /HTTP 503/);
  });
});

test('sponsor view does not restore false production, carrier or SDK execution labels', async () => {
  const source = await readFile(new URL('../src/views/SponsorAgentsView.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Three production integrations|VERIFIED & ACTIVE|Online \(\+1|12 Scenarios/);
  assert.match(source, /LOCAL SIMULATION/);
  assert.match(source, /LOCAL DETERMINISTIC/);
  assert.match(source, /Remote adapters require server gates/);
  assert.match(source, /Carrier delivery is not established by API acceptance/);
});

test('actual HTTP failures never fall through to static fixtures or fabricated sponsor success', async () => {
  const {createServer}=await import('node:http');
  const api=await import('../src/sponsorAgentsApi.ts');
  const calls=[];
  let status=404;
  const server=createServer((req,res)=>{calls.push([req.method,req.url]);res.writeHead(status, {'Content-Type':'application/json'});res.end(JSON.stringify({detail:'backend unavailable'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const original=globalThis.fetch;
  const base=`http://127.0.0.1:${server.address().port}`;
  const actions=[()=>api.fetchPhotonStatus(),()=>api.sendSimulatedSMS('STATUS'),()=>api.runDroidAgent(),()=>api.runChalkEvaluations(),()=>api.fetchLatestChalkReport(),()=>api.submitHumanReview('id','REJECTED','test')];
  globalThis.fetch=(url,init)=>original(new URL(url,base),init);
  try {
    for (status of [401,403,404,405,503]) for (const action of actions) {
      const before=calls.length;
      await assert.rejects(action(),new RegExp(`HTTP ${status}`));
      assert.equal(calls.length,before+1);
      assert.ok(!calls.at(-1)[1].endsWith('.json'));
    }
    await new Promise(resolve=>server.close(resolve));
    for (const action of actions) await assert.rejects(action(),/fetch failed/);
  } finally {globalThis.fetch=original;if(server.listening)await new Promise(resolve=>server.close(resolve));}
});

test('even HTTP 200 archived envelopes cannot become sponsor action or status success', async () => {
  const api=await import('../src/sponsorAgentsApi.ts');
  const actions=[()=>api.fetchPhotonStatus(),()=>api.sendSimulatedSMS('STATUS'),()=>api.runDroidAgent(),()=>api.runChalkEvaluations(),()=>api.fetchLatestChalkReport(),()=>api.submitHumanReview('id','REJECTED','test')];
  for(const delivery_mode of ['ARTIFACT_REPLAY','SAVED_RESULT_REPLAY']){
    await withFetch(async()=>Response.json({delivery_mode}),async()=>{
      for(const action of actions)await assert.rejects(action(),/archived evidence/);
    });
  }
});

test('remote requests serialize explicit mode, stable IDs and operator header without exposing token in URL/body', async()=>{
  const api=await import('../src/sponsorAgentsApi.ts');
  const token='memory-only-test-token'; const calls=[];
  await withFetch(async(url,init)=>{
    calls.push([url,init]); assert.equal(init.headers['X-Concord-Operator-Token'],token);
    assert.ok(!url.includes(token)); assert.ok(!init.body.includes(token));
    if(url.endsWith('/send'))return Response.json({status:'DELIVERY_UNKNOWN',delivery_mode:'PHOTON_API',runtime_receipt:{status:'DELIVERY_UNKNOWN'},provider_message_id:null});
    if(url.endsWith('/remote-run'))return Response.json({execution_mode:'REMOTE_CHALK_COMPUTE',provider_status:'EXECUTED',evaluation_id:'eval-1',run_id:'run-1',rows:[],complete_and_passing:false});
    return Response.json({execution_mode:'LIVE_FACTORY_PROPOSAL_LOCAL_ENGINE_VALIDATION',provider_status:'EXECUTED',human_approval_status:'PENDING_HUMAN_REVIEW',runtime_receipt:{status:'SUCCEEDED',session_id:'factory-1'}});
  },async()=>{
    const photon=await api.sendLivePhoton({body:'STATUS',messageId:'stable-approved-id',operatorToken:token,confirmLive:true});
    assert.equal(photon.status,'DELIVERY_UNKNOWN');
    assert.deepEqual(JSON.parse(calls[0][1].body),{body:'STATUS',sender:'+16175550199',message_id:'stable-approved-id',confirm_live:true});
    await api.runLiveDroidAgent(token,true);
    assert.deepEqual(JSON.parse(calls[1][1].body),{trial_id:'NCT05800015',max_iterations:3,execution_mode:'LIVE_FACTORY'});
    const chalk=await api.runRemoteChalk(token,true);
    assert.deepEqual(JSON.parse(calls[2][1].body),{confirm_live:true}); assert.equal(api.remoteChalkComplete(chalk),false);
  });
});

test('unconfirmed/tokenless remote calls stop before transport and live modes reject local success envelopes',async()=>{
  const api=await import('../src/sponsorAgentsApi.ts');let calls=0;
  await withFetch(async()=>{calls++;return Response.json({status:'LOCAL_SIMULATION',execution_mode:'LOCAL_DETERMINISTIC'});},async()=>{
    for(const action of [()=>api.sendLivePhoton({body:'STATUS',messageId:'stable-id',operatorToken:'token',confirmLive:false}),()=>api.runLiveDroidAgent('token',false),()=>api.runRemoteChalk('token',false),()=>api.runRemoteChalk('',true),()=>api.runRemoteChalk('secret\nvalue',true)])await assert.rejects(action(),/confirmation|token/);
    assert.equal(calls,0);
    await assert.rejects(api.sendLivePhoton({body:'STATUS',messageId:'stable-id',operatorToken:'token',confirmLive:true}),/valid provider send receipt/);
    await assert.rejects(api.runLiveDroidAgent('token',true),/runtime receipt/);
    await assert.rejects(api.runRemoteChalk('token',true),/remote result dataset receipt/);
    assert.equal(calls,3);
  });
});

test('actual remote HTTP authorization failure is one request with no fixture or local fallback',async()=>{
  const {createServer}=await import('node:http');const api=await import('../src/sponsorAgentsApi.ts');const calls=[];
  let status=403;const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;calls.push({url:req.url,method:req.method,token:req.headers['x-concord-operator-token'],body:JSON.parse(text)});res.writeHead(status,{'Content-Type':'application/json'});res.end('{"detail":"Operator gate disabled"}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const original=globalThis.fetch;
  globalThis.fetch=(url,init)=>original(`http://127.0.0.1:${server.address().port}${url}`,init);
  try{
    for(status of [401,403,503])for(const action of [()=>api.sendLivePhoton({body:'STATUS',messageId:'stable-id',operatorToken:'memory-token',confirmLive:true}),()=>api.runLiveDroidAgent('memory-token',true),()=>api.runRemoteChalk('memory-token',true)]){const before=calls.length;await assert.rejects(action(),new RegExp(`HTTP ${status}`));assert.equal(calls.length,before+1);assert.equal(calls.at(-1).token,'memory-token');assert.equal(calls.at(-1).method,'POST');}
    assert.deepEqual(calls.map(c=>c.url),Array(3).fill(['/api/agents/photon/send','/api/agents/droid/run','/api/evals/chalk/remote-run']).flat());
  }finally{globalThis.fetch=original;await new Promise(resolve=>server.close(resolve));}
});

test('incomplete, failing or missing remote rows cannot be rendered as complete acceptance',async()=>{
  const {remoteChalkComplete}=await import('../src/sponsorAgentsApi.ts');
  const result={complete_and_passing:true,row_count:15,rows:Array.from({length:15},(_,i)=>({scenario_id:String(i)})),passed_scenarios:15,failed_scenarios:0,row_errors:[]};
  assert.equal(remoteChalkComplete(result),true);
  for(const patch of [{complete_and_passing:false},{row_count:14},{rows:[]},{passed_scenarios:14},{failed_scenarios:1},{row_errors:['case1']},{row_errors:undefined}])assert.equal(remoteChalkComplete({...result,...patch}),false);
});

test('readiness uses only status GETs, rejects missing prerequisites shape and does not infer auth',async()=>{
  const api=await import('../src/sponsorAgentsApi.ts');const calls=[];
  await withFetch(async(url,init)=>{calls.push([url,init.method??'GET']);return Response.json({readiness:'MISSING_CREDENTIALS',provider_status:'IMPLEMENTED_UNVERIFIED',auth_status:'NOT_VERIFIED',missing_prerequisites:['provider credential']});},async()=>{
    for(const action of [api.fetchPhotonStatus,api.fetchDroidStatus,api.fetchChalkStatus])assert.equal((await action()).auth_status,'NOT_VERIFIED');
    assert.deepEqual(calls,[['/api/agents/photon/status','GET'],['/api/agents/droid/status','GET'],['/api/evals/chalk/status','GET']]);
  });
  await withFetch(async()=>Response.json({}),async()=>{for(const action of [api.fetchPhotonStatus,api.fetchDroidStatus,api.fetchChalkStatus])await assert.rejects(action(),/incomplete readiness/);});
});

test('readiness and initial sponsor UI render missing credentials, UNKNOWN failures and disabled remote controls',async()=>{
  const {createServer}=await import('vite'); const {default:react}=await import('@vitejs/plugin-react');
  const {createElement}=await import('react'); const {renderToStaticMarkup}=await import('react-dom/server');
  const server=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,plugins:[react()],server:{middlewareMode:true},appType:'custom'});
  try{
    const view=await server.ssrLoadModule('/src/views/SponsorAgentsView.tsx');
    const missing=renderToStaticMarkup(createElement(view.Readiness,{label:'Factory',status:{readiness:'MISSING_CREDENTIALS',provider_status:'IMPLEMENTED_UNVERIFIED',auth_status:'NOT_VERIFIED',missing_prerequisites:['FACTORY_MODEL_ID']},error:null,gate:false}));
    assert.match(missing,/FACTORY_MODEL_ID/);assert.match(missing,/NOT_VERIFIED/);assert.match(missing,/DISABLED/);
    const unavailable=renderToStaticMarkup(createElement(view.Readiness,{label:'Chalk',status:null,error:'Backend status unavailable',gate:false}));
    assert.match(unavailable,/UNKNOWN/);assert.match(unavailable,/Backend status unavailable/);
    const initial=renderToStaticMarkup(createElement(view.default));
    assert.match(initial,/type="password"/); assert.match(initial,/memory only/);
    assert.equal((initial.match(/type="checkbox"/g)??[]).length,3);
    for(const label of ['Send approved STATUS via Photon API','Run approved Factory SDK proposals','Run approved remote Chalk evaluation'])assert.match(initial,new RegExp(`<button[^>]*disabled[^>]*>${label}</button>`));
  }finally{await server.close();}
});


test('operator token is memory-only and cleared unconditionally after remote completion or failure',async()=>{
  const source=await readFile(new URL('../src/views/SponsorAgentsView.tsx',import.meta.url),'utf8');
  assert.match(source,/finally\s*\{\s*setOperatorToken\(''\)/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|URLSearchParams|console\.(?:log|info|debug)/);
  assert.match(source,/type="password" autoComplete="off"/);
});

test('Photon API acceptance stays acceptance rather than a delivery claim',async()=>{
  const {sendLivePhoton}=await import('../src/sponsorAgentsApi.ts');
  await withFetch(async()=>Response.json({status:'ACCEPTED',delivery_mode:'PHOTON_API',runtime_receipt:{status:'ACCEPTED'},provider_message_id:'provider-message-1',delivery_note:'Carrier delivery remains UNVERIFIED'}),async()=>{
    const result=await sendLivePhoton({body:'STATUS',messageId:'stable-id',operatorToken:'token',confirmLive:true});
    assert.equal(result.status,'ACCEPTED');assert.match(result.delivery_note,/UNVERIFIED/);
  });
  const source=await readFile(new URL('../src/views/SponsorAgentsView.tsx',import.meta.url),'utf8');
  assert.match(source,/Carrier delivery: UNVERIFIED/);
});
