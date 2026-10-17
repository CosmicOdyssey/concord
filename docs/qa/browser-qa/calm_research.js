// Research tab (Calm) QA: every sub-route and pre-pivot link opens its sub-tab under the in-sample banner and label;
// Simple vs Detailed (what moves into disclosures, what stays visible); the numbers on screen equal the API
// responses the page received; hover cards open on hover, keyboard focus and tap; the clear-run controls, the trial
// row -> price tags link and the other deep links work; no horizontal page scroll; no page or console errors; and a
// screenshot of every sub-view in both densities and both themes at 1440 and 390 px.
//
// Only the default US-Northeast clear and the Regeneron September 2024 preset are run; the API caches both. The
// assumptions are never changed (a new clear takes minutes on the shared backend). Price tags and slot values are
// recomputed by the backend on each request (about 10 s each).
//
// usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node calm_research.js [base] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep, layoutCheck } = require('./lib')

const BASE = process.argv[2] || 'http://127.0.0.1:5216'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/R/research'
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
fs.mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}` : ''}`)
}
const want = (part) => !ONLY || ONLY.includes(part)

// ---- format.ts (same logic) ----
const DASH = '—'
const isNum = (x) => typeof x === 'number' && Number.isFinite(x)
const num = (x, d = 1) => (!isNum(x) ? DASH : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))
const int = (x) => (!isNum(x) ? DASH : Math.round(x).toLocaleString('en-US'))
const pct = (x, d = 0) => (!isNum(x) ? DASH : `${(x * 100).toFixed(d)}%`)
const times = (x, d = 2) => (!isNum(x) ? DASH : `${x.toFixed(d)}×`)
const usd = (x) => (!isNum(x) ? DASH : `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()

const COMPS = ['coord_vs_actual', 'indep_vs_actual', 'coordination_no_loser_vs_indep', 'coord_free_vs_actual', 'coord_free_vs_indep']
// Words the Research views must not use (copy deck D, rule 1).
const BANNED = /months saved|speed ?up|faster trials|faster enrollment|better site selection|cost savings|fair market value(?! legal opinion)/i

async function fresh(browser, { width = 1440, height = 900, theme = 'light', density = 'simple' } = {}) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  const touch = width < 600
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch })
  // Set the stored theme and density once per tab, so a later click on the header control is not undone by a reload.
  await page.evaluateOnNewDocument(
    (t, d) => {
      try {
        if (!sessionStorage.getItem('qa-init')) {
          localStorage.setItem('concord.theme', t)
          localStorage.setItem('concord.density', d)
          sessionStorage.setItem('qa-init', '1')
        }
      } catch {
        /* storage off */
      }
    },
    theme,
    density,
  )
  page.__errors = []
  page.__api = []
  page.on('pageerror', (e) => page.__errors.push(`pageerror ${e}`))
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && page.__errors.push(`console.${m.type()} ${m.text()}`))
  page.on('response', async (res) => {
    const url = res.url()
    if (!url.includes('/api/')) return
    if (res.status() >= 400) page.__errors.push(`http ${res.status()} ${url}`)
    let body = null
    try {
      body = await res.json()
    } catch {
      /* not JSON */
    }
    page.__api.push({ url, post: res.request().postData() ?? null, status: res.status(), body })
  })
  return { ctx, page }
}

/** The last API response whose URL (and POST body) matches. */
function lastApi(page, pred) {
  for (let i = page.__api.length - 1; i >= 0; i--) if (page.__api[i].status === 200 && pred(page.__api[i])) return page.__api[i].body
  return null
}
const clearBody = (page, sponsor = null) =>
  lastApi(page, (a) => a.url.endsWith('/api/clear') && a.post && (JSON.parse(a.post).sponsor ?? null) === sponsor && JSON.parse(a.post).region === (sponsor ? 'US' : 'US-Northeast'))

const waitFn = (page, fn, arg, timeout = 120000) => page.waitForFunction(fn, { timeout, polling: 250 }, arg)

async function go(page, hash) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
  await sleep(300)
}

/** Ready: the sub-tab shows, its in-sample label rendered, nothing loading. */
async function ready(page, subLabel, extra) {
  await waitFn(
    page,
    (s) => document.querySelector('.rs-tabs [aria-selected="true"]')?.innerText.trim() === s && !!document.querySelector('main .rs-label') && !document.querySelector('main .loading'),
    subLabel,
    240000,
  )
  if (extra) await waitFn(page, extra, null, 240000)
  try {
    await page.waitForNetworkIdle({ idleTime: 600, timeout: 15000 })
  } catch {
    /* map tiles */
  }
  await page.evaluate(() => document.fonts && document.fonts.ready)
  await sleep(400)
}

async function setDensity(page, d) {
  await page.evaluate((label) => [...document.querySelectorAll('.density-seg button')].find((b) => b.innerText.trim() === label)?.click(), d === 'simple' ? 'Simple' : 'Detailed')
  await sleep(500)
}

/** Text of the elements matching sel that are rendered (not inside a closed disclosure). */
const shown = (page, sel) =>
  page.$$eval(sel, (els) => els.filter((e) => e.checkVisibility()).map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
const isShown = (page, sel) => page.evaluate((s) => !!document.querySelector(s) && document.querySelector(s).checkVisibility(), sel)

/** The open hover card's text, or null. */
const openCard = (page) =>
  page.evaluate(() => {
    const c = [...document.querySelectorAll('.hc-card')].find((x) => !x.hidden && x.checkVisibility())
    return c ? c.innerText.replace(/\s+/g, ' ').trim() : null
  })

async function focusByTab(page, sel) {
  // Focus the focusable element before `sel`, then press Tab, so the trigger gets keyboard (:focus-visible) focus.
  await page.evaluate((s) => {
    const t = document.querySelector(s)
    const all = [...document.querySelectorAll('a[href], button:not([disabled]), select, input, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter(
      (e) => e.checkVisibility(),
    )
    const i = all.indexOf(t)
    ;(all[i - 1] ?? document.body).focus()
  }, sel)
  await page.keyboard.press('Tab')
  await sleep(350)
  return page.evaluate((s) => document.activeElement === document.querySelector(s), sel)
}

function expectRange(xs) {
  const v = xs.filter(isNum)
  if (!v.length) return DASH
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  return Math.abs(hi - lo) < 0.005 ? times(lo) : `${times(lo)} to ${times(hi)}`
}

function mapStats(r) {
  return ['actual', 'indep', 'coord', 'coord_free'].map((a) => {
    const loads = r.sites.map((s) => ({ s, n: s[`load_${a}`] }))
    const slots = loads.reduce((acc, x) => acc + x.n, 0)
    const amc = loads.reduce((acc, x) => acc + (x.s.is_amc ? x.n : 0), 0)
    const top10 = [...loads].sort((x, y) => y.n - x.n).slice(0, 10).reduce((acc, x) => acc + x.n, 0)
    return { a, used: r.counts[`sites_used_${a}`], top10: slots ? top10 / slots : null, amc: slots ? amc / slots : null, max: Math.max(0, ...loads.map((x) => x.n)) }
  })
}

;(async () => {
  const browser = await launch()
  try {
    // ---------------------------------------------------------------- 1. routes, banner and in-sample labels
    if (want('routes')) {
      const { ctx, page } = await fresh(browser)
      const routes = [
        ['#research/model', 'Model & data'],
        ['#research/robustness', 'Robustness'],
        ['#research/clear', 'Clear it'],
        ['#research/map', 'Map'],
        ['#research/portfolio', 'Portfolio clearing'],
        ['#research/prices', 'Price tags'],
        ['#research/terms', 'Term sheet (old)'],
        ['#clear', 'Clear it'],
        ['#map', 'Map'],
        ['#robustness', 'Robustness'],
        ['#model', 'Model & data'],
        ['#terms', 'Term sheet (old)'],
        ['#prices/NCT06452277', 'Price tags'],
        ['#research', 'Price tags'], // keeps the last sub-tab
      ]
      const got = []
      for (const [hash, sub] of routes) {
        await go(page, hash)
        try {
          await ready(page, sub)
        } catch {
          /* recorded below */
        }
        got.push(
          await page.evaluate(
            (h, s) => ({
              hash: h,
              want: s,
              tab: document.querySelector('nav.tabs [aria-selected="true"] .tab-label')?.innerText ?? null,
              sub: document.querySelector('.rs-tabs [aria-selected="true"]')?.innerText.trim() ?? null,
              banner: document.querySelector('.rs-banner')?.innerText.includes('in-sample model outputs, not product claims') ?? false,
              bannerShown: (document.querySelector('.rs-banner')?.checkVisibility() ?? false),
              label: document.querySelector('main .rs-label')?.innerText.replace(/\s+/g, ' ') ?? null,
              h1: document.querySelector('main h1')?.innerText ?? null,
              selected: document.querySelector('main .controls select')?.value ?? null,
            }),
            hash,
            sub,
          ),
        )
      }
      const bad = got.filter((g) => g.tab !== 'Research' || g.sub !== g.want || !g.banner || !g.bannerShown || !g.label || !g.h1)
      check('every Research sub-route and pre-pivot link opens its sub-tab under the banner, with an h1 and the in-sample label', bad.length === 0, bad.length ? bad : `${got.length} routes`)
      check('the in-sample label names the kind of number on each sub-view', got.every((g) => /In-sample model output|Model inputs and checks/.test(g.label ?? '')), got.map((g) => g.label?.slice(0, 50)))
      const pr = got.find((g) => g.hash === '#prices/NCT06452277')
      check('#prices/NCT06452277 preselects that trial', pr?.selected === 'NCT06452277', pr)
      // Sub-tab clicks change the hash; Back returns to the previous sub-tab.
      await page.evaluate(() => [...document.querySelectorAll('.rs-tabs button')].find((b) => b.innerText.trim() === 'Model & data').click())
      await sleep(500)
      await page.evaluate(() => [...document.querySelectorAll('.rs-tabs button')].find((b) => b.innerText.trim() === 'Robustness').click())
      await sleep(500)
      const h1 = await page.evaluate(() => location.hash)
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null)
      await sleep(800)
      const back = await page.evaluate(() => ({ hash: location.hash, sub: document.querySelector('.rs-tabs [aria-selected="true"]')?.innerText.trim() }))
      check('sub-tab clicks set #research/<sub>; Back returns to the previous sub-tab', h1 === '#research/robustness' && back.hash === '#research/model' && back.sub === 'Model & data', { h1, back })
      // The sub-tab bar is a tablist of real buttons, one selected.
      const bar = await page.evaluate(() => {
        const n = document.querySelector('.rs-tabs')
        return { role: n.getAttribute('role'), seg: n.classList.contains('seg'), tabs: [...n.querySelectorAll('button[role="tab"]')].length, selected: n.querySelectorAll('[aria-selected="true"]').length }
      })
      check('sub-tabs: a segmented control with role=tablist, 7 tab buttons, one selected', bar.role === 'tablist' && bar.seg && bar.tabs === 7 && bar.selected === 1, bar)
      check('routes: no page, console or HTTP errors', page.__errors.length === 0, page.__errors.slice(0, 5))
      await ctx.close()
    }

    // ---------------------------------------------------------------- 2. Clear it: Simple, then Detailed
    if (want('clear')) {
      const { ctx, page } = await fresh(browser)
      await go(page, '#research/clear')
      await ready(page, 'Clear it', () => (document.querySelector('.run-status')?.innerText ?? '').includes('Cleared US-Northeast') && document.querySelectorAll('.rs-lane').length === 3)
      const r = clearBody(page)
      check('clear: the page received the default US-Northeast clear', !!r)
      const s = r.summary
      const lanes = await page.$$eval('#rs-result .rs-lane', (ls) => ls.map((l) => ({ v: l.querySelector('.rs-lane-num')?.innerText.trim(), note: l.querySelector('.rs-lane-note')?.innerText.trim() })))
      const exp = [s.coord_vs_actual.ratio, s.indep_vs_actual.ratio, s.coordination_no_loser_vs_indep.ratio].map((x) => times(x))
      check('clear (Simple): the three lanes equal the API ratios (capped, site selection, pure coordination)', JSON.stringify(lanes.map((l) => l.v)) === JSON.stringify(exp), { lanes, exp })
      check('clear (Simple): every lane value carries "in-sample" beside it', lanes.every((l) => l.note === 'in-sample'), lanes)
      const res = await shown(page, '#rs-result .section-text')
      check(
        'clear (Simple): the claim keeps its qualifiers visible (in-sample, scored by our model, does not hold out of sample, trials compared)',
        res.length === 1 &&
          res[0].includes('In-sample') &&
          res[0].includes('scored by our enrollment model') &&
          res[0].includes('Does not hold out of sample') &&
          res[0].includes(`${int(s.coord_vs_actual.trials)} trials compared · ${int(s.background_trials)} held fixed as background`) &&
          res[0].includes(times(s.coord_vs_actual.ratio)) &&
          res[0].includes(times(s.coordination_no_loser_vs_indep.ratio)),
        res[0]?.slice(0, 400),
      )
      const c = s.calibration_check
      const ratio = c.model_median_T_actual_phase3 / c.real_completed_phase3_median_enrollment_window
      if (ratio > 1.25) check('clear (Simple): the calibration check stays visible', res[0].includes(`${num(ratio, 1)}×`), num(ratio, 1))
      const simpleState = await page.evaluate(() => ({
        disclosures: [...document.querySelectorAll('main details.section-disclosure')].map((d) => ({ open: d.open, summary: d.querySelector('summary').innerText.trim() })),
        tableShown: (document.querySelector('.tbl-trials')?.checkVisibility() ?? false),
        tableInDom: !!document.querySelector('.tbl-trials tbody tr'),
        statsShown: [...document.querySelectorAll('main .stat')].some((x) => x.checkVisibility()),
        controls: !!document.querySelector('.rs-controls .btn-primary') && document.querySelector('.rs-controls .btn-primary').checkVisibility(),
      }))
      check(
        'clear (Simple): secondary tables sit in closed Details disclosures; the clear controls stay visible',
        simpleState.disclosures.length >= 2 && simpleState.disclosures.every((d) => !d.open) && !simpleState.tableShown && simpleState.tableInDom && !simpleState.statsShown && simpleState.controls,
        simpleState,
      )
      // Hover cards: pointer hover, keyboard focus, Escape.
      const info = '#rs-result .hc-info'
      await page.hover(info)
      await sleep(450)
      const onHover = await openCard(page)
      await page.mouse.move(2, 2)
      await sleep(500)
      const afterLeave = await openCard(page)
      const focused = await focusByTab(page, info)
      const onFocus = await openCard(page)
      await page.keyboard.press('Escape')
      await sleep(300)
      const afterEsc = await openCard(page)
      check(
        'clear: the section info card opens on hover and on keyboard focus, and closes on leave and Escape',
        onHover?.includes('Does not hold out of sample') && !afterLeave && focused && onFocus?.includes('Does not hold out of sample') && !afterEsc,
        { onHover: onHover?.slice(0, 60), afterLeave, focused, onFocus: onFocus?.slice(0, 60), afterEsc },
      )
      await page.hover('#rs-result .section-quals .qual .hc-trigger')
      await sleep(450)
      const gloss = await openCard(page)
      check('clear: the "In-sample" mark opens its glossary card (copy deck B4)', gloss?.includes('Scored on the same data used to make the choice. This flatters the result.'), gloss)
      await page.mouse.move(2, 2)
      await sleep(400)
      // Open the trials disclosure and follow a row to its price tags.
      await page.evaluate(() => [...document.querySelectorAll('main details.section-disclosure > summary')].find((x) => x.innerText.includes('Show the trials table')).click())
      await sleep(400)
      const rows = await page.$$eval('.tbl-trials tbody tr', (rs) => rs.length)
      check('clear: "Show the trials table" opens the full table', rows === r.trials.length && (await isShown(page, '.tbl-trials')), { rows, api: r.trials.length })
      const firstId = await page.$eval('.tbl-trials tbody tr', (tr) => (tr.innerText.match(/NCT\d{8}/) || [])[0])
      await page.click('.tbl-trials tbody tr td.sponsor-cell')
      await waitFn(page, () => location.hash.startsWith('#research/prices'), null, 10000)
      await ready(page, 'Price tags', () => document.querySelectorAll('.rs-tag-simple, .tag').length > 0 || !!document.querySelector('main .error'))
      const sel = await page.$eval('main .controls select', (x) => x.value)
      check('clear: clicking a trial row opens Price tags with that trial selected', sel === firstId, { sel, firstId })
      const tg = lastApi(page, (a) => a.url.includes(`/api/trials/${firstId}/price-tags`))
      const tagRows = await page.$$eval('.rs-tag-simple', (ls) => ls.map((l) => ({ label: l.querySelector('.strong')?.innerText.trim(), v: l.querySelector('.rs-tag-num > span')?.innerText.trim() })))
      const sgn = (m) => `${m > 0 ? '−' : m < 0 ? '+' : ''}${num(Math.abs(m))} mo`
      check(
        'prices (Simple): each criterion row shows the API months for this trial, in order',
        !!tg && JSON.stringify(tagRows) === JSON.stringify(tg.criteria.map((c) => ({ label: c.label, v: sgn(c.months_saved_trial) }))),
        { tagRows: tagRows.slice(0, 3), api: tg?.criteria.slice(0, 3).map((c) => [c.label, c.months_saved_trial]) },
      )
      if (tg?.criteria.length) {
        await page.hover('.rs-tag-simple .hc-info')
        await sleep(450)
        const card = await openCard(page)
        check('prices (Simple): the criterion info card holds its source sentence, portfolio months and pool', card?.includes(tg.criteria[0].source.slice(0, 30)) && card.includes(`Portfolio ${num(tg.criteria[0].months_saved_portfolio)} trial-mo`), card?.slice(0, 120))
        await page.mouse.move(2, 2)
        await sleep(300)
      }
      const pricesQual = await shown(page, '#rs-tags .section-quals')
      check('prices (Simple): in-sample and eligibility-source qualifiers stay visible', pricesQual[0]?.includes('In-sample') && pricesQual[0]?.includes('Eligibility:'), pricesQual[0])

      // Detailed, via the header control (the same page: nothing is refetched).
      await setDensity(page, 'detailed')
      const tagsD = await page.$$eval('.tags .tag', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')))
      check(
        'prices (Detailed): the full price-tag rows (this trial, portfolio, pool, source sentence) as before',
        tg && tagsD.length === tg.criteria.length && tg.criteria.every((c, i) => tagsD[i].includes(`this trial, if relaxed ${sgn(c.months_saved_trial)} portfolio ${num(c.months_saved_portfolio)} trial-mo pool ${times(c.pool_multiplier)}`)),
        tagsD.slice(0, 2),
      )
      // Slot values: the compute button works in Detailed.
      await page.evaluate(() => [...document.querySelectorAll('#rs-slots button')].find((b) => b.innerText.includes('Compute slot values')).click())
      await waitFn(page, () => !!document.querySelector('#rs-slots tbody tr') || !!document.querySelector('#rs-slots .error') || (document.querySelector('#rs-slots')?.innerText ?? '').includes('No site is at capacity'), null, 180000)
      const sv = lastApi(page, (a) => a.url.includes('/api/slot-values'))
      const svRows = await page.$$eval('#rs-slots tbody tr', (rs) => rs.map((tr) => [...tr.children].map((td) => td.innerText.trim())))
      check('prices: "Compute slot values" shows the API slot values', !!sv && svRows.length === sv.length && sv.every((x, i) => svRows[i][4] === num(x.months_saved) && svRows[i][1] === int(x.k)), { n: svRows.length, api: sv?.length })

      await go(page, '#research/clear')
      await ready(page, 'Clear it')
      const stats = await page.$$eval('main .stat', (ss) => Object.fromEntries(ss.filter((x) => x.checkVisibility()).map((x) => [x.querySelector('.stat-label').innerText.trim(), x.querySelector('.stat-value').innerText.trim()])))
      const h = s.coord_vs_actual
      check(
        'clear (Detailed): the headline stats equal the API',
        stats['Enrollment-time ratio (in-sample)'] === times(h.ratio) && stats['Median per-trial ratio (in-sample)'] === times(h.median_speedup) && norm(stats['Trial-months (in-sample)']) === `${int(h.dividend_trial_months)} trial-months`,
        stats,
      )
      const decomp = await page.evaluate(() => {
        const t = [...document.querySelectorAll('main table')].find((x) => x.querySelector('thead th')?.innerText.trim() === 'Comparison' && x.checkVisibility())
        return t ? [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, ' ').trim())) : null
      })
      check(
        'clear (Detailed): "Where the gain comes from" shows all five comparisons with the API ratio, median and trial-months',
        decomp && COMPS.every((k, i) => decomp[i][1] === times(s[k].ratio) && decomp[i][2] === times(s[k].median_speedup) && decomp[i][6] === int(s[k].dividend_trial_months)),
        decomp?.map((x) => x.slice(1, 3)),
      )
      const trialRows = await page.$$eval('.tbl-trials tbody tr', (rs) => rs.map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, ' ').trim())))
      const byId = new Map(r.trials.map((t) => [t.nct_id, t]))
      const badRows = trialRows
        .map((row) => {
          const t = byId.get((row[0].match(/NCT\d{8}/) || [])[0])
          if (!t) return row[0]
          const okT = ['actual', 'indep', 'coord', 'coord_free'].every((k, i) => row[4 + i] === num(t[`T_${k}`]))
          return okT && row[2] === num(t.target_region) && row[3] === int(t.sites_actual) ? null : row[0]
        })
        .filter(Boolean)
      check('clear (Detailed): the trials table is open and every row equals the API (target, sites, four T values)', trialRows.length === r.trials.length && badRows.length === 0 && (await isShown(page, '.tbl-trials')), { rows: trialRows.length, bad: badRows.slice(0, 3) })
      const heads = await page.$$eval('.tbl-trials thead th', (ths) => ths.map((t) => t.innerText.replace(/\s+/g, ' ').trim()))
      check('clear: the trials table says "Difference (mo)", not "Months saved"', heads.some((x) => x.startsWith('Difference (mo)')) && !heads.some((x) => /months saved/i.test(x)), heads)
      const asm = await page.evaluate(() => (document.querySelector('main .raw-grid')?.innerText ?? '').replace(/\s+/g, ' '))
      const b = s.assumptions.beta
      check('clear (Detailed): Assumptions used shows β with its 95% CI from the API', asm.includes(`${num(b.beta, 3)} (95% CI ${num(b.ci95[0], 3)} to ${num(b.ci95[1], 3)})`), asm.slice(0, 120))
      // The clear-run controls: Assumptions opens with its form; "Clear the market" re-runs (the cached default clear).
      await page.click('.rs-controls details.assumptions > summary')
      await sleep(300)
      const form = await page.evaluate(() => ({
        open: document.querySelector('.rs-controls details.assumptions').open,
        fields: document.querySelectorAll('.rs-controls .form-grid .field').length,
        sliders: document.querySelectorAll('.rs-controls .sliders input[type=range]').length,
        resetDisabled: [...document.querySelectorAll('.rs-controls button')].find((x) => x.innerText.includes('Reset to defaults'))?.disabled,
      }))
      check('clear: the Assumptions disclosure opens with its five fields, three sliders and a (disabled) reset', form.open && form.fields === 5 && form.sliders === 3 && form.resetDisabled === true, form)
      const nClears = page.__api.filter((a) => a.url.endsWith('/api/clear')).length
      await page.click('.rs-controls .btn-primary')
      await waitFn(page, (n) => (document.querySelector('.run-status')?.innerText ?? '').includes('Cleared US-Northeast') && !document.querySelector('main .loading'), nClears, 240000)
      await sleep(500)
      check('clear: "Clear the market" runs a clear and the run status reports it', page.__api.filter((a) => a.url.endsWith('/api/clear')).length === nClears + 1, { before: nClears })
      check('clear and price tags: no page, console or HTTP errors', page.__errors.length === 0, page.__errors.slice(0, 5))
      await ctx.close()
    }

    // ---------------------------------------------------------------- 3. Robustness
    if (want('robustness')) {
      const { ctx, page } = await fresh(browser)
      await go(page, '#research/robustness')
      await ready(page, 'Robustness', () => document.querySelectorAll('#rs-survives .rs-lane').length >= 3)
      const d = lastApi(page, (a) => a.url.includes('/api/robustness'))
      const assumed = (r) => r.beta_label.toLowerCase().includes('assumed')
      const data = d.rows.filter((r) => !assumed(r))
      const exp = [expectRange(data.map((r) => r.coordination_no_loser_vs_indep.ratio))]
      if (d.rows.some(assumed)) exp.push(expectRange(d.rows.filter(assumed).map((r) => r.coordination_no_loser_vs_indep.ratio)))
      exp.push(expectRange(data.map((r) => r.coord_vs_actual.ratio)), expectRange(data.map((r) => r.indep_vs_actual.ratio)))
      const lanes = await page.$$eval('#rs-survives .rs-lane', (ls) => ls.map((l) => ({ v: l.querySelector('.rs-lane-num').innerText.replace(/\s+/g, ' ').trim(), note: l.querySelector('.rs-lane-note')?.innerText.trim(), assumed: l.classList.contains('rs-lane-assumed') })))
      check('robustness (Simple): the lanes equal the ranges computed from the API grid', JSON.stringify(lanes.map((l) => l.v)) === JSON.stringify(exp), { lanes, exp })
      check(
        'robustness (Simple): the assumed β = 1 lane is drawn as assumed (weakening result as prominent as the others), the rest are marked in-sample',
        lanes.filter((l) => l.assumed).every((l) => l.note === 'assumed β') && lanes.filter((l) => !l.assumed).every((l) => l.note === 'in-sample') && lanes.length === exp.length,
        lanes,
      )
      const lede = (await shown(page, '#rs-survives .section-lede'))[0] ?? ''
      check('robustness (Simple): the plain sentence says where the earlier dividend came from', !d.rows.some(assumed) || lede.includes('The earlier coordination dividend came from that assumption'), lede.slice(0, 200))
      check('robustness (Simple): the grid is in a closed disclosure', !(await isShown(page, '.tbl-robust')) && !!(await page.$('.tbl-robust')))
      await setDensity(page, 'detailed')
      const grid = await page.$$eval('.tbl-robust tbody tr', (rs) => rs.map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, ' ').trim())))
      check(
        'robustness (Detailed): the grid shows every API row with its pure-coordination and site-selection ratios',
        grid.length === d.rows.length && d.rows.every((r, i) => grid[i][4] === times(r.coordination_no_loser_vs_indep.ratio, 3) && grid[i][7] === times(r.indep_vs_actual.ratio)) && (await isShown(page, '.tbl-robust')),
        { rows: grid.length, api: d.rows.length },
      )
      await page.evaluate(() => [...document.querySelectorAll('.rs-scenario button')].find((b) => b.innerText.includes('Regeneron')).click())
      await waitFn(page, () => (document.querySelector('#rs-grid .section-lede')?.innerText ?? '').includes('Regeneron') || !!document.querySelector('main .empty'), null, 60000)
      const rg = await page.evaluate(() => ({ pressed: document.querySelector('.rs-scenario [aria-checked="true"]')?.innerText, lede: document.querySelector('#rs-grid .section-lede')?.innerText ?? document.querySelector('main .empty')?.innerText }))
      check('robustness: the scenario control switches to the Regeneron grid', rg.pressed?.includes('Regeneron') && /Regeneron|Not precomputed/.test(rg.lede ?? ''), rg)
      check('robustness: no page, console or HTTP errors', page.__errors.length === 0, page.__errors.slice(0, 5))
      await ctx.close()
    }

    // ---------------------------------------------------------------- 4. Map
    if (want('map')) {
      const { ctx, page } = await fresh(browser)
      await go(page, '#research/map')
      await ready(page, 'Map', () => document.querySelectorAll('.rs-bars li').length === 4)
      const r = clearBody(page)
      const st = mapStats(r)
      const bars = await page.$$eval('.rs-bars li', (ls) => ls.map((l) => [l.querySelector('.rs-bars-label').innerText.trim(), l.querySelector('.rs-bars-val').innerText.trim()]))
      check('map (Simple): the concentration bars equal the top-10 shares computed from the API assignments', JSON.stringify(bars.map((b) => b[1])) === JSON.stringify(st.map((x) => pct(x.top10))), { bars, exp: st.map((x) => pct(x.top10)) })
      const legend = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement)
        const sw = [...document.querySelectorAll('.legend .sw')].map((x) => getComputedStyle(x).backgroundColor)
        const probe = document.createElement('i')
        document.body.append(probe)
        const rgb = (v) => {
          probe.style.color = v
          return getComputedStyle(probe).color
        }
        const out = { sw, tokens: [rgb(cs.getPropertyValue('--series-2')), rgb(cs.getPropertyValue('--accent')), rgb(cs.getPropertyValue('--ctl'))] }
        probe.remove()
        return out
      })
      check('map: marker colours come from the theme tokens (series-2, accent, control grey)', JSON.stringify(legend.sw) === JSON.stringify(legend.tokens), legend)
      await page.evaluate(() => [...document.querySelectorAll('.map-wrap .seg-btn')].find((b) => b.innerText.trim() === 'Joint optimum').click())
      await sleep(500)
      await setDensity(page, 'detailed')
      const side = await page.evaluate(() => ({
        pressed: document.querySelector('.map-wrap [aria-checked="true"]')?.innerText.trim(),
        head: [...document.querySelectorAll('.side h2')].map((h) => h.innerText.trim()),
        rows: [...document.querySelectorAll('.side table tbody tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim())),
        top: [...document.querySelectorAll('.side .toplist li')].length,
      }))
      check('map: the allocation control switches to Joint optimum and the busiest list follows', side.pressed === 'Joint optimum' && side.head.includes('Busiest sites · Joint optimum') && side.top > 0, side.head)
      check(
        'map (Detailed): the concentration table equals the API (sites used, top-10 share, AMC share, max)',
        side.rows.length === 4 && st.every((x, i) => side.rows[i][1] === int(x.used) && side.rows[i][2] === pct(x.top10) && side.rows[i][3] === pct(x.amc) && side.rows[i][4] === int(x.max)),
        side.rows,
      )
      // Dark: Leaflet's own chrome follows the palette.
      await page.evaluate(() => document.querySelector('.theme-seg button[aria-label="Dark theme"]')?.click())
      await sleep(700)
      const dark = await page.evaluate(() => {
        const z = document.querySelector('.leaflet-control-zoom-in')
        const lum = (c) => {
          const m = c.match(/\d+(\.\d+)?/g).map(Number)
          return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255
        }
        return { theme: document.documentElement.dataset.theme, zoomBg: lum(getComputedStyle(z).backgroundColor), zoomFg: lum(getComputedStyle(z).color), tiles: getComputedStyle(document.querySelector('.leaflet-tile-pane')).filter }
      })
      check('map (dark): zoom control dark with light glyphs; tiles inverted', dark.theme === 'dark' && dark.zoomBg < 0.2 && dark.zoomFg > 0.6 && dark.tiles.includes('invert'), dark)
      check('map: no page, console or HTTP errors', page.__errors.length === 0, page.__errors.slice(0, 5))
      await ctx.close()
    }

    // ---------------------------------------------------------------- 5. Term sheet (old)
    if (want('terms')) {
      const { ctx, page } = await fresh(browser)
      await go(page, '#research/terms')
      await ready(page, 'Term sheet (old)', () => !!document.querySelector('#rs-sheet') || !!document.querySelector('main .error'))
      const ts = lastApi(page, (a) => a.url.includes('/api/termsheet'))
      const kfs = await page.$$eval('#rs-sheet .kf-value', (ks) => ks.map((k) => k.innerText.trim()))
      check('terms (Simple): the three key figures equal the API (expected patients, per patient, site total)', !!ts && JSON.stringify(kfs) === JSON.stringify([num(ts.expected_patients), usd(ts.budget.per_patient_total), usd(ts.expected_site_total)]), { kfs })
      const quals = (await shown(page, '#rs-sheet .section-quals'))[0] ?? ''
      check('terms (Simple): the expected-patients source, price source and capability qualifiers stay visible', quals.includes('Expected patients:') && quals.includes('CMS 2026') && quals.includes('not verified with the site'), quals)
      const disc = await shown(page, 'main > .rs .caveat, main .rs-view > .caveat')
      check('terms (Simple): the disclaimer (decision support, not a legal fair-market-value determination) is visible', disc.some((x) => x.includes(ts.disclaimer)), disc)
      await setDensity(page, 'detailed')
      const stats = await page.$$eval('main .stat', (ss) => ss.map((x) => x.querySelector('.stat-value').innerText.trim()))
      const cov = await page.$$eval('.tbl-coverage tbody tr', (rs) => rs.length)
      check('terms (Detailed): stats and the full coverage grid as before', JSON.stringify(stats) === JSON.stringify([num(ts.expected_patients), usd(ts.budget.per_patient_total), usd(ts.expected_site_total)]) && cov === ts.coverage_grid.length, { stats, cov })
      const disc2 = await shown(page, 'main .rs-view > .caveat')
      check('terms (Detailed): the disclaimer is visible', disc2.some((x) => x.includes(ts.disclaimer)))
      check('terms: no page, console or HTTP errors', page.__errors.length === 0, page.__errors.slice(0, 5))
      await ctx.close()
    }

    // ---------------------------------------------------------------- 6. Model & data
    if (want('model')) {
      const { ctx, page } = await fresh(browser)
      await go(page, '#research/model')
      await ready(page, 'Model & data', () => !!document.querySelector('#rs-congestion .coefplot') && !!document.querySelector('#rs-data'))
      const cg = lastApi(page, (a) => a.url.endsWith('/api/congestion-test'))
      const st = lastApi(page, (a) => a.url.endsWith('/api/status'))
      const prim = cg.results[cg.primary]
      const bt = st.model.backtest
      const fig = await page.evaluate(() => ({
        cong: [...document.querySelectorAll('#rs-congestion .kf')].map((k) => k.innerText.replace(/\s+/g, ' ')),
        bt: [...document.querySelectorAll('#rs-backtest .kf-value')].map((k) => k.innerText.trim()),
        data: [...document.querySelectorAll('#rs-data .kf-value')].map((k) => k.innerText.trim()),
      }))
      check(
        'model (Simple): the congestion figure equals the API estimate with its 95% CI beside it',
        fig.cong[0]?.includes(num(prim.coef, 3)) && fig.cong[0]?.includes(`95% CI ${num(prim.ci95[0], 3)} to ${num(prim.ci95[1], 3)}`),
        fig.cong,
      )
      const mErr = Math.exp(bt.by_model.model.industry_p23.median_abs_log_error)
      const nErr = Math.exp(bt.by_model.naive.industry_p23.median_abs_log_error)
      check('model (Simple): the held-out typical miss equals the API (fitted model and naive baseline)', JSON.stringify(fig.bt) === JSON.stringify([`×${num(mErr, 1)}`, `×${num(nErr, 1)}`]), fig.bt)
      check('model (Simple): the data counts equal the API', JSON.stringify(fig.data) === JSON.stringify([int(st.counts.trials), int(st.counts.sites), int(st.counts.trial_sites)]), fig.data)
      const btq = (await shown(page, '#rs-backtest .section-quals'))[0] ?? ''
      check('model (Simple): the backtest says held-out, with its cutoff', btq.includes('Held-out') && btq.includes(bt.cutoff), btq)
      await page.click('#rs-compiler .btn-primary')
      await waitFn(page, () => !!document.querySelector('.compiled') || !!document.querySelector('#rs-compiler .error'), null, 60000)
      const cp = lastApi(page, (a) => a.url.endsWith('/api/compile/eligibility'))
      const comp = await page.evaluate(() => ({ text: document.querySelector('.compiled .kv-row')?.innerText ?? '', rows: document.querySelectorAll('.compiled tbody tr').length }))
      check('model: the eligibility compiler runs and shows the API result', !!cp && comp.text.includes(cp.eligible_fraction === null ? '—' : pct(cp.eligible_fraction, 1)) && comp.rows === cp.criteria.length, comp)
      await setDensity(page, 'detailed')
      const stats = await page.$$eval('main .stat', (ss) => Object.fromEntries(ss.filter((x) => x.checkVisibility()).map((x) => [x.querySelector('.stat-label').innerText.trim(), x.querySelector('.stat-value').innerText.trim()])))
      check(
        'model (Detailed): congestion and data stats equal the API',
        stats['Within-site estimate'] === num(prim.coef, 3) && stats['Model had assumed'] === num(cg.model_implied_coef_overlap, 0) && stats['Trials'] === int(st.counts.trials) && stats['Observations'] === int(prim.n_rows),
        stats,
      )
      const btRows = await page.$$eval('#rs-backtest tbody tr', (rs) => rs.length)
      check('model (Detailed): the backtest table and the subset and parser tables are inline', btRows >= 3 && (await isShown(page, '#rs-backtest table')) && (await isShown(page, '#rs-congestion .section-details table')))
      check('model: no page, console or HTTP errors', page.__errors.length === 0, page.__errors.slice(0, 5))
      await ctx.close()
    }

    // ---------------------------------------------------------------- 7. Portfolio clearing (Regeneron preset; runs last: it replaces the clear)
    if (want('portfolio')) {
      const { ctx, page } = await fresh(browser)
      await go(page, '#research/portfolio/regeneron')
      await ready(page, 'Portfolio clearing', () => (document.querySelector('.run-status')?.innerText ?? '').includes('Regeneron') && document.querySelectorAll('#rs-result .rs-lane').length === 3)
      const r = clearBody(page, 'Regeneron')
      const s = r.summary
      const lanes = await page.$$eval('#rs-result .rs-lane-num', (ls) => ls.map((l) => l.innerText.trim()))
      check('portfolio (Simple): the lanes equal the Regeneron clear', JSON.stringify(lanes) === JSON.stringify([s.coord_vs_actual, s.indep_vs_actual, s.coordination_no_loser_vs_indep].map((c) => times(c.ratio))), lanes)
      const q = (await shown(page, '#rs-result .section-quals'))[0] ?? ''
      check('portfolio (Simple): the effect on other sponsors’ trials stays visible', q.includes(`${int(s.background_trials)} other trials are held fixed at their registered sites`) && q.includes(`(${int(s.background_worse_under_coord_free)} by any amount)`), q.slice(0, 300))
      const own = r.trials.filter((t) => t.movable)
      await page.evaluate(() => [...document.querySelectorAll('main details.section-disclosure > summary')].find((x) => x.innerText.includes('Show the trials table')).click())
      await sleep(300)
      const rows = await page.$$eval('main details.section-disclosure[open] tbody tr', (rs) => rs.map((tr) => [...tr.children].map((td) => td.innerText.trim())))
      check('portfolio: the sponsor’s trials table equals the API (T registered and coordinated)', rows.length === own.length && own.every((t, i) => rows[i][3] === num(t.T_actual) && rows[i][5] === num(t.T_coord)), { rows: rows.length, own: own.length })
      const words = (await page.evaluate(() => document.querySelector('main').innerText)).match(/compete for the same patients/i)
      check('portfolio: no "compete for the same patients" wording about same-sponsor trials', !words)
      check('portfolio: no page, console or HTTP errors', page.__errors.length === 0, page.__errors.slice(0, 5))
      await ctx.close()
    }

    // ---------------------------------------------------------------- 8. layout, wording and screenshots: 2 widths x 2 themes x 2 densities
    if (want('sweep')) {
      const SUBS = [
        ['clear', '#research/clear', 'Clear it', () => document.querySelectorAll('#rs-result .rs-lane').length === 3],
        ['robustness', '#research/robustness', 'Robustness', () => !!document.querySelector('#rs-grid')],
        ['map', '#research/map', 'Map', () => !!document.querySelector('.leaflet-container')],
        ['prices', '#research/prices/NCT06452277', 'Price tags', () => document.querySelectorAll('.rs-tag-simple, .tag').length > 0 || !!document.querySelector('main .error')],
        ['terms', '#research/terms', 'Term sheet (old)', () => !!document.querySelector('#rs-sheet, .tbl-coverage') || !!document.querySelector('main .error')],
        ['model', '#research/model', 'Model & data', () => !!document.querySelector('#rs-compiler') && !!document.querySelector('#rs-data')],
        ['portfolio', '#research/portfolio/regeneron', 'Portfolio clearing', () => document.querySelectorAll('#rs-result .rs-lane').length === 3],
      ]
      const layoutBad = []
      const wording = []
      const labels = []
      const smallTargets = []
      let errors = []
      for (const width of process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 390]) {
        for (const theme of ['light', 'dark']) {
          for (const density of ['simple', 'detailed']) {
            const { ctx, page } = await fresh(browser, { width, height: width < 600 ? 844 : 900, theme, density })
            for (const [name, hash, sub, extra] of SUBS) {
              await go(page, hash)
              try {
                await ready(page, sub, extra)
              } catch (e) {
                layoutBad.push({ name, width, theme, density, error: String(e).slice(0, 120) })
                continue
              }
              const lc = await layoutCheck(page)
              if (lc.overflow || lc.offenders.length) layoutBad.push({ name, width, theme, density, sw: lc.docScrollWidth, offenders: lc.offenders.slice(0, 3) })
              const info = await page.evaluate(() => ({
                text: document.querySelector('main').innerText,
                banner: (document.querySelector('.rs-banner')?.checkVisibility() ?? false),
                label: (document.querySelector('main .rs-label')?.checkVisibility() ?? false),
                coarse: matchMedia('(pointer: coarse)').matches,
                small: [...document.querySelectorAll('main .btn, main .seg-btn, main select, main input:not([type=range]):not([type=checkbox]), main summary, main .hc-info, .rs-tabs button')]
                  // The info buttons draw small and take their 44 px hit area from ::after (hovercard.css).
                  .filter((e) => e.checkVisibility() && Math.max(e.getBoundingClientRect().height, parseFloat(getComputedStyle(e, '::after').height) || 0) < 43.5)
                  .map((e) => `${e.tagName.toLowerCase()}.${e.className.replace(/ ?seg-on/, '')} ${Math.round(e.getBoundingClientRect().height)}`)
                  .filter((x, i, a) => a.indexOf(x) === i),
              }))
              const m = info.text.match(BANNED)
              if (m) wording.push({ name, density, hit: m[0] })
              if (!info.banner || !info.label) labels.push({ name, width, theme, density, banner: info.banner, label: info.label })
              if (width < 600 && info.coarse && info.small.length) smallTargets.push({ name, density, small: info.small })
              await page.screenshot({ path: path.join(OUT, `${name}-${width}-${theme}-${density}.png`).replace(/\\/g, '/'), fullPage: true })
            }
            if (width === 390 && theme === 'light' && density === 'simple') {
              // Tap opens a hover card on the phone.
              await go(page, '#research/clear')
              await ready(page, 'Clear it', () => document.querySelectorAll('#rs-result .rs-lane').length === 3)
              await page.evaluate(() => document.querySelector('#rs-result .hc-info').scrollIntoView({ block: 'center' }))
              await sleep(300)
              await page.tap('#rs-result .hc-info')
              await sleep(400)
              const card = await openCard(page)
              check('phone: tapping the info button opens its card', card?.includes('Does not hold out of sample'), card?.slice(0, 60))
              const tabs = await page.evaluate(() => {
                const n = document.querySelector('.rs-tabs')
                const r = n.getBoundingClientRect()
                return { left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, scroll: n.scrollWidth > n.clientWidth, ox: getComputedStyle(n).overflowX }
              })
              check('phone: the sub-tab control fits the screen and scrolls inside itself', tabs.left >= 0 && tabs.right <= tabs.vw && tabs.ox === 'auto', tabs)
            }
            errors = errors.concat(page.__errors.map((e) => `${width}/${theme}/${density}: ${e}`))
            await ctx.close()
          }
        }
      }
      check('layout: no horizontal page scroll and nothing cut off, every sub-view, 1440 and 390, both themes and densities', layoutBad.length === 0, layoutBad.slice(0, 6))
      check('honesty: the in-sample banner and label are visible on every sub-view in both densities and themes', labels.length === 0, labels.slice(0, 6))
      check('honesty: no banned wording (months saved, speedup, faster enrollment, better site selection, savings) in any sub-view', wording.length === 0, wording)
      check('phone: controls are at least 44 px tall on a coarse pointer', smallTargets.length === 0, smallTargets.slice(0, 4))
      check('sweep: no page, console or HTTP errors', errors.length === 0, errors.slice(0, 6))
    }
  } catch (e) {
    check('run completed', false, String(e && e.stack ? e.stack : e).slice(0, 800))
  } finally {
    await browser.close()
  }
  fs.writeFileSync(path.join(OUT, 'research-qa.json'), JSON.stringify(results, null, 1))
  const fails = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - fails}/${results.length} passed`)
})()
