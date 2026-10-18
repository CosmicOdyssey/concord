// Browser QA for switching between the app's main tabs (App.tsx, lazyView.ts, tabActive.ts): visited views stay
// mounted and hidden, the view shown fades in (opacity and a 6 px rise, 180 ms, only when motion is allowed), the
// header and tab bar stay still, a kept view keeps its state, a hidden view never rewrites the address or holds focus,
// and every deep link still opens its view. Simple and Detailed, light and dark, 1440 and 390 px: a screenshot of each
// tab after a switch, no horizontal page scroll, 0 page and console errors. Light 1440 Simple also saves the fade's
// frames (the pane's animation paused at 0, 45, 90, 135 ms) and runs the deep links and back/forward; reduced motion
// is checked once (no animation, the view is there at once).
// Usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node app_tabs.js [baseUrl] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep, showStep } = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5293'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/apptabs2'
fs.mkdirSync(OUT, { recursive: true })
const NCT = 'NCT05800015'

const TABS = [
  { id: 'terms-flow', label: 'Protocol to terms', sel: 'h1', text: 'Protocol to terms' },
  { id: 'overlap', label: 'Portfolio overlap', sel: 'h1', text: 'Portfolio overlap' },
  { id: 'findings', label: 'Findings', sel: 'h1', text: 'Findings' },
  { id: 'site-scores', label: 'Site scores', sel: 'h1', text: 'Site scores' },
  { id: 'research', label: 'Research', sel: '.rs h1', text: null },
]
const byId = Object.fromEntries(TABS.map((t) => [t.id, t]))

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: ok ? undefined : detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`)
}

async function newPage(browser, { width, theme, density, reduced = false }, log) {
  const page = await browser.newPage()
  await page.setViewport({ width, height: 900 })
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: theme },
    { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
  ])
  await page.evaluateOnNewDocument(
    (theme, density) => {
      try {
        localStorage.setItem('concord.theme', theme)
        localStorage.setItem('concord.density', density)
      } catch {
        /* ignore */
      }
    },
    theme,
    density,
  )
  page.on('pageerror', (e) => log.pageerrors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') log.console.push(m.text())
  })
  return page
}

/** The heading of `tab` is on screen (not inside a hidden pane). */
async function waitView(page, tab, timeout = 60000) {
  await page.waitForFunction(
    (t) =>
      [...document.querySelectorAll(`main ${t.sel}`)].some(
        (h) => h.getClientRects().length > 0 && !h.closest('[hidden]') && (!t.text || h.textContent.trim() === t.text),
      ),
    { timeout, polling: 50 },
    tab,
  )
}

async function clickTab(page, label) {
  await page.evaluate((label) => {
    const b = [...document.querySelectorAll('nav.tabs button')].find((x) => x.querySelector('.tab-label')?.textContent.trim() === label)
    if (!b) throw new Error('no tab ' + label)
    b.click()
  }, label)
}

/** What is on screen: the panes in the page, which one shows, the address, the tab bar's place, page overflow. */
async function state(page) {
  return page.evaluate(() => {
    const panes = [...document.querySelectorAll('.app-pane')]
    const bar = document.querySelector('nav.tabs')
    const a = document.activeElement
    return {
      hash: location.hash,
      mounted: panes.map((p) => p.dataset.view),
      shown: panes.filter((p) => !p.hidden).map((p) => p.dataset.view),
      selected: document.querySelector('nav.tabs [aria-selected="true"] .tab-label')?.textContent.trim() ?? null,
      barTop: bar && bar.getClientRects().length ? Math.round(bar.getBoundingClientRect().top * 10) / 10 : null,
      headerH: Math.round(document.querySelector('.appbar')?.getBoundingClientRect().height ?? 0),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      focusHidden: !!(a && a.closest && a.closest('[hidden]')),
      title: document.title,
    }
  })
}

/** The fade on the pane just shown: its animation, paused at each time, a screenshot of the viewport. */
async function fadeFrames(page, name, times) {
  const out = []
  for (const t of times) {
    const v = await page.evaluate((t) => {
      const pane = [...document.querySelectorAll('.app-pane')].find((p) => !p.hidden)
      const anim = pane?.getAnimations().find((x) => x.animationName === 'app-pane-in')
      if (!anim) return null
      anim.pause()
      anim.currentTime = t
      const cs = getComputedStyle(pane)
      return { t, opacity: Number(cs.opacity), ty: cs.transform === 'none' ? 0 : new DOMMatrixReadOnly(cs.transform).m42 }
    }, t)
    if (!v) break
    await page.screenshot({ path: path.join(OUT, `${name}-fade-${String(t).padStart(3, '0')}ms.png`) })
    out.push(v)
  }
  await page.evaluate(() => {
    for (const p of document.querySelectorAll('.app-pane')) for (const a of p.getAnimations()) if (a.animationName === 'app-pane-in') a.finish()
  })
  return out
}

;(async () => {
  const browser = await launch()
  const log = { pageerrors: [], console: [] }
  const report = { base: BASE, runs: [], fade: null, reduced: null, deeplinks: [] }
  try {
    for (const theme of ['light', 'dark']) {
      for (const width of [1440, 390]) {
        for (const density of ['simple', 'detailed']) {
          const tag = `${theme}-${width}-${density}`
          const page = await newPage(browser, { width, theme, density }, log)
          const run = { tag, steps: [] }
          // Landing -> Open Protocol to terms.
          await page.goto(`${BASE}/#home`, { waitUntil: 'networkidle2', timeout: 90000 })
          await sleep(800)
          await page.evaluate(() => {
            const a = [...document.querySelectorAll('a,button')].find((x) => x.textContent.trim().startsWith('Open Protocol to terms'))
            if (!a) throw new Error('no landing CTA')
            a.click()
          })
          await waitView(page, byId['terms-flow'])
          const first = tag === 'light-1440-simple'
          if (first) report.fade = { landing: await fadeFrames(page, 'landing-to-terms', [0, 45, 90, 135]) }
          await sleep(300)
          let st = await state(page)
          run.steps.push({ to: 'terms-flow', from: 'landing', ...st })
          check(`${tag}: landing -> Protocol to terms shows the Terms view only`, st.shown.join() === 'terms-flow' && st.selected === 'Protocol to terms', st)
          await page.screenshot({ path: path.join(OUT, `${tag}-terms-flow.png`) })
          // Terms: go to the Budget step, so the revisit can show the step was kept.
          await showStep(page, 'budget')
          await sleep(200)
          // Every other tab, then back to Terms.
          for (const id of ['overlap', 'findings', 'site-scores', 'research', 'terms-flow']) {
            const t = byId[id]
            await page.evaluate(() => window.scrollTo({ top: Math.min(400, document.documentElement.scrollHeight - innerHeight), behavior: 'instant' }))
            await sleep(150)
            const before = await state(page)
            await clickTab(page, t.label)
            await waitView(page, t)
            if (first && id === 'overlap') report.fade.tab = await fadeFrames(page, 'terms-to-overlap', [0, 45, 90, 135])
            await sleep(id === 'terms-flow' ? 300 : 700)
            st = await state(page)
            run.steps.push({ to: id, from: before.shown.join(), barBefore: before.barTop, ...st })
            check(`${tag}: -> ${t.label}: one view on show, tab selected`, st.shown.join() === id && st.selected === t.label, st)
            check(`${tag}: -> ${t.label}: no horizontal page scroll`, st.overflowX <= 0, st.overflowX)
            check(`${tag}: -> ${t.label}: focus not inside a hidden view`, !st.focusHidden, st)
            check(`${tag}: -> ${t.label}: header height unchanged`, st.headerH === before.headerH, { before: before.headerH, after: st.headerH })
            if (id !== 'terms-flow') await page.screenshot({ path: path.join(OUT, `${tag}-${id}.png`) })
          }
          // Revisit of Terms: the Budget step and the address kept.
          st = await state(page)
          const step = await page.evaluate(() => {
            const p = [...document.querySelectorAll('.tf-step[role="tabpanel"]')].find((x) => !x.hidden)
            return p ? p.id : null
          })
          check(`${tag}: Terms revisit keeps the Budget step and its address`, step === 'tf-step-3' && st.hash === `#terms-flow/${NCT}/budget`, { step, hash: st.hash })
          check(`${tag}: every visited view stays mounted`, ['terms-flow', 'overlap', 'findings', 'site-scores', 'research'].every((v) => st.mounted.includes(v)), st.mounted)
          await page.screenshot({ path: path.join(OUT, `${tag}-terms-flow-revisit.png`) })
          // A hidden view never rewrites the address: on Findings for a second, the hash stays #findings.
          await clickTab(page, 'Findings')
          await waitView(page, byId.findings)
          await sleep(1000)
          st = await state(page)
          check(`${tag}: on Findings, hidden views leave the address alone`, st.hash === '#findings' && st.title === 'Findings · Concord', { hash: st.hash, title: st.title })
          report.runs.push(run)
          if (first) {
            // Deep links into views that are mounted and hidden, then back and forward.
            const S = await (await fetch(`${BASE}/api/site-scores/summary`)).json()
            const siteId = S?.preset?.site_id
            const findingId = await page.evaluate(() => [...document.querySelectorAll('[data-finding]')][1]?.dataset.finding ?? null)
            const links = [
              {
                hash: `#terms-flow/${NCT}/term-sheet`,
                view: 'terms-flow',
                ok: () => {
                  const p = [...document.querySelectorAll('.tf-step[role="tabpanel"]')].find((x) => !x.hidden)
                  return p?.id === 'tf-step-6'
                },
              },
              {
                hash: '#overlap/regeneron',
                view: 'overlap',
                ok: () => (document.querySelector('.app-pane:not([hidden]) .ov-detail h2')?.innerText ?? '').includes('NCT05785767 × NCT05800015'),
              },
              {
                // The site's breakdown, scrolled into view (SiteScoresView waits until it is shown to scroll).
                hash: `#site-scores/${siteId}`,
                view: 'site-scores',
                ok: (id) => {
                  const el = document.querySelector('.app-pane:not([hidden]) .ss-breakdown')
                  if (location.hash !== `#site-scores/${id}` || !el) return false
                  const top = el.getBoundingClientRect().top
                  return top > -5 && top < innerHeight * 0.6
                },
                arg: siteId,
              },
              {
                hash: `#findings/${findingId}`,
                view: 'findings',
                ok: (id) => {
                  const el = document.getElementById(`finding-${id}`)
                  if (!el) return false
                  const top = el.getBoundingClientRect().top
                  return top > -5 && top < innerHeight * 0.5
                },
                arg: findingId,
              },
              { hash: '#research/map', view: 'research', ok: () => (document.querySelector('.rs-tabs [aria-selected="true"]')?.innerText ?? '').trim() === 'Map' },
              { hash: '#financial', view: 'financial', ok: () => [...document.querySelectorAll('.app-pane:not([hidden]) h1')].some((h) => h.textContent.trim() === 'Sponsor budget') },
              { hash: '#portfolio-command', view: 'portfolio-command', ok: () => [...document.querySelectorAll('.app-pane:not([hidden]) h1')].some((h) => h.textContent.trim() === 'Portfolio Command') },
            ]
            for (const l of links) {
              await page.evaluate((h) => {
                location.hash = h
              }, l.hash)
              let ok = false
              try {
                await page.waitForFunction(l.ok, { timeout: 30000, polling: 100 }, l.arg ?? null)
                ok = true
              } catch {
                ok = false
              }
              await sleep(400)
              st = await state(page)
              report.deeplinks.push({ hash: l.hash, ok, ...st })
              check(`deep link ${l.hash} opens ${l.view}`, ok && st.shown.join() === l.view, st)
            }
            // Back twice: Financial, then Research (the map), each from the kept view.
            await page.goBack()
            await sleep(600)
            const b1 = await state(page)
            await page.goBack()
            await sleep(600)
            const b2 = await state(page)
            await page.goForward()
            await sleep(600)
            const f1 = await state(page)
            check('back -> #financial', b1.shown.join() === 'financial' && b1.hash === '#financial', b1)
            check('back -> #research/map', b2.shown.join() === 'research' && b2.hash === '#research/map', b2)
            check('forward -> #financial', f1.shown.join() === 'financial', f1)
          }
          await page.close()
        }
      }
    }
    // A view whose code is slow to arrive (the Terms module held back 900 ms): the old view stays on screen, usable,
    // for the first 200 ms; only then the Loading box, in a space a screen tall; then the view.
    {
      const page = await newPage(browser, { width: 1440, theme: 'light', density: 'simple' }, log)
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        if (/ProtocolTermsView/.test(req.url())) setTimeout(() => req.continue().catch(() => undefined), 900)
        else req.continue().catch(() => undefined)
      })
      await page.goto(`${BASE}/#findings`, { waitUntil: 'domcontentloaded', timeout: 90000 })
      await waitView(page, byId.findings)
      const samples = await page.evaluate(async () => {
        const b = [...document.querySelectorAll('nav.tabs button')].find((x) => x.querySelector('.tab-label')?.textContent.trim() === 'Protocol to terms')
        const t0 = performance.now()
        b.click()
        const out = []
        await new Promise((resolve) => {
          const tick = () => {
            const t = performance.now() - t0
            const shown = [...document.querySelectorAll('.app-pane')].filter((p) => !p.hidden).map((p) => p.dataset.view)
            const box = document.querySelector('.app-loading')
            out.push({
              t: Math.round(t),
              shown: shown.join(),
              loading: !!(box && box.getClientRects().length),
              boxH: box ? Math.round(box.getBoundingClientRect().height) : 0,
              selected: document.querySelector('nav.tabs [aria-selected="true"] .tab-label')?.textContent.trim(),
            })
            if (t < 2500 && !shown.includes('terms-flow')) requestAnimationFrame(tick)
            else resolve()
          }
          requestAnimationFrame(tick)
        })
        return out
      })
      const early = samples.filter((s) => s.t < 180)
      const firstLoading = samples.find((s) => s.loading)
      const end = samples[samples.length - 1]
      report.slowChunk = { firstLoadingAt: firstLoading?.t ?? null, boxH: firstLoading?.boxH ?? null, termsAt: end.shown === 'terms-flow' ? end.t : null, frames: samples.length }
      check(
        'slow code: the old view stays (tab already selected) for the first 180 ms, no Loading box',
        early.length > 0 && early.every((s) => s.shown === 'findings' && !s.loading && s.selected === 'Protocol to terms'),
        early.slice(0, 4),
      )
      check('slow code: the Loading box only after ~200 ms, a screen tall', !!firstLoading && firstLoading.t >= 190 && firstLoading.boxH >= 900, report.slowChunk)
      check('slow code: then the Terms view', end.shown === 'terms-flow', end)
      await page.close()
    }
    // Reduced motion: no animation on the view shown; it is there, fully opaque, at once.
    {
      const page = await newPage(browser, { width: 1440, theme: 'light', density: 'simple', reduced: true }, log)
      await page.goto(`${BASE}/#findings`, { waitUntil: 'networkidle2', timeout: 90000 })
      await waitView(page, byId.findings)
      await sleep(1500)
      await clickTab(page, 'Protocol to terms')
      await waitView(page, byId['terms-flow'])
      const r = await page.evaluate(() => {
        const pane = [...document.querySelectorAll('.app-pane')].find((p) => !p.hidden)
        const cs = getComputedStyle(pane)
        return { animations: pane.getAnimations().map((a) => a.animationName), opacity: cs.opacity, transform: cs.transform, animationName: cs.animationName }
      })
      report.reduced = r
      check('reduced motion: no fade on the view shown, opaque at once', r.animations.length === 0 && r.opacity === '1' && r.transform === 'none', r)
      await page.close()
    }
  } catch (e) {
    console.error('app_tabs failed:', e)
    check('script ran to the end', false, String(e))
  } finally {
    await browser.close().catch(() => undefined)
  }
  check('0 page errors', log.pageerrors.length === 0, log.pageerrors.slice(0, 5))
  check('0 console errors', log.console.length === 0, log.console.slice(0, 5))
  const failed = results.filter((r) => !r.ok)
  fs.writeFileSync(path.join(OUT, 'app_tabs.json'), JSON.stringify({ ...report, results, log }, null, 1))
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (report.fade) console.log('fade frames', JSON.stringify(report.fade))
  if (report.slowChunk) console.log('slow chunk', JSON.stringify(report.slowChunk))
  if (report.reduced) console.log('reduced motion', JSON.stringify(report.reduced))
  process.exit(failed.length ? 1 : 0)
})()
