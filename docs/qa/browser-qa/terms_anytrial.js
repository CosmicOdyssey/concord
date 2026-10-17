// Protocol to terms for any trial: add three real trials by NCT ID through the picker (cardiology, diabetes and a
// non-lung oncology Phase 3), an unknown NCT ID (clear error), the schedule-source panel, a SoA CSV paste and the way
// back to the registry draft; then screenshots in Simple and Detailed, light and dark, 1440 and 390 px; page and
// console errors; horizontal page scroll; on-screen per-participant total equal to the API; downstream steps
// (compare, spreads, proposal check, term sheet) present. Writes report.json with the numbers per trial.
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
  // Known and pre-existing (proposal track, also for SIENNA and NCT06627647): GET /proposal-sample answers 404 for a
  // trial without a synthetic sample, the client reads that as "no sample", and Chrome logs the 404 as a console
  // error. Counted separately; everything else counts as a failure.
  const log = { console: [], pageerrors: [], failed: [], preexisting404: 0, runs: {}, trials: {} }
  const watch = (page, name, allowAdd404 = false) => {
    const pending = []
    page.on('response', (r) => {
      if (!r.url().includes('/api/') || r.status() < 400) return
      if (r.status() === 404 && r.url().endsWith('/proposal-sample')) {
        log.preexisting404 += 1
        pending.push(1)
        return
      }
      if (allowAdd404 && r.url().includes('add-trial')) return pending.push(1)
      log.failed.push(`${name}: ${r.status()} ${r.url()}`)
    })
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return
      if (/Failed to load resource: the server responded with a status of 404/.test(m.text()) && pending.length) {
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
    log.trials[t.nct] = {
      area: t.area,
      title: proto.short_title,
      visits_inferred: proto.import.n_visits,
      items_inferred: proto.import.n_items,
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

  // 3. CSV route in the UI on the diabetes trial: paste, use, check the panel and total, then back to the draft.
  {
    const nct = 'NCT07564414'
    const page = await open('csv', 1440, { hash: `#terms-flow/${nct}` })
    await ready(page)
    const csv = 'Visit,Week,Procedure,Code,Repeats\nScreening,-2,Office visit new patient,99204,\n,,HbA1c,,\nRandomisation,0,ECG,93000,\nDosing visit,W4 ±3,SC injection,96372,17\nEnd of treatment,72,HbA1c,83036,\n'
    await page.type('.ta-csv-text', csv)
    await page.evaluate(() => [...document.querySelectorAll('.ta-actions button')].find((b) => b.innerText.includes('Use this schedule')).click())
    await page.waitForFunction(() => document.querySelector('.ta-panel .badge')?.innerText.includes('Uploaded'), { timeout: 60000, polling: 300 })
    await sleep(2500)
    const sites = await getJson(`/api/terms-flow/${nct}/sites`)
    const bud = await getJson(`/api/terms-flow/${nct}/budget?site_id=${sites.default_pair[0]}&multiplier=1`)
    const onScreen = await page.$eval('.tf-payer-value', (e) => e.innerText)
    check('csv: on-screen total equals API', onScreen.includes(usd(bud.totals.per_participant)), `${onScreen} vs ${usd(bud.totals.per_participant)}`)
    log.csvRoute = { per_participant: bud.totals.per_participant, onScreen, visits: bud.visits.map((v) => `${v.label} x${v.occurrences ?? 1}`) }
    await (await page.$('.ta-panel')).screenshot({ path: path.join(OUT, 'anytrial_csv_panel_simple-1440-light.png') })
    await page.evaluate(() => [...document.querySelectorAll('.ta-actions button')].find((b) => b.innerText.includes('Back to the registry draft')).click())
    await page.waitForFunction(() => document.querySelector('.ta-panel .badge')?.innerText.includes('Draft'), { timeout: 60000, polling: 300 })
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
      { fails, console: log.console, pageerrors: log.pageerrors, failed: log.failed, preexisting404: log.preexisting404, csvRoute: log.csvRoute, unknown: log.unknownError, bad: log.badFormatError },
      null,
      1,
    ),
  )
  for (const [k, v] of Object.entries(log.trials))
    console.log(k, v.area, '| visits', v.visits_inferred, 'items', v.items_inferred, '| unpriced', v.unpriced_procedures.length, '| site', v.site_a, '| per participant', v.per_participant, '| shares', JSON.stringify(v.shares))
})()
