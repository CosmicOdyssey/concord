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
  assert.match(source, /not implemented/);
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
