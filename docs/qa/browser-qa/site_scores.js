// Browser QA for the Site scores tab (Calm): Simple and Detailed, light and dark, 1440 and 390 px. Screenshots,
// numbers against the API, honesty wording, controls and deep links in both densities, hover cards on hover, keyboard
// focus and tap, layout (no sideways page scroll), page and console errors.
//   NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules \
//   APP=http://127.0.0.1:5214 SCREENS=<dir> node docs/qa/browser-qa/site_scores.js
const fs = require('fs')
const L = require('./lib')

const APP = process.env.APP || 'http://127.0.0.1:5214'
const SCREENS = process.env.SCREENS || 'C:/Users/micha/Projects/concord/data/work/R/site-scores'
fs.mkdirSync(SCREENS, { recursive: true })

// Product-claim wording the app rule forbids on this view (page text and every hover card's text).
const FORBIDDEN = [
  /speed-?up/i, /time[- ]to[- ]fill/i, /\bfaster\b/i, /\bfastest\b/i, /\bslower\b/i, /\bbest\b/i, /\btop\b/i,
  /\brecommend/i, /\bpick\b/i, /\bchoose\b/i, /\bpredict/i, /\brank/i, /\bperformance\b/i,
]
// Copy deck B8, the one sentence allowed to say "predicted": it says the predicted differences were overstated.
const BANNER_RE =
  /^In development\. Scores come from public registry history\. On later trials they carried real signal, but predicted differences between site lists were about (\d+) to (\d+) times larger than observed, on the log scale\.$/
// Review fixes: sites to deep-link (an unfitted U.S. site and a non-U.S. site).
const UNFITTED_US = process.env.UNFITTED_US || 'f4911c74062a' // Northwestern Medicine Glenview, 0 fitted of 12
const NON_US = process.env.NON_US || '661aca9983d3' // Vall Hebron Institute of Oncology, Spain

const out = { checks: [], shots: [] }
const check = (name, ok, detail) => {
  out.checks.push({ name, ok: !!ok, detail })
  console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600))
}
const log = { console: [], pageerrors: [], api: [] }

/** frontend/src/siteScoresApi.ts rate(): three significant figures. */
function rate(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  if (x === 0) return '0'
  return x.toFixed(Math.max(0, Math.min(5, 2 - Math.floor(Math.log10(Math.abs(x))))))
}
const fixed = (x, d = 2) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const int = (x) => Math.round(x).toLocaleString('en-US')
const ordinal = (p) => {
  const n = Math.round(p)
  const k = n % 100
  return `${n}${k >= 11 && k <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`
}
const api = async (path) => (await fetch(`${APP}${path}`)).json()

/** A fresh page for one density / theme / width. density null = a first-time visitor (nothing stored). */
async function openPage(browser, { density, theme = 'light', width = 1440 }) {
  const page = await browser.newPage()
  const phone = width < 600
  await page.setViewport({ width, height: phone ? 844 : 900, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone })
  await page.evaluateOnNewDocument(
    (density, theme) => {
      try {
        localStorage.setItem('concord.theme', theme)
        if (density) localStorage.setItem('concord.density', density)
        else localStorage.removeItem('concord.density')
      } catch {
        /* ignore */
      }
    },
    density,
    theme,
  )
  page.on('console', (m) => {
    if (m.type() === 'error') log.console.push(`${density}/${theme}/${width}: ${m.text()}`)
  })
  page.on('pageerror', (e) => log.pageerrors.push(`${density}/${theme}/${width}: ${String(e)}`))
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) log.api.push(`${r.status()} ${r.url()}`)
  })
  return page
}

async function go(page, hash = '#site-scores') {
  await page.goto('about:blank')
  await page.goto(`${APP}/${hash}`, { waitUntil: 'networkidle0', timeout: 120_000 })
  await settle(page)
}

async function settle(page) {
  await page.waitForSelector('.ss-breakdown .ss-bd-title', { timeout: 90_000 })
  await page.waitForSelector('.ss-sites tbody tr', { timeout: 60_000 })
  await page.waitForFunction(() => !document.querySelector('.ss-stale'), { timeout: 30_000 })
  await page.evaluate(() => document.fonts && document.fonts.ready)
  await L.sleep(400)
}

async function shot(page, name, fullPage = true) {
  const file = `${SCREENS}/${name}.png`
  await page.screenshot({ path: file, fullPage })
  out.shots.push(file)
}

async function elementShot(page, sel, name) {
  const el = await page.$(sel)
  if (!el) return
  await el.scrollIntoView()
  await L.sleep(150)
  const file = `${SCREENS}/${name}.png`
  await el.screenshot({ path: file })
  out.shots.push(file)
}

