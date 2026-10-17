// Findings landing page + app restructure QA: screenshots (1440 and 390, light and dark), phone overflow,
// hash routes (new and pre-pivot deep links) and the lazy clear.
// Usage: node findings.js <baseUrl> <outDir>   (NODE_PATH = C:/Users/micha/Projects/concord/data/work/D/node_modules)
// OVERLAP_FILE=<self_overlap.json> answers /api/findings/self-overlap with that file (e.g. the overlap audit's real
// output from its worktree) so the related note renders. FAKE_OVERLAP=1 uses the inline fixture below instead,
// which has the audit's file shape (headline {count, sponsors, upper_bound_count, text}, broad count,
// definition, parameters); FAKE_OVERLAP=count drops the headline object (the audit's first-run shape).
// FINDINGS_FILE=<findings.json> answers /api/findings with that file (e.g. a newer generated findings.json).
const L = require('./lib')
const fs = require('fs')

const BASE = process.argv[2] || 'http://localhost:5173'
const DIR = process.argv[3] || `${L.WORK}/findings`
fs.mkdirSync(DIR, { recursive: true })

// Shape of data/findings/self_overlap.json as `python -m concord.overlap` writes it (values from its current run).
const OVERLAP_FIXTURE = {
  generated_at: '2026-10-17T07:54:12+00:00',
  definition: 'Same-sponsor pairs of NSCLC trials ... that share >= 10 identifiable registered sites ... (fixture)',
  parameters: { min_shared_sites: 10, min_overlap_one_direction: 0.8, since: '2015-01-01', until: '2026-10-16' },
  headline: {
    count: 21,
    upper_bound_count: 19,
    sponsors: 10,
    variant: 'both_hand_encoded',
    text: "21 same-sponsor pairs where both trials' eligibility was hand-encoded and reviewed; in 19 of them ...",
  },
  count: 134,
  upper_bound_count: 42,
  sponsors_with_pairs: 27,
  notes: ['Descriptive: counts of registered sites ... Nothing here predicts enrollment speed.'],
  pairs: [],
}
const { headline: _h, ...OVERLAP_FIXTURE_COUNT_ONLY } = OVERLAP_FIXTURE
const OVERLAP_BODY = process.env.OVERLAP_FILE
  ? fs.readFileSync(process.env.OVERLAP_FILE, 'utf8')
  : process.env.FAKE_OVERLAP === '1'
    ? JSON.stringify(OVERLAP_FIXTURE)
    : process.env.FAKE_OVERLAP === 'count'
      ? JSON.stringify(OVERLAP_FIXTURE_COUNT_ONLY)
      : null
const FINDINGS_BODY = process.env.FINDINGS_FILE ? fs.readFileSync(process.env.FINDINGS_FILE, 'utf8') : null
const INTERCEPT = !!(OVERLAP_BODY || FINDINGS_BODY)
const SUFFIX = process.env.SUFFIX ?? (INTERCEPT ? '_overlap' : '')

async function newPage(browser, w, h, mobile, dark, log) {
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }])
  L.instrument(page, log)
  if (INTERCEPT) {
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname
      if (OVERLAP_BODY && path === '/api/findings/self-overlap')
        req.respond({ status: 200, contentType: 'application/json', body: OVERLAP_BODY })
      else if (FINDINGS_BODY && path === '/api/findings')
        req.respond({ status: 200, contentType: 'application/json', body: FINDINGS_BODY })
      else req.continue()
    })
  }
  return page
}

async function waitFindings(page) {
  await page.waitForSelector('.fd-card', { timeout: 30000 })
  await page.waitForSelector('.ci svg', { timeout: 30000 })
  await L.sleep(500)
}

