// Protocol to terms view (Calm): screenshots in Simple and Detailed, light and dark, at 1440 and 390 px; page and
// console errors; horizontal page scroll; the always-visible labels (illustrative, decision-support disclaimer) on
// every price-bearing step in both densities; the two-payer explanation; on-screen totals equal to the API; no
// forecast or savings wording; hover cards on hover, keyboard focus and tap; reviewer override, multiplier and
// proposed-standard edits flowing into the totals and the markdown export; deep links and tab-switch persistence;
// the print view as PDF.
// Usage (NODE_PATH must reach puppeteer-core): node terms_flow.js [baseUrl] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep, layoutCheck, showStep } = require('./lib')
// termsProposalApi.sample reads a 404 from /proposal-sample as 'this trial ships no synthetic sample' (only
// NCT05800015 does), so that one 404, and Chrome's console line for it, are expected and not counted.
const noSample404 = (url, status) => status === 404 && /\/api\/terms-flow\/[^/]+\/proposal-sample(\?|$)/.test(url)

const BASE = process.argv[2] || 'http://localhost:5213'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/R/terms'
const NCT = 'NCT05800015'
const NCT2 = 'NCT06627647'
const DISCLAIMER = 'Decision support. Not a fair-market-value legal opinion.'
const ILLUSTRATIVE = 'Illustrative, authored from public trial information'
fs.mkdirSync(OUT, { recursive: true })

