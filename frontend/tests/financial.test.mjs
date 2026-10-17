// Sponsor budget (financialApi.ts) against docs/financial/CONTRACT.md. Fixtures are trimmed live-API outputs
// (tests/fixtures/make_financial_fixtures.py): the default request, a capacity-short variant and a commercial payer
// without the rate assumption.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  commitment,
  financialApi,
  payerFraming,
  pct,
  sameCoverageInputs,
  scenarioChange,
  signedUsd,
  splitWords,
  usd,
  usd2,
} from '../src/financialApi.ts'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const demo = fixture('financial_demo')
const base = fixture('financial_default')
const short = fixture('financial_capacity_short')
const commercial = fixture('financial_commercial')
const request = demo.request

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

/* ------------------------------------------------------------------ requests ------------------------------------------------------------------ */

test('comparison posts the complete financial request', async () => {
  let observed
  globalThis.fetch = async (url, options) => {
    observed = { url, options }
    return new Response(JSON.stringify({ run_id: 'example' }), { status: 200 })
  }
  assert.equal((await financialApi.compare(request)).run_id, 'example')
  assert.equal(observed.url, '/api/financial/compare')
  assert.equal(observed.options.method, 'POST')
  assert.deepEqual(JSON.parse(observed.options.body), request)
})

test('nonfinite numeric edits cannot silently become null', async () => {
  globalThis.fetch = () => {
    assert.fail('Invalid request must not reach the server')
  }
  for (const budget of [NaN, Infinity, -Infinity]) await assert.rejects(financialApi.compare({ ...request, budget }), /finite/)
  const sites = request.sites.map((s, i) => (i === 0 ? { ...s, capacity: NaN } : s))
  await assert.rejects(financialApi.compare({ ...request, sites }), /finite/)
})

test('export recomputes exact inputs through the report endpoint', async () => {
  let body
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/financial/report?format=html')
    body = options.body
    return new Response('<html>report</html>')
  }
  assert.match(await (await financialApi.report(request, 'html')).text(), /report/)
  assert.deepEqual(JSON.parse(body), request)
})

test('API failures and cancellation propagate to the UI', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Budget invalid' }), { status: 422 })
  await assert.rejects(financialApi.compare(request), /422.*Budget invalid/)
  const ctl = new AbortController()
  ctl.abort()
  globalThis.fetch = async (_url, options) => {
    options.signal.throwIfAborted()
  }
  await assert.rejects(financialApi.compare(request, ctl.signal), { name: 'AbortError' })
})

/* ------------------------------------------------------------------ contract ------------------------------------------------------------------ */

const REQUEST_KEYS = [
  'admin_cost', 'admin_reduction', 'budget', 'budget_period_months', 'commercial_rate_assumption', 'cost_spread', 'coverage_overrides', 'draws',
  'drug_contingency_per_participant', 'extra_support', 'jurisdiction', 'minimum_support', 'payer_admin_per_participant', 'payer_fraction', 'payer_kind',
  'payer_plan', 'seed', 'sites', 'sponsor_rate_multiplier', 'support_per_participant', 'target', 'trial_id',
]
const SITE_KEYS = ['activation_cost', 'baseline_active', 'capacity', 'feasible', 'id', 'monthly_cost', 'name', 'per_participant_cost']

test('the demo request the view starts from has exactly the contract fields (a removed field posted back is a 422)', () => {
  assert.deepEqual(Object.keys(request).sort(), REQUEST_KEYS)
  for (const site of request.sites) assert.deepEqual(Object.keys(site).sort(), SITE_KEYS)
  for (const removed of ['horizon_months', 'rate_spread', 'rate_multiplier', 'no_loser']) assert.ok(!(removed in request), removed)
})

/** Every key in a JSON value, recursively. */
function keys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => keys(v, out))
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      keys(v, out)
    }
  return out
}

test('comparisons carry no time, speed, ranking or netted-participant field', () => {
  const banned = /modeled|horizon|months_quantiles|time_change|recommended|no_loser|^rate$|activation_lag|reinvest|projected_capacity|net_cash_exposure|patient_exposure|speed|faster/i
  for (const r of [base, short, commercial, demo]) {
    const hits = [...keys(r)].filter((k) => k !== 'budget_period_months' && banned.test(k))
    assert.deepEqual(hits, [])
  }
  assert.deepEqual(base.scenarios.map((s) => s.id), ['A', 'B', 'C', 'D', 'E'])
  assert.equal(base.comparison.reference_scenario_id, 'A')
})

/* ------------------------------------------------------------------ formatting ------------------------------------------------------------------ */

test('unknown amounts read Unknown and uncosted plans read Not costed, never 0', () => {
  assert.equal(usd(null), 'Unknown')
  assert.equal(usd2(undefined), 'Unknown')
  assert.equal(signedUsd(null), 'Unknown')
  assert.equal(pct(null), 'Unknown')
  assert.equal(commercial.coverage.totals.payer, null)
  assert.equal(usd2(commercial.coverage.totals.payer), 'Unknown')
  assert.equal(usd(commercial.scenarios[0].economics.insurer.payments), 'Unknown')
  assert.equal(usd(commercial.scenarios[0].economics.patient.cost_sharing), 'Unknown')
  const a = short.scenarios[0]
  assert.equal(a.plan.costed, false)
  assert.equal(commitment(a.plan), 'Not costed')
  assert.equal(commitment(base.scenarios[0].plan), '$662,387')
  assert.equal(signedUsd(-30000), '−$30,000')
  assert.equal(signedUsd(18000), '+$18,000')
  assert.equal(signedUsd(0), '$0')
  assert.equal(usd2(3159.79), '$3,159.79')
})

/* ------------------------------------------------------------ change against A ------------------------------------------------------------ */