const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim())
const texts = (page, sel) => page.$$eval(sel, (es) => es.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
const openCard = (page) =>
  page.evaluate(() => {
    const c = [...document.querySelectorAll('.hc-card')].find((x) => !x.hidden)
    return c ? c.innerText.replace(/\s+/g, ' ').trim() : null
  })
async function closeCards(page) {
  await page.keyboard.press('Escape')
  await page.mouse.move(2, 2)
  await L.sleep(250)
}

/** Text of every visible hover card in `.ss`, opened one at a time with a click (which pins the card open). */
async function allCardTexts(page) {
  const n = await page.$$eval('.ss .hc-trigger', (es) => es.length)
  const res = []
  for (let i = 0; i < n; i++) {
    const h = await page.$$('.ss .hc-trigger')
    const el = h[i]
    const vis = await el.evaluate((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && !e.closest('details:not([open])')
    })
    if (!vis) continue
    await el.scrollIntoView()
    await el.click()
    await L.sleep(250)
    res.push({ label: await el.evaluate((e) => e.getAttribute('aria-label') || e.innerText), text: await openCard(page) })
    await closeCards(page)
  }
  return res
}

/** Focus `sel` with the keyboard: focus the focusable element before it, then press Tab. */
async function tabTo(page, sel) {
  const ok = await page.evaluate((sel) => {
    const target = document.querySelector(sel)
    const all = [...document.querySelectorAll('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])')].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    const i = all.indexOf(target)
    if (i < 1) return false
    all[i - 1].focus()
    return true
  }, sel)
  if (!ok) return false
  await page.keyboard.press('Tab')
  await L.sleep(250)
  return page.evaluate((sel) => document.activeElement === document.querySelector(sel), sel)
}

;(async () => {
  const browser = await L.launch()
  try {
    const S = await api('/api/site-scores/summary')
    const D = await api(`/api/site-scores/${S.preset.site_id}`)
    const list0 = await api('/api/site-scores?region=US&min_trials=1&sort=-n_fit&limit=20&offset=0')
    const ind = S.validation.industry_phase2_3
    const allT = S.validation.all_trials

    /* ================= Detailed, light, 1440: every check of the pre-Calm view ================= */
    let page = await openPage(browser, { density: 'detailed' })
    await go(page)
    check('detailed: <html data-density="detailed"> and the view renders detailed', await page.evaluate(() => document.documentElement.dataset.density === 'detailed' && !!document.querySelector('.ss.ss-detailed')))

    const tabs = await texts(page, 'nav.tabs .tab-label')
    const at = tabs.indexOf('Site scores')
    // Other tabs may sit between Site scores and Research (Sponsor budget).
    check('tab order: Site scores after Protocol to terms, before Research', at > 0 && tabs[at - 1] === 'Protocol to terms' && tabs.indexOf('Research') > at, tabs)
    const title = await text(page, '.ss-bd-title')
    check('preset opens the richest-history Dana-Farber / MSK site', /dana|sloan/i.test(title), title)
    const head = await text(page, '.ss-bd-head .small.muted')
    check('preset label is built from summary.preset.basis', head === `Example site (${S.preset.basis})`, head)
    const firstRows = await texts(page, '.ss-sites tbody tr .ss-site-name')
    const nfit = await page.$$eval('.ss-sites tbody tr td:nth-child(2) div:first-child', (es) => es.map((e) => Number(e.textContent.replace(/,/g, ''))))
    check('default order is fitted trials, descending', nfit.every((v, i) => i === 0 || nfit[i - 1] >= v), nfit.slice(0, 6))
    check('table rows are the API rows (names, fitted trials)', firstRows.length === list0.rows.length && list0.rows.every((r, i) => firstRows[i] === r.facility && nfit[i] === r.n_fit), { shown: firstRows.slice(0, 3), api: list0.rows.slice(0, 3).map((r) => r.facility) })
    out.preset = {
      title,
      figs: await texts(page, '.ss-figs .ss-fig'),
      steps: await texts(page, '.ss-steps .ss-step'),
      strip: await texts(page, '.ss-strip-row .ss-strip-note'),
      slope: await texts(page, '.ss-slope-head'),
      reading: await text(page, '.ss-reading'),
      calib: await text(page, '.ss-calib-def'),
      buckets: await texts(page, '.ss-buckets tbody tr'),
      caveat: await text(page, '.ss-dist .caveat'),
      what: await text(page, '.ss-what'),
      contribLede: await text(page, '.ss-contrib-lede'),
      contribRows: (await texts(page, '.ss-trials tbody tr')).slice(0, 3),
      notFit: await text(page, '.ss-notfit'),
      firstRows: firstRows.slice(0, 5),
      tableRows: (await texts(page, '.ss-sites tbody tr')).slice(0, 5),
      calnote: await text(page, '.ss-calnote'),
    }
    check('distribution caveat no longer says scores fall with history depth', !/Scores also fall with history depth/i.test(out.preset.caveat) && /lower median/.test(out.preset.caveat), out.preset.caveat)
    // Score ranges include trial-to-trial variation (summary.heterogeneity); the old Poisson-only range is kept small.
    const het = S.heterogeneity
    out.heterogeneity = { k: het.k, inv_k: het.inv_k, ci: het.inv_k_ci95, sites: het.sites_used }
    check('summary: heterogeneity estimated (not the Poisson fallback)', het && !het.fallback && het.inv_k > 0 && het.sites_used > 0, out.heterogeneity)
    // No undefined symbol (1/k) in the note; it says the amount is set mostly by the high-volume sites.
    check(
      'table note: ranges include trial-to-trial variation (mostly set by high-volume sites), leave out systematic error in the split',
      /varies from one trial to the next/.test(out.preset.calnote) &&
        /systematic error in that split/.test(out.preset.calnote) &&
        !/1\/k/.test(out.preset.calnote) &&
        !/narrower than the real uncertainty/.test(out.preset.calnote) &&
        out.preset.calnote.includes(`50 of them carry ${Math.round(het.concentration.top50_weight * 100)}% of its weight`),
      out.preset.calnote,
    )
    const ivText = await page.$$eval('.ss-sites tbody tr > td:nth-child(3) > div:nth-child(2)', (es) => es.map((e) => e.textContent.trim()))
    const ivWant = list0.rows.map((r) => `${rate(r.interval[0])}–${rate(r.interval[1])}`)
    const scText = await page.$$eval('.ss-sites tbody tr > td:nth-child(3) > div:nth-child(1)', (es) => es.map((e) => e.textContent.trim()))
    out.preset.intervals = ivText.slice(0, 5)
    check(
      'table scores and ranges are the API score and interval (with trial-to-trial variation), not interval_poisson',
      ivText.length === ivWant.length &&
        ivText.every((t, i) => t === ivWant[i]) &&
        scText.every((t, i) => t === rate(list0.rows[i].score)) &&
        list0.rows.every((r) => r.interval[0] <= r.interval_poisson[0] && r.interval[1] >= r.interval_poisson[1]),
      { shown: ivText.slice(0, 3), api: ivWant.slice(0, 3) },
    )
    const calCells = await page.$$eval('.ss-sites tbody tr > td:nth-child(4)', (es) => es.map((e) => e.textContent.trim()))
    check('table calibrated column is the API value', calCells.every((t, i) => t === rate(list0.rows[i].calibrated)), calCells.slice(0, 3))
    const step3 = out.preset.steps[2]
    check(
      'Step 3: range includes trial-to-trial variation, effective vs allocated patients, Poisson-only range in small text',
      /varies from trial to trial/.test(step3) &&
        /effective patients/.test(step3) &&
        step3.includes(`${rate(D.posterior.p10)}–${rate(D.posterior.p90)}`) &&
        step3.includes(`exact counts): ${rate(D.posterior.p10_poisson)}–${rate(D.posterior.p90_poisson)}`),
      step3,
    )
    check('detailed: all six steps, the interval strip, histogram, buckets and contributing trials are shown inline',
      out.preset.steps.length === 6 && out.preset.strip.length >= 3 && out.preset.buckets.length === S.buckets.length && (await page.$('.ss-hist svg')) && out.preset.contribRows.length === 3,
      { steps: out.preset.steps.length, strip: out.preset.strip.length, buckets: out.preset.buckets.length })
    const figScore = out.preset.figs.find((f) => /^Score/.test(f)) || ''
    const figCal = out.preset.figs.find((f) => /^Calibrated/.test(f)) || ''
    check('breakdown figures equal the API (score, its range, calibrated, percentile, history)',
      figScore.startsWith(`Score ${rate(D.score)}`) && figScore.includes(`${rate(D.posterior.p10)}–${rate(D.posterior.p90)}`) &&
        figCal.startsWith(`Calibrated ${rate(D.calibrated.value)}`) &&
        out.preset.figs.some((f) => f.startsWith(`Percentile ${ordinal(D.percentile)}`)) &&
        out.preset.figs.some((f) => f.startsWith(`History ${int(D.history.n_fit)} fitted of ${int(D.history.n_hist)}`)),
      out.preset.figs)
    out.preset.bdCaveat = await text(page, '.ss-breakdown .caveat')
    check(
      'breakdown caveat: what the range includes and leaves out; historical, not a forecast',
      /varies from trial to trial/.test(out.preset.bdCaveat) &&
        /systematic error in that split/.test(out.preset.bdCaveat) &&
        /not a forecast for a new trial/.test(out.preset.bdCaveat) &&
        !/treats the allocated patients as observed/.test(out.preset.bdCaveat) &&
        !/suggests that error is large/.test(out.preset.bdCaveat),
      out.preset.bdCaveat,
    )
    check('method paragraph: one sentence on trial-to-trial variation', /varies from one trial to the next/.test(S.method), S.method)
    check('reading: overstatement explained on the log scale', /on the log scale, not a division of ratios/.test(out.preset.reading), out.preset.reading)
    check('slope plot shows the API slopes and CIs', out.preset.slope.some((s) => s.includes(`${fixed(ind.slope)} [${fixed(ind.ci95[0])}, ${fixed(ind.ci95[1])}]`)) && (!allT || out.preset.slope.some((s) => s.includes(`${fixed(allT.slope)} [${fixed(allT.ci95[0])}, ${fixed(allT.ci95[1])}]`))), out.preset.slope)

    // Honesty wording: the page (minus the B8 banner sentence, checked on its own) and every hover card.
    const banner = await text(page, '.page-head .banner')
    const bm = banner.match(BANNER_RE)
    check('B8 banner: in development, real signal, 3 to 6 times larger on the log scale (factors from the API)',
      bm && Number(bm[1]) === Math.round(ind.overstatement) && Number(bm[2]) === Math.round(allT.overstatement), banner)
    const body = await page.evaluate(() => {
      const ss = document.querySelector('.ss').cloneNode(true)
      ss.querySelector('.page-head .banner')?.remove()
      return ss.innerText
    })
    const hits = FORBIDDEN.filter((r) => r.test(body)).map(String)
    check('detailed: no speedup / time-to-fill / faster / best-sites wording', hits.length === 0, hits)
    check('detailed: says not a forecast', /not a forecast for a new trial/i.test(body))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('detailed 1440: no horizontal page scroll', overflow <= 0, overflow)
    const tbl = await page.$eval('.ss-list .table-scroll', (e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
    check('1440: site table fits its window (no sideways scroll)', tbl.sw <= tbl.cw + 1, tbl)
    await page.evaluate(() => window.scrollTo(0, 0))
    await shot(page, 'site-scores-detailed-light-1440')
    await elementShot(page, '.ss-list', 'site-scores-detailed-table')
    await elementShot(page, '.ss-breakdown', 'site-scores-detailed-breakdown-preset')

    // Histogram hover tooltip
    const bins = await page.$$('.ss-hit')
    if (bins.length) {
      await page.$eval('.ss-hist', (e) => e.scrollIntoView({ block: 'center' }))
      const box = await bins[Math.floor(bins.length / 2)].boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5)
      await page.waitForSelector('.ss-tip', { timeout: 5000 })
      check('histogram tooltip on hover', true, await text(page, '.ss-tip'))
      await page.mouse.move(5, 5)
    }

    // Pick another site from the table: hash and breakdown follow.
    let rows = await page.$$('.ss-sites tbody tr')
    await rows[2].click()
    await page.waitForFunction((t) => document.querySelector('.ss-bd-title')?.textContent !== t && !document.querySelector('.ss-stale'), { timeout: 30_000 }, title)
    let picked = await text(page, '.ss-bd-title')
    let hash = await page.evaluate(() => window.location.hash)
    check('detailed: row click selects the site and writes #site-scores/<id>', /^#site-scores\/[0-9a-f]+$/.test(hash) && picked === firstRows[2], { picked, hash })

    // Sorting by score shows the overstatement note.
    await page.evaluate(() => [...document.querySelectorAll('.ss-sites th button')].find((b) => b.textContent.startsWith('Score')).click())
    await page.waitForSelector('.ss-sortnote', { timeout: 10_000 })
    const note = await text(page, '.ss-sortnote')
    check('sort note: overstatement is on the log scale, with a worked ratio', /log score/i.test(note) && /log scale/i.test(note) && /10x ratio between two raw scores is about 2\.2x/.test(note), note)
    out.sortedByScoreRows = (await texts(page, '.ss-sites tbody tr')).slice(0, 3)

    // Search filters the table.
    await page.evaluate(() => [...document.querySelectorAll('.ss-sites th button')].find((b) => b.textContent.startsWith('Fitted')).click())
    await page.type('.ss-search input', 'sloan')
    await page.waitForFunction(() => [...document.querySelectorAll('.ss-sites tbody tr .ss-site-name')].every((e) => /sloan/i.test(e.closest('tr').innerText)), { timeout: 15_000 })
    const sloan = await texts(page, '.ss-sites tbody tr .ss-site-name')
    check('detailed: search filters the table', sloan.length > 0, sloan.slice(0, 4))

    // Deep link to a capped low-history site.
    const cappedList = await api('/api/site-scores?min_trials=1&sort=n_fit&limit=200')
    const c = cappedList.rows.find((r) => r.capped)
    await go(page, `#site-scores/${c.site_id}`)
    const capStep = await text(page, '.ss-step-warn')
    check('detailed: deep link to a capped site shows the cap step', /capped to/i.test(capStep) && (await text(page, '.ss-bd-title')) === c.facility, { facility: c.facility, capStep })
    await L.sleep(400)
    let top = await page.$eval('.ss-breakdown', (e) => Math.round(e.getBoundingClientRect().top))
    check('detailed: fresh deep link scrolls to the breakdown (below the sticky header)', top >= 40 && top < 200, top)
    out.capped = { site: c, steps: await texts(page, '.ss-steps .ss-step'), figs: await texts(page, '.ss-figs .ss-fig') }
    check('capped site: list row has no percentile (status tied_at_cap)', c.percentile === null && c.percentile_status === 'tied_at_cap', c)
    check(
      'capped site: percentile figure reads "at cap", Step 5 explains the tie',
      /^Percentile at cap tied with [\d,]+ capped U\.S\. sites/i.test(out.capped.figs.find((f) => /^percentile/i.test(f)) || '') && /gets no percentile/.test(out.capped.steps[4]),
      { figs: out.capped.figs, step5: out.capped.steps[4] },
    )
    await shot(page, 'site-scores-detailed-1440-capped-site', false)

    // Deep link to a U.S. site with no fitted trial: no percentile, Step 5 says it is the unseen-site rate.
    await go(page, `#site-scores/${UNFITTED_US}`)
    const uf = { title: await text(page, '.ss-bd-title'), figs: await texts(page, '.ss-figs .ss-fig'), steps: await texts(page, '.ss-steps .ss-step') }
    out.unfitted = uf
    check(
      'unfitted U.S. site: no percentile, Step 5 says unseen-site rate',
      /^Percentile — no fitted trials/i.test(uf.figs.find((f) => /^percentile/i.test(f)) || '') && /unseen-site rate/.test(uf.steps[4]) && !/percentile among/.test(uf.steps[4]),
      uf,
    )
    check('unfitted U.S. site: Step 3 range is the prior’s', /With no fitted trial, the 10th–90th range is the prior’s/.test(uf.steps[2]), uf.steps[2])

    // Deep link to a non-U.S. site: calibrated value labelled as relative to the U.S. mean; no U.S. percentile.
    await go(page, `#site-scores/${NON_US}`)
    const nu = { title: await text(page, '.ss-bd-title'), figs: await texts(page, '.ss-figs .ss-fig'), steps: await texts(page, '.ss-steps .ss-step') }
    out.nonUS = nu
    check(
      'non-U.S. site: calibrated labelled relative to the U.S. mean; percentile says outside the U.S.',
      /relative to the U\.S\. mean/.test(nu.figs.find((f) => /^calibrated/i.test(f)) || '') &&
        /outside the U\.S\./.test(nu.figs.find((f) => /^percentile/i.test(f)) || '') &&
        /relative to the U\.S\. average/.test(nu.steps[5]),
      nu,
    )
    await shot(page, 'site-scores-detailed-1440-non-us-site', false)
    await page.close()

    /* ================= Simple (a first-time visitor), light, 1440 ================= */
    page = await openPage(browser, { density: null })
    await go(page)
    check('first visit: Simple by default', await page.evaluate(() => document.documentElement.dataset.density === 'simple' && !!document.querySelector('.ss.ss-simple')))
    const lede = await text(page, '.page-head .lede')
    check('simple: plain definition, not a forecast, ordered by history', /historical patients per month per trial/.test(lede) && /not a forecast for a new trial/.test(lede) && /ordered by how much history/.test(lede), lede)
    check('simple: B8 banner visible', BANNER_RE.test(await text(page, '.page-head .banner')))
    const vt = await text(page, '.ss-valid h2')
    const vq = await text(page, '.ss-valid .section-quals')
    check('simple: validation callout says differences are overstated about 3x on the log scale (from the API)', vt === `Scores overstate differences about ${ind.overstatement.toFixed(0)}x on the log scale`, vt)
    check('simple: validation qualifiers visible next to the numbers (95% CI, the weaker all-trials result, observational)',
      vq.includes(`Slope ${fixed(ind.slope)} (95% CI ${fixed(ind.ci95[0])} to ${fixed(ind.ci95[1])})`) &&
        vq.includes(`slope ${fixed(allT.slope)} (95% CI ${fixed(allT.ci95[0])} to ${fixed(allT.ci95[1])}), differences overstated about ${allT.overstatement.toFixed(0)}x`) &&
        /not a test of choosing different sites/.test(vq),
      vq)
    check('simple: low-history share visible', (await text(page, '.ss-dist .section-lede')).startsWith(`${int(S.us.low_history)} of ${int(S.us.sites)} U.S. sites`))
    const closed = await page.$$eval('.ss details.section-disclosure', (ds) => ds.map((d) => d.open))
    check('simple: secondary content sits in closed "Details" disclosures (method, validation, buckets, trials)', closed.length === 4 && closed.every((o) => !o), closed)
    check('simple: no six-step list or interval strip; a 3-step breakdown instead', !(await page.$('.ss-steps')) && !(await page.$('.ss-strip')) && (await page.$$('.ss-brief .ss-brief-step')).length === 3)
    const brief = await texts(page, '.ss-brief .ss-brief-step')
    out.simpleBrief = brief
    check('simple: brief steps carry the API values (data rate, score, calibrated)',
      brief[0].includes(`${rate(D.data.data_rate)} / mo`) && brief[1].includes(`${rate(D.score)} / mo`) && brief[2].includes(`${rate(D.calibrated.value)} / mo`), brief)
    const sFigs = await texts(page, '.ss-figs .ss-fig')
    check('simple: score figure keeps its range visible', (sFigs[0] || '').includes(`range ${rate(D.posterior.p10)}–${rate(D.posterior.p90)}`), sFigs[0])
    const sIv = await page.$$eval('.ss-sites tbody tr > td:nth-child(3) > div:nth-child(2)', (es) => es.map((e) => e.textContent.trim()))
    const sN = await page.$$eval('.ss-sites tbody tr td:nth-child(2) div:first-child', (es) => es.map((e) => Number(e.textContent.replace(/,/g, ''))))
    check('simple: table shows score + range and history depth, default order by history', sIv.every((t, i) => t === ivWant[i]) && sN.every((v, i) => v === list0.rows[i].n_fit), { iv: sIv.slice(0, 3), n: sN.slice(0, 3) })
    check('simple: legend under the table keeps the cap qualifier visible', /Capped sites \(at cap\) all share one value/.test(await text(page, '.ss-legend-s')))
    const sBody = await page.evaluate(() => {
      const ss = document.querySelector('.ss').cloneNode(true)
      ss.querySelector('.page-head .banner')?.remove()
      return ss.innerText
    })
    check('simple: no speedup / time-to-fill / faster / best-sites wording', FORBIDDEN.filter((r) => r.test(sBody)).length === 0, FORBIDDEN.filter((r) => r.test(sBody)).map(String))

    // Hover cards: on hover (mouse), on keyboard focus, and the content they hold.
    await page.$eval('.ss-brief', (e) => e.scrollIntoView({ block: 'center' }))
    await page.hover('.ss-brief-step:nth-child(1) .hc-info')
    await L.sleep(450)
    const hovered = await openCard(page)
    check('simple: hover opens the step card (full Prior and Data steps)', /Step 1: Prior/.test(hovered || '') && /Step 2: Data/.test(hovered || '') && hovered.includes(`Data weight ${fixed(D.data.data_weight, 3)}`), hovered)
    await page.mouse.move(2, 2)
    await L.sleep(400)
    check('simple: the hover card closes when the pointer leaves', (await openCard(page)) === null)
    const focused = await tabTo(page, '.ss-brief-step:nth-child(2) .hc-info')
    const focusCard = await openCard(page)
    check('simple: keyboard focus opens the step card (Posterior, cap, final score)', focused && /Step 3: Posterior/.test(focusCard || '') && /Step 4: Low-history cap/.test(focusCard || '') && /Step 5: Final score/.test(focusCard || ''), { focused, focusCard })
    await shot(page, 'site-scores-simple-hovercard-focus', false)
    await closeCards(page)
    const cards = await allCardTexts(page)
    out.simpleCards = cards
    const cardText = cards.map((c) => c.text || '').join(' \n ')
    check('simple: every info card opens', cards.length >= 10 && cards.every((c) => c.text), cards.map((c) => `${c.label}: ${(c.text || 'NONE').slice(0, 40)}`))
    check('simple: cards hold the calibration formula', /exp\(m \+ b × \(log score − m\)\)/.test(cardText))
    check('simple: cards hold the heterogeneity (range) note', /varies from one trial to the next/.test(cardText) && /systematic error in that split/.test(cardText))
    check('simple: cards hold the not-a-forecast note', cards.some((c) => c.label === 'About this range' && /not a forecast for a new trial/.test(c.text || '')))
    check('simple: no forbidden wording in any card', FORBIDDEN.filter((r) => r.test(cardText)).length === 0, FORBIDDEN.filter((r) => r.test(cardText)).map(String))

    const ov1 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('simple 1440: no horizontal page scroll', ov1 <= 0, ov1)
    await page.evaluate(() => window.scrollTo(0, 0))
    await shot(page, 'site-scores-simple-light-1440')
    await elementShot(page, '.ss-breakdown', 'site-scores-simple-breakdown-preset')
    await elementShot(page, '.ss-valid', 'site-scores-simple-validation')

    // Every control works in Simple too: sort + note, region, paging, row click + hash, search, show all trials.
    await page.evaluate(() => [...document.querySelectorAll('.ss-sites th button')].find((b) => b.textContent.startsWith('Score')).click())
    await page.waitForSelector('.ss-sortnote', { timeout: 10_000 })
    check('simple: sorting by score works and shows the overstatement note', /overstated about 3x/.test(await text(page, '.ss-sortnote')))
    await page.evaluate(() => [...document.querySelectorAll('.ss-sites th button')].find((b) => b.textContent.startsWith('Fitted')).click())
    await page.waitForFunction(() => !document.querySelector('.ss-sortnote'), { timeout: 10_000 })
    const before = await texts(page, '.ss-sites tbody tr .ss-site-name')
    await page.evaluate(() => [...document.querySelectorAll('.ss-pager button')].find((b) => b.textContent.trim() === 'Next').click())
    await page.waitForFunction((f) => document.querySelector('.ss-sites tbody tr .ss-site-name')?.textContent !== f, { timeout: 15_000 }, before[0])
    check('simple: paging works', /^21–40 of/.test(await text(page, '.ss-pager .muted')))
    await page.select('.ss-filters .field:first-child select', 'US-West')
    await page.waitForFunction(() => /^1–20 of/.test(document.querySelector('.ss-pager .muted')?.textContent ?? ''), { timeout: 15_000 })
    const west = await api('/api/site-scores?region=US-West&min_trials=1&sort=-n_fit&limit=20&offset=0')
    await page.waitForFunction((n) => document.querySelector('.ss-win-head .small')?.textContent.startsWith(n), { timeout: 15_000 }, int(west.total))
    check('simple: region filter works (count equals the API)', (await text(page, '.ss-win-head .small')).startsWith(`${int(west.total)} U.S. sites`), int(west.total))
    rows = await page.$$('.ss-sites tbody tr')
    const pickName = await rows[1].$eval('.ss-site-name', (e) => e.textContent.trim())
    await rows[1].click()
    await page.waitForFunction((t) => document.querySelector('.ss-bd-title')?.textContent === t && !document.querySelector('.ss-stale'), { timeout: 30_000 }, pickName)
    hash = await page.evaluate(() => window.location.hash)
    check('simple: row click selects the site and writes #site-scores/<id>', hash === `#site-scores/${west.rows[1].site_id}`, { pickName, hash })
    await page.focus('.ss-sites tbody tr:nth-child(3)')
    await page.keyboard.press('Enter')
    await page.waitForFunction((id) => window.location.hash === `#site-scores/${id}`, { timeout: 15_000 }, west.rows[2].site_id)
    check('simple: keyboard Enter on a row selects it', true)
    await page.type('.ss-search input', 'zzzz-no-such-site')
    await page.waitForFunction(() => /No sites match/.test(document.querySelector('.ss-sites tbody')?.innerText ?? ''), { timeout: 15_000 })
    check('simple: search works (empty result says so)', true)
    // Contributing trials: open the disclosure, show all, sort.
    await go(page)
    await page.$eval('.ss-contrib details.section-disclosure', (d) => {
      d.open = true
    })
    await L.sleep(300)
    const shown15 = (await page.$$('.ss-trials tbody tr')).length
    await page.evaluate(() => [...document.querySelectorAll('.ss-contrib button')].find((b) => /^Show all/.test(b.textContent)).click())
    await L.sleep(300)
    const shownAll = (await page.$$('.ss-trials tbody tr')).length
    check('simple: contributing trials open in the disclosure; Show all works', shown15 === 15 && shownAll === D.trials.length, { shown15, shownAll, api: D.trials.length })
    const contribFig = await text(page, '.ss-contrib .section-figure')
    const sumHat = D.trials.reduce((s, t) => s + t.n_hat, 0)
    const above = D.trials.filter((t) => t.n_hat > t.equal_split).length
    check('simple: contributing key figures equal the API', contribFig.includes(fixed(sumHat, 1)) && contribFig.includes(`${above} of ${D.trials.length}`), contribFig)

    // Deep link in Simple to a capped site: brief step 2 keeps the Capped qualifier visible; percentile "at cap".
    await go(page, `#site-scores/${c.site_id}`)
    await L.sleep(400)
    top = await page.$eval('.ss-breakdown', (e) => Math.round(e.getBoundingClientRect().top))
    const capBrief = await texts(page, '.ss-brief .ss-brief-step')
    const capFigs = await texts(page, '.ss-figs .ss-fig')
    check('simple: deep link to a capped site scrolls to the breakdown and keeps "Capped" and "at cap" visible',
      top >= 40 && top < 200 && /Capped at the prior’s 25th percentile/.test(capBrief[1]) && /^Percentile at cap/.test(capFigs.find((f) => /^Percentile/.test(f)) || '') && /capped/.test(capFigs[0]),
      { top, capBrief, capFigs })
    await page.close()

    /* ================= Dark theme, both densities, 1440 ================= */
    for (const density of ['simple', 'detailed']) {
      page = await openPage(browser, { density, theme: 'dark' })
      await go(page)
      const dark = await page.evaluate(() => document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.body).backgroundColor)
      check(`${density} dark: theme applied`, dark === 'rgb(12, 19, 23)', dark)
      await shot(page, `site-scores-${density}-dark-1440`)
      await page.close()
    }

    /* ================= Phone, 390 px, both densities and themes ================= */
    for (const density of ['simple', 'detailed'])
      for (const theme of ['light', 'dark']) {
        page = await openPage(browser, { density, theme, width: 390 })
        await go(page)
        const tag = `${density} ${theme} 390`
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        check(`${tag}: no horizontal page scroll`, ov <= 0, ov)
        const wide = await page.evaluate(() =>
          [...document.querySelectorAll('.ss *')]
            .filter((e) => !e.closest('.table-scroll') && !e.closest('details:not([open])'))
            .filter((e) => {
              const r = e.getBoundingClientRect()
              return r.width > 0 && r.right > window.innerWidth + 1
            })
            .slice(0, 5)
            .map((e) => `${e.tagName}.${e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className}`),
        )
        check(`${tag}: nothing outside table scrollers overflows the viewport`, wide.length === 0, wide)
        const sitesTable = await page.$eval('.ss-list .table-scroll', (e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
        check(`${tag}: site table fits (calibrated and percentile fold into the score cell)`, sitesTable.sw <= sitesTable.cw + 1, sitesTable)
        const stack = await texts(page, '.ss-sites tbody tr .ss-stack')
        check(`${tag}: folded calibrated value and percentile are visible`, stack.length > 0 && /^cal\. [\d.]+ (\d+(st|nd|rd|th) pctile|at cap)$/.test(stack[0]), stack.slice(0, 3))
        if (density === 'detailed') {
          // Open the histogram table so every scroller has a size; any scroller wider than its box must show the hint.
          await page.$eval('.ss-hist-table', (d) => {
            d.open = true
          })
          await L.sleep(300)
          const scrollers = await page.$$eval('.ss-scrollx', (es) =>
            es.map((e) => {
              const t = e.querySelector('.table-scroll')
              return { label: t.getAttribute('aria-label'), sw: t.scrollWidth, cw: t.clientWidth, hint: !!e.querySelector('.ss-scroll-hint'), edge: e.classList.contains('ss-more-r') }
            }),
          )
          out[`scrollers390${theme}`] = scrollers
          check(`${tag}: every table wider than its box shows a scroll hint and a right-edge mark`, scrollers.every((x) => x.sw <= x.cw + 1 || (x.hint && x.edge)), scrollers)
          await page.$eval('.ss-hist-table', (d) => {
            d.open = false
          })
        } else {
          // Tap opens a hover card on a touch screen; a second tap closes it.
          const tip = await page.$('.ss-brief-step:nth-child(3) .hc-info')
          await tip.scrollIntoView()
          await tip.tap()
          await L.sleep(300)
          const tapped = await openCard(page)
          check(`${tag}: tap opens the calibrated step card (formula)`, /Step 6: Calibrated/.test(tapped || '') && /exp\(m \+ b/.test(tapped || ''), tapped)
          if (theme === 'light') await shot(page, 'site-scores-simple-390-hovercard-tap', false)
          const inView = await page.evaluate(() => {
            const c = [...document.querySelectorAll('.hc-card')].find((x) => !x.hidden)
            const r = c.getBoundingClientRect()
            return r.left >= 0 && r.right <= window.innerWidth
          })
          check(`${tag}: the tapped card fits the screen`, inView)
          await tip.tap()
          await L.sleep(300)
          check(`${tag}: a second tap closes it`, (await openCard(page)) === null)
          const small = await page.$$eval('.ss button, .ss select, .ss input', (es) =>
            es
              .filter((e) => {
                const r = e.getBoundingClientRect()
                return r.width > 0 && r.height > 0 && !e.closest('details:not([open])') && !e.classList.contains('hc-trigger')
              })
              .filter((e) => e.getBoundingClientRect().height < 43.5)
              .map((e) => `${e.tagName} ${e.textContent.trim().slice(0, 20)} ${Math.round(e.getBoundingClientRect().height)}`),
          )
          check(`${tag}: buttons, selects and inputs are at least 44 px tall on touch`, small.length === 0, small.slice(0, 8))
        }
        await page.evaluate(() => window.scrollTo(0, 0))
        await shot(page, `site-scores-${density}-${theme}-390`)
        await page.close()
      }

    check('no page errors', log.pageerrors.length === 0, log.pageerrors)
    check('no console errors', log.console.length === 0, log.console)
    check('no failed API calls', log.api.length === 0, log.api)
  } finally {
    await browser.close()
  }
  fs.writeFileSync(`${SCREENS}/site-scores-qa.json`, JSON.stringify(out, null, 1))
  const failed = out.checks.filter((c) => !c.ok)
  console.log(`${out.checks.length} checks, ${failed.length ? `${failed.length} FAILED` : 'ALL PASS'}`)
  process.exit(failed.length ? 1 : 0)
})()
