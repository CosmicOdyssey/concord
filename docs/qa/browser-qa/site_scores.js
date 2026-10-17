// Browser QA for the Site scores tab: screenshots at 1440x900 and 390 px, interactions, wording checks.
//   APP=http://localhost:5184 SCREENS=<dir> node docs/qa/browser-qa/site_scores.js
// puppeteer-core is required by absolute path through ./lib (installed in data/work/D).
const fs = require('fs')
const L = require('./lib')

const APP = process.env.APP || 'http://localhost:5184'
const SCREENS = process.env.SCREENS || 'C:/Users/micha/Projects/concord/data/work/S/screens'
fs.mkdirSync(SCREENS, { recursive: true })

// Product-claim wording the app rule forbids on this view.
const FORBIDDEN = [
  /speed-?up/i, /time[- ]to[- ]fill/i, /\bfaster\b/i, /\bfastest\b/i, /\bslower\b/i, /\bbest\b/i, /\btop\b/i,
  /\brecommend/i, /\bpick\b/i, /\bchoose\b/i, /\bpredict/i, /\brank/i, /\bperformance\b/i,
]
// Review fixes: sites to deep-link (an unfitted U.S. site and a non-U.S. site).
const UNFITTED_US = process.env.UNFITTED_US || 'f4911c74062a' // Northwestern Medicine Glenview, 0 fitted of 12
const NON_US = process.env.NON_US || '661aca9983d3' // Vall Hebron Institute of Oncology, Spain

const out = { checks: [], shots: [] }
const check = (name, ok, detail) => {
  out.checks.push({ name, ok: !!ok, detail })
  console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail))
}

async function settle(page) {
  await page.waitForSelector('.ss-breakdown .ss-bd-title', { timeout: 60_000 })
  await page.waitForSelector('.ss-sites tbody tr', { timeout: 60_000 })
  await page.waitForFunction(() => !document.querySelector('.ss-stale'), { timeout: 30_000 })
}

async function shot(page, name, fullPage = false) {
  const file = `${SCREENS}/${name}.png`
  await page.screenshot({ path: file, fullPage })
  out.shots.push(file)
  console.log('shot', file)
}

const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim())
const texts = (page, sel) => page.$$eval(sel, (es) => es.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))

/** frontend/src/siteScoresApi.ts rate(): three significant figures. */
function rate(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  if (x === 0) return '0'
  return x.toFixed(Math.max(0, Math.min(5, 2 - Math.floor(Math.log10(Math.abs(x))))))
}

async function elementShot(page, sel, name) {
  const el = await page.$(sel)
  if (!el) return
  await el.scrollIntoView()
  const file = `${SCREENS}/${name}.png`
  await el.screenshot({ path: file })
  out.shots.push(file)
  console.log('shot', file)
}

