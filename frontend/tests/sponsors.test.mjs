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
