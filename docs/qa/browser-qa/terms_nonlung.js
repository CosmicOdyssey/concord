// Protocol to terms with the non-lung protocol (SIENNA, NCT06541704, geographic atrophy): screenshots in Simple and
// Detailed, light and dark, at 1440 and 390 px; page and console errors; horizontal page scroll; the picker label
// next to the lung protocols; the always-visible labels; on-screen per-participant total equal to the API; an
// unresolved-locality site that says why; the unpriced research items and the 20 counted dosing visits under the
// payer figure (both densities); a two-site compare against an unresolved site that states the national-amount
// assumption first; the term sheet (md and html) export.
// Usage (NODE_PATH must reach puppeteer-core): node terms_nonlung.js [baseUrl] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep, layoutCheck, showStep } = require('./lib')
// termsProposalApi.sample reads a 404 from /proposal-sample as 'this trial ships no synthetic sample' (only
// NCT05800015 does), so that one 404, and Chrome's console line for it, are expected and not counted.
const noSample404 = (url, status) => status === 404 && /\/api\/terms-flow\/[^/]+\/proposal-sample(\?|$)/.test(url)

const BASE = process.argv[2] || 'http://localhost:5282'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/nonlung'
const NCT = 'NCT06541704'
const DISCLAIMER = 'Decision support. Not a fair-market-value legal opinion.'
const ILLUSTRATIVE = 'Illustrative, authored from public trial information'
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
  await page.waitForSelector('.tf-grid', { timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('.tf-payer-value') && document.querySelector('.tf-decomp-total'), {
    timeout: 60000,
    polling: 300,
  })
  await sleep(800)
}

