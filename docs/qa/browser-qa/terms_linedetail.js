// Browser QA for the term-sheet line detail: the step-by-step price table (LineBreakdown.tsx) that replaced the
// one-line formula. Simple and Detailed, light and dark, 1440 and 390 px; page and console errors; horizontal page
// scroll; the table's numbers equal to the API (71260: $191.25 at NY 01 Manhattan, $195.46 at NY 02 NYC Suburbs/Long
// Island); the multiplier and overhead boxes in the table edit the step 3 controls; the hover-card variant.
// Steps are tabs (termsSteps.tsx): each check first chooses its step in the step nav (lib.js showStep), since only the
// step on show is visible (the others are mounted but hidden).
// Usage (NODE_PATH must reach puppeteer-core): node terms_linedetail.js [baseUrl] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep, layoutCheck, showStep } = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5288'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/linedetail'
fs.mkdirSync(OUT, { recursive: true })
const getJson = async (p) => (await fetch(BASE + p)).json()
const fails = []
const notes = []
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`)
  return !!ok
}

;(async () => {
  const browser = await launch()
  const log = { console: [], pageerrors: [], failed: [] }
  const open = async (name, nct, width, { theme = 'light', density = 'simple', hash } = {}) => {
    const page = await browser.newPage()
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && log.console.push(`${name}: ${m.text()}`))
    page.on('pageerror', (e) => log.pageerrors.push(`${name}: ${e}`))
    page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && log.failed.push(`${name}: ${r.status()} ${r.url()}`))
    await page.evaluateOnNewDocument(
      (theme, density) => {
        try {
          localStorage.clear()
          localStorage.setItem('concord.theme', theme)
          localStorage.setItem('concord.density', density)
        } catch {
          /* ignore */
        }
      },
      theme,
      density,
    )
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
    await page.goto(`${BASE}/${hash ?? `#terms-flow/${nct}`}`, { waitUntil: 'domcontentloaded' })
    return page
  }
  const waitTable = (page) =>
    page.waitForFunction(() => document.querySelector('#tf-step-6 .lb-tbl') && !document.querySelector('#tf-step-6 .lb-stale'), {
      timeout: 60000,
      polling: 300,
    })
  const shotStep = async (page, file) => {
    const el = await page.$('#tf-step-6 .lb-wrap')
    await el.scrollIntoView()
    await sleep(300)
    await el.screenshot({ path: path.join(OUT, file) })
  }

  // ---- API truth
  for (const [nct, want] of [
    ['NCT05800015', 191.25],
    ['NCT06627647', 195.46],
  ]) {
    const s = await getJson(`/api/terms-flow/${nct}/sites`)
    const [A, B] = s.default_pair
    const d = await getJson(`/api/terms-flow/${nct}/line-detail?node_id=C7D1:ct_chest&site_a=${A}&site_b=${B}&multiplier=1`)
    const a = d.sites.a
    notes.push(
      `${nct} Site A ${a.site.label}, ${a.adjustment_source.label}: units ${d.components.map((c) => c.units).join('/')}, adj ${Object.values(a.adjustment).join('/')}, total ${a.total_units} x ${d.conversion_factor} = $${a.medicare_rate}; sponsor x${a.sponsor.multiplier} + ${a.sponsor.overhead_rate * 100}% = $${a.sponsor.sponsor_price}; budget per participant $${a.reconcile.per_participant} adds up ${a.reconcile.adds_up}. Site B ${d.sites.b.adjustment_source.label}: $${d.sites.b.medicare_rate}`,
    )
    check(`${nct} Site A Medicare rate`, a.medicare_rate === want, String(a.medicare_rate))
  }

  // ---- every density x theme x width
  for (const density of ['simple', 'detailed'])
    for (const theme of ['light', 'dark'])
      for (const width of [1440, 390]) {
        const name = `${density}-${theme}-${width}`
        const page = await open(name, 'NCT05800015', width, { theme, density })
        await waitTable(page)
        await showStep(page, 'term-sheet')
        await sleep(500)
        const txt = await page.$eval('#tf-step-6 .lb-wrap', (e) => e.innerText)
        check(`${name}: Medicare rate $191.25`, txt.includes('$191.25'))
        check(`${name}: Site B $148.38`, txt.includes('$148.38'))
        check(`${name}: sponsor price $239.06`, txt.includes('$239.06'))
        check(`${name}: setting note`, txt.includes('office-setting (non-facility) rate'))
        check(`${name}: same-at-every-site note`, txt.includes('Units and dollars per unit are the same at every site'))
        check(`${name}: CMS link`, await page.$eval('#tf-step-6 a.lb-cms', (a) => a.href === 'https://www.cms.gov/medicare/physician-fee-schedule/search'))
        // The CMS file names ("RVU file", "GPCI file") are the cited sources; every other technical term is in a tooltip.
        const plain = txt.replace(/RVU file|GPCI file/g, '')
        check(`${name}: no RVU/GPCI/nonQPP outside the file names`, !/RVU|GPCI|nonQPP|non-facility RVU/.test(plain), plain.match(/.{0,30}(RVU|GPCI|nonQPP).{0,30}/)?.[0])
        if (density === 'detailed') {
          for (const s of ["Doctor's time", 'Practice costs (staff, equipment, rent)', 'Malpractice insurance', 'Total units', 'Medicare dollars per unit (2026 conversion factor)', 'Sponsor price for this line'])
            check(`${name}: row ${s}`, txt.replace(/’/g, "'").includes(s))
          check(`${name}: RVU source`, txt.includes('CMS 2026 Physician Fee Schedule RVU file (rvu26d, October release), row 71260'))
          check(`${name}: GPCI source`, txt.includes('CMS 2026 GPCI file, locality Manhattan (NY 01)'))
          check(`${name}: CF source`, txt.includes('CMS CY 2026 conversion factor'))
          check(`${name}: reconciles`, txt.includes('$6,568.67') && txt.includes('the total shown in Budget'))
          check(`${name}: assumptions labelled in the reconciliation`, txt.includes('(Concord’s proposed standard schedule, an assumption)') && txt.includes('overhead assumption)'))
          check(`${name}: no plain 'non-facility' outside the setting note`, !txt.replace('office-setting (non-facility) rate', '').includes('non-facility'))
          if (width === 390) {
            // phones: the compact summary sits above the full table, so both sites' rates and sponsor prices are in view
            const inView = await page.$eval('#tf-step-6 .lb-phone-summary', (e) => {
              const cells = [...e.querySelectorAll('td.num.strong')]
              return cells.length >= 4 && cells.every((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.right <= window.innerWidth })
            })
            check(`${name}: phone summary numbers in view`, inView)
            const siteB = await page.$eval('#tf-step-6 .lb-full thead th.lb-site', (e) => e.getBoundingClientRect().left)
            check(`${name}: a site column starts in view`, siteB < 390, String(siteB))
          }
        }
        const lay = await layoutCheck(page)
        check(`${name}: no horizontal page scroll`, !lay.overflow, `${lay.docScrollWidth} > ${lay.innerWidth}`)
        await shotStep(page, `${name}.png`)
        await page.close()
      }

  // ---- Detailed: the table's multiplier and overhead boxes edit the step 3 controls
  {
    const page = await open('edit', 'NCT05800015', 1440, { density: 'detailed' })
    await waitTable(page)
    await showStep(page, 'term-sheet')
    const boxes = await page.$$('#tf-step-6 .lb-pct input')
    check('edit: two boxes', boxes.length === 2, String(boxes.length))
    await boxes[0].click({ clickCount: 3 })
    await boxes[0].type('150')
    await boxes[0].press('Enter')
    await sleep(400)
    await waitTable(page)
    await page.waitForFunction(() => document.querySelector('#tf-step-6 .lb-wrap').innerText.includes('$286.88'), { timeout: 30000, polling: 300 })
    const step3 = await page.$eval('.tf-mult input', (i) => i.value)
    check('edit: step 3 % of Medicare follows the table', step3 === '150', step3)
    await boxes[1].click({ clickCount: 3 })
    await boxes[1].type('20')
    await boxes[1].press('Enter')
    await sleep(400)
    await waitTable(page)
    // 191.25 x 1.5 = 286.88; + 20% = 57.38; = 344.26
    await page.waitForFunction(() => document.querySelector('#tf-step-6 .lb-wrap').innerText.includes('$344.26'), { timeout: 30000, polling: 300 })
    const over3 = await page.$eval('.tfa-over input', (i) => i.value)
    check('edit: step 3 overhead follows the table', over3 === '20', over3)
    const s = await getJson(`/api/terms-flow/NCT05800015/sites`)
    const bud = await getJson(`/api/terms-flow/NCT05800015/budget?site_id=${s.default_pair[0]}&multiplier=1.5&standard=${encodeURIComponent('{"overhead":0.2}')}`)
    const txt = await page.$eval('#tf-step-6 .lb-wrap', (e) => e.innerText)
    check('edit: reconciles with the edited budget', txt.includes(`$${bud.totals.per_participant.toLocaleString('en-US', { minimumFractionDigits: 2 })}`), String(bud.totals.per_participant))
    notes.push(`edited: x150% +20% -> sponsor price $344.26; budget per participant $${bud.totals.per_participant}`)
    await shotStep(page, 'detailed-light-1440-edited.png')
    await page.close()
  }

  // ---- NCT06627647 Site A (Westbury, NY 02): $195.46
  {
    const page = await open('westbury', 'NCT06627647', 1440, { density: 'detailed' })
    await waitTable(page)
    await showStep(page, 'term-sheet')
    const txt = await page.$eval('#tf-step-6 .lb-wrap', (e) => e.innerText)
    check('westbury: $195.46', txt.includes('$195.46'))
    check('westbury: locality NY 02', txt.includes('CMS 2026 GPCI file, locality NYC Suburbs/Long Island (NY 02)'))
    await shotStep(page, 'detailed-light-1440-NCT06627647-westbury.png')
    await page.close()
  }

  // ---- hover-card variant (budget provenance column) and the coverage node detail
  for (const width of [1440, 390]) {
    const page = await open(`hover-${width}`, 'NCT05800015', width, { density: 'detailed' })
    await waitTable(page)
    // the budget's line table (provenance column) is in step 3
    await showStep(page, 'budget')
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.tf-budget tbody tr.clickable')].find((r) => r.innerText.includes('Cycle 7 Day 1'))
      row?.click()
    })
    await sleep(500)
    const ok = await page.evaluate(() => {
      // the research CT at cycle 7 day 1 (the screening CT above it is routine care)
      const b = [...document.querySelectorAll('.tf-prov .hc-trigger')].find((x) => x.innerText.includes('$191.25 × 100%'))
      if (!b) return false
      b.scrollIntoView({ block: 'center' })
      b.click()
      return true
    })
    check(`hover-${width}: provenance trigger`, ok)
    await page.waitForFunction(() => document.querySelector('.hc-card:not([hidden]) .lb-tbl'), { timeout: 30000, polling: 300 })
    await sleep(400)
    const card = await page.$('.hc-card:not([hidden])')
    const ctext = await card.evaluate((e) => e.innerText)
    check(`hover-${width}: card numbers`, ctext.includes('$191.25') && ctext.includes('$239.06'))
    const box = await card.boundingBox()
    check(`hover-${width}: card inside viewport`, box.x >= 0 && box.x + box.width <= width + 1, JSON.stringify(box))
    await card.screenshot({ path: path.join(OUT, `hover-provenance-${width}.png`) })
    await page.close()
  }

  // ---- an open-ended visit (TA36: no fixed count): priced per occurrence, outside the per-participant total
  {
    const page = await open('TA36', 'NCT05800015', 1440)
    await waitTable(page)
    // the schedule grid is in step 2 (Simple: inside its Details disclosure); the line shows in step 6
    await showStep(page, 'coverage')
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button.tf-cell')].find((x) => x.title.startsWith('Tumor assessment at week 36, CT chest'))
      if (!b) return false
      b.click()
      return true
    })
    check('TA36: grid cell', clicked)
    await showStep(page, 'term-sheet')
    await page.waitForFunction(
      () => (document.querySelector('#tf-step-6 .lb-wrap h3')?.innerText ?? '').includes('week 36') && document.querySelector('#tf-step-6 .lb-tbl') && !document.querySelector('#tf-step-6 .lb-stale'),
      { timeout: 30000, polling: 300 },
    )
    await sleep(300)
    const txt = await page.$eval('#tf-step-6 .lb-wrap', (e) => e.innerText)
    check('TA36: no "adds $0.00"', !txt.includes('adds $0.00'), txt.match(/In Budget.{0,80}/)?.[0])
    check('TA36: priced per occurrence', txt.includes('Priced per occurrence only') && txt.includes('each occurrence pays $239.06'), txt.match(/Priced.{0,160}/)?.[0])
    notes.push(`TA36 Simple: ${txt.match(/Priced.{0,200}/)?.[0]}`)
    await shotStep(page, 'simple-light-1440-TA36.png')
    await page.close()
  }

  // ---- step 5 site proposal check: no one-line formula; the Medicare amount opens the breakdown
  {
    const page = await open('proposal', 'NCT05800015', 1440, { density: 'detailed' })
    await showStep(page, 'proposal')
    await page.waitForFunction(() => [...document.querySelectorAll('#tf-step-5 button')].some((b) => b.textContent.includes('Load synthetic sample')), { timeout: 60000, polling: 300 })
    await page.evaluate(() => [...document.querySelectorAll('#tf-step-5 button')].find((x) => x.textContent.includes('Load synthetic sample')).click())
    await page.waitForSelector('#tf-step-5 .tp-table-full', { timeout: 60000 })
    await sleep(500)
    const srcs = await page.$$eval('#tf-step-5 td.tp-src', (els) => els.map((e) => e.innerText))
    check('proposal: sources shown', srcs.some((t) => t.includes('code 71260')))
    check('proposal: no one-line formula in sources', !srcs.some((t) => /33\.4009|\) x /.test(t)), srcs.find((t) => /33\.4009/.test(t)))
    const ok = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#tf-step-5 .tp-table-full tbody tr')].find((r) => r.innerText.includes('71260'))
      const b = row?.querySelector('td.num .hc-trigger')
      if (!b) return false
      b.scrollIntoView({ block: 'center' })
      b.click()
      return true
    })
    check('proposal: Medicare amount opens the breakdown', ok)
    if (ok) {
      await page.waitForFunction(() => document.querySelector('.hc-card:not([hidden]) .lb-tbl'), { timeout: 30000, polling: 300 })
      await sleep(300)
      const card = await page.$('.hc-card:not([hidden])')
      const ctext = await card.evaluate((e) => e.innerText)
      check('proposal: card numbers', ctext.includes('$191.25') && ctext.includes('$148.38'))
      await card.screenshot({ path: path.join(OUT, 'proposal-medicare-breakdown-1440.png') })
    }
    const lay = await layoutCheck(page)
    check('proposal: no horizontal page scroll', !lay.overflow)
    await page.close()
  }

  // ---- landing, Detailed: the term-sheet line's breakdown (Simple has no term-sheet line)
  for (const theme of ['light', 'dark'])
    for (const width of [1440, 390]) {
      const name = `landing-${theme}-${width}`
      const page = await open(name, null, width, { theme, density: 'detailed', hash: '#home' })
      await page.waitForFunction(() => document.querySelector('.lp-sheet .lb-tbl'), { timeout: 60000, polling: 300 })
      await sleep(600)
      const el = await page.$('.lp-sheet')
      const txt = await el.evaluate((e) => e.innerText)
      check(`${name}: $191.25 and $148.38`, txt.includes('$191.25') && txt.includes('$148.38'))
      check(`${name}: no one-line formula`, !txt.includes('33.4009 = $'))
      if (width === 1440 && theme === 'light') {
        // the landing table is not editable: its sponsor-price tip must not send people to a step 3 that is not there
        const tip = await page.$('.lp-sheet button[aria-label="How the sponsor price is built (assumptions)"]')
        check(`${name}: sponsor price tip`, !!tip)
        if (tip) {
          await tip.click()
          await page.waitForSelector('.hc-card:not([hidden])', { timeout: 10000 })
          const t = await page.$eval('.hc-card:not([hidden])', (e) => e.innerText)
          check(`${name}: tip says where to set them`, t.includes('set both in step 3 of Protocol to terms') && !t.includes('Edit both in step 3 or in Detailed view'), t)
          await page.keyboard.press('Escape')
        }
      }
      const lay = await layoutCheck(page)
      check(`${name}: no horizontal page scroll`, !lay.overflow, `${lay.docScrollWidth} > ${lay.innerWidth}`)
      await el.scrollIntoView()
      await sleep(300)
      await el.screenshot({ path: path.join(OUT, `${name}.png`) })
      await page.close()
    }

  await browser.close()
  // Pre-existing and outside this track: step 5 asks for a synthetic sample proposal, which only NCT05800015 has (404
  // for the other trials, shown in step 5 as "no sample"). Listed, not counted.
  const known = log.failed.filter((f) => f.includes('/proposal-sample'))
  const knownPages = new Set(known.map((f) => f.split(':')[0]))
  log.console = log.console.filter((c) => !(knownPages.has(c.split(':')[0]) && c.includes('404')))
  log.failed = log.failed.filter((f) => !f.includes('/proposal-sample'))
  const res = { notes, fails, console: log.console, pageerrors: log.pageerrors, failed: log.failed, known_preexisting: known }
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(res, null, 1))
  console.log(JSON.stringify(res, null, 1))
  process.exit(fails.length || log.pageerrors.length || log.console.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
