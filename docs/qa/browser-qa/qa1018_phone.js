// 2026-10-18 QA at phone width (390x844): each top-level tab for page-level horizontal overflow, elements cut off
// at the viewport edge (outside a scroll box that fits), and screenshots (<name>-390.png).
// Usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node qa1018_phone.js [base] [prefix]
const path = require('path')
const Q = require('./qa1018_lib')

const BASE = process.argv[2] || 'http://localhost:5173'
const PREFIX = process.argv[3] || '12'
const out = { base: BASE, tabs: [], errors: [] }

const TABS = [
  ['#findings', 'findings', () => document.querySelectorAll('.fd-card').length >= 3 && document.querySelector('.ci-plot')],
  ['#overlap/regeneron', 'overlap', () => (document.querySelector('.ov-detail h2')?.innerText ?? '').includes('NCT05785767')],
  ['#terms-flow/NCT05800015', 'terms-flow', () => document.querySelectorAll('.tf-stats .stat-value').length >= 4 && document.querySelector('.tf-decomp-total') && document.querySelector('.tf-sheet')],
  ['#research/clear', 'research', () => document.querySelector('.tbl-trials tbody tr')],
]

;(async () => {
  const browser = await Q.launch()
  for (const [hash, name, ready] of TABS) {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && out.errors.push(`${name} [${m.type()}] ${m.text()}`))
    page.on('pageerror', (e) => out.errors.push(`${name} [pageerror] ${e}`))
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(ready, { timeout: 300000, polling: 300 })
    await Q.sleep(1000)
    const layout = await Q.layoutCheck(page)
    // Tab bars: every tab reachable (inside a horizontal scroller that fits the screen, or fully visible).
    const bars = await page.evaluate(() =>
      [...document.querySelectorAll('nav.tabs, .rs-tabs, .tf-steps, .ov-controls .controls-row')].map((b) => {
        const r = b.getBoundingClientRect()
        const cs = getComputedStyle(b)
        return { el: b.className, left: Math.round(r.left), right: Math.round(r.right), clientWidth: b.clientWidth, scrollWidth: b.scrollWidth, overflowX: cs.overflowX, flexWrap: cs.flexWrap }
      }),
    )
    // Form controls narrower than 44 px or wider than the viewport.
    const controls = await page.evaluate(() => {
      const vw = innerWidth
      return [...document.querySelectorAll('main button, main select, main input, main a.btn')]
        .map((e) => {
          const r = e.getBoundingClientRect()
          return { tag: e.tagName.toLowerCase(), cls: e.className, text: (e.innerText || e.value || e.getAttribute('aria-label') || '').slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) }
        })
        .filter((c) => c.w > 0 && (c.right > vw + 1 || c.left < -1))
    })
    const t = { name, hash, layout, bars, controlsOffscreen: controls }
    out.tabs.push(t)
    console.log(name, 'scrollWidth', layout.docScrollWidth, 'innerWidth', layout.innerWidth, 'overflow', layout.overflow, 'offenders', layout.offenders.length, 'offscreen controls', controls.length)
    layout.offenders.forEach((o) => console.log('   offender', JSON.stringify(o)))
    controls.slice(0, 10).forEach((o) => console.log('   control', JSON.stringify(o)))
    await Q.snap(browser, page, `${PREFIX}-${name}-390`, { fullPage: false })
    await Q.snap(browser, page, `${PREFIX}-${name}-390-full`, { fullPage: true, maxH: 4200 })
    await page.close()
  }
  Q.save(path.join(Q.OUT, `phone_${PREFIX}.json`), out)
  console.log('errors', out.errors.length)
  out.errors.forEach((e) => console.log('  ', e))
  await browser.close()
})().catch((e) => {
  console.error('FAILED', e)
  Q.save(path.join(Q.OUT, `phone_${PREFIX}_failed.json`), out)
  process.exit(1)
})
