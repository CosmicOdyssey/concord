// Portfolio overlap, extra indication (breast cancer, site overlap only): Simple/Detailed x light/dark x 1440/390.
// Checks the exact site-only label, no eligibility numbers / shade / 80% dots in the breast view, no page-level
// horizontal scroll, 0 console/page errors; and that lung stays the default view with its shade.
//   NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node docs/qa/browser-qa/overlap_indication.js [base] [outdir]
const fs = require('fs')
const { launch, instrument, layoutCheck, shot, sleep, save } = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5287'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/indication2'
const LABEL = 'site overlap only; eligibility overlap is available for lung cancer'

async function open(browser, { width, density, theme, indication }) {
  const page = await browser.newPage()
  const log = {}
  instrument(page, log)
  await page.setViewport({ width, height: width < 600 ? 844 : 1000, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(
    (d, t, ind) => {
      try {
        localStorage.setItem('concord.density', d)
        localStorage.setItem('concord.theme', t)
        if (ind) sessionStorage.setItem('concord.overlap.indication', ind)
        else sessionStorage.removeItem('concord.overlap.indication')
      } catch {
        /* ignore */
      }
    },
    density,
    theme,
    indication,
  )
  await page.goto(`${BASE}/#overlap`, { waitUntil: 'networkidle0', timeout: 120000 })
  return { page, log }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch()
  const results = []
  let fail = 0
  try {
    for (const density of ['simple', 'detailed'])
      for (const theme of ['light', 'dark'])
        for (const width of [1440, 390]) {
          const name = `breast-${density}-${theme}-${width}`
          const { page, log } = await open(browser, { width, density, theme, indication: 'breast-cancer' })
          await page.waitForSelector('.ovs .hg-cell', { timeout: 120000 })
          await sleep(600)
          const info = await page.evaluate((LABEL) => {
            const root = document.querySelector('.ovs')
            const text = root.innerText
            const grid = root.querySelector('.ov-hg')
            return {
              hasLabel: text.includes(LABEL),
              labelCount: text.split(LABEL).length - 1,
              percentInView: (text.match(/\d+(\.\d+)?\s?%/g) || []).length,
              shadeCells: grid ? grid.querySelectorAll('.hg-h0,.hg-h1,.hg-h2,.hg-h3,.hg-h4').length : -1,
              hiDots: grid ? grid.querySelectorAll('.hg-hi').length : -1,
              cells: grid ? grid.querySelectorAll('.hg-cell').length : 0,
              cellNumbers: grid ? [...grid.querySelectorAll('.hg-n')].map((n) => n.textContent).slice(0, 12) : [],
              indication: document.querySelector('.ov-f-ind select')?.value,
              sponsor: document.querySelector('.ov-f-sponsor select')?.value,
              sumline: root.querySelector('.ov-sumline')?.innerText,
              pairPanel: root.querySelector('.ovs-pair')?.innerText?.slice(0, 400),
              stats: [...root.querySelectorAll('.stat')].map((s) => s.innerText.replace(/\s+/g, ' ')),
              head: document.querySelector('.page-head')?.innerText,
              // Simple: the months' basis is a hover card in the pair panel; Detailed: the "Both recruiting" row.
              monthsTip: !!root.querySelector('.ovs-pair [aria-label="How months are counted"]'),
              bothRow: [...root.querySelectorAll('.ovs-pair dt')].some((d) => d.textContent === 'Both recruiting'),
              // The pair list names the label once in its caption, never "absent" per row.
              pairCaption: root.querySelector('.ovs-pairs-tbl caption')?.innerText ?? null,
              absentCells: [...root.querySelectorAll('.ovs-pairs-tbl td')].filter((td) => td.textContent.trim() === 'absent').length,
              trialsLede: !!root.querySelector('.ovs-trials .ov-trials-lede'),
            }
          }, LABEL)
          const lay = await layoutCheck(page)
          await shot(page, OUT, name)
          // The hover card of the first cell (keyboard focus), viewport only.
          await page.focus('.ovs .hg-cell')
          await sleep(400)
          const tip = await page.evaluate(() => document.querySelector('.hc-card:not([hidden])')?.innerText ?? null)
          if (density === 'simple' && width === 1440) await shot(page, OUT, `${name}-cellcard`, false)
          const simple = density === 'simple'
          const ok =
            info.hasLabel && info.percentInView === 0 && info.shadeCells === 0 && info.hiDots === 0 && info.cells > 0 && !lay.overflow &&
            info.monthsTip === simple && info.bothRow === !simple && info.trialsLede === simple && info.absentCells === 0 &&
            (simple || (info.pairCaption || '').includes(LABEL)) && (tip || '').includes('later ClinicalTrials.gov start date') &&
            log.console.filter((c) => c.type === 'error').length === 0 && log.pageerrors.length === 0
          if (!ok) fail++
          results.push({ name, ok, info, tip, overflow: lay.overflow, docScrollWidth: lay.docScrollWidth, offenders: lay.offenders.slice(0, 5), console: log.console, pageerrors: log.pageerrors })
          console.log(name, ok ? 'OK' : 'FAIL', JSON.stringify({ cells: info.cells, pct: info.percentInView, shade: info.shadeCells, dots: info.hiDots, overflow: lay.overflow, errs: log.console.length + log.pageerrors.length }))
          await page.close()
        }

    // From a lung deep link, choosing breast cancer resets the hash to #overlap, so a reload keeps breast cancer.
    {
      const name = 'deeplink-switch'
      // Not open(): its init script would reset the stored indication on the reload this check depends on.
      const page = await browser.newPage()
      const log = {}
      instrument(page, log)
      await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
      await page.evaluateOnNewDocument(() => {
        try {
          localStorage.setItem('concord.density', 'simple')
          localStorage.setItem('concord.theme', 'light')
        } catch {
          /* ignore */
        }
      })
      await page.goto(`${BASE}/#overlap/regeneron`, { waitUntil: 'networkidle0', timeout: 120000 })
      await page.waitForSelector('.ov .ov-f-ind select', { timeout: 120000 })
      const before = await page.evaluate(() => ({ hash: location.hash, ind: document.querySelector('.ov-f-ind select')?.value }))
      await page.select('.ov-f-ind select', 'breast-cancer')
      await page.waitForSelector('.ovs .hg-cell', { timeout: 120000 })
      const after = await page.evaluate(() => location.hash)
      await page.reload({ waitUntil: 'networkidle0', timeout: 120000 })
      await page.waitForSelector('.ov-f-ind select', { timeout: 120000 })
      await sleep(600)
      const reloaded = await page.evaluate(() => ({ hash: location.hash, ind: document.querySelector('.ov-f-ind select')?.value, isSites: !!document.querySelector('.ovs') }))
      const info = { before, after, reloaded }
      const ok =
        before.ind === 'lung' && after === '#overlap' && reloaded.ind === 'breast-cancer' && reloaded.isSites &&
        log.console.filter((c) => c.type === 'error').length === 0 && log.pageerrors.length === 0
      if (!ok) fail++
      results.push({ name, ok, info, console: log.console, pageerrors: log.pageerrors })
      console.log(name, ok ? 'OK' : 'FAIL', JSON.stringify(info))
      await page.close()
    }

    // Lung default: no stored indication -> the lung view, with its shade.
    for (const [density, width] of [
      ['simple', 1440],
      ['detailed', 390],
    ]) {
      const name = `lung-default-${density}-light-${width}`
      const { page, log } = await open(browser, { width, density, theme: 'light', indication: null })
      await page.waitForSelector('.ov .ov-f-ind select', { timeout: 120000 })
      await page.waitForSelector('.ov .hg-cell, .ov .ov-cell', { timeout: 180000 })
      await sleep(600)
      const info = await page.evaluate(() => ({
        indication: document.querySelector('.ov-f-ind select')?.value,
        options: [...document.querySelectorAll('.ov-f-ind option')].map((o) => o.textContent),
        isSites: !!document.querySelector('.ovs'),
        shadeCells: document.querySelectorAll('.ov .hg-h0,.ov .hg-h1,.ov .hg-h2,.ov .hg-h3,.ov .hg-h4').length,
        lede: document.querySelector('.page-head .lede')?.textContent,
      }))
      const lay = await layoutCheck(page)
      await shot(page, OUT, name)
      const ok = info.indication === 'lung' && !info.isSites && !lay.overflow && log.console.filter((c) => c.type === 'error').length === 0 && log.pageerrors.length === 0
      if (!ok) fail++
      results.push({ name, ok, info, overflow: lay.overflow, offenders: lay.offenders.slice(0, 5), console: log.console, pageerrors: log.pageerrors })
      console.log(name, ok ? 'OK' : 'FAIL', JSON.stringify(info))
      await page.close()
    }
  } finally {
    await browser.close()
  }
  save(`${OUT}/qa_results.json`, results)
  console.log(fail ? `FAILURES: ${fail}` : 'ALL OK', `-> ${OUT}`)
  process.exitCode = fail ? 1 : 0
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 2
})
