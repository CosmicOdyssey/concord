// Protocol to terms for any trial: add three real trials by NCT ID through the picker (cardiology, diabetes and a
// non-lung oncology Phase 3), an unknown NCT ID (clear error), the schedule-source panel, a SoA CSV paste and the way
// back to the registry draft; then screenshots in Simple and Detailed, light and dark, 1440 and 390 px; page and
// console errors; horizontal page scroll; on-screen per-participant total equal to the API; downstream steps
// (compare, spreads, proposal check, term sheet) present. Also: a trial with no U.S. sites is refused; reviewer
// overrides, then the unmodified CSV template uploaded and back to the draft, with zero failed requests; authored
// trials without a synthetic sample load with no 404. Writes report.json with the numbers per trial.
// Usage (NODE_PATH must reach puppeteer-core): node terms_anytrial.js [baseUrl] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep, layoutCheck } = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5286'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/anytrial'
const TRIALS = [
  { nct: 'NCT07064473', area: 'cardiology (heart failure / CV-kidney)' },
  { nct: 'NCT07564414', area: 'diabetes / obesity' },
  { nct: 'NCT06966700', area: 'oncology (breast cancer)' },
]
const DISCLAIMER = 'Decision support. Not a fair-market-value legal opinion.'
const DRAFT = "Draft from the public record, not the sponsor's protocol"
const FORBIDDEN = ['time-to-fill', 'time to fill', 'enrollment rate', 'speedup', 'months saved']
fs.mkdirSync(OUT, { recursive: true })

