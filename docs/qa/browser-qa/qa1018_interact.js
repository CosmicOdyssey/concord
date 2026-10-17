// 2026-10-18 QA: interactions around the demo path at 1440x900 that the walk-through does not exercise:
// overlap pair list, Protocol to terms multiplier / site presets / compare toggle, and every Research sub-tab
// after the default clear. Checks the screen against fresh API fetches and collects console errors.
// Usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node qa1018_interact.js [base]
const path = require('path')
const Q = require('./qa1018_lib')

const BASE = process.argv[2] || 'http://localhost:5173'
const checks = []
const errors = []
const ck = Q.checker('interact', checks)
const wait = (page, fn, arg, timeout = 90000) => page.waitForFunction(fn, { timeout, polling: 300 }, arg)

;(async () => {
  const browser = await Q.launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  const log = {}
  Q.instrument(page, log)
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e}`))
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[${m.type()}] ${m.text()}`))
  page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && errors.push(`[http ${r.status()}] ${r.url()}`))

  // Overlap: pair list, pick another pair.
  await page.goto(`${BASE}/#overlap/regeneron`, { waitUntil: 'domcontentloaded' })
  await wait(page, () => (document.querySelector('.ov-detail h2')?.innerText ?? '').includes('NCT05785767 × NCT05800015'))
  await page.evaluate(() => [...document.querySelectorAll('.seg-btn')].find((b) => b.innerText === 'Pair list').click())
  await wait(page, () => document.querySelectorAll('.ov-pairs tbody tr').length > 0)
  const d = (await Q.apiGet('/api/overlap?sponsor=Regeneron+Pharmaceuticals&as_of=2024-09-01&region=US')).body
  const rows = await page.$$eval('.ov-pairs tbody tr', (rs) => rs.map((r) => [...r.children].map((c) => c.innerText.trim())))
  ck('pair list rows', d.pairs.length, rows.length)
  for (const r of rows) {
    const p = d.pairs.find((x) => x.p === r[0] && x.q === r[1])
    ck(`pair list ${r[0]}×${r[1]}`, JSON.stringify([String(p.shared_sites), Q.fmt.pct(p.o_pq), Q.fmt.pct(p.o_qp), `${Q.fmt.num(p.months_both_recruiting_estimated, 1)} mo`]), JSON.stringify(r.slice(2, 6)))
  }
  await page.evaluate(() => [...document.querySelectorAll('.ov-pairs tbody tr')].find((r) => r.innerText.includes('NCT05557591') && r.innerText.includes('NCT05785767')).click())
  await wait(page, () => (document.querySelector('.ov-detail h2')?.innerText ?? '').includes('NCT05557591 × NCT05785767'))
  // Calm pair detail: shared sites, the two shares, months both recruiting (in both densities).
  const facts = await page.$$eval('.ov-detail .ov-fact', (e) => e.map((f) => f.querySelector('.ov-fig, .ov-fig-unk').innerText.replace(/\s+/g, ' ').trim()))
  const p2 = d.pairs.find((x) => x.p === 'NCT05557591' && x.q === 'NCT05785767')
  ck('pair detail after list click', JSON.stringify([String(p2.shared_sites), Q.fmt.pct(p2.o_pq), Q.fmt.pct(p2.o_qp), Q.fmt.num(p2.months_both_recruiting_estimated, 1)]), JSON.stringify(facts))

  // Protocol to terms: multiplier 120%, preset Manhattan vs the Bronx, compare toggle off.
  await page.goto(`${BASE}/#terms-flow/NCT05800015`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.clear()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await wait(page, () => document.querySelectorAll('.tf-stats .stat-value').length >= 4 && document.querySelector('.tf-decomp-total'))
  const inp = await page.$('.tf-mult input')
  await inp.click({ clickCount: 3 })
  await inp.type('120')
  await page.evaluate(() => document.activeElement.blur())
  await wait(page, () => [...document.querySelectorAll('.tf-sheet-list li')].some((l) => l.innerText.includes('Multiplier: 120%')) && !document.querySelector('.tf-stale'))
  await Q.settle(page, 800)
  await page.evaluate(() => [...document.querySelectorAll('.tf-preset')].find((b) => b.innerText.includes('Bronx')).click())
  await wait(page, () => (document.querySelectorAll('.tf-cmp-site')[1]?.innerText ?? '').includes('Montefiore'))
  await Q.settle(page, 800)
  const scr = await page.evaluate(() => ({
    per: document.querySelector('.tf-stats .stat-value')?.innerText,
    totals: [...document.querySelectorAll('.tf-cmp-total')].map((e) => e.innerText),
    delta: document.querySelector('.tf-decomp-total')?.innerText,
    sites: [...document.querySelectorAll('.tf-cmp-site')].map((e) => e.innerText.replace(/\s+/g, ' ')),
  }))
  const b = (await Q.apiGet('/api/terms-flow/NCT05800015/budget?site_id=334d690736c4&multiplier=1.2')).body
  const c = (await Q.apiGet('/api/terms-flow/NCT05800015/compare?site_a=334d690736c4&site_b=17ac1cf8701d&multiplier=1.2')).body
  ck('120% per participant', Q.fmt.usd(b.totals.per_participant), scr.per)
  ck('120% compare totals (Manhattan vs Bronx)', JSON.stringify([Q.fmt.usd(c.a.totals.per_participant), Q.fmt.usd(c.b.totals.per_participant)]), JSON.stringify(scr.totals))
  ck('120% delta', Q.fmt.signedUsd(c.summary.delta_per_participant), scr.delta)
  ck('Bronx locality differs from Manhattan', true, c.a.locality.code !== c.b.locality.code, `${c.a.locality.name} ${c.a.locality.code} vs ${c.b.locality.name} ${c.b.locality.code}`)
  // One step at a time (tabs): the term sheet is step 6, chosen in the step nav.
  await Q.showStep(page, 6)
  const hrefOn = await page.$eval('#tf-step-6 a[download]', (a) => a.getAttribute('href'))
  await page.evaluate(() => document.querySelector('#tf-step-6 label.check input').click())
  await Q.sleep(300)
  const hrefOff = await page.$eval('#tf-step-6 a[download]', (a) => a.getAttribute('href'))
  ck('compare toggle adds compare_site', true, hrefOn.includes('compare_site=17ac1cf8701d') && hrefOn.includes('multiplier=1.2'), hrefOn)
  ck('compare toggle off drops compare_site', true, !hrefOff.includes('compare_site'), hrefOff)
  const mdOff = (await Q.apiGet(hrefOff)).body
  ck('markdown without compare has per participant at 120%', true, String(mdOff).includes(Q.fmt.usd(b.totals.per_participant)))

  // Research: every sub-tab after the default clear renders something and logs nothing.
  await page.goto(`${BASE}/#research/clear`, { waitUntil: 'domcontentloaded' })
  await Q.waitCleared(page)
  const subs = {}
  for (const label of ['Robustness', 'Map', 'Portfolio clearing', 'Price tags', 'Term sheet (old)', 'Model & data', 'Clear it']) {
    await Q.clickTab(page, label)
    await Q.sleep(1500)
    try {
      await Q.waitNoLoading(page, 120000)
    } catch {
      /* report below */
    }
    subs[label] = await page.evaluate(() => ({
      hash: location.hash,
      h1: document.querySelector('main h1')?.innerText ?? null,
      chars: document.querySelector('main')?.innerText.length ?? 0,
      errorBox: document.querySelector('main .error')?.innerText ?? null,
      loading: !!document.querySelector('main .loading'),
    }))
    ck(`research ${label} renders`, true, subs[label].chars > 400 && !subs[label].errorBox, subs[label])
  }

  Q.save(path.join(Q.OUT, 'interact.json'), { checks, errors, subs })
  console.log(`interact: ${checks.length} checks, ${checks.filter((x) => !x.ok).length} mismatches, ${errors.length} errors`)
  errors.forEach((e) => console.log('  ', e))
  await browser.close()
})().catch((e) => {
  console.error('FAILED', e)
  Q.save(path.join(Q.OUT, 'interact_failed.json'), { checks, errors })
  process.exit(1)
})
