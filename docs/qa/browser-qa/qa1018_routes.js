// 2026-10-18 QA: hash routing (deep links, pre-pivot flat links, back/forward), console errors, and light/dark
// rendering of each top-level tab at 1440x900.
// Usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node qa1018_routes.js [base] [dark=1]
const path = require('path')
const Q = require('./qa1018_lib')

const BASE = process.argv[2] || 'http://localhost:5173'
const DARK = (process.argv[3] ?? '1') !== '0'
const results = []
const errors = []

function rec(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(ok ? 'ok  ' : 'FAIL', name, detail ? JSON.stringify(detail) : '')
}

async function state(page) {
  return page.evaluate(() => ({
    hash: location.hash,
    tab: [...document.querySelectorAll('nav.tabs button')].find((b) => b.getAttribute('aria-selected') === 'true')?.innerText.replace(/^\d+\s*/, '').trim(),
    sub: document.querySelector('.rs-tabs button[aria-selected="true"]')?.innerText.trim() ?? null,
    h1: document.querySelector('main h1')?.innerText ?? null,
    banner: !!document.querySelector('.rs-banner'),
  }))
}

async function fresh(browser, hash, scheme = 'light') {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${hash} [${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${hash} [pageerror] ${e}`))
  page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && errors.push(`${hash} [http ${r.status()}] ${r.url()}`))
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
  await Q.sleep(400)
  return page
}

const wait = (page, fn, arg, timeout = 60000) => page.waitForFunction(fn, { timeout, polling: 300 }, arg)

;(async () => {
  const browser = await Q.launch()

  // Deep link: #overlap/regeneron opens the preset with the fianlimab pair selected.
  {
    const page = await fresh(browser, '#overlap/regeneron')
    await wait(page, () => {
      const strip = document.querySelector('.ov-win .win-strip')?.innerText ?? ''
      const sum = document.querySelector('.ov-sumline')?.innerText ?? ''
      return strip.includes('Regeneron') && sum.includes('September 1, 2024') && (document.querySelector('.ov-detail h2')?.innerText ?? '').includes('NCT05785767 × NCT05800015')
    })
    const s = await state(page)
    // Simple (a fresh visitor's density) draws the half grid: the selected pair's cell is its one [data-cell] wrapper.
    const sel = await page.$eval('.ov-matrix td.ov-sel, .ov-hg .ov-sel[data-cell]', (td) => td.dataset.cell).catch(() => null)
    rec('#overlap/regeneron opens the Regeneron 2024-09-01 preset with the fianlimab pair', s.tab === 'Portfolio overlap' && sel === 'NCT05785767|NCT05800015', { ...s, sel })
    // Reload keeps it.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await wait(page, () => (document.querySelector('.ov-detail h2')?.innerText ?? '').includes('NCT05785767 × NCT05800015'))
    rec('#overlap/regeneron survives reload', true, await state(page))
    await page.close()
  }

  // Deep links to Protocol to terms: both trials.
  for (const nct of ['NCT05800015', 'NCT06627647']) {
    const page = await fresh(browser, `#terms-flow/${nct}`)
    await wait(page, () => document.querySelector('.tf-trial-on') && document.querySelector('.tf-grid') && document.querySelectorAll('.tf-stats .stat-value').length >= 4, null, 90000)
    const on = await page.$eval('.tf-trial-on', (e) => e.innerText)
    const s = await state(page)
    // One step at a time (tabs): the term sheet is step 6, chosen in the step nav.
    await Q.showStep(page, 6).catch(() => {})
    const sheet = await page.$eval('#tf-step-6', (e) => e.innerText).catch(() => '')
    rec(`#terms-flow/${nct} selects that trial`, s.tab === 'Protocol to terms' && on.includes(nct) && s.hash === `#terms-flow/${nct}`, { ...s, on: on.slice(0, 60) })
    await page.close()
  }

  // Hash change while on Protocol to terms switches trial.
  {
    const page = await fresh(browser, '#terms-flow/NCT05800015')
    await wait(page, () => document.querySelector('.tf-trial-on')?.innerText.includes('NCT05800015') && document.querySelector('.tf-grid'), null, 90000)
    await page.evaluate(() => {
      location.hash = '#terms-flow/NCT06627647'
    })
    await wait(page, () => document.querySelector('.tf-trial-on')?.innerText.includes('NCT06627647') && document.querySelectorAll('.tf-stats .stat-value').length >= 4, null, 90000)
    rec('hash change #terms-flow/NCT05800015 -> NCT06627647 while open switches trial', true, await state(page))
    await page.close()
  }

  // Research deep link and pre-pivot flat links.
  for (const [hash, sub] of [
    ['#research/clear', 'Clear it'],
    ['#research/robustness', 'Robustness'],
    ['#research/model', 'Model & data'],
    ['#clear', 'Clear it'],
    ['#map', 'Map'],
    ['#robustness', 'Robustness'],
    ['#terms', 'Term sheet'],
    ['#portfolio/regeneron', 'Portfolio clearing'],
  ]) {
    const page = await fresh(browser, hash)
    await wait(page, () => document.querySelector('.rs-banner') && document.querySelector('.rs-tabs button[aria-selected="true"]'))
    await Q.sleep(600)
    const s = await state(page)
    rec(`${hash} opens Research / ${sub}`, s.tab === 'Research' && s.sub === sub && s.banner, s)
    await page.close()
  }

  // #findings/allocation scrolls to the second finding; unknown hash falls back to Findings.
  {
    const page = await fresh(browser, '#findings/allocation')
    await wait(page, () => document.querySelectorAll('.fd-card').length >= 3)
    await Q.sleep(800)
    const top = await page.$eval('#finding-allocation', (e) => Math.round(e.getBoundingClientRect().top))
    rec('#findings/allocation scrolls to the allocation finding', Math.abs(top) < 120, { top })
    await page.close()
    const p2 = await fresh(browser, '#nonsense/xyz')
    await wait(p2, () => document.querySelectorAll('.fd-card').length >= 3)
    rec('unknown hash falls back to Findings', (await state(p2)).tab === 'Findings', await state(p2))
    await p2.close()
  }

  // Back / forward across the four tabs (clicking the tab bar).
  {
    const page = await fresh(browser, '#findings')
    await wait(page, () => document.querySelectorAll('.fd-card').length >= 3)
    const seq = []
    for (const label of ['Portfolio overlap', 'Protocol to terms', 'Research', 'Findings']) {
      await Q.clickTab(page, label)
      await Q.sleep(1200)
      seq.push(await state(page))
    }
    rec('tab clicks', seq.map((s) => s.tab).join(' > ') === 'Portfolio overlap > Protocol to terms > Research > Findings', seq.map((s) => `${s.tab} ${s.hash}`))
    const back = []
    for (let i = 0; i < 4; i++) {
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null)
      await Q.sleep(1200)
      back.push(await state(page))
    }
    rec('back x4', back.map((s) => s.tab).join(' > ') === 'Research > Protocol to terms > Portfolio overlap > Findings', back.map((s) => `${s.tab} ${s.hash} ${s.h1}`))
    const fwd = []
    for (let i = 0; i < 2; i++) {
      await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => null)
      await Q.sleep(1200)
      fwd.push(await state(page))
    }
    rec('forward x2', fwd.map((s) => s.tab).join(' > ') === 'Portfolio overlap > Protocol to terms', fwd.map((s) => `${s.tab} ${s.hash} ${s.h1}`))
    // The view under the tab bar matches the selected tab.
    const h1 = await page.$eval('main h1', (e) => e.innerText).catch(() => null)
    rec('view matches tab after forward', h1 === 'Protocol to terms', { h1 })
    // Research sub-tab back/forward.
    await Q.clickTab(page, 'Research')
    await Q.sleep(800)
    await Q.clickTab(page, 'Model & data')
    await Q.sleep(800)
    await Q.clickTab(page, 'Robustness')
    await Q.sleep(800)
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null)
    await Q.sleep(1000)
    const sb = await state(page)
    rec('back between research sub-tabs', sb.sub === 'Model & data' && sb.hash === '#research/model', sb)
    await page.close()
  }

  // Light and dark render of each top-level tab.
  const shots = []
  for (const scheme of DARK ? ['light', 'dark'] : ['light']) {
    for (const [hash, name, ready] of [
      ['#findings', 'findings', () => document.querySelectorAll('.fd-card').length >= 3],
      ['#overlap/regeneron', 'overlap', () => (document.querySelector('.ov-detail h2')?.innerText ?? '').includes('NCT05785767')],
      ['#terms-flow/NCT05800015', 'terms-flow', () => document.querySelectorAll('.tf-stats .stat-value').length >= 4 && document.querySelector('.tf-decomp-total')],
      ['#research/clear', 'research-clear', () => document.querySelector('.tbl-trials tbody tr')],
    ]) {
      const page = await fresh(browser, hash, scheme)
      await wait(page, ready, null, 300000)
      await Q.sleep(800)
      const colors = await page.evaluate(() => {
        const cs = (el) => (el ? getComputedStyle(el) : null)
        const b = cs(document.body)
        const card = cs(document.querySelector('main .card'))
        return { bodyBg: b.backgroundColor, bodyColor: b.color, cardBg: card?.backgroundColor ?? null, scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' }
      })
      const lum = (rgb) => {
        const m = (rgb || '').match(/\d+(\.\d+)?/g)
        if (!m) return null
        const [r, g, bb] = m.slice(0, 3).map(Number)
        return (0.2126 * r + 0.7152 * g + 0.0722 * bb) / 255
      }
      const bg = lum(colors.bodyBg)
      const fg = lum(colors.bodyColor)
      const ok = scheme === 'dark' ? bg !== null && bg < 0.3 && fg > 0.6 : bg > 0.8 && fg < 0.4
      rec(`${scheme} mode ${name}: body background/text`, ok, colors)
      if (scheme === 'dark') {
        const file = `11-dark-${name}`
        await Q.snap(browser, page, file, { fullPage: false })
        shots.push(file)
      }
      await page.close()
    }
  }

  Q.save(path.join(Q.OUT, 'routes.json'), { results, errors, shots })
  console.log(`routes: ${results.filter((r) => r.ok).length}/${results.length} ok; console/page/http errors: ${errors.length}`)
  errors.forEach((e) => console.log('  ', e))
  await browser.close()
})().catch((e) => {
  console.error('FAILED', e)
  Q.save(path.join(Q.OUT, 'routes_failed.json'), { results, errors })
  process.exit(1)
})