const usd = (x) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const getJson = async (p) => (await fetch(BASE + p)).json()
const fails = []
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`)
  return !!ok
}

async function ready(page) {
  await page.waitForSelector('.tf-grid', { timeout: 90000 })
  await page.waitForFunction(() => document.querySelector('.tf-payer-value') && document.querySelector('.ta-panel'), {
    timeout: 90000,
    polling: 300,
  })
  await sleep(1000)
}

;(async () => {
  const browser = await launch()
  // Every failed /api request counts (GET /proposal-sample answers null, not 404, for a trial without a sample);
  // only the add form's deliberate errors (unknown ID, no U.S. sites) are expected.
  const log = { console: [], pageerrors: [], failed: [], runs: {}, trials: {} }
  const watch = (page, name, allowAdd404 = false) => {
    const pending = []
    page.on('response', (r) => {
      if (!r.url().includes('/api/') || r.status() < 400) return
      if (allowAdd404 && r.url().includes('add-trial')) return pending.push(1)
      log.failed.push(`${name}: ${r.status()} ${r.url()}`)
    })
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return
      if (/Failed to load resource: the server responded with a status of 40[04]/.test(m.text()) && pending.length) {
        pending.pop()
        return
      }
      log.console.push(`${name}: ${m.text()}`)
    })
    page.on('pageerror', (e) => log.pageerrors.push(`${name}: ${e}`))
  }
  const open = async (name, width, { theme = 'light', density = 'simple', hash = '#terms-flow' } = {}) => {
    const page = await browser.newPage()
    watch(page, name)
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
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
    return page
  }

  // 1. Add the three trials through the picker, and an unknown NCT ID.
  {
    const page = await browser.newPage()
    watch(page, 'add', true)
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${BASE}/#terms-flow`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.ta-add input', { timeout: 60000 })
    for (const t of TRIALS) {
      await page.click('.ta-add input', { clickCount: 3 })
      await page.type('.ta-add input', t.nct.toLowerCase())
      await page.keyboard.press('Enter')
      await page.waitForFunction((n) => location.hash.includes(n) && document.querySelector('.ta-panel'), { timeout: 90000, polling: 300 }, t.nct)
      await ready(page)
    }
    await page.click('.ta-add input', { clickCount: 3 })
    await page.type('.ta-add input', 'NCT00000000')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.ta-add .ta-error', { timeout: 60000 })
    const err = await page.$eval('.ta-add .ta-error', (e) => e.innerText)
    check('unknown NCT ID error', /no study NCT00000000/.test(err), err)
    log.unknownError = err
    // a trial with no registered U.S. sites (hepatocellular carcinoma, China only): refused with a reason
    await page.click('.ta-add input', { clickCount: 3 })
    await page.type('.ta-add input', 'NCT04560894')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /U\.S\. sites/.test(document.querySelector('.ta-add .ta-error')?.innerText ?? ''), {
      timeout: 90000,
      polling: 300,
    })
    log.noUsSitesError = await page.$eval('.ta-add .ta-error', (e) => e.innerText)
    check('no-US-sites trial refused', /no registered U\.S\. sites/.test(log.noUsSitesError), log.noUsSitesError)
    const listed = await getJson('/api/terms-flow/trials')
    check('no-US-sites trial not listed', !listed.some((t) => t.nct_id === 'NCT04560894'))
    await page.click('.ta-add input', { clickCount: 3 })
    await page.type('.ta-add input', 'hello')
    await page.keyboard.press('Enter')
    await sleep(300)
    log.badFormatError = await page.$eval('.ta-add .ta-error', (e) => e.innerText)
    const form = await page.$('.ta-add')
    await form.screenshot({ path: path.join(OUT, 'anytrial_add_form_error.png') })
    await page.close()
  }

  // 2. Numbers per trial from the API (what the screen shows is checked against it below).
  for (const t of TRIALS) {
    const proto = await getJson(`/api/terms-flow/${t.nct}/protocol`)
    const sites = await getJson(`/api/terms-flow/${t.nct}/sites`)
    const [A, B] = sites.default_pair
    const bud = await getJson(`/api/terms-flow/${t.nct}/budget?site_id=${A}&multiplier=1`)
    const cmp = await getJson(`/api/terms-flow/${t.nct}/compare?site_a=${A}&site_b=${B}&multiplier=1`)
    const ld = await getJson(`/api/terms-flow/${t.nct}/locality-distribution?site_a=${A}&site_b=${B}`)
    const sp = await getJson(`/api/terms-flow/${t.nct}/spreads?site_a=${A}&site_b=${B}`)
    const md = await (await fetch(`${BASE}/api/terms-flow/${t.nct}/termsheet.md?site_id=${A}&compare_site=${B}`)).text()
    const pc = await (
      await fetch(`${BASE}/api/terms-flow/${t.nct}/proposal-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: A, csv: 'item,amount\n93000,$40\nCoordinator time and data entry,$300\n' }),
      })
    ).json()
    check(`${t.nct} draft label`, proto.label === DRAFT)
    check(`${t.nct} every node RA`, proto.nodes.every((n) => n.rule === 'RA' && n.coverage === 'research'))
    check(`${t.nct} term sheet labels`, md.includes(DRAFT) && md.includes(DISCLAIMER))
    check(`${t.nct} no forbidden words`, !FORBIDDEN.some((w) => md.toLowerCase().includes(w)))
    const unpricedInBudget = bud.totals.unpriced_sponsor_items.reduce((s, i) => s + i.per_participant, 0)
    check(`${t.nct} panel unpriced items equal the budget's`, proto.import.n_unpriced_items === unpricedInBudget, `${proto.import.n_unpriced_items} vs ${unpricedInBudget}`)
    check(`${t.nct} rules are RA only`, proto.rules.map((r) => r.id).join() === 'RA')
    check(`${t.nct} term sheet has no lung example`, !md.includes('R4 (research)') && !md.includes('CT every 6 weeks'))
    log.trials[t.nct] = {
      area: t.area,
      title: proto.short_title,
      visits_inferred: proto.import.n_visits,
      horizon_points: proto.visits.filter((v) => v.horizon).map((v) => v.label),
      items_inferred: proto.import.n_items,
      items_unpriced: proto.import.n_unpriced_items,
      unpriced_in_budget: unpricedInBudget,
      procedures: proto.procedures.map((p) => `${p.label} [${p.code ?? p.pricing}]`),
      unpriced_procedures: proto.procedures.filter((p) => p.pricing === 'unpriced').map((p) => p.label),
      unmapped: proto.import.unmapped,
      n_us_sites: sites.sites.length,
      n_resolved: sites.sites.filter((s) => s.locality).length,
      site_a: `${bud.site.label} (${bud.locality ? bud.locality.name : 'unresolved'})`,
      site_b: cmp.b.site.label,
      per_participant: bud.totals.per_participant,
      per_participant_scope: bud.totals.per_participant_scope,
      unpriced_lines: bud.totals.n_unpriced_sponsor_lines,
      unpriced_text: bud.totals.unpriced_text,
      screen_failure: bud.totals.screen_failure,
      shares: bud.anchoring.shares.map((s) => ({ id: s.id, label: s.label, amount: s.amount, pct: s.pct })),
      band_total: bud.band_totals ?? bud.totals_band ?? null,
      compare_delta: cmp.summary.delta_per_participant,
      locality_distribution_n: (ld.localities ?? ld.rows ?? []).length,
      spreads_geography: sp.geography ? Object.keys(sp.geography) : null,
      proposal_rows: pc.rows ? pc.rows.map((r) => `${r.input ?? r.item ?? ''} -> ${r.flag}`) : pc.detail,
    }
  }

  // 3. CSV route in the UI on the diabetes trial with three reviewer overrides in place: upload the unmodified
  // template (no warnings, citations are file lines), then back to the registry draft. No request may carry the old
  // schedule's override ids (every /api response must succeed), and the totals must follow each schedule.
  {
    const nct = 'NCT07564414'
    const ov = { 'D1:anthro': 'routine', 'W72:anthro': 'routine', 'D1:lipids': 'routine' }
    const page = await browser.newPage()
    watch(page, 'csv')
    const failedHere = []
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) failedHere.push(`${r.status()} ${r.url()}`)
    })
    await page.evaluateOnNewDocument(
      (nct, ov) => {
        try {
          localStorage.clear()
          localStorage.setItem(`tf:overrides:${nct}`, JSON.stringify(ov))
        } catch {
          /* ignore */
        }
      },
      nct,
      ov,
    )
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${BASE}/#terms-flow/${nct}`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    const sites = await getJson(`/api/terms-flow/${nct}/sites`)
    const A = sites.default_pair[0]
    const budAt = async (o) =>
      getJson(`/api/terms-flow/${nct}/budget?site_id=${A}&multiplier=1${o ? `&overrides=${encodeURIComponent(JSON.stringify(o))}` : ''}`)
    const payerIs = async (want) => {
      try {
        await page.waitForFunction((w) => (document.querySelector('.tf-payer-value')?.innerText ?? '').includes(w), { timeout: 30000, polling: 250 }, want)
        return true
      } catch {
        return false
      }
    }
    const draftOv = await budAt(ov)
    const draftPlain = await budAt(null)
    check('csv: overrides applied on the draft', await payerIs(usd(draftOv.totals.per_participant)), usd(draftOv.totals.per_participant))
    const tpl = await (await fetch(`${BASE}/api/terms-flow/soa-template.csv`)).text()
    await page.$eval('.ta-csv-text', (el) => el.focus())
    await page.type('.ta-csv-text', tpl)
    await page.evaluate(() => [...document.querySelectorAll('.ta-actions button')].find((b) => b.innerText.includes('Use this schedule')).click())
    await page.waitForFunction(() => document.querySelector('.ta-panel .badge')?.innerText.includes('Uploaded'), { timeout: 60000, polling: 300 })
    const csvBud = await budAt(null)
    check('csv: on-screen total equals API', await payerIs(usd(csvBud.totals.per_participant)), usd(csvBud.totals.per_participant))
    await sleep(1500)
    const panel = await page.evaluate(() => ({
      warnings: document.querySelector('.ta-panel .ta-warn')?.innerText ?? '',
      text: document.querySelector('.ta-panel')?.textContent ?? '',
      kfs: document.querySelector('.ta-kfs')?.innerText ?? '',
      qual: [...document.querySelectorAll('#tf-step-1 .qualifier, #tf-step-1 [class*="qual"]')].map((e) => e.innerText).join(' | '),
      step1: document.querySelector('#tf-step-1')?.textContent ?? '',
    }))
    check('csv: template uploads with no warnings', !panel.warnings, panel.warnings)
    check('csv: citations are file lines (Screening is line 5)', panel.text.includes('from your CSV, row 5'))
    check('csv: step 1 credits the uploaded CSV', panel.step1.includes('Uploaded schedule (CSV), not checked against the protocol'))
    check('csv: no "Authored ... from the registry record" for the CSV', !panel.step1.includes('from the registry record:'))
    const csvProto = await getJson(`/api/terms-flow/${nct}/protocol`)
    log.csvRoute = {
      per_participant: csvBud.totals.per_participant,
      unpriced_text: csvBud.totals.unpriced_text,
      kfs: panel.kfs,
      qualifier: panel.qual,
      visits: csvBud.visits.map((v) => `${v.label} x${v.occurrences ?? 1}`),
      unpriced_items: csvProto.import.n_unpriced_items,
    }
    await (await page.$('.ta-panel')).screenshot({ path: path.join(OUT, 'anytrial_csv_panel_simple-1440-light.png') })
    await page.evaluate(() => [...document.querySelectorAll('.ta-actions button')].find((b) => b.innerText.includes('Back to the registry draft')).click())
    await page.waitForFunction(() => document.querySelector('.ta-panel .badge')?.innerText.includes('Draft'), { timeout: 60000, polling: 300 })
    check('csv: back on the draft, the overrides apply again', await payerIs(usd(draftOv.totals.per_participant)), usd(draftOv.totals.per_participant))
    await sleep(1500)
    check('csv: zero failed requests through override, upload and back', failedHere.length === 0, failedHere.join('; '))
    log.csvRoute.draft_with_overrides = draftOv.totals.per_participant
    log.csvRoute.draft_plain = draftPlain.totals.per_participant
    await page.close()
  }

  // 3b. Authored trials without a synthetic sample (SIENNA, NCT06627647): no 404, no console error.
  for (const nct of ['NCT06541704', 'NCT06627647']) {
    const page = await open(`authored-${nct}`, 1440, { hash: `#terms-flow/${nct}` })
    await page.waitForFunction(() => document.querySelector('.tf-payer-value'), { timeout: 90000, polling: 300 })
    await sleep(2500)
    await page.close()
  }

  // 4. Screenshots and checks, every density, theme and width, on each added trial.
  for (const t of TRIALS)
    for (const density of ['simple', 'detailed'])
      for (const theme of ['light', 'dark'])
        for (const width of [1440, 390]) {
          const name = `${t.nct}-${density}-${width}-${theme}`
          const page = await open(name, width, { theme, density, hash: `#terms-flow/${t.nct}` })
          await ready(page)
          const r = await page.evaluate(
            (DISCLAIMER, DRAFT) => {
              const txt = (sel) => document.querySelector(sel)?.innerText ?? ''
              const main = txt('main')
              return {
                disclaimer: main.includes(DISCLAIMER),
                draft: txt('.ta-panel').includes(DRAFT) || txt('.ta-panel').includes('Draft from the public record'),
                assumed: main.includes('assumed until reviewed'),
                payer: txt('.tf-payer-value'),
                steps: [...document.querySelectorAll('[id^="tf-step-"]')].length,
                termsheet: !!document.querySelector('a[href*="termsheet"]'),
                forbidden: ['time-to-fill', 'time to fill', 'enrollment rate', 'speedup', 'months saved'].filter((w) => main.toLowerCase().includes(w)),
              }
            },
            DISCLAIMER,
            DRAFT,
          )
          const lay = await layoutCheck(page)
          check(`${name} disclaimer`, r.disclaimer)
          check(`${name} draft label`, r.draft)
          check(`${name} assumed coverage label`, r.assumed)
          check(`${name} no horizontal page scroll`, !lay.overflow, `${lay.docScrollWidth} > ${lay.innerWidth}`)
          check(`${name} forbidden`, r.forbidden.length === 0, r.forbidden.join(','))
          check(`${name} total equals API`, r.payer.includes(usd(log.trials[t.nct].per_participant)), `${r.payer}`)
          log.runs[name] = { ...r, overflow: lay.overflow }
          if (t.nct === 'NCT07064473' || width === 1440) {
            await page.screenshot({ path: path.join(OUT, `anytrial_${name}.png`), fullPage: t.nct === 'NCT07064473' })
            const panel = await page.$('.ta-panel')
            if (panel) await panel.screenshot({ path: path.join(OUT, `anytrial_panel_${name}.png`) })
          }
          await page.close()
        }

  await browser.close()
  log.fails = fails
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(log, null, 1))
  console.log(
    JSON.stringify(
      { fails, console: log.console, pageerrors: log.pageerrors, failed: log.failed, csvRoute: log.csvRoute, unknown: log.unknownError, bad: log.badFormatError, noUsSites: log.noUsSitesError },
      null,
      1,
    ),
  )
  for (const [k, v] of Object.entries(log.trials))
    console.log(k, v.area, '| visits', v.visits_inferred, '(horizons', v.horizon_points.length + ')', 'items', v.items_inferred, '| unpriced items', v.items_unpriced, '(budget', v.unpriced_in_budget + ')', 'procedures', v.unpriced_procedures.length, '| site', v.site_a, '| per participant', v.per_participant, '| screen failure', v.screen_failure, '| shares', JSON.stringify(v.shares))
})()