;(async () => {
  const out = { base: BASE, overlapFile: process.env.OVERLAP_FILE ?? null, fakeOverlap: process.env.FAKE_OVERLAP ?? null, findingsFile: process.env.FINDINGS_FILE ?? null, runs: {} }
  const browser = await L.launch()
  try {
    // 1. Desktop light: landing load
    {
      const log = {}
      const page = await newPage(browser, 1440, 900, false, false, log)
      const t0 = Date.now()
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
      await waitFindings(page)
      const tReady = Date.now() - t0
      await L.sleep(1500)
      const r = { tReadyMs: tReady, layout: await L.layoutCheck(page), grab: await L.grab(page) }
      r.shots = [await L.shot(page, DIR, `findings_1440${SUFFIX}_full`, true), await L.shot(page, DIR, `findings_1440${SUFFIX}`, false)]
      r.activeTab = await page.evaluate(() => document.querySelector('nav.tabs .tab-active')?.innerText.replace(/\s+/g, ' ').trim())
      r.tabs = await page.evaluate(() => [...document.querySelectorAll('nav.tabs button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()))
      r.svg = await page.evaluate(() => {
        const s = document.querySelector('.ci svg')
        return {
          labelledby: s?.getAttribute('aria-labelledby'),
          title: s?.querySelector('title')?.textContent,
          desc: s?.querySelector('desc')?.textContent,
          texts: [...(s?.querySelectorAll('text') ?? [])].map((t) => t.textContent),
        }
      })
      r.highlighted = await page.evaluate(() => [...document.querySelectorAll('.fd-row-hl')].map((tr) => tr.innerText.replace(/\s+/g, ' ')))
      r.related = await page.evaluate(() => document.querySelector('.fd-related')?.innerText ?? null)
      r.relatedPlacement = await page.evaluate(() => {
        const n = document.querySelector('.fd-related')
        const idx = document.querySelector('.fd-index')
        const card = document.querySelector('.fd-card')
        const top = (el) => (el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null)
        return { relatedTop: top(n), indexTop: top(idx), firstCardTop: top(card), pageHeight: document.documentElement.scrollHeight }
      })
      r.columnsPerTable = await page.evaluate(() =>
        [...document.querySelectorAll('.fd-table-block')].map((b) => `${b.querySelector('.fd-table-title')?.innerText}: ${[...b.querySelectorAll('thead th')].map((t) => t.innerText).join(' | ')}`),
      )
      r.sourcesOff = await page.evaluate(() => [...document.querySelectorAll('.fd-src-off')].map((e) => e.parentElement.innerText))
      r.runStatus = await page.evaluate(() => document.querySelector('.run-status')?.innerText.trim() ?? '')
      r.sourceLinks = await page.evaluate(() => [...document.querySelectorAll('.fd-sources a')].map((a) => a.getAttribute('href')))
      r.sourceStatus = []
      for (const href of r.sourceLinks) r.sourceStatus.push(`${href} ${await page.evaluate(async (h) => (await fetch(h)).status, href)}`)
      r.apiCalls = log.api.map((a) => `${a.method} ${a.url.replace(BASE, '')} ${a.status}`)
      r.console = log.console
      r.pageerrors = log.pageerrors
      // index button scrolls to the third card
      await page.evaluate(() => [...document.querySelectorAll('.fd-index-item')][2].click())
      await L.sleep(1000)
      r.scrollAfterIndex = await page.evaluate(() => Math.round(window.scrollY))
      out.runs.desktop_light = r
      await page.close()
    }
    // 2. Desktop dark
    {
      const log = {}
      const page = await newPage(browser, 1440, 900, false, true, log)
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
      await waitFindings(page)
      await L.sleep(800)
      out.runs.desktop_dark = {
        shots: [await L.shot(page, DIR, `findings_1440_dark${SUFFIX}`, false), await L.shot(page, DIR, `findings_1440_dark${SUFFIX}_full`, true)],
        pageerrors: log.pageerrors,
      }
      await page.close()
    }
    // 3. Phone 390, light and dark
    for (const dark of [false, true]) {
      const log = {}
      const page = await newPage(browser, 390, 844, true, dark, log)
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
      await waitFindings(page)
      await L.sleep(800)
      const n = `findings_390${dark ? '_dark' : ''}${SUFFIX}`
      const r = { layout: await L.layoutCheck(page) }
      r.shots = [await L.shot(page, DIR, n, false), await L.shot(page, DIR, n + '_full', true)]
      r.svgWidth = await page.evaluate(() => document.querySelector('.ci svg')?.getAttribute('width'))
      r.related = await page.evaluate(() => document.querySelector('.fd-related')?.innerText ?? null)
      // Wide tables: hint shown, first column stays in view when scrolled to the far right.
      r.tables = await page.evaluate(async () => {
        const res = []
        for (const b of document.querySelectorAll('.fd-table-block')) {
          const sc = b.querySelector('.table-scroll')
          const th = b.querySelector('tbody th')
          const before = th.getBoundingClientRect().left - sc.getBoundingClientRect().left
          sc.scrollLeft = sc.scrollWidth
          await new Promise((r) => setTimeout(r, 150))
          const after = th.getBoundingClientRect().left - sc.getBoundingClientRect().left
          const lastTh = [...b.querySelectorAll('thead th')].pop()
          const lastVisible = lastTh.getBoundingClientRect().right <= sc.getBoundingClientRect().right + 1
          res.push({
            title: b.querySelector('.fd-table-title')?.innerText,
            clientWidth: sc.clientWidth,
            scrollWidth: sc.scrollWidth,
            hint: !!b.querySelector('.fd-scroll-hint'),
            fadeRightBefore: null,
            stickyOffsetBefore: Math.round(before),
            stickyOffsetAfterScroll: Math.round(after),
            lastColumnVisibleAfterScroll: lastVisible,
            rowHeaderWidth: Math.round(th.getBoundingClientRect().width),
          })
          sc.scrollLeft = 0
        }
        return res
      })
      if (!dark) {
        await L.clickTab(page, 'Research')
        await page.waitForSelector('.rs-banner', { timeout: 30000 })
        await L.sleep(1500)
        r.researchLayout = await L.layoutCheck(page)
        r.shots.push(await L.shot(page, DIR, `research_390${SUFFIX}`, false))
      }
      r.pageerrors = log.pageerrors
      out.runs[n] = r
      await page.close()
    }
    if (!INTERCEPT) {
      // 4. Routing: new routes, pre-pivot deep links, lazy clear
      const log = {}
      const page = await newPage(browser, 1440, 900, false, false, log)
      const route = async (hash) => {
        const before = log.api.length
        await page.goto('about:blank')
        await page.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' })
        await L.sleep(2500)
        const st = await page.evaluate(() => ({
          tab: document.querySelector('nav.tabs .tab-active')?.innerText.replace(/\s+/g, ' ').trim(),
          sub: document.querySelector('.rs-tab-on')?.innerText ?? null,
          h1: document.querySelector('main h1')?.innerText ?? null,
          banner: !!document.querySelector('.rs-banner'),
          runstatus: document.querySelector('.run-status')?.innerText.trim() ?? '',
          scrollY: Math.round(window.scrollY),
          allocationCardTop: Math.round(document.getElementById('finding-allocation')?.getBoundingClientRect().top ?? -1),
          trialSelect: document.querySelector('main select')?.value ?? null,
        }))
        return { hash, ...st, api: log.api.slice(before).map((a) => `${a.method} ${a.url.replace(BASE, '').split('?')[0]} ${a.status}`) }
      }
      out.runs.routes = []
      for (const h of ['', '#findings', '#findings/allocation', '#overlap', '#terms-flow', '#research', '#research/robustness', '#robustness', '#model',
        '#clear', '#map', '#research/prices/NCT06452277', '#prices/NCT06452277', '#portfolio', '#portfolio/regeneron', '#terms', '#bogus'])
        out.runs.routes.push(await route(h))
      // click-through: sub-tab, banner link back to findings, Research tab remembers the sub-tab
      await page.goto('about:blank')
      await page.goto(BASE + '/#research/model', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.rs-banner')
      await page.evaluate(() => [...document.querySelectorAll('.rs-tab')].find((b) => b.innerText === 'Robustness').click())
      await L.sleep(1000)
      const a = await page.evaluate(() => [location.hash, document.querySelector('main h1')?.innerText])
      out.runs.research_1440 = await L.shot(page, DIR, 'research_1440', false)
      await page.evaluate(() => document.querySelector('.rs-banner a').click())
      await L.sleep(1500)
      const b = await page.evaluate(() => [location.hash, document.querySelector('main h1')?.innerText])
      await L.clickTab(page, 'Research')
      await L.sleep(1000)
      const c = await page.evaluate(() => [location.hash, document.querySelector('.rs-tab-on')?.innerText])
      await L.clickTab(page, 'Portfolio overlap')
      await L.sleep(500)
      const d = await page.evaluate(() => [location.hash, document.querySelector('main')?.innerText])
      out.runs.clickthrough = { subTab: a, bannerLink: b, backToResearch: c, overlapPlaceholder: d }

      // In-app hash changes (no reload): run status only on Research, the Clear-it pointer to #findings/allocation,
      // and the Regeneron preset link followed after the first load.
      {
        const before = log.api.length
        const status = () => page.evaluate(() => document.querySelector('.run-status')?.innerText.trim() ?? '')
        await page.goto('about:blank')
        await page.goto(BASE + '/#research/clear', { waitUntil: 'domcontentloaded' })
        await L.waitCleared(page, 'US-Northeast')
        const onResearch = await status()
        await L.clickTab(page, 'Findings')
        await page.waitForSelector('.fd-card')
        const onFindings = await status()
        await L.clickTab(page, 'Protocol to terms')
        const onTerms = await status()
        await L.clickTab(page, 'Portfolio overlap')
        const onOverlap = await status()
        await page.evaluate(() => {
          location.hash = 'research/clear'
        })
        await page.waitForSelector('.headline')
        await L.sleep(800)
        const pointer = await page.evaluate(() => {
          const a = [...document.querySelectorAll('main a')].find((x) => x.getAttribute('href') === '#findings/allocation')
          return a ? a.closest('p')?.innerText ?? null : null
        })
        await page.evaluate(() => [...document.querySelectorAll('main a')].find((x) => x.getAttribute('href') === '#findings/allocation')?.click())
        await page.waitForSelector('#finding-allocation')
        await L.sleep(1200)
        const afterPointer = await page.evaluate(() => ({
          hash: location.hash,
          tab: document.querySelector('nav.tabs .tab-active')?.innerText.replace(/\s+/g, ' ').trim(),
          allocationCardTop: Math.round(document.getElementById('finding-allocation').getBoundingClientRect().top),
          scrollY: Math.round(window.scrollY),
        }))
        await page.evaluate(() => {
          location.hash = 'portfolio/regeneron'
        })
        await L.waitCleared(page, 'Regeneron')
        await L.sleep(800)
        const portfolio = await page.evaluate(() => ({
          hash: location.hash,
          sub: document.querySelector('.rs-tab-on')?.innerText,
          runStatus: document.querySelector('.run-status')?.innerText.trim(),
          formRegion: document.querySelector('main select')?.value ?? null,
        }))
        out.runs.inApp = {
          onResearch,
          onFindings,
          onTerms,
          onOverlap,
          pointer,
          afterPointer,
          portfolio,
          clears: log.api.slice(before).filter((x) => x.url.includes('/api/clear')).map((x) => x.post),
        }
        out.runs.inApp.shot = await L.shot(page, DIR, 'research_portfolio_regeneron_hashchange', false)
      }
      out.runs.routing_pageerrors = log.pageerrors
      out.runs.routing_console = log.console
      await page.close()
    }
  } finally {
    await browser.close()
  }
  L.save(`${DIR}/qa_findings${SUFFIX}.json`, out)
  console.log(JSON.stringify(out, (k, v) => (k === 'grab' ? undefined : v), 1))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
