// 2026-10-18 QA helper: at 390 px, measure the Protocol to terms budget table (step 4) column by column, to see
// why it is wider than its card. Usage: NODE_PATH=... node qa1018_measure_budget.js [base]
const Q = require('./qa1018_lib')
const BASE = process.argv[2] || 'http://localhost:5173'

;(async () => {
  const browser = await Q.launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  await page.goto(`${BASE}/#terms-flow/NCT05800015`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('.tf-stats .stat-value').length >= 4 && document.querySelector('table.tf-budget'), { timeout: 120000, polling: 300 })
  await Q.sleep(800)
  // One step at a time (tabs): the budget is step 3, chosen in the step nav (the compare table is measured on step 4).
  await Q.showStep(page, 3)
  const m = await page.evaluate(() => {
    const t = document.querySelector('table.tf-budget')
    const box = t.closest('.table-scroll')
    const cols = [...t.querySelectorAll('thead th')].map((th) => {
      const cs = getComputedStyle(th)
      return { text: th.innerText, w: Math.round(th.getBoundingClientRect().width), ws: cs.whiteSpace, minW: cs.minWidth, pad: cs.paddingLeft + ' ' + cs.paddingRight, display: cs.display }
    })
    const cmp = document.querySelector('table.tf-cmp-tbl')
    return {
      box: { clientWidth: box.clientWidth, scrollWidth: box.scrollWidth },
      table: { w: Math.round(t.getBoundingClientRect().width), minWidth: getComputedStyle(t).minWidth, width: getComputedStyle(t).width },
      cols,
      rowTh: (() => {
        const th = t.querySelector('tbody th[scope="row"]')
        const cs = getComputedStyle(th)
        return { w: Math.round(th.getBoundingClientRect().width), ws: cs.whiteSpace, minW: cs.minWidth }
      })(),
      tdWs: getComputedStyle(t.querySelector('tbody td')).whiteSpace,
      linesWrap: (() => {
        const w = document.querySelector('.tf-lines-wrap')
        return w ? { clientWidth: w.clientWidth, left: Math.round(w.getBoundingClientRect().left), right: Math.round(w.getBoundingClientRect().right) } : null
      })(),
      cmpCols: cmp ? [...cmp.querySelectorAll('thead th')].map((th) => ({ text: th.innerText, w: Math.round(th.getBoundingClientRect().width) })) : null,
    }
  })
  await Q.showStep(page, 4)
  m.cmpCols = await page.evaluate(() => {
    const cmp = document.querySelector('table.tf-cmp-tbl')
    return cmp ? [...cmp.querySelectorAll('thead th')].map((th) => ({ text: th.innerText, w: Math.round(th.getBoundingClientRect().width) })) : null
  })
  console.log(JSON.stringify(m, null, 1))
  await browser.close()
})()
