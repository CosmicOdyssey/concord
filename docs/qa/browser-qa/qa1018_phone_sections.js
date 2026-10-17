// 2026-10-18 QA at 390x844: section screenshots of the two product views (the full pages are too tall to read)
// and measurements of the nested scrollers in the Protocol to terms budget and compare steps.
// Usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node qa1018_phone_sections.js [base] [prefix]
const path = require('path')
const Q = require('./qa1018_lib')

const BASE = process.argv[2] || 'http://localhost:5173'
const PREFIX = process.argv[3] || '13'
const out = { base: BASE, sections: [], errors: [] }

async function open(browser, hash, ready) {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && out.errors.push(`${hash} [${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => out.errors.push(`${hash} [pageerror] ${e}`))
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(ready, { timeout: 120000, polling: 300 })
  await Q.sleep(1000)
  return page
}

function measure(page, sel) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return null
    const vw = innerWidth
    const r = root.getBoundingClientRect()
    const scrollers = [...root.querySelectorAll('*')]
      .filter((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1)
      .map((e) => {
        const b = e.getBoundingClientRect()
        return { el: e.tagName.toLowerCase() + '.' + String(e.className).trim().split(/\s+/).join('.'), left: Math.round(b.left), right: Math.round(b.right), clientWidth: e.clientWidth, scrollWidth: e.scrollWidth, fitsViewport: b.left >= -1 && b.right <= vw + 1 }
      })
    // Header cells of each table that start past the right edge of their scroller (need a sideways scroll to see).
    const hidden = [...root.querySelectorAll('table')].map((t) => {
      const box = t.closest('.table-scroll, .tf-lines-wrap, .ov-mscroll')
      const br = box ? box.getBoundingClientRect() : { left: 0, right: vw }
      const right = Math.min(br.right, vw)
      return {
        table: t.className,
        offscreenHeaders: [...t.querySelectorAll(':scope > thead th')].filter((th) => th.getBoundingClientRect().left >= right - 4).map((th) => th.innerText.trim()),
      }
    })
    return { left: Math.round(r.left), right: Math.round(r.right), scrollers, hidden }
  }, sel)
}

;(async () => {
  const browser = await Q.launch()
  {
    const page = await open(browser, '#overlap/regeneron', () => (document.querySelector('.ov-detail h2')?.innerText ?? '').includes('NCT05785767'))
    for (const [sel, name] of [
      ['section[aria-label="Pair matrix"]', 'overlap-matrix'],
      ['.ov-detail', 'overlap-pair-detail'],
    ]) {
      out.sections.push({ name, m: await measure(page, sel) })
      await Q.snap(browser, await page.$(sel), `${PREFIX}-${name}-390`, { element: true, maxH: 2400 })
    }
    await page.close()
  }
  {
    const page = await open(browser, '#terms-flow/NCT05800015', () => document.querySelector('#tf-step-3 .tf-payer-value') && document.querySelector('.tf-decomp-total') && document.querySelector('.tf-sheet'))
    // One step at a time (tabs): choose each step in the step nav before measuring it.
    for (const [step, name] of [
      [2, 'terms-schedule'],
      [3, 'terms-budget'],
      [4, 'terms-compare'],
      [6, 'terms-termsheet'],
    ]) {
      const sel = await Q.showStep(page, step)
      out.sections.push({ name, m: await measure(page, sel) })
      await Q.snap(browser, await page.$(sel), `${PREFIX}-${name}-390`, { element: true, maxH: 2400 })
    }
    await page.close()
  }
  Q.save(path.join(Q.OUT, `phone_sections_${PREFIX}.json`), out)
  for (const s of out.sections) {
    console.log('==', s.name, s.m && `${s.m.left}..${s.m.right}`)
    for (const x of s.m?.scrollers ?? []) console.log('   scroller', JSON.stringify(x))
    for (const h of s.m?.hidden ?? []) if (h.offscreenHeaders.length) console.log('   offscreen headers', JSON.stringify(h))
  }
  console.log('errors', out.errors.length)
  await browser.close()
})().catch((e) => {
  console.error('FAILED', e)
  process.exit(1)
})
