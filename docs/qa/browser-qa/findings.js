// Findings landing page + app restructure QA: screenshots (1440 and 390, light and dark), phone overflow,
// hash routes (new and pre-pivot deep links) and the lazy clear.
// Usage: node findings.js <baseUrl> <outDir>   (NODE_PATH = C:/Users/micha/Projects/concord/data/work/D/node_modules)
// FAKE_OVERLAP=1 answers /api/findings/self-overlap with a labelled test fixture to render the related note.
const L = require('./lib')
const fs = require('fs')

const BASE = process.argv[2] || 'http://localhost:5173'
const DIR = process.argv[3] || `${L.WORK}/findings`
fs.mkdirSync(DIR, { recursive: true })

const FAKE_OVERLAP = process.env.FAKE_OVERLAP === '1'
const SUFFIX = FAKE_OVERLAP ? '_overlapfixture' : ''

async function newPage(browser, w, h, mobile, dark, log) {
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }])
  L.instrument(page, log)
  if (FAKE_OVERLAP) {
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (req.url().includes('/api/findings/self-overlap'))
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ headline: 'TEST FIXTURE: 12 pairs of concurrent trials overlap' }),
        })
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
  const out = { base: BASE, fakeOverlap: FAKE_OVERLAP, runs: {} }
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
    if (!FAKE_OVERLAP) {
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
          trialSelect: document.querySelector('main select')?.value ?? null,
        }))
        return { hash, ...st, api: log.api.slice(before).map((a) => `${a.method} ${a.url.replace(BASE, '').split('?')[0]} ${a.status}`) }
      }
      out.runs.routes = []
      for (const h of ['', '#findings', '#overlap', '#terms-flow', '#research', '#research/robustness', '#robustness', '#model',
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
