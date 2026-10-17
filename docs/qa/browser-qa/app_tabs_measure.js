// Measures switching between the app's main tabs (App.tsx), and landing -> app, from the click: time until the new
// view's main heading is rendered (and until its fade has finished), whether a Loading fallback or spinner showed and
// for how long, the layout shift summed over the first 1.5 s (PerformanceObserver 'layout-shift', every entry), the
// scroll movement after the heading appeared, and whether the header's tab bar moved. Each ordered pair A -> B runs on
// a fresh page at #A: first visit of B, then B -> A -> B for the revisit. Before each click the page is scrolled down
// (600 px or the bottom), so scroll handling shows. 1440 x 900, light, Simple, motion allowed. Writes
// <outDir>/<label>.json and a Markdown table <outDir>/<label>.md.
// Usage (NODE_PATH must reach puppeteer-core): node app_tabs_measure.js [baseUrl] [outDir] [label] [--reduced]
const fs = require('fs')
const path = require('path')
const { launch, sleep } = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5292'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/apptabs'
const LABEL = process.argv[4] || 'measure'
const REDUCED = process.argv.includes('--reduced')
fs.mkdirSync(OUT, { recursive: true })

const TABS = [
  { id: 'terms-flow', label: 'Protocol to terms', sel: 'h1', text: 'Protocol to terms' },
  { id: 'overlap', label: 'Portfolio overlap', sel: 'h1', text: 'Portfolio overlap' },
  { id: 'findings', label: 'Findings', sel: 'h1', text: 'Findings' },
  { id: 'site-scores', label: 'Site scores', sel: 'h1', text: 'Site scores' },
  { id: 'research', label: 'Research', sel: '.rs h1', text: null },
]
const byId = Object.fromEntries(TABS.map((t) => [t.id, t]))
const WINDOW = 1500

// Runs in the page before any script: layout-shift entries, and a per-frame sampler.
function pageInit(reduced) {
  window.__shifts = []
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__shifts.push({ t: e.startTime, v: e.value })
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {
    /* unsupported */
  }
  try {
    localStorage.setItem('concord.theme', 'light')
    localStorage.setItem('concord.density', 'simple')
  } catch {
    /* ignore */
  }
  void reduced
}

/** In the page: click `click()` and sample every frame for `ms`. */
async function measureSwitch(page, spec, clickFn, clickArg) {
  return page.evaluate(
    async (spec, clickSrc, clickArg, ms) => {
      const rendered = (el) => el && el.getClientRects().length > 0 && !el.closest('[hidden]')
      const opacityOf = (el) => {
        let o = 1
        for (let a = el; a && a !== document.documentElement; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity || '1')
        return o
      }
      const heading = () =>
        [...document.querySelectorAll(`main ${spec.sel}`)].find((h) => rendered(h) && (!spec.text || h.textContent.trim() === spec.text)) || null
      const loadingOn = () =>
        [...document.querySelectorAll('main .loading, main .spinner, #root > .loading, .app-loading')].some((el) => rendered(el))
      const bar = () => document.querySelector('nav.tabs')
      const frames = []
      const t0 = performance.now()
      const y0 = window.scrollY
      const bar0 = bar() ? bar().getBoundingClientRect().top : null
      // eslint-disable-next-line no-new-func
      new Function('arg', clickSrc)(clickArg)
      await new Promise((resolve) => {
        const tick = () => {
          const t = performance.now() - t0
          const h = heading()
          const b = bar()
          frames.push({
            t: Math.round(t * 10) / 10,
            h: !!h,
            op: h ? Math.round(opacityOf(h) * 1000) / 1000 : null,
            ty: h ? (() => { const tr = getComputedStyle(h.closest('.app-pane') || h).transform; return tr && tr !== 'none' ? new DOMMatrixReadOnly(tr).m42 : 0 })() : null,
            load: loadingOn(),
            y: Math.round(window.scrollY),
            bar: b ? Math.round(b.getBoundingClientRect().top * 10) / 10 : null,
          })
          if (t < ms) requestAnimationFrame(tick)
          else resolve()
        }
        requestAnimationFrame(tick)
      })
      const shifts = (window.__shifts || []).filter((s) => s.t >= t0 && s.t <= t0 + ms)
      const first = frames.find((f) => f.h)
      const full = frames.find((f) => f.h && f.op >= 0.999)
      const loads = frames.filter((f) => f.load)
      let jump = 0
      let after = false
      let prevY = null
      for (const f of frames) {
        if (f.h) after = true
        if (after && prevY !== null) jump += Math.abs(f.y - prevY)
        if (after) prevY = f.y
      }
      const barMove = bar0 === null ? null : Math.max(0, ...frames.filter((f) => f.bar !== null).map((f) => Math.abs(f.bar - bar0)))
      return {
        heading_ms: first ? first.t : null,
        opaque_ms: full ? full.t : null,
        fallback: loads.length > 0,
        fallback_ms: loads.length ? Math.round((loads[loads.length - 1].t - loads[0].t + 16.7) * 10) / 10 : 0,
        cls: Math.round(shifts.reduce((a, s) => a + s.v, 0) * 10000) / 10000,
        scroll_before: Math.round(y0),
        scroll_at_heading: first ? first.y : null,
        scroll_end: frames.length ? frames[frames.length - 1].y : null,
        scroll_jump_after_paint: jump,
        tabbar_move: barMove,
        frames: frames.filter((f) => f.h).slice(0, 16).map((f) => ({ t: f.t, op: f.op, ty: f.ty })),
      }
    },
    spec,
    clickFn,
    clickArg,
    WINDOW,
  )
}

