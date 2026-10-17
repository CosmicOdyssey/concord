import {test, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {demoApi, nextScene, previousScene, metrics, proposal, SCENES} from '../src/demoApi.ts'
const original = globalThis.fetch
afterEach(() => { globalThis.fetch = original })
const input = JSON.parse(readFileSync(new URL('../../data/demo/hackharvard-request.json',import.meta.url)))
test('four main clicks take six scenes through actual computation; no empty-result skip', () => {
  assert.equal(SCENES.length,6)
  assert.equal(nextScene(0,false),1)
  assert.equal(nextScene(1,false),1)
  assert.equal(nextScene(1,true),3)
  assert.equal(nextScene(3,true),4)
  assert.equal(nextScene(4,true),5)
  assert.equal(previousScene(3),1)
})
test('read baseline and explicit optimization are separate local requests', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push([url, options.method ?? 'GET']); return Response.json({}) }
  const ctl = new AbortController()
  await demoApi.baseline(ctl.signal); await demoApi.optimize(ctl.signal)
  assert.deepEqual(calls,[['/api/hackharvard-demo','GET'],['/api/hackharvard-demo/optimize','POST']])
})
test('errors never silently load saved data and abort signals propagate', async () => {
  globalThis.fetch = async (url, options) => { assert.equal(url,'/api/hackharvard-demo/optimize'); assert.ok(options.signal); return Response.json({}, {status:503}) }
  await assert.rejects(demoApi.optimize(new AbortController().signal),/503.*no result has been substituted/i)
})
test('metrics count distinct hospitals, assignments and conservative reserved budget', () => {
  const sites=input.sites.map(s=>({id:s.id,capacity:s.capacity,peak_rate:3,reserved_slots:2}))
  const m=metrics({selected_edges:[0,1,4,5],sites,ledger:{budget_commitment:1500000}},input)
  assert.equal(m.activated,2); assert.equal(m.assignments,4);assert.equal(m.budgetFraction,.5)
  assert.equal(m.capacityFeasible,false) // SYN-D has cap 2, so do not manufacture green
})
test('infeasible, missing, or unverified optimization is never called a recommendation', () => {
  for(const scenarios of [[],[{id:'E',feasible:false,optimization:{status:'OPTIMAL'}}],[{id:'E',feasible:true,optimization:{status:'FIXED_COMPARISON'}}]]) assert.throws(()=>proposal({recommended_scenario_id:'E',scenarios}),/No verified/)
  for(const status of ['OPTIMAL','FEASIBLE_HEURISTIC']) assert.equal(proposal({recommended_scenario_id:'E',scenarios:[{id:'E',feasible:true,optimization:{status}}]}).optimization.status,status)
})
test('saved fallback fails closed on changed bytes',async()=>{
  globalThis.fetch=async()=>new Response('{"altered":true}')
  await assert.rejects(demoApi.saved(new AbortController().signal),/checksum mismatch/)
})
test('demo inputs never enable rate boosts or realized administration savings',()=>{
  assert.equal(input.operations_rate_effect,0);assert.equal(input.support_rate_effect,0)
  assert.equal(input.savings_realized,false);assert.equal(input.draws,32);assert.equal(input.seed,7)
})
