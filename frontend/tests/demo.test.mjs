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
  globalThis.fetch = async (url, options) => { calls.push([url, options.method ?? 'GET']); return Response.json({delivery_mode:'LIVE_COMPUTATION'}) }
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
test('explicit saved rehearsal restores genuine checked bytes without touching the API',async()=>{
  globalThis.fetch=async(url)=>{assert.equal(url,'/demo/saved-result.json');return new Response(readFileSync(new URL('../public/demo/saved-result.json',import.meta.url),'utf8'))}
  const capture=await demoApi.saved(new AbortController().signal)
  assert.equal(capture.run.delivery_mode,'ARTIFACT_REPLAY')
  assert.equal(capture.run.result.evidence.dirty,false)
  assert.deepEqual(capture.run.result.request,input)
  assert.equal(proposal(capture.run.result).optimization.status,'OPTIMAL')
})
test('missing backend routes never fetch falsely live static copies', async () => {
  for (const status of [404,405,401,403,500]) {
    for (const action of ['baseline','optimize']) {
      const calls=[]
      globalThis.fetch=async(url)=>{calls.push(url);return Response.json({}, {status})}
      await assert.rejects(demoApi[action](new AbortController().signal),new RegExp(String(status)))
      assert.equal(calls.length,1)
      assert.ok(!calls[0].endsWith('.json'))
    }
  }
})
test('a replay envelope cannot satisfy the live optimization transport contract', async()=>{
  globalThis.fetch=async()=>Response.json({delivery_mode:'ARTIFACT_REPLAY'})
  await assert.rejects(demoApi.optimize(new AbortController().signal),/did not return live computation|archived evidence/)
})

test('baseline rejects an archived HTTP 200 envelope rather than declaring backend readiness',async()=>{
  globalThis.fetch=async()=>Response.json({delivery_mode:'ARTIFACT_REPLAY'})
  await assert.rejects(demoApi.baseline(new AbortController().signal),/archived evidence/)
})

test('hosting configuration and served files cannot answer live action paths with saved HTTP 200 results',async()=>{
  const {createServer}=await import('node:http')
  const {readFile}=await import('node:fs/promises')
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'))
  const publicRoot=new URL('../public/',import.meta.url)
  const actions=['/api/hackharvard-demo','/api/hackharvard-demo/optimize','/api/agents/photon/status','/api/agents/photon/simulate','/api/agents/droid/run','/api/agents/droid/review','/api/evals/chalk/run','/api/evals/chalk/latest']
  const matches=(source,url)=>new RegExp(`^${source}$`).test(url)
  for(const action of [...actions,'/api','/api/unknown']){
    assert.equal(config.rewrites.some(rule=>matches(rule.source,action)),false,`API route must not rewrite to saved files or the SPA: ${action}`)
    await assert.rejects(readFile(new URL(action.slice(1),publicRoot)),/ENOENT|EISDIR/)
    await assert.rejects(readFile(new URL(`${action.slice(1)}.json`,publicRoot)),/ENOENT/)
  }
  // Exercise the resulting static-file/rewrite boundary through real HTTP.
  // This is a local config regression, not a Vercel deployment receipt.
  const server=createServer(async(req,res)=>{
    const send=raw=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(raw)}
    try{return send(await readFile(new URL(req.url.slice(1),publicRoot)))}catch{}
    const rule=config.rewrites.find(rule=>matches(rule.source,req.url))
    try{if(!rule)throw new Error('No route');send(await readFile(new URL(rule.destination.slice(1),publicRoot)))}
    catch{res.writeHead(404);res.end('No backend configured')}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${server.address().port}`
  try{
    for(const action of actions){const response=await original(`${base}${action}`,{method:action.includes('/status')||action.endsWith('/latest')||action==='/api/hackharvard-demo'?'GET':'POST'});assert.equal(response.status,404,action)}
    const archived=await original(`${base}/archives/pr7-static-api/hackharvard-demo/optimize.json`)
    // SPA navigation can still rewrite arbitrary non-API URLs; inspect the actual
    // archive bytes independently so a future rewrite cannot relabel them live.
    assert.equal(archived.ok,true)
    const archive=JSON.parse(await readFile(new URL('archives/pr7-static-api/hackharvard-demo/optimize.json',publicRoot),'utf8'))
    assert.equal(archive.delivery_mode,'ARTIFACT_REPLAY')
    assert.equal(JSON.parse(await readFile(new URL('archives/pr7-static-api/hackharvard-demo/optimize',publicRoot),'utf8')).delivery_mode,'ARTIFACT_REPLAY')
  }finally{await new Promise(resolve=>server.close(resolve))}
})