const CLICK_TAB = `const b=[...document.querySelectorAll('nav.tabs button')].find(x=>x.querySelector('.tab-label')?.textContent.trim()===arg); if(!b) throw new Error('no tab '+arg); b.click()`
const CLICK_CTA = `const a=[...document.querySelectorAll('a,button')].find(x=>x.textContent.trim().startsWith(arg)); if(!a) throw new Error('no cta'); a.click()`

async function waitHeading(page, spec, timeout = 60000) {
  await page.waitForFunction(
    (spec) =>
      [...document.querySelectorAll(`main ${spec.sel}`)].some(
        (h) => h.getClientRects().length > 0 && !h.closest('[hidden]') && (!spec.text || h.textContent.trim() === spec.text),
      ),
    { timeout, polling: 100 },
    spec,
  )
}

async function settle(page, ms = 1200) {
  try {
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 })
  } catch {
    /* busy */
  }
  await sleep(ms)
}

async function scrollDown(page, y = 600) {
  await page.evaluate((y) => window.scrollTo({ top: Math.min(y, document.documentElement.scrollHeight - innerHeight), behavior: 'instant' }), y)
  await sleep(250)
}

async function newPage(browser, log) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: REDUCED ? 'reduce' : 'no-preference' },
  ])
  await page.evaluateOnNewDocument(pageInit, REDUCED)
  page.on('pageerror', (e) => log.pageerrors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text()
      log.console.push(t)
    }
  })
  return page
}