const changes = (r) => {
  const ref = r.scenarios.find((s) => s.id === r.comparison.reference_scenario_id)
  return Object.fromEntries(r.scenarios.map((s) => [s.id, scenarioChange(s, ref, r.request)]))
}

test('default fixture: each change against A equals budget_reallocation and names its cause', () => {
  const ch = changes(base)
  assert.equal(ch.A.kind, 'reference')
  assert.deepEqual([ch.B.kind, ch.B.incremental, ch.B.causes, ch.B.adminReduction], ['change', -30000, [{ key: 'administration', amount: -30000 }], 0.25])
  // C keeps A's network: the existing sites' stated capacity (120) covers the target (60).
  assert.deepEqual([ch.C.kind, ch.C.incremental, ch.C.causes, ch.C.noSitesAdded, ch.C.addedSites], ['change', 0, [], true, null])
  assert.deepEqual([ch.D.incremental, ch.D.causes, ch.D.supportIncrease], [18000, [{ key: 'support', amount: 18000 }], 300])
  assert.deepEqual(
    [ch.E.incremental, ch.E.causes, ch.E.noSitesAdded],
    [-12000, [{ key: 'administration', amount: -30000 }, { key: 'support', amount: 18000 }], true],
  )
  for (const s of base.scenarios) if (s.id !== 'A') assert.equal(ch[s.id].incremental, s.budget_reallocation.incremental_cost)
  // Sponsor commitments of the default fixture (CONTRACT.md, rev 2).
  assert.deepEqual(base.scenarios.map((s) => s.plan.sponsor_total), [662387.4, 632387.4, 662387.4, 680387.4, 650387.4])
})

test('capacity-short fixture: A is not costed, so C and E state the added sites’ own cost instead of a change', () => {
  const ch = changes(short)
  assert.equal(ch.A.kind, 'reference')
  assert.equal(ch.B.kind, 'not_costed')
  assert.equal(ch.D.kind, 'not_costed')
  for (const id of ['C', 'E']) {
    assert.equal(ch[id].kind, 'reference_not_costed')
    assert.equal(ch[id].incremental, null)
    assert.equal(ch[id].noSitesAdded, false)
    assert.deepEqual(ch[id].addedSites, {
      ids: ['SYN-C'],
      cost: { activation: 35000, operating: 38400, site_variable: 48000, site_total: 121400, participants: 20 },
    })
  }
  const c = short.scenarios.find((s) => s.id === 'C')
  assert.deepEqual(c.plan.site_rows.map((r) => r.participants), [20, 20, 20])
  assert.match(splitWords(c.plan.participant_split), /Existing sites take participants up to their stated capacity/)
  assert.match(splitWords(base.scenarios[0].plan.participant_split), /in proportion to stated capacity/)
})

/* ----------------------------------------------------------- payer framing, verbatim ----------------------------------------------------------- */

test('the payer framing is the API’s own sentences, from assumptions or limitations', () => {
  const fromDemo = payerFraming(demo.limitations)
  const fromResult = payerFraming(base.limitations, base.assumptions)
  assert.equal(fromResult.benchmarks, base.assumptions.payer_benchmarks)
  assert.equal(fromResult.billing, base.assumptions.payer_billing)
  assert.equal(fromResult.independence, base.assumptions.payer_independence)
  assert.deepEqual(fromDemo, fromResult)
  for (const sentence of Object.values(fromDemo)) {
    assert.ok(sentence, 'every framing sentence is found')
    assert.ok(demo.limitations.includes(sentence), 'verbatim, not paraphrased')
  }
  assert.match(fromDemo.noTime, /^Nothing here models negotiation length/)
  assert.deepEqual(payerFraming([]), { benchmarks: null, billing: null, independence: null, noTime: null })
})

test('the worksheet amounts count as current only for the demo’s coverage inputs', () => {
  assert.ok(sameCoverageInputs(request, { ...request }))
  assert.ok(sameCoverageInputs(request, { ...request, budget: 1, target: 10, budget_period_months: 12 }), 'budget inputs do not change the worksheet')
  for (const patch of [
    { payer_kind: 'Medicaid' },
    { payer_fraction: 0.5 },
    { commercial_rate_assumption: true },
    { sponsor_rate_multiplier: 1.5 },
    { drug_contingency_per_participant: 0 },
    { trial_id: 'NCT06627647' },
    { coverage_overrides: { 'SCR:ecg': 'UNKNOWN' } },
  ])
    assert.ok(!sameCoverageInputs(request, { ...request, ...patch }), JSON.stringify(patch))
})

/* ------------------------------------------------------------------ copy scan ------------------------------------------------------------------ */

test('the view and its API module reference no removed field and use no speed, ranking or saving wording', () => {
  const files = { view: source('../src/views/FinancialView.tsx'), api: source('../src/financialApi.ts') }
  for (const [name, text] of Object.entries(files)) {
    const fields = text.match(/modeled_months|core_modeled|horizon_months|rate_spread|(?<!sponsor_)rate_multiplier|no_loser|recommended_scenario_id|reinvestment|activation_lag|net_cash_exposure|patient_exposure|projected_capacity|modeled_time_change/g)
    assert.equal(fields, null, `${name}: ${fields}`)
    const wording = text.match(/.{0,30}(faster|speed|accelerat|sooner|recommend|\bbest\b|saving|reinvest|pilot).{0,30}/gi)
    assert.equal(wording, null, `${name}: ${wording}`)
    // "months" only as the contract-period input's name and unit.
    const months = text.replaceAll('budget_period_months', '').replaceAll('Budgeted contract period (months)', '').match(/.{0,30}\bmonths?\b.{0,30}/gi)
    assert.equal(months, null, `${name}: ${months}`)
  }
})