;(async () => {
  const browser = await L.launch()
  const log = {}
  try {
    const page = await browser.newPage()
    L.instrument(page, log)
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${APP}/#site-scores`, { waitUntil: 'networkidle0', timeout: 120_000 })
    await settle(page)

    const tabs = (await texts(page, 'nav.tabs button')).map((t) => t.replace(/^\d+\s*/, ''))
    const at = tabs.indexOf('Site scores')
    check('tab order: Site scores after Protocol to terms, before Research', at > 0 && tabs[at - 1] === 'Protocol to terms' && tabs[at + 1] === 'Research', tabs)
    const title = await text(page, '.ss-bd-title')
    check('preset opens the richest-history Dana-Farber / MSK site', /dana|sloan/i.test(title), title)
    const head = await text(page, '.ss-bd-head .small.muted')
    const sum = await (await fetch(`${APP}/api/site-scores/summary`)).json()
    check('preset label is built from summary.preset.basis', head === `Example site (${sum.preset.basis})`, head)
    const firstRows = await texts(page, '.ss-sites tbody tr .ss-site-name')
    const nfit = await page.$$eval('.ss-sites tbody tr td:nth-child(2) div:first-child', (es) => es.map((e) => Number(e.textContent.replace(/,/g, ''))))
    check('default order is fitted trials, descending', nfit.every((v, i) => i === 0 || nfit[i - 1] >= v), nfit.slice(0, 6))
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
    const het = sum.heterogeneity
    out.heterogeneity = het
    check('summary: heterogeneity estimated (not the Poisson fallback)', het && !het.fallback && het.inv_k > 0 && het.sites_used > 0, het && { k: het.k, inv_k: het.inv_k, ci: het.inv_k_ci95, sites: het.sites_used })
    // No undefined symbol (1/k) in the note; it says the amount is set mostly by the high-volume sites.
    check('table note: ranges include trial-to-trial variation (mostly set by high-volume sites), leave out systematic error in the split',
      /varies from one trial to the next/.test(out.preset.calnote) && /systematic error in that split/.test(out.preset.calnote) &&
        !/1\/k/.test(out.preset.calnote) && !/narrower than the real uncertainty/.test(out.preset.calnote) &&
        out.preset.calnote.includes(`50 of them carry ${Math.round(het.concentration.top50_weight * 100)}% of its weight`),
      out.preset.calnote)
    const apiRows = (await (await fetch(`${APP}/api/site-scores?region=US&min_trials=1&sort=-n_fit&limit=20&offset=0`)).json()).rows
    const ivText = await page.$$eval('.ss-sites tbody tr > td:nth-child(3) > div:nth-child(2)', (es) => es.map((e) => e.textContent.trim()))
    const ivWant = apiRows.map((r) => `${rate(r.interval[0])}–${rate(r.interval[1])}`)
    out.preset.intervals = ivText.slice(0, 5)
    check('table ranges are the API interval (with trial-to-trial variation), not interval_poisson',
      ivText.length === ivWant.length && ivText.every((t, i) => t === ivWant[i]) &&
        apiRows.every((r) => r.interval[0] <= r.interval_poisson[0] && r.interval[1] >= r.interval_poisson[1]),
      { shown: ivText.slice(0, 3), api: ivWant.slice(0, 3) })
    const detail = await (await fetch(`${APP}/api/site-scores/${sum.preset.site_id}`)).json()
    const step3 = out.preset.steps[2]
    check('Step 3: range includes trial-to-trial variation, effective vs allocated patients, Poisson-only range in small text',
      /varies from trial to trial/.test(step3) && /effective patients/.test(step3) &&
        step3.includes(`${rate(detail.posterior.p10)}–${rate(detail.posterior.p90)}`) &&
        step3.includes(`exact counts): ${rate(detail.posterior.p10_poisson)}–${rate(detail.posterior.p90_poisson)}`),
      step3)
    out.preset.detail = { data: detail.data, posterior: detail.posterior }
    out.preset.bdCaveat = await text(page, '.ss-breakdown .caveat')
    check('breakdown caveat: what the range includes and leaves out; historical, not a forecast',
      /varies from trial to trial/.test(out.preset.bdCaveat) && /systematic error in that split/.test(out.preset.bdCaveat) &&
        /not a forecast for a new trial/.test(out.preset.bdCaveat) && !/treats the allocated patients as observed/.test(out.preset.bdCaveat) &&
        !/suggests that error is large/.test(out.preset.bdCaveat),
      out.preset.bdCaveat)
    check('method paragraph: one sentence on trial-to-trial variation', /varies from one trial to the next/.test(sum.method), sum.method)
    check('reading: overstatement explained on the log scale', /on the log scale, not a division of ratios/.test(out.preset.reading), out.preset.reading)
    const body = await page.evaluate(() => document.querySelector('.ss').innerText)
    const hits = FORBIDDEN.filter((r) => r.test(body)).map(String)
    check('no speedup / time-to-fill / faster / best-sites wording', hits.length === 0, hits)
    check('says not a forecast', /not a forecast for a new trial/i.test(body))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('1440: no horizontal page scroll', overflow <= 0, overflow)
    await shot(page, 'site-scores-1440')
    await shot(page, 'site-scores-1440-full', true)
    // The site table and the preset's (Dana-Farber's) breakdown, as elements.
    await elementShot(page, '.ss-list', 'site-scores-table')
    await elementShot(page, '.ss-breakdown', 'site-scores-breakdown-preset')
    await page.evaluate(() => window.scrollTo(0, 0))

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
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
    await page.evaluate(() => window.scrollTo(0, 0))
    await shot(page, 'site-scores-1440-dark')
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])

    // Pick another site from the table: hash and breakdown follow.
    const rows = await page.$$('.ss-sites tbody tr')
    await rows[2].click()
    await page.waitForFunction((t) => document.querySelector('.ss-bd-title')?.textContent !== t && !document.querySelector('.ss-stale'), { timeout: 30_000 }, title)
    const picked = await text(page, '.ss-bd-title')
    const hash = await page.evaluate(() => window.location.hash)
    check('row click selects the site and writes #site-scores/<id>', /^#site-scores\/[0-9a-f]+$/.test(hash) && picked === firstRows[2], { picked, hash })

    // Sorting by score shows the overstatement note.
    await page.evaluate(() => [...document.querySelectorAll('.ss-sites th button')].find((b) => b.textContent.startsWith('Score')).click())
    await page.waitForSelector('.ss-sortnote', { timeout: 10_000 })
    const note = await text(page, '.ss-sortnote')
    check('sort note: overstatement is on the log scale, with a worked ratio', /log score/i.test(note) && /log scale/i.test(note) && /10x ratio between two raw scores is about 2\.2x/.test(note), note)
    out.sortedByScoreRows = (await texts(page, '.ss-sites tbody tr')).slice(0, 3)

    // Search and min-trials filter.
    await page.evaluate(() => [...document.querySelectorAll('.ss-sites th button')].find((b) => b.textContent.startsWith('Fitted')).click())
    await page.type('.ss-search input', 'sloan')
    await page.waitForFunction(() => [...document.querySelectorAll('.ss-sites tbody tr .ss-site-name')].every((e) => /sloan/i.test(e.closest('tr').innerText)), { timeout: 15_000 })
    const sloan = await texts(page, '.ss-sites tbody tr .ss-site-name')
    check('search filters the table', sloan.length > 0, sloan.slice(0, 4))

    // Deep link to a capped low-history site.
    const capped = await (await fetch(`${APP}/api/site-scores?min_trials=1&sort=n_fit&limit=200`)).json()
    const c = capped.rows.find((r) => r.capped)
    await page.goto('about:blank')
    await page.goto(`${APP}/#site-scores/${c.site_id}`, { waitUntil: 'networkidle0' }) // fresh load: initial hash
    await settle(page)
    const capStep = await text(page, '.ss-step-warn')
    check('deep link to a capped site shows the cap step', /capped to/i.test(capStep) && (await text(page, '.ss-bd-title')) === c.facility, { facility: c.facility, capStep })
    await new Promise((r) => setTimeout(r, 400))
    const top = await page.$eval('.ss-breakdown', (e) => Math.round(e.getBoundingClientRect().top))
    check('fresh deep link scrolls to the breakdown', top >= -2 && top < 200, top)
    out.capped = { site: c, steps: await texts(page, '.ss-steps .ss-step'), figs: await texts(page, '.ss-figs .ss-fig') }
    check('capped site: list row has no percentile (status tied_at_cap)', c.percentile === null && c.percentile_status === 'tied_at_cap', c)
    check('capped site: percentile figure reads "at cap", Step 5 explains the tie',
      /^Percentile at cap tied with [\d,]+ capped U\.S\. sites/i.test(out.capped.figs.find((f) => /^percentile/i.test(f)) || '') && /gets no percentile/.test(out.capped.steps[4]),
      { figs: out.capped.figs, step5: out.capped.steps[4] })
    await shot(page, 'site-scores-1440-capped-site')

    // Deep link to a U.S. site with no fitted trial: no percentile, Step 5 says it is the unseen-site rate.
    await page.goto('about:blank')
    await page.goto(`${APP}/#site-scores/${UNFITTED_US}`, { waitUntil: 'networkidle0' })
    await settle(page)
    const uf = { title: await text(page, '.ss-bd-title'), figs: await texts(page, '.ss-figs .ss-fig'), steps: await texts(page, '.ss-steps .ss-step') }
    out.unfitted = uf
    check('unfitted U.S. site: no percentile, Step 5 says unseen-site rate',
      /^Percentile — no fitted trials/i.test(uf.figs.find((f) => /^percentile/i.test(f)) || '') &&
        /unseen-site rate/.test(uf.steps[4]) && !/percentile among/.test(uf.steps[4]),
      uf)
    check('unfitted U.S. site: Step 3 range is the prior’s', /With no fitted trial, the 10th–90th range is the prior’s/.test(uf.steps[2]), uf.steps[2])

    // Deep link to a non-U.S. site: calibrated value labelled as relative to the U.S. mean; no U.S. percentile.
    await page.goto('about:blank')
    await page.goto(`${APP}/#site-scores/${NON_US}`, { waitUntil: 'networkidle0' })
    await settle(page)
    const nu = { title: await text(page, '.ss-bd-title'), figs: await texts(page, '.ss-figs .ss-fig'), steps: await texts(page, '.ss-steps .ss-step') }
    out.nonUS = nu
    check('non-U.S. site: calibrated labelled relative to the U.S. mean; percentile says outside the U.S.',
      /relative to the U\.S\. mean/.test(nu.figs.find((f) => /^calibrated/i.test(f)) || '') &&
        /outside the U\.S\./.test(nu.figs.find((f) => /^percentile/i.test(f)) || '') &&
        /relative to the U\.S\. average/.test(nu.steps[5]),
      nu)
    await shot(page, 'site-scores-1440-non-us-site')

    // Phone width.
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
    await page.goto('about:blank')
    await page.goto(`${APP}/#site-scores`, { waitUntil: 'networkidle0' })
    await settle(page)
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('390: no horizontal page scroll', ov <= 0, ov)
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll('.ss *')]
        .filter((e) => !e.closest('.table-scroll'))
        .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 5)
        .map((e) => `${e.tagName}.${e.className}`),
    )
    check('390: nothing outside table scrollers overflows the viewport', wide.length === 0, wide)
    const sitesTable = await page.$eval('.ss-list .table-scroll', (e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
    check('390: site table fits (calibrated and percentile fold into the score cell)', sitesTable.sw <= sitesTable.cw + 1, sitesTable)
    const stack = await texts(page, '.ss-sites tbody tr .ss-stack')
    check('390: folded calibrated value and percentile are visible', stack.length > 0 && /^cal\. [\d.]+ (\d+(st|nd|rd|th) pctile|at cap)$/.test(stack[0]), stack.slice(0, 3))
    // Open the histogram table so every scroller has a size; any scroller wider than its box must show the hint.
    await page.$eval('.ss-hist details', (d) => {
      d.open = true
    })
    await new Promise((r) => setTimeout(r, 300))
    const scrollers = await page.$$eval('.ss-scrollx', (es) =>
      es.map((e) => {
        const t = e.querySelector('.table-scroll')
        return { label: t.getAttribute('aria-label'), sw: t.scrollWidth, cw: t.clientWidth, hint: !!e.querySelector('.ss-scroll-hint'), fade: e.classList.contains('ss-more-r') }
      }),
    )
    out.scrollers390 = scrollers
    check('390: every table wider than its box shows a scroll hint and a right-edge fade', scrollers.every((x) => x.sw <= x.cw + 1 || (x.hint && x.fade)), scrollers)
    await page.$eval('.ss-hist details', (d) => {
      d.open = false
    })
    await shot(page, 'site-scores-390')
    await shot(page, 'site-scores-390-full', true)

    check('no page errors', log.pageerrors.length === 0, log.pageerrors)
    check('no console errors', log.console.filter((m) => m.type === 'error').length === 0, log.console)
    const bad = log.api.filter((a) => a.status >= 400 && !String(a.url).includes('not-a-site'))
    check('no failed API calls', bad.length === 0, bad.map((a) => `${a.status} ${a.url}`))
  } finally {
    await browser.close()
  }
  fs.writeFileSync(`${SCREENS}/site-scores-qa.json`, JSON.stringify(out, null, 1))
  const failed = out.checks.filter((c) => !c.ok)
  console.log(failed.length ? `${failed.length} FAILED` : 'ALL PASS')
  process.exit(failed.length ? 1 : 0)
})()