;(async () => {
  const browser = await launch()
  const log = { pageerrors: [], console: [] }
  const rows = []
  try {
    // Landing -> Open Protocol to terms (first visit), then back to the landing and in again (revisit).
    {
      const page = await newPage(browser, log)
      await page.goto(`${BASE}/#home`, { waitUntil: 'networkidle2' })
      await sleep(1500)
      await scrollDown(page, 400)
      const first = await measureSwitch(page, byId['terms-flow'], CLICK_CTA, 'Open Protocol to terms')
      rows.push({ from: 'landing', to: 'terms-flow', visit: 'first', ...first })
      await settle(page)
      await page.evaluate(() => {
        location.hash = '#home'
      })
      await sleep(1500)
      await scrollDown(page, 400)
      const again = await measureSwitch(page, byId['terms-flow'], CLICK_CTA, 'Open Protocol to terms')
      rows.push({ from: 'landing', to: 'terms-flow', visit: 'revisit', ...again })
      await page.close()
    }
    for (const a of TABS) {
      for (const b of TABS) {
        if (a === b) continue
        const page = await newPage(browser, log)
        await page.goto(`${BASE}/#${a.id}`, { waitUntil: 'domcontentloaded' })
        await waitHeading(page, a)
        await settle(page)
        await scrollDown(page)
        const first = await measureSwitch(page, b, CLICK_TAB, b.label)
        rows.push({ from: a.id, to: b.id, visit: 'first', ...first })
        await settle(page)
        await scrollDown(page, 300)
        const leftAt = await page.evaluate(() => Math.round(window.scrollY))
        await measureSwitch(page, a, CLICK_TAB, a.label)
        await settle(page, 600)
        await scrollDown(page, 500)
        const again = await measureSwitch(page, b, CLICK_TAB, b.label)
        rows.push({ from: a.id, to: b.id, visit: 'revisit', left_at: leftAt, ...again })
        await page.close()
        process.stdout.write(`${a.id} -> ${b.id}: first ${first.heading_ms} ms, revisit ${again.heading_ms} ms\n`)
      }
    }
  } catch (e) {
    console.error('measure failed:', e)
    log.pageerrors.push(`script: ${e}`)
  } finally {
    await browser.close().catch(() => undefined)
  }
  const out = { label: LABEL, base: BASE, reduced: REDUCED, when: new Date().toISOString(), rows, log }
  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(out, null, 1))
  const md = [
    `| from | to | visit | heading ms | fade done ms | fallback (ms) | CLS 1.5 s | scroll before -> at heading -> end (left B at) | scroll moved after paint | tab bar moved px |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
    ...rows.map(
      (r) =>
        `| ${r.from} | ${r.to} | ${r.visit} | ${r.heading_ms ?? '-'} | ${r.opaque_ms ?? '-'} | ${r.fallback ? `yes (${r.fallback_ms})` : 'no'} | ${r.cls} | ${r.scroll_before} -> ${r.scroll_at_heading ?? '-'} -> ${r.scroll_end ?? '-'}${r.left_at !== undefined ? ` (${r.left_at})` : ''} | ${r.scroll_jump_after_paint} | ${r.tabbar_move ?? '-'} |`,
    ),
  ]
  const agg = (vis) => {
    const rs = rows.filter((r) => r.visit === vis && r.from !== 'landing')
    const med = (xs) => {
      const s = xs.filter((x) => x !== null).sort((p, q) => p - q)
      return s.length ? s[Math.floor(s.length / 2)] : null
    }
    return {
      n: rs.length,
      heading_median: med(rs.map((r) => r.heading_ms)),
      heading_max: Math.max(...rs.map((r) => r.heading_ms ?? 0)),
      fallback_count: rs.filter((r) => r.fallback).length,
      cls_median: med(rs.map((r) => r.cls)),
      cls_max: Math.max(...rs.map((r) => r.cls)),
      scroll_moved_count: rs.filter((r) => r.scroll_jump_after_paint > 0).length,
      scroll_restored_count: rs.filter((r) => r.left_at !== undefined && Math.abs((r.scroll_end ?? -1) - r.left_at) <= 1).length,
      tabbar_moved_count: rs.filter((r) => (r.tabbar_move ?? 0) > 0.5).length,
    }
  }
  md.push('', '```', JSON.stringify({ first: agg('first'), revisit: agg('revisit'), pageerrors: log.pageerrors.length, console: log.console }, null, 1), '```')
  fs.writeFileSync(path.join(OUT, `${LABEL}.md`), md.join('\n'))
  console.log(md.slice(-1 - 3).join('\n'))
  console.log(JSON.stringify({ first: agg('first'), revisit: agg('revisit'), pageerrors: log.pageerrors, console: log.console.slice(0, 10) }, null, 1))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