;(async () => {
  const browser = await launch()
  const log = { console: [], pageerrors: [], failed: [], runs: {} }
  const open = async (name, width, { theme = 'light', density = 'simple', hash = `#terms-flow/${NCT}` } = {}) => {
    const page = await browser.newPage()
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !(/status of 404/.test(m.text()) && noSample404(m.location()?.url ?? '', 404)) && log.console.push(`${name}: ${m.text()}`))
    page.on('pageerror', (e) => log.pageerrors.push(`${name}: ${e}`))
    page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && !noSample404(r.url(), r.status()) && log.failed.push(`${name}: ${r.status()} ${r.url()}`))
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
    await ready(page)
    return page
  }

  const sites = await getJson(`/api/terms-flow/${NCT}/sites`)
  const [A, B] = sites.default_pair
  const bud = await getJson(`/api/terms-flow/${NCT}/budget?site_id=${A}&multiplier=1`)
  log.api = { siteA: bud.site.label, perParticipant: bud.totals.per_participant, sites: sites.sites.length }

  for (const density of ['simple', 'detailed'])
    for (const theme of ['light', 'dark'])
      for (const width of [1440, 390]) {
        const name = `${density}-${width}-${theme}`
        const page = await open(name, width, { theme, density })
        await page.screenshot({ path: path.join(OUT, `nonlung_${name}.png`), fullPage: true })
        const card = await page.$('.tf-trial-on')
        if (card) await card.screenshot({ path: path.join(OUT, `nonlung_picker_${name}.png`) })
        const r = await page.evaluate(
          (DISCLAIMER, ILLUSTRATIVE) => {
            const txt = (sel) => document.querySelector(sel)?.innerText ?? ''
            return {
              density: document.documentElement.dataset.density,
              theme: document.documentElement.dataset.theme,
              picker: [...document.querySelectorAll('.tf-trial')].map((e) => e.querySelector('.tf-trial-sponsor')?.innerText ?? ''),
              lede1: txt('#tf-step-1 .section-lede'),
              steps: [1, 2, 3, 4, 5].map((n) => {
                const t = txt(`#tf-step-${n}`)
                return { illustrative: t.includes(ILLUSTRATIVE), disclaimer: t.includes(DISCLAIMER) }
              }),
            }
          },
          DISCLAIMER,
          ILLUSTRATIVE,
        )
        // One step at a time (tabs): choose each step in the step nav; read its text and check its layout. The payer
        // cards are measured while step 3 (Budget) is on show.
        r.main = ''
        const lays = []
        for (let n = 1; n <= 6; n++) {
          await showStep(page, n)
          r.main += ' ' + (await page.evaluate(() => document.querySelector('main')?.innerText ?? ''))
          lays.push(await layoutCheck(page))
          if (n !== 3) continue
          Object.assign(
            r,
            await page.evaluate(() => ({
              payerValues: [...document.querySelectorAll('.tf-payer-value')].map((e) => e.textContent),
              // text clipped inside a payer card (a nowrap qualifier wider than its card)
              payerClipped: [...document.querySelectorAll('.tf-payer, .tf-payer .qual')]
                .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > (e.closest('.tf-payer')?.getBoundingClientRect().right ?? 1e9) + 1)
                .map((e) => e.className),
            })),
          )
          await page.screenshot({ path: path.join(OUT, `nonlung_budget_${name}.png`), fullPage: true })
        }
        const lay = { overflow: lays.some((l) => l.overflow), offenders: lays.flatMap((l) => l.offenders) }
        log.runs[name] = { ...r, main: undefined, overflow: lay.overflow, offenders: lay.offenders.slice(0, 5) }
        check(`${name} density`, r.density === density, r.density)
        check(`${name} theme`, r.theme === theme, r.theme)
        check(`${name} no page scroll`, !lay.overflow, JSON.stringify(lay.offenders.slice(0, 3)))
        check(`${name} picker label`, r.picker.some((p) => p.includes('Outside lung cancer')), JSON.stringify(r.picker))
        // the three authored trials, plus any trial added by NCT ID (terms_anytrial.js adds three to the gitignored cache)
        const listed = await getJson('/api/terms-flow/trials')
        const authored = listed.filter((t) => !t.import).length
        check(`${name} picker lists 3 authored trials, and every trial the API lists`, authored === 3 && r.picker.length === listed.length, `${authored} authored, ${r.picker.length} shown, ${listed.length} listed`)
        check(`${name} lede names the non-lung trial`, r.lede1.includes('outside lung cancer'), r.lede1)
        check(`${name} disclaimer visible`, r.main.includes(DISCLAIMER))
        check(`${name} illustrative visible`, r.main.includes(ILLUSTRATIVE))
        check(`${name} per-participant equals API`, r.main.includes(usd(bud.totals.per_participant)), usd(bud.totals.per_participant))
        check(`${name} nothing clipped in the payer cards`, r.payerClipped.length === 0, JSON.stringify(r.payerClipped))
        check(`${name} unpriced items stated`, !!bud.totals.unpriced_text && r.main.includes(bud.totals.unpriced_text), bud.totals.unpriced_text)
        for (const x of bud.totals.per_participant_repeats ?? [])
          check(`${name} counted dosing visits stated`, r.main.includes(`${x.count} × ${usd(x.amount)} = ${usd(x.subtotal)}`), usd(x.amount))
        const low = r.main.toLowerCase()
        check(`${name} no forecast wording`, !FORBIDDEN.some((f) => low.includes(f)))
        await page.close()
      }

  // An unresolved-locality site (registry-snapshot site in a multi-locality state, county not crosswalked).
  const tampa = sites.sites.find((s) => s.city === 'Tampa')
  if (check('Tampa site present', !!tampa) && check('Tampa unresolved', tampa.locality === null && !!tampa.locality_note)) {
    const page = await open('unresolved-1440', 1440, { density: 'detailed' })
    await showStep(page, 3)
    const sel = await page.$('#tf-step-3 select')
    if (check('budget site select present', !!sel)) {
      await page.select('#tf-step-3 select', tampa.site_id)
      await page.waitForFunction(() => (document.querySelector('main')?.innerText ?? '').includes('left unresolved rather than guessed'), {
        timeout: 30000,
        polling: 300,
      }).catch(() => {})
      const main = await page.evaluate(() => document.querySelector('main')?.innerText ?? '')
      log.unresolvedShown = main.includes('left unresolved rather than guessed')
      check('unresolved locality note shown', log.unresolvedShown)
      const step = await page.$('#tf-step-3')
      await step.screenshot({ path: path.join(OUT, `nonlung_unresolved_site.png`) })
    }
    await page.close()
  }

  // Compare against an unresolved site: the sentence states the national-amount assumption first.
  const rich = sites.sites.find((s) => s.city === 'Richmond' && s.locality === null)
  if (check('Richmond unresolved site present', !!rich)) {
    for (const density of ['simple', 'detailed']) {
      const page = await open(`compare-unresolved-${density}`, 1440, { density })
      await showStep(page, 4)
      const sels = await page.$$('#tf-step-4 select')
      if (check(`${density} compare selects present`, sels.length === 2, String(sels.length))) {
        await sels[1].select(rich.site_id)
        await page
          .waitForFunction(() => (document.querySelector('#tf-step-4 .section-lede')?.innerText ?? '').includes('On that assumption'), {
            timeout: 30000,
            polling: 300,
          })
          .catch(() => {})
        const lede = await page.evaluate(() => document.querySelector('#tf-step-4 .section-lede')?.innerText ?? '')
        log[`compareUnresolved_${density}`] = lede
        check(`${density} compare opens with the locality note`, lede.startsWith('Site B: Medicare locality not resolved.'), lede)
        check(`${density} compare says on that assumption`, lede.includes('On that assumption'), lede)
        check(`${density} compare does not claim a published GPCI difference`, !lede.includes('because Medicare'), lede)
        const step = await page.$('#tf-step-4')
        await step.screenshot({ path: path.join(OUT, `nonlung_compare_unresolved_${density}.png`) })
      }
      await page.close()
    }
  }

  // Term sheet exports.
  const md = await (await fetch(`${BASE}/api/terms-flow/${NCT}/termsheet.md?site_id=${A}&compare_site=${B}&download=false`)).text()
  fs.writeFileSync(path.join(OUT, 'term-sheet_NCT06541704.md'), md)
  check('md disclaimer', md.includes(DISCLAIMER))
  check('md snapshot source', md.includes('clinicaltrials.gov/api/v2/studies/NCT06541704'))
  check('md unpriced items in totals', md.includes('Excludes 6 research items with no published Medicare amount'))
  for (const width of [1440, 390]) {
    const page = await browser.newPage()
    page.on('pageerror', (e) => log.pageerrors.push(`sheet-${width}: ${e}`))
    page.on('console', (m) => m.type() === 'error' && !(/status of 404/.test(m.text()) && noSample404(m.location()?.url ?? '', 404)) && log.console.push(`sheet-${width}: ${m.text()}`))
    await page.setViewport({ width, height: 900 })
    await page.goto(`${BASE}/api/terms-flow/${NCT}/termsheet.html?site_id=${A}&compare_site=${B}`, { waitUntil: 'load' })
    const lay = await layoutCheck(page)
    check(`termsheet html ${width} no page scroll`, !lay.overflow)
    await page.screenshot({ path: path.join(OUT, `nonlung_termsheet_${width}.png`), fullPage: false })
    await page.close()
  }

  log.fails = fails
  check('no page errors', log.pageerrors.length === 0, log.pageerrors.join(' | '))
  check('no console errors', log.console.length === 0, log.console.join(' | '))
  check('no failed API calls', log.failed.length === 0, log.failed.join(' | '))
  log.fails = fails
  fs.writeFileSync(path.join(OUT, 'terms_nonlung.json'), JSON.stringify(log, null, 2))
  console.log(JSON.stringify({ api: log.api, unresolvedShown: log.unresolvedShown, fails }, null, 2))
  await browser.close()
})()
