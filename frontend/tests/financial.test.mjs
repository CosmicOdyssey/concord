import {test, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {financialApi} from '../src/financialApi.ts'
const originalFetch=globalThis.fetch
const request={budget:1000, sites:[]}
afterEach(()=>{globalThis.fetch=originalFetch})
test('comparison posts the complete financial request',async()=>{
  let observed
  globalThis.fetch=async(url,options)=>{observed={url,options}; return new Response(JSON.stringify({run_id:'example'}),{status:200})}
  assert.equal((await financialApi.compare(request)).run_id,'example')
  assert.equal(observed.url,'/api/financial/compare')
  assert.equal(observed.options.method,'POST')
  assert.deepEqual(JSON.parse(observed.options.body),request)
})
test('nonfinite numeric edits cannot silently become null',async()=>{
  globalThis.fetch=()=>{assert.fail('Invalid request must not reach the server')}
  for(const budget of [NaN,Infinity,-Infinity]) await assert.rejects(financialApi.compare({...request,budget}),/finite/)
})
test('export recomputes exact inputs through report endpoint',async()=>{
  let body
  globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/financial/report?format=html');body=options.body;return new Response('<html>report</html>')}
  assert.match(await (await financialApi.report(request,'html')).text(),/report/)
  assert.deepEqual(JSON.parse(body),request)
})
test('API failures and cancellation propagate to the UI',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:'Budget invalid'}),{status:422})
  await assert.rejects(financialApi.compare(request),/422.*Budget invalid/)
  const ctl=new AbortController();ctl.abort()
  globalThis.fetch=async(_url,options)=>{options.signal.throwIfAborted()}
  await assert.rejects(financialApi.compare(request,ctl.signal),{name:'AbortError'})
})
