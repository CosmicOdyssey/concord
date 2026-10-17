// Verify the fixes: trials-table fit at laptop widths, corrected labels, no console errors.
// Usage: node verify.js <baseUrl> <outName>
const L = require('./lib')
const fs = require('fs')

const BASE = process.argv[2] || 'http://localhost:5174'
const NAME = process.argv[3] || 'verify'
const DIR = `${L.WORK}/${NAME}`
fs.mkdirSync(DIR, { recursive: true })

;(async () => {
  const log = { base: BASE, widths: {}, text: {} }
  const browser = await L.launch()
  const page = await browser.newPage()
  // Detailed: the trials table and the notes are inline (Simple puts them in Details disclosures).
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('concord.density', 'detailed')
    } catch {
      /* storage off */
    }
  })
  L.instrument(page, log)
  try {
    await page.setViewport({ width: 1400, height: 900 })
    await page.goto(BASE + L.RESEARCH_START, { waitUntil: 'domcontentloaded' }) // research views; the landing page does not clear
    await L.waitCleared(page, 'US-Northeast')
    await L.settle(page, 1000)
    log.text.map = await page.evaluate(() => [...document.querySelectorAll('.side p')].map((p) => p.innerText).join(' | '))
    await L.clickTab(page, 'Clear it')
    await page.evaluate(() => {
      const d = document.querySelector('details.assumptions')
      if (d) d.open = true
    })
    for (const w of [1440, 1400, 1280, 1024]) {
      await page.setViewport({ width: w, height: 900 })
      await L.sleep(700)
      log.widths[w] = await page.evaluate(() => {
        const t = document.querySelector('.tbl-trials')
        const sc = t.closest('.table-scroll')
        const head = [...t.querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().height))
        return { clientWidth: sc.clientWidth, scrollWidth: sc.scrollWidth, clipped: sc.scrollWidth - sc.clientWidth, headHeights: head }
      })
      const box = await page.evaluate(() => {
        const r = document.querySelector('.tbl-trials').closest('.card, .win').getBoundingClientRect()
        return { x: r.left, y: r.top + window.scrollY, w: r.width }
      })
      await page.screenshot({ path: `${DIR}/clear_trials_${w}.png`, clip: { x: Math.max(0, box.x), y: box.y, width: Math.min(box.w, w), height: 520 }, captureBeyondViewport: true })
    }
    log.text.assumptions = await page.evaluate(() => document.querySelector('.raw-grid')?.innerText)
    await page.setViewport({ width: 1400, height: 900 })
    await L.clickTab(page, 'Robustness')
    await L.waitNoLoading(page)
    log.text.robustCaveat = await page.evaluate(() => document.querySelector('main .caveat')?.innerText)
    await L.clickTab(page, 'Model & data')
    await page.waitForFunction(() => document.querySelector('main .coefplot'), { timeout: L.LONG })
    await page.evaluate(() => document.querySelectorAll('main details').forEach((d) => (d.open = true)))
    await L.sleep(400)
    log.text.model = await page.evaluate(() => [...document.querySelectorAll('main .kv-row span')].map((s) => s.innerText).join(' | '))
    log.text.specs = await page.evaluate(() => [...document.querySelectorAll('main details tbody tr')].map((r) => r.children[0].innerText + ' / ' + r.children[1].innerText).join(' | '))
    await L.clickTab(page, 'Portfolio')
    await L.sleep(800)
    log.text.portfolio = await page.evaluate(() => document.querySelector('main .controls p.muted')?.innerText)
    await L.shot(page, DIR, 'portfolio_label', false)
  } catch (e) {
    log.error = String(e && e.stack ? e.stack : e)
  } finally {
    L.save(`${L.WORK}/${NAME}_log.json`, { ...log, api: log.api.map((a) => ({ url: a.url, status: a.status })) })
    console.log(JSON.stringify({ widths: log.widths, text: log.text, console: log.console, pageerrors: log.pageerrors, error: log.error }, null, 1))
    await browser.close()
  }
})()