const usd = (x) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const signed = (x) => (Math.abs(x) < 0.005 ? '$0.00' : `${x > 0 ? '+' : '−'}${usd(Math.abs(x))}`)
const getJson = async (p) => (await fetch(BASE + p)).json()
const fails = []
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`)
  return !!ok
}

async function ready(page) {
  await page.waitForSelector('.tf-grid', { timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('.tf-payer-value') && document.querySelector('.tf-decomp-total') && document.querySelector('.tf-featured'), {
    timeout: 60000,
    polling: 300,
  })
  await sleep(800)
}

;(async () => {
  const browser = await launch()
  const log = { console: [], pageerrors: [], failed: [], runs: {} }
  const open = async (name, width, { theme = 'light', density = 'simple', hash = `#terms-flow/${NCT}`, clear = true, touch = false } = {}) => {
    const page = await browser.newPage()
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !(/status of 404/.test(m.text()) && noSample404(m.location()?.url ?? '', 404)) && log.console.push(`${name}: ${m.text()}`))
    page.on('pageerror', (e) => log.pageerrors.push(`${name}: ${e}`))
    page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && !noSample404(r.url(), r.status()) && log.failed.push(`${name}: ${r.status()} ${r.url()}`))
    await page.evaluateOnNewDocument(
      (theme, density, clear) => {
        try {
          if (clear && !sessionStorage.getItem('qa-cleared')) {
            localStorage.clear()
            sessionStorage.setItem('qa-cleared', '1')
          }
          localStorage.setItem('concord.theme', theme)
          localStorage.setItem('concord.density', density)
        } catch {
          /* ignore */
        }
      },
      theme,
      density,
      clear,
    )
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch })
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    return page
  }

  // ---------------------------------------------------------------- reference numbers from the API
  const sites = await getJson(`/api/terms-flow/${NCT}/sites`)
  const [A, B] = sites.default_pair
  const bud = await getJson(`/api/terms-flow/${NCT}/budget?site_id=${A}&multiplier=1`)
  const cmp = await getJson(`/api/terms-flow/${NCT}/compare?site_a=${A}&site_b=${B}&multiplier=1`)

  // ---------------------------------------------------------------- every density x theme x width
  for (const density of ['simple', 'detailed'])
    for (const theme of ['light', 'dark'])
      for (const width of [1440, 390]) {
        const name = `${density}-${width}-${theme}`
        const page = await open(name, width, { theme, density })
        await page.screenshot({ path: path.join(OUT, `terms_${name}.png`), fullPage: true })
        const r = await page.evaluate(
          (DISCLAIMER, ILLUSTRATIVE) => {
            const txt = (sel) => document.querySelector(sel)?.innerText ?? ''
            const steps = [1, 2, 3, 4, 5, 6].map((n) => txt(`#tf-step-${n}`))
            // Inside a closed <details> an element keeps a layout box, so ask for the closed disclosure itself.
            const visible = (el) => !!el && !el.closest('details:not([open])') && el.getBoundingClientRect().height > 0
            return {
              density: document.documentElement.dataset.density,
              theme: document.documentElement.dataset.theme,
              banner: txt('.tf .banner'),
              steps: steps.map((t) => ({ illustrative: t.includes(ILLUSTRATIVE), disclaimer: t.includes(DISCLAIMER) })),
              gridVisible: visible(document.querySelector('.tf-grid')),
              stdVisible: visible(document.querySelector('.tf-std')),
              payerNote: txt('#tf-step-3 .tf-payer-note'),
              insNote: txt('#tf-step-4 .tf-payer-note'),
              payerValues: [...document.querySelectorAll('.tf-payer-value')].map((e) => e.textContent),
              compose: [...document.querySelectorAll('.tf-compose dd')].map((e) => e.textContent),
              two: [...document.querySelectorAll('.tf-two tbody tr')].map((tr) => [...tr.children].map((c) => c.innerText.trim())),
              decompTotal: txt('.tf-decomp-total'),
              decompParts: [...document.querySelectorAll('.tf-decomp-v')].map((e) => e.textContent),
              lede4: txt('#tf-step-4 .section-lede'),
              main: txt('main'),
            }
          },
          DISCLAIMER,
          ILLUSTRATIVE,
        )
        // One step at a time (tabs): choose each step in the step nav; read its text, check its layout, capture it. The
        // grid (step 2) and the standard schedule (step 3) are measured while their step is on show.
        const shownVisible = (sel) =>
          page.evaluate((sel) => {
            const el = document.querySelector(sel)
            return !!el && !el.closest('details:not([open])') && el.getBoundingClientRect().height > 0
          }, sel)
        r.main = ''
        const lays = []
        for (let n = 1; n <= 6; n++) {
          await showStep(page, n)
          r.main += ' ' + (await page.evaluate(() => document.querySelector('main')?.innerText ?? ''))
          lays.push(await layoutCheck(page))
          if (n === 2) r.gridVisible = await shownVisible('.tf-grid')
          if (n === 3) r.stdVisible = await shownVisible('.tf-std')
          if (n > 1) await page.screenshot({ path: path.join(OUT, `terms_${name}_step${n}.png`), fullPage: true })
        }
        const lay = { overflow: lays.some((l) => l.overflow), offenders: lays.flatMap((l) => l.offenders) }
        log.runs[name] = { ...r, main: undefined, overflow: lay.overflow, offenders: lay.offenders.slice(0, 5) }
        check(`${name} density`, r.density === density, r.density)
        check(`${name} theme`, r.theme === theme, r.theme)
        check(`${name} no horizontal page scroll`, !lay.overflow, JSON.stringify(lay.offenders.slice(0, 3)))
        check(`${name} disclaimer banner`, r.banner.includes(DISCLAIMER), r.banner)
        r.steps.forEach((s, i) => check(`${name} step ${i + 1} illustrative label`, s.illustrative))
        // Price-bearing steps: Budget, Compare, Term sheet. (Step 5, Site proposal, shows it with a checked proposal:
        // terms_proposal.js.)
        ;[3, 4, 6].forEach((n) => check(`${name} step ${n} disclaimer`, r.steps[n - 1].disclaimer))
        check(`${name} grid shown only in Detailed`, r.gridVisible === (density === 'detailed'))
        check(`${name} standard schedule shown only in Detailed`, r.stdVisible === (density === 'detailed'))
        // Two payers, explained where the numbers are, in both densities.
        check(`${name} payer note`, r.payerNote.includes('Different payers') && r.payerNote.includes('Neither amount includes the other'), r.payerNote)
        check(`${name} insurance row note`, r.insNote.includes('different payer'), r.insNote)
        // On-screen totals equal the API (default pair, 100% of Medicare, no overrides or edits).
        const t = bud.totals
        check(`${name} sponsor per participant`, r.payerValues[0] === usd(t.per_participant), `${r.payerValues[0]} vs ${usd(t.per_participant)}`)
        check(`${name} insurance per participant`, r.payerValues[1] === usd(t.per_participant_insurance_medicare), r.payerValues[1])
        check(
          `${name} composition`,
          JSON.stringify(r.compose) === JSON.stringify([t.per_participant_research_items, t.per_participant_coordinator, t.per_participant_overhead].map(usd)),
          JSON.stringify(r.compose),
        )
        const row = (label) => r.two.find((x) => x[0].startsWith(label)) ?? []
        check(`${name} compare sponsor`, row('Paid by sponsor')[1] === usd(cmp.a.totals.per_participant) && row('Paid by sponsor')[2] === usd(cmp.b.totals.per_participant), JSON.stringify(row('Paid by sponsor')))
        check(
          `${name} compare insurance`,
          row('Billable to insurance')[1] === usd(cmp.a.totals.per_participant_insurance_medicare) && row('Billable to insurance')[2] === usd(cmp.b.totals.per_participant_insurance_medicare),
          JSON.stringify(row('Billable to insurance')),
        )
        check(`${name} compare locality`, row('Medicare locality')[1]?.startsWith(cmp.a.locality.code) && row('Medicare locality')[2]?.startsWith(cmp.b.locality.code), JSON.stringify(row('Medicare locality')))
        const sm = cmp.summary
        check(`${name} difference`, r.decompTotal === signed(sm.delta_per_participant), r.decompTotal)
        check(
          `${name} decomposition`,
          JSON.stringify(r.decompParts) === JSON.stringify([sm.from_work, sm.from_pe, sm.from_mp, sm.delta_overhead, sm.rounding].map(signed)),
          JSON.stringify(r.decompParts),
        )
        check(`${name} difference sentence`, r.lede4.includes(usd(Math.abs(sm.delta_per_participant))) && r.lede4.includes(usd(Math.abs(sm.from_pe))) && r.lede4.includes('not a saving'), r.lede4)
        // No product forecast and no savings claim anywhere on the tab.
        const forecast = r.main.match(/faster|speed-?up|time[- ]to[- ]fill|enrollment rate|months saved|predicted|forecast(?!s\b)/i)
        check(`${name} no forecast wording`, !forecast, forecast?.[0])
        check(`${name} "saving" only as "not a saving"`, !/saving/i.test(r.main.replace(/not a saving/g, '')))
        await page.close()
      }

  // ---------------------------------------------------------------- hover cards: hover, keyboard focus, tap
  {
    const page = await open('hover', 1440, { density: 'simple' })
    const openCard = () => page.evaluate(() => [...document.querySelectorAll('.hc-card')].find((c) => !c.hidden)?.innerText ?? '')
    // hover a visit column: its line items
    await showStep(page, 3)
    const col = await page.$('#tf-step-3 .tf-vcol:nth-child(8)')
    await col.hover()
    await sleep(500)
    const hoverText = await openCard()
    await page.screenshot({ path: path.join(OUT, 'terms_hovercard_visit_1440.png') })
    await page.mouse.move(5, 5)
    await sleep(600)
    // keyboard focus a rule title in the coverage step
    await showStep(page, 2)
    await page.evaluate(() => document.querySelector('#tf-step-2 .tf-rules .hc-trigger')?.scrollIntoView({ block: 'center' }))
    // A key press first, so the focus that follows counts as keyboard focus (:focus-visible).
    await page.keyboard.press('Shift')
    await page.focus('#tf-step-2 .tf-rules .hc-trigger')
    await sleep(400)
    const focusText = await openCard()
    await page.screenshot({ path: path.join(OUT, 'terms_hovercard_focus_1440.png') })
    await page.keyboard.press('Escape')
    log.hover = { hoverText: hoverText.slice(0, 200), focusText: focusText.slice(0, 200) }
    check('hover: visit column card lists lines', /Cycle 7 Day 1/.test(hoverText) && hoverText.includes('CT chest with contrast'), hoverText.slice(0, 120))
    check('focus: rule card opens', /R\d: /.test(focusText), focusText.slice(0, 120))
    await page.close()
  }
  {
    const page = await open('tap', 390, { density: 'simple', touch: true })
    await showStep(page, 3)
    const btn = await page.$('#tf-step-3 .tf-locline .hc-info')
    await btn.evaluate((b) => b.scrollIntoView({ block: 'center' }))
    await sleep(300)
    await btn.tap()
    await sleep(400)
    const tapText = await page.evaluate(() => [...document.querySelectorAll('.hc-card')].find((c) => !c.hidden)?.innerText ?? '')
    await page.screenshot({ path: path.join(OUT, 'terms_hovercard_tap_390.png') })
    log.tap = tapText.slice(0, 200)
    check('tap: locality card opens with GPCIs', tapText.includes('Practice expense GPCI'), tapText.slice(0, 120))
    // Open every disclosure so the grid, coverage chips and editors are measured too. Inline text glosses (dotted
    // terms) are exempt; the "i" buttons have a 44 px hit area of their own (::after).
    await page.evaluate(() => document.querySelectorAll('.tf details').forEach((d) => (d.open = true)))
    await sleep(300)
    // Every step in turn (one is on show at a time).
    const targets = { coarse: false, small: [] }
    for (let n = 1; n <= 6; n++) {
      await showStep(page, n)
      const t = await page.evaluate(() => ({
        coarse: matchMedia('(pointer: coarse)').matches,
        small: [...document.querySelectorAll('.tf button, .tf a.btn, .tf select, .tf input:not([type="checkbox"]), .tf .tf-check, .tf summary')]
          .filter((e) => e.getBoundingClientRect().height > 0)
          .map((e) => ({ e: `${e.tagName}.${e.className}`.slice(0, 40), h: Math.round(e.getBoundingClientRect().height) }))
          // .sr-only: a visually hidden control a visible button drives (the proposal's file input, tabIndex -1).
          .filter((x) => x.h < 44 && !/hc-trigger|hc-info|sr-only/.test(x.e)),
      }))
      targets.coarse = t.coarse
      targets.small.push(...t.small.map((x) => ({ ...x, step: n })))
    }
    log.targets = { coarse: targets.coarse, small: targets.small.slice(0, 10) }
    if (targets.coarse) check('touch targets >= 44 px', targets.small.length === 0, JSON.stringify(targets.small.slice(0, 5)))
    await page.close()
  }

  // ---------------------------------------------------------------- controls (Simple: they work through the disclosure)
  {
    const page = await open('interact', 1440, { density: 'simple' })
    const perParticipant = () => page.evaluate(() => document.querySelector('.tf-payer-sponsor .tf-payer-value')?.textContent)
    const before = await perParticipant()
    // reviewer override: open "Schedule grid and reviewer overrides", flip the week-18 CT chest to routine
    await showStep(page, 2)
    await page.evaluate(() => {
      const d = document.querySelector('#tf-step-2 details.section-disclosure')
      d.open = true
    })
    await sleep(300)
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('.tf-vchip')].find((b) => b.textContent.startsWith('C7') && b.closest('.tf-cov-row')?.textContent.includes('CT chest'))
      chip?.click()
    })
    await page.waitForFunction((b) => document.querySelector('.tf-payer-sponsor .tf-payer-value')?.textContent !== b, { timeout: 15000 }, before)
    await sleep(600)
    const afterOverride = await perParticipant()
    const badge = await page.evaluate(() => document.querySelector('#tf-step-2 .tf-ovcount')?.textContent ?? '')
    // the featured line follows the selected item
    const featured = await page.evaluate(() => document.querySelector('.tf-featured')?.innerText ?? '')
    // multiplier 120%
    await showStep(page, 3)
    const input = await page.$('.tf-mult-input input')
    await input.click({ clickCount: 3 })
    await input.type('120')
    await page.waitForFunction((b) => document.querySelector('.tf-payer-sponsor .tf-payer-value')?.textContent !== b, { timeout: 15000 }, afterOverride)
    await sleep(600)
    const afterMult = await perParticipant()
    const qual = await page.evaluate(() => document.querySelector('#tf-step-3 .section-quals')?.innerText ?? '')
    const mdHref = await page.evaluate(() => document.querySelector('.tf-sheet-actions a[download]')?.getAttribute('href'))
    const md = await (await fetch(BASE + mdHref)).text()
    // presets change both sites
    await showStep(page, 4)
    const presetText = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.tf-preset')][1]
      b?.click()
      return b?.textContent ?? ''
    })
    await sleep(1500)
    const cmpAfter = await page.evaluate(() => [...document.querySelectorAll('.tf-two tbody tr')][0]?.innerText ?? '')
    log.interact = { before, afterOverride, afterMult, badge, featured: featured.slice(0, 160), qual, presetText, cmpAfter }
    check('override changes the sponsor total', afterOverride && afterOverride !== before)
    check('override count shown', /1 reviewer override/.test(badge), badge)
    check('featured line follows the selection', featured.includes('selected in the grid') && featured.includes('reviewer override'), featured.slice(0, 160))
    check('multiplier changes the sponsor total', afterMult && afterMult !== afterOverride)
    check('multiplier qualifier', qual.includes('120% of Medicare'), qual)
    check('markdown carries the override', md.includes('reviewer override (rule R4 said research)'))
    check('markdown carries 120%', md.includes('120% of Medicare'))
    check('markdown carries the disclaimer', md.includes(DISCLAIMER))
    check('preset changes the pair', /Montefiore|Bronx/i.test(cmpAfter), cmpAfter)
    await page.close()
  }

  // ---------------------------------------------------------------- Detailed: standard schedule edit and visit lines
  {
    const page = await open('detailed-edit', 1440, { density: 'detailed' })
    const total = () => page.evaluate(() => document.querySelector('.tf-payer-sponsor .tf-payer-value')?.textContent)
    const before = await total()
    await showStep(page, 3)
    const coord = await page.$('input[aria-label^="Coordinator time and data entry amount"]')
    await coord.click({ clickCount: 3 })
    await coord.type('200')
    await page.waitForFunction((b) => document.querySelector('.tf-payer-sponsor .tf-payer-value')?.textContent !== b, { timeout: 15000 }, before)
    await sleep(600)
    const after = await total()
    const reset = await page.evaluate(() => [...document.querySelectorAll('.tf-std-foot button')].map((b) => b.textContent)[0] ?? '')
    await page.evaluate(() => document.querySelector('.tf-std-foot button')?.click())
    await page.waitForFunction((b) => document.querySelector('.tf-payer-sponsor .tf-payer-value')?.textContent === b, { timeout: 15000 }, before)
    // a visit row opens its lines; a compare row opens its formulas
    await page.evaluate(() => [...document.querySelectorAll('.tf-budget tbody tr.clickable')][7]?.click())
    await page.evaluate(() => [...document.querySelectorAll('.tf-cmp-tbl tbody tr.clickable')][0]?.click())
    await sleep(400)
    const lines = await page.evaluate(() => document.querySelectorAll('.tf-lines tbody tr').length)
    await (await page.$('#tf-step-3')).screenshot({ path: path.join(OUT, 'terms_detailed_budget_1440.png') })
    await showStep(page, 4)
    // The open compare row shows the line's price step by step at both sites (LineBreakdown.tsx, which replaced the
    // one-line "A: ... B: ..." formulas), then the difference formula.
    await page.waitForFunction(() => document.querySelector('.tf-cmp-tbl .tf-lines-row .lb-tbl') && !document.querySelector('.tf-cmp-tbl .tf-lines-row .lb-stale'), { timeout: 30000, polling: 250 }).catch(() => {})
    const formula = await page.evaluate(() => document.querySelector('.tf-cmp-tbl .tf-lines-row')?.innerText ?? '')
    await (await page.$('#tf-step-4')).screenshot({ path: path.join(OUT, 'terms_detailed_compare_1440.png') })
    log.detailed = { before, after, reset, lines, formula: formula.slice(0, 160) }
    check('standard schedule edit changes the total', after !== before, `${before} -> ${after}`)
    check('reset button', /Reset 1 edit/.test(reset), reset)
    check('visit rows open their lines', lines > 10, String(lines))
    check(
      'compare rows open both formulas',
      /Site A/.test(formula) && /Site B/.test(formula) && /Medicare rate[\s\S]*\$[\d,]+\.\d\d[\s\S]*\$[\d,]+\.\d\d/.test(formula) && /Δ = [\s\S]* = [+−]?\$/.test(formula),
      formula.slice(0, 300),
    )
    await page.close()
  }

  // ---------------------------------------------------------------- deep link, step nav, persistence
  {
    const page = await open('deeplink', 1440, { hash: `#terms-flow/${NCT2}` })
    const sel = await page.evaluate(() => document.querySelector('.tf-trial-on a')?.textContent ?? '')
    check('deep link selects the trial', sel === NCT2, sel)
    await page.screenshot({ path: path.join(OUT, `terms_${NCT2}_1440.png`), fullPage: true })
    // the step nav is a tab list: a click shows step 4 alone; Enter on its tab moves focus to the step's heading
    await page.evaluate(() => [...document.querySelectorAll('.tf-flow-btn')][3]?.click())
    await sleep(500)
    const navClick = await page.evaluate(() => ({
      shown: [...document.querySelectorAll('.tf [role=tabpanel]')].filter((p) => !p.hidden).map((p) => p.id),
      selected: document.querySelector('nav.tf-flow [aria-selected="true"]')?.id,
      hash: location.hash,
    }))
    check('step nav shows step 4 alone', navClick.shown.join() === 'tf-step-4' && navClick.selected === 'tf-tab-compare', JSON.stringify(navClick))
    check('step nav writes the step in the hash', navClick.hash === `#terms-flow/${NCT2}/compare`, navClick.hash)
    await page.keyboard.press('Shift')
    await page.focus('#tf-tab-compare')
    await page.keyboard.press('Enter')
    await sleep(400)
    const nav = await page.evaluate(() => ({
      focus: document.activeElement?.closest('section')?.id,
      tag: document.activeElement?.tagName,
      top: Math.round(document.getElementById('tf-step-4').getBoundingClientRect().top),
      navBottom: Math.round(document.querySelector('nav.tf-flow').getBoundingClientRect().bottom),
      vh: window.innerHeight,
    }))
    check('step nav (Enter) focuses step 4 heading', nav.focus === 'tf-step-4' && nav.tag === 'H2', JSON.stringify(nav))
    check('step 4 top in view, below the sticky header and step nav', nav.top >= nav.navBottom && nav.top < nav.vh - 100, JSON.stringify(nav))
    // leaving the tab and coming back keeps the trial and the step (the view stays mounted while hidden, App.tsx);
    // the address bar carries both
    const tab = (label) =>
      page.evaluate((l) => {
        const b = [...document.querySelectorAll('nav.tabs [role="tab"]')].find((x) => x.querySelector('.tab-label')?.textContent.trim() === l)
        b?.click()
        return !!b
      }, label)
    const left = await tab('Findings')
    await sleep(800)
    const hashAway = await page.evaluate(() => window.location.hash)
    const back = await tab('Protocol to terms')
    await ready(page)
    log.persist = {
      left,
      hashAway,
      back,
      hash: await page.evaluate(() => window.location.hash),
      selected: await page.evaluate(() => document.querySelector('.tf-trial-on a')?.textContent ?? ''),
    }
    check('persist: away, the address is the other tab', log.persist.hashAway === '#findings', log.persist.hashAway)
    check('persist: hash (trial and step)', log.persist.hash === `#terms-flow/${NCT2}/compare`, log.persist.hash)
    check('persist: trial', log.persist.selected === NCT2, log.persist.selected)
    const kept = await page.evaluate(() => [...document.querySelectorAll('.tf [role=tabpanel]')].filter((p) => !p.hidden).map((p) => p.id).join())
    check('persist: step 4 still on show', kept === 'tf-step-4', kept)
    await page.close()
  }

  // ---------------------------------------------------------------- print view (API page)
  {
    const page = await browser.newPage()
    await page.setViewport({ width: 1100, height: 900 })
    await page.goto(`${BASE}/api/terms-flow/${NCT}/termsheet.html?site_id=${A}&compare_site=${B}&multiplier=1`, { waitUntil: 'load' })
    await page.screenshot({ path: path.join(OUT, 'termsheet_print_view.png') })
    await page.pdf({ path: path.join(OUT, 'termsheet_print_view.pdf'), format: 'Letter', printBackground: true })
    await page.setViewport({ width: 390, height: 844 })
    await sleep(300)
    log.print390 = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    check('print view fits 390', log.print390.scrollWidth <= log.print390.clientWidth, JSON.stringify(log.print390))
    await page.close()
  }

  await browser.close()
  check('no console errors or warnings', log.console.length === 0, log.console.slice(0, 3).join(' | '))
  check('no page errors', log.pageerrors.length === 0, log.pageerrors.slice(0, 3).join(' | '))
  check('no failed API calls', log.failed.length === 0, log.failed.slice(0, 3).join(' | '))
  log.fails = fails
  fs.writeFileSync(path.join(OUT, 'qa_log.json'), JSON.stringify(log, null, 1))
  console.log(JSON.stringify({ fails, console: log.console, pageerrors: log.pageerrors, failed: log.failed, interact: log.interact, detailed: log.detailed, persist: log.persist, hover: log.hover, tap: log.tap, targets: log.targets }, null, 1))
  process.exit(fails.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
