// Browser QA for the Site scores tab: screenshots at 1440x900 and 390 px, interactions, wording checks.
//   APP=http://localhost:5184 SCREENS=<dir> node docs/qa/browser-qa/site_scores.js
// puppeteer-core is required by absolute path through ./lib (installed in data/work/D).
const fs = require('fs')
const L = require('./lib')

const APP = process.env.APP || 'http://localhost:5184'
const SCREENS = process.env.SCREENS || 'C:/Users/micha/Projects/concord/data/work/S/screens'
fs.mkdirSync(SCREENS, { recursive: true })

// Product-claim wording the app rule forbids on this view.
const FORBIDDEN = [/speed-?up/i, /time[- ]to[- ]fill/i, /\bfaster\b/i, /best sites/i, /top sites/i, /fastest/i]

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
    const body = await page.evaluate(() => document.querySelector('.ss').innerText)
    const hits = FORBIDDEN.filter((r) => r.test(body)).map(String)
    check('no speedup / time-to-fill / faster / best-sites wording', hits.length === 0, hits)
    check('says not a forecast', /not a forecast for a new trial/i.test(body))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('1440: no horizontal page scroll', overflow <= 0, overflow)
    await shot(page, 'site-scores-1440')
    await shot(page, 'site-scores-1440-full', true)

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
    check('sorting by score shows the overstatement note', true, await text(page, '.ss-sortnote'))

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
    await shot(page, 'site-scores-1440-capped-site')

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
