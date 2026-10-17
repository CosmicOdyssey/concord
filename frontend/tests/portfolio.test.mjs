import {test, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {portfolioApi, runPath} from '../src/portfolioCommandApi.ts'
const originalFetch = globalThis.fetch
const request = {budget: 3000000, trials: [{id: 'SIM-A'}], sites: [], edges: []}
const id = 'a'.repeat(32)
afterEach(() => { globalThis.fetch = originalFetch })
test('complete portfolio inputs and seed cross the API boundary unchanged', async () => {
  let observed
  globalThis.fetch = async (url, options) => { observed = {url, options}; return Response.json({run_id: id}) }
  assert.equal((await portfolioApi.compare({...request, seed: 7})).run_id, id)
  assert.equal(observed.url, '/api/portfolio-command/compare')
  assert.equal(observed.options.method, 'POST')
  assert.deepEqual(JSON.parse(observed.options.body), {...request, seed: 7})
})
test('nonfinite nested edits fail before they become null', async () => {
  globalThis.fetch = () => assert.fail('Invalid input must not reach server')
  for (const rate of [NaN, Infinity, -Infinity]) await assert.rejects(portfolioApi.compare({...request, edges: [{rate}]}), /finite/)
})
test('reports point to immutable saved results rather than recomputing inputs', () => {
  assert.equal(portfolioApi.reportUrl(id, 'json'), `/api/portfolio-command/runs/${id}/report/json`)
  assert.throws(() => runPath('../../secrets'), /saved run ID/)
})
test('saved evidence loads by validated identifier', async () => {
  globalThis.fetch = async (url) => { assert.equal(url, runPath(id)); return Response.json({run_id: id, request}) }
  assert.deepEqual((await portfolioApi.load(id)).request, request)
})
test('JSON import must validate before entering the editor state', async () => {
  globalThis.fetch = async (url, options) => { assert.equal(url, '/api/portfolio-command/validate'); return Response.json(JSON.parse(options.body)) }
  assert.deepEqual(await portfolioApi.validate(request), request)
})
test('validation errors and cancellation propagate', async () => {
  globalThis.fetch = async () => Response.json({detail: 'Unknown site'}, {status: 422})
  await assert.rejects(portfolioApi.compare(request), /422.*Unknown site/)
  const ctl = new AbortController(); ctl.abort()
  globalThis.fetch = async (_url, options) => { options.signal.throwIfAborted() }
  await assert.rejects(portfolioApi.compare(request, ctl.signal), {name:'AbortError'})
})
