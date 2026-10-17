// Browser QA for the Protocol to terms step tabs (termsSteps.tsx, termsStepTabs.ts): one step on show at a time,
// every step mounted; ARIA tabs (roles, aria-selected/controls, roving tabindex, Left/Right/Home/End); the soft
// fade-in (opacity sampled every frame with motion allowed, and no animation with prefers-reduced-motion: reduce);
// no scroll jump beyond the sticky header offset; focus to the heading only on keyboard activation; Back / Next;
// deep links #terms-flow/<NCT>/<step>; state kept across switches (a pasted proposal CSV, the band input); Simple and
// Detailed, light and dark, 1440 and 390 px; no horizontal page scroll; 0 page and console errors.
// Usage (NODE_PATH must reach puppeteer-core): node terms_steptabs.js [baseUrl] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep, layoutCheck } = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5289'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/steptabs'
const NCT = 'NCT05800015'
const SLUGS = ['protocol', 'coverage', 'budget', 'compare', 'proposal', 'term-sheet']
fs.mkdirSync(OUT, { recursive: true })

const fails = []
const notes = []
const metrics = {}
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`)
  return !!ok
}

/** Which panels are on show, which tab is selected, the hash. */
const state = (page) =>
  page.evaluate(() => {
    const panels = [...document.querySelectorAll('.tf [role=tabpanel]')]
    const tabs = [...document.querySelectorAll('nav.tf-flow [role=tab]')]
    return {
      shown: panels.filter((p) => !p.hidden).map((p) => p.id),
      mounted: panels.map((p) => p.id),
      selected: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.id),
      tabindex0: tabs.filter((t) => t.tabIndex === 0).map((t) => t.id),
      hash: location.hash,
      active: !document.activeElement ? null : document.activeElement.tagName === 'H2' ? `H2:${document.activeElement.textContent}` : document.activeElement.id || document.activeElement.tagName,
    }
  })

/** The sticky offset the switch aims for: the nav's sticky top + its height + 12 px. */
const offsets = (page, i) =>
  page.evaluate((i) => {
    const nav = document.querySelector('nav.tf-flow')
    const cs = getComputedStyle(nav)
    const panel = document.getElementById(`tf-step-${i + 1}`)
    const bar = document.querySelector('.appbar')
    const tabs = document.querySelector('nav.tabs')
    const hdr = Math.max(bar ? bar.getBoundingClientRect().bottom : 0, tabs ? tabs.getBoundingClientRect().bottom : 0)
    return {
      scrollY: Math.round(window.scrollY),
      navTop: Math.round(nav.getBoundingClientRect().top),
      navBottom: Math.round(nav.getBoundingClientRect().bottom),
      stickyTop: parseFloat(cs.top),
      header: Math.round(hdr),
      panelTop: panel ? Math.round(panel.getBoundingClientRect().top) : null,
      want: Math.round(parseFloat(cs.top) + nav.getBoundingClientRect().height + 12),
      docH: document.documentElement.scrollHeight,
    }
  }, i)

;(async () => {
  const browser = await launch()
  const log = { console: [], pageerrors: [], failed: [] }
  const open = async (name, width, { theme = 'light', density = 'simple', hash = `#terms-flow/${NCT}`, motion = 'no-preference' } = {}) => {
    const page = await browser.newPage()
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && log.console.push(`${name}: ${m.text()}`))
    page.on('pageerror', (e) => log.pageerrors.push(`${name}: ${e}`))
    page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && log.failed.push(`${name}: ${r.status()} ${r.url()}`))
    await page.evaluateOnNewDocument(
      (theme, density) => {
        try {
          if (!sessionStorage.getItem('qa-cleared')) {
            localStorage.clear()
            sessionStorage.setItem('qa-cleared', '1')
          }
          localStorage.setItem('concord.theme', theme)
          localStorage.setItem('concord.density', density)
        } catch {
          /* ignore */
        }
      },
      theme,
      density,
    )
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: motion }])
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
    // Every step mounted with its content (budget priced, compare done).
    await page.waitForFunction(
      () => document.querySelectorAll('.tf [role=tabpanel]').length === 6 && document.querySelector('#tf-step-3 .tf-payer-value') && document.querySelector('#tf-step-4 .tf-decomp-total'),
      { timeout: 60000, polling: 300 },
    )
    await sleep(600)
    return page
  }
  const clickTab = async (page, i) => {
    await page.click(`#tf-tab-${SLUGS[i]}`)
    await sleep(350)
  }

  // ------------------------------------------------------------ structure, ARIA, deep links
  {
    const page = await open('aria', 1440)
    const s = await state(page)
    check('step 1 on show at load', s.shown.join() === 'tf-step-1', s.shown.join())
    check('all six steps mounted', s.mounted.length === 6, s.mounted.join())
    check('tab 1 selected, one tab in tab order', s.selected.join() === 'tf-tab-protocol' && s.tabindex0.join() === 'tf-tab-protocol', JSON.stringify(s))
    const aria = await page.evaluate(() => {
      const nav = document.querySelector('nav.tf-flow')
      const tabs = [...nav.querySelectorAll('[role=tab]')]
      return {
        role: nav.getAttribute('role'),
        tabs: tabs.length,
        controls: tabs.every((t) => document.getElementById(t.getAttribute('aria-controls'))?.getAttribute('role') === 'tabpanel'),
        labelled: [...document.querySelectorAll('.tf [role=tabpanel]')].every((p) => document.getElementById(p.getAttribute('aria-labelledby'))?.getAttribute('role') === 'tab'),
        buttons: tabs.every((t) => t.tagName === 'BUTTON' && t.type === 'button'),
      }
    })
    check('nav is a tablist of 6 button tabs', aria.role === 'tablist' && aria.tabs === 6 && aria.buttons, JSON.stringify(aria))
    check('aria-controls -> tabpanel, aria-labelledby -> tab', aria.controls && aria.labelled, JSON.stringify(aria))
    check('#terms-flow/<NCT> keeps the hash', s.hash === `#terms-flow/${NCT}`, s.hash)

    // Click a tab: the hash follows with replaceState (no new history entry).
    const h0 = await page.evaluate(() => history.length)
    await clickTab(page, 3)
    const s2 = await state(page)
    const h1 = await page.evaluate(() => history.length)
    check('click Compare shows step 4 only', s2.shown.join() === 'tf-step-4' && s2.selected.join() === 'tf-tab-compare', JSON.stringify(s2))
    check('hash updated to /compare', s2.hash === `#terms-flow/${NCT}/compare`, s2.hash)
    check('replaceState: no history entry added', h1 === h0, `${h0} -> ${h1}`)
    check('pointer click keeps focus on the tab', s2.active === 'tf-tab-compare', s2.active)
    await clickTab(page, 0)
    check('back to Protocol drops the slug', (await state(page)).hash === `#terms-flow/${NCT}`)
    await page.close()

    for (const [i, slug] of SLUGS.entries()) {
      const p = await open(`deeplink-${slug}`, 1440, { hash: `#terms-flow/${NCT}/${slug}` })
      const d = await state(p)
      check(`deep link /${slug} opens step ${i + 1}`, d.shown.join() === `tf-step-${i + 1}` && d.selected.join() === `tf-tab-${slug}`, JSON.stringify(d))
      check(`deep link /${slug} hash kept`, d.hash === (i === 0 ? `#terms-flow/${NCT}` : `#terms-flow/${NCT}/${slug}`), d.hash)
      await p.close()
    }
    const plain = await open('deeplink-plain', 1440, { hash: '#terms-flow' })
    const dp = await state(plain)
    check('#terms-flow opens step 1', dp.shown.join() === 'tf-step-1', dp.shown.join())
    // Hash change while on the page: the address bar picks the step.
    await plain.evaluate((nct) => (location.hash = `#terms-flow/${nct}/term-sheet`), NCT)
    await sleep(500)
    check('hashchange to /term-sheet selects step 6', (await state(plain)).shown.join() === 'tf-step-6')
    await plain.close()

    // Landing page link into Terms.
    const lp = await browser.newPage()
    lp.on('pageerror', (e) => log.pageerrors.push(`landing: ${e}`))
    await lp.setViewport({ width: 1440, height: 900 })
    await lp.goto(`${BASE}/#home`, { waitUntil: 'domcontentloaded' })
    await lp.waitForSelector('a[href="#terms-flow"]', { timeout: 30000 })
    await lp.click('a[href="#terms-flow"]')
    await lp.waitForFunction(() => document.querySelectorAll('.tf [role=tabpanel]').length === 6, { timeout: 60000 })
    await sleep(500)
    const ls = await state(lp)
    check('landing link opens Terms at step 1', ls.shown.join() === 'tf-step-1', JSON.stringify(ls))
    await lp.close()
  }

  // ------------------------------------------------------------ keyboard
  {
    const page = await open('keyboard', 1440)
    await page.keyboard.press('Shift')
    await page.focus('#tf-tab-protocol')
    const seq = []
    for (const k of ['ArrowRight', 'ArrowRight', 'End', 'ArrowRight', 'ArrowLeft', 'Home', 'ArrowLeft']) {
      await page.keyboard.press(k)
      await sleep(120)
      const s = await state(page)
      seq.push(`${k}:${s.selected[0]}/${s.shown[0]}/focus=${s.active}/tab0=${s.tabindex0.join()}`)
    }
    const want = ['coverage', 'budget', 'term-sheet', 'protocol', 'term-sheet', 'protocol', 'term-sheet']
    seq.forEach((x, i) => check(`key ${i + 1} ${x.split(':')[0]}`, x.includes(`:tf-tab-${want[i]}/tf-step-${SLUGS.indexOf(want[i]) + 1}/focus=tf-tab-${want[i]}/tab0=tf-tab-${want[i]}`), x))
    metrics.keyboardSequence = seq
    // Enter on the selected tab: focus moves to the panel heading, page does not jump.
    await page.keyboard.press('Home')
    await sleep(100)
    await page.keyboard.press('ArrowRight')
    await sleep(100)
    const y0 = await page.evaluate(() => window.scrollY)
    await page.keyboard.press('Enter')
    await sleep(200)
    const s = await state(page)
    const y1 = await page.evaluate(() => window.scrollY)
    check('Enter on a tab focuses the panel heading', /^H2:Coverage/.test(s.active), s.active)
    check('Enter focus does not scroll (preventScroll)', y0 === y1, `${y0} -> ${y1}`)
    // Next via the keyboard (Tab to it, Enter): heading of the next step gets focus.
    await page.evaluate(() => document.querySelector('#tf-step-2 .tf-pager-next').focus())
    await page.keyboard.press('Enter')
    await sleep(250)
    const s3 = await state(page)
    check('keyboard Next -> step 3 heading focused', s3.shown.join() === 'tf-step-3' && /^H2:Budget at a site/.test(s3.active), JSON.stringify(s3))
    const back = await page.evaluate(() => {
      const b = document.querySelector('#tf-step-3 .tf-pager-back')
      return { text: b.innerText, label: b.getAttribute('aria-label'), next: document.querySelector('#tf-step-3 .tf-pager-next').innerText }
    })
    check('pager labels', back.text.includes('Back') && back.label === 'Back to step 2: Coverage' && back.next.includes('Next: Compare'), JSON.stringify(back))
    await page.keyboard.press('Shift')
    await page.evaluate(() => document.querySelector('#tf-step-3 .tf-pager-back').focus())
    await page.keyboard.press(' ')
    await sleep(250)
    const s4 = await state(page)
    check('keyboard Back (Space) -> step 2 heading focused', s4.shown.join() === 'tf-step-2' && /^H2:Coverage/.test(s4.active), JSON.stringify(s4))
    // Mouse Next: no heading focus; focus kept on the new step's tab, not lost to <body>.
    await page.click('#tf-step-2 .tf-pager-next')
    await sleep(250)
    const s5 = await state(page)
    check('mouse Next -> step 3, focus on its tab', s5.shown.join() === 'tf-step-3' && s5.active === 'tf-tab-budget', JSON.stringify(s5))
    await page.close()
  }

  // ------------------------------------------------------------ fade-in (motion allowed vs reduced), scroll offset
  for (const motion of ['no-preference', 'reduce']) {
    const page = await open(`fade-${motion}`, 1440, { density: 'detailed', motion })
    const samples = await page.evaluate(async () => {
      const tab = document.getElementById('tf-tab-coverage')
      const panel = document.getElementById('tf-step-2')
      const out = []
      const t0 = performance.now()
      tab.click()
      out.push({ t: 0, o: parseFloat(getComputedStyle(panel).opacity), anims: panel.getAnimations().map((a) => a.animationName) })
      // Samples for 400 ms after the panel first shows (the fade starts then, and a dev build under load can take
      // 200 ms to show it), capped at 2 s.
      let shownAt = null
      await new Promise((res) => {
        const tick = () => {
          const t = performance.now() - t0
          if (shownAt == null && !panel.hidden) shownAt = t
          out.push({ t: Math.round(t), o: Math.round(parseFloat(getComputedStyle(panel).opacity) * 1000) / 1000, tr: getComputedStyle(panel).transform, anims: panel.getAnimations().map((a) => a.animationName), shown: !panel.hidden })
          if (t < 2000 && (shownAt == null || t - shownAt < 400)) requestAnimationFrame(tick)
          else res()
        }
        requestAnimationFrame(tick)
      })
      return out
    })
    // samples[0] is taken before React commits; samples[1] is the first animation frame after the click.
    const first = samples[1]
    const reachedOne = samples.slice(1).find((x) => x.o >= 0.999)
    const last = samples[samples.length - 1]
    metrics[`fade_${motion}`] = {
      firstFrameMs: first.t,
      firstFrameOpacity: first.o,
      opacityReaches1AtMs: reachedOne?.t ?? null,
      fadeDurationMs: reachedOne ? reachedOne.t - first.t : null,
      animations: first.anims,
      transformAfter: last.tr,
      animationsAfter: last.anims,
      sample: samples.slice(1, 16).map((x) => `${x.t}ms o=${x.o} ${x.tr}`),
    }
    // Dev build, Detailed: the first frame's latency depends on machine load, so only a gross delay fails.
    check(`${motion}: new step on screen on the next frames (<= 250 ms)`, first.shown && first.t <= 250, JSON.stringify(first))
    if (motion === 'no-preference') {
      check('fade: animation tf-step-in runs', first.anims.includes('tf-step-in'), JSON.stringify(first.anims))
      check('fade: starts near 0', first.o < 0.35, JSON.stringify(first))
      check('fade: 0 -> 1 within 250 ms of the first frame', reachedOne && reachedOne.t - first.t <= 250, JSON.stringify(reachedOne))
      check('fade: no transform or animation left on the panel', last.tr === 'none' && last.anims.length === 0, JSON.stringify(last))
    } else {
      check('reduced motion: no animation', first.anims.length === 0, JSON.stringify(first.anims))
      check('reduced motion: opacity 1 on the first frame', first.o === 1, JSON.stringify(first))
    }

    // Scroll: at the top (nav in place), a switch does not scroll.
    await page.evaluate(() => window.scrollTo(0, 0))
    await sleep(100)
    const a0 = await offsets(page, 2)
    await clickTab(page, 2)
    const a1 = await offsets(page, 2)
    check(`${motion}: switch at the top does not scroll`, a0.scrollY === a1.scrollY && a1.scrollY === 0, `${a0.scrollY} -> ${a1.scrollY}`)
    // Deep in step 3 (Detailed is long), use the sticky nav: the new panel's top lands just under header + nav.
    await page.evaluate(() => {
      const p = document.getElementById('tf-step-3')
      window.scrollTo(0, window.scrollY + p.getBoundingClientRect().bottom - window.innerHeight + 40)
    })
    await sleep(200)
    const b0 = await offsets(page, 3)
    await clickTab(page, 3)
    const b1 = await offsets(page, 3)
    metrics[`scroll_${motion}`] = { before: b0, after: b1 }
    check(`${motion}: nav stays visible (sticky under header)`, b0.navTop >= b0.header - 3 && b0.navTop <= b0.header + 0.5, JSON.stringify(b0))
    check(`${motion}: new panel top just under the sticky nav`, Math.abs(b1.panelTop - b1.want) <= 2 && b1.panelTop >= b1.navBottom, JSON.stringify(b1))
    // Bottom Next from the end of a long step lands the same way.
    await page.evaluate(() => {
      const p = document.getElementById('tf-step-4')
      window.scrollTo(0, window.scrollY + p.getBoundingClientRect().bottom - window.innerHeight + 40)
    })
    await sleep(150)
    await page.click('#tf-step-4 .tf-pager-next')
    await sleep(300)
    const c1 = await offsets(page, 4)
    metrics[`scroll_next_${motion}`] = c1
    check(`${motion}: Next from the bottom lands under the nav`, Math.abs(c1.panelTop - c1.want) <= 2, JSON.stringify(c1))
    await page.close()
  }

  // ------------------------------------------------------------ sticky nav meets the sticky app header (no gap)
  for (const [w, touch] of [
    [1440, false],
    [1319, false],
    [1000, false],
    [700, false],
    [390, false],
    [390, true],
  ]) {
    const name = `sticky-${w}${touch ? '-touch' : ''}`
    const page = await browser.newPage()
    page.on('pageerror', (e) => log.pageerrors.push(`${name}: ${e}`))
    await page.setViewport({ width: w, height: 900, hasTouch: touch, isMobile: touch })
    await page.goto(`${BASE}/#terms-flow/${NCT}/budget`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#tf-step-3 .tf-payer-value', { timeout: 60000 })
    await page.evaluate(() => window.scrollTo(0, 2000))
    await sleep(300)
    const r = await page.evaluate(() => {
      const bar = document.querySelector('.appbar')
      const tabs = document.querySelector('nav.tabs')
      const nav = document.querySelector('nav.tf-flow')
      const header = Math.max(bar.getBoundingClientRect().bottom, tabs.getBoundingClientRect().bottom)
      // What is painted in the row just above the nav's top edge: the header or the nav, never page content.
      const nr = nav.getBoundingClientRect()
      const hit = document.elementFromPoint(nr.left + nr.width / 2, Math.max(0, nr.top - 0.5))
      return {
        header: Math.round(header * 10) / 10,
        navTop: Math.round(nr.top * 10) / 10,
        navH: Math.round(nr.height),
        coveredBy: hit ? (hit.closest('.appbar, nav.tabs') ? 'header' : hit.closest('nav.tf-flow') ? 'nav' : hit.className || hit.tagName) : null,
      }
    })
    metrics[name] = r
    check(`${name}: no gap between header and step nav`, r.navTop <= r.header + 0.5 && r.navTop >= r.header - 4, JSON.stringify(r))
    await page.close()
  }

  // ------------------------------------------------------------ state kept across switches
  {
    const page = await open('state', 1440)
    await clickTab(page, 4)
    const csv = 'item_or_code,amount\n71260,$275.00\nCoordinator time and data entry,$350'
    await page.click('.tp-csv')
    await page.keyboard.type(csv)
    await page.waitForFunction(() => document.querySelector('.tp-tally'), { timeout: 30000 }).catch(() => {})
    await sleep(800)
    const before = await page.evaluate(() => ({ csv: document.querySelector('.tp-csv').value, tally: document.querySelector('.tp-tally')?.innerText ?? '' }))
    await clickTab(page, 2)
    // Change the band high end in Budget, then go away and back.
    const hi = await page.$('input[aria-label="Range high, percent of Medicare"]')
    await hi.click({ clickCount: 3 })
    await hi.type('130')
    await page.keyboard.press('Tab')
    await sleep(900)
    await clickTab(page, 0)
    await clickTab(page, 4)
    const after = await page.evaluate(() => ({ csv: document.querySelector('.tp-csv').value, tally: document.querySelector('.tp-tally')?.innerText ?? '' }))
    check('pasted CSV kept across switches', after.csv === before.csv && after.csv === csv, JSON.stringify(after.csv))
    check('proposal results kept across switches', !!before.tally && after.tally === before.tally, `${before.tally} | ${after.tally}`)
    await clickTab(page, 2)
    const band = await page.evaluate(() => document.querySelector('input[aria-label="Range high, percent of Medicare"]').value)
    check('band input kept across switches', band === '130', band)
    metrics.stateKept = { csvLines: csv.split('\n').length, tally: after.tally.replace(/\s+/g, ' '), bandHigh: band }
    await page.close()
  }

  // ------------------------------------------------------------ Simple / Detailed, light / dark, 1440 / 390
  for (const density of ['simple', 'detailed'])
    for (const theme of ['light', 'dark'])
      for (const width of [1440, 390]) {
        const name = `${density}-${width}-${theme}`
        const page = await open(name, width, { theme, density })
        const per = []
        for (let i = 0; i < 6; i++) {
          await clickTab(page, i)
          await page.evaluate(() => window.scrollTo(0, 0))
          await sleep(250)
          const s = await state(page)
          const lay = await layoutCheck(page)
          check(`${name} step ${i + 1} only on show`, s.shown.join() === `tf-step-${i + 1}`, s.shown.join())
          check(`${name} step ${i + 1} no horizontal page scroll`, !lay.overflow, JSON.stringify(lay.offenders.slice(0, 3)))
          const h = await page.evaluate(() => document.documentElement.scrollHeight)
          per.push(h)
          if (i === 0 || i === 2 || i === 4 || width === 390) await page.screenshot({ path: path.join(OUT, `step${i + 1}_${name}.png`) })
        }
        metrics[`pageHeight_${name}`] = per
        // Contrast of the active tab (number on accent, label on page) and the Next button.
        const con = await page.evaluate(() => {
          const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
          const lum = ([r, g, b]) => {
            const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
          }
          const ratio = (a, b) => {
            const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m)
            return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100
          }
          const on = document.querySelector('.tf-flow-on')
          const n = on.querySelector('.tf-flow-n')
          const off = document.querySelector('.tf-flow-btn:not(.tf-flow-on)')
          const navBg = getComputedStyle(document.querySelector('nav.tf-flow')).backgroundColor
          const next = document.querySelector('.tf-step:not([hidden]) .tf-pager-next') || document.querySelector('.tf-step:not([hidden]) .tf-pager-back')
          const ncs = getComputedStyle(next)
          return {
            activeNumber: ratio(getComputedStyle(n).color, getComputedStyle(n).backgroundColor),
            activeLabel: ratio(getComputedStyle(on).color, navBg),
            inactiveLabel: ratio(getComputedStyle(off).color, navBg),
            pagerButton: ratio(ncs.color, ncs.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.querySelector('.tf-step:not([hidden])')).backgroundColor : ncs.backgroundColor),
          }
        })
        metrics[`contrast_${name}`] = con
        check(`${name} contrast >= 4.5`, Object.values(con).every((x) => x >= 4.5), JSON.stringify(con))
        // The step nav at 390: one row that scrolls sideways inside itself, the active tab in view.
        if (width === 390) {
          await clickTab(page, 5)
          const strip = await page.evaluate(() => {
            const ol = document.querySelector('nav.tf-flow ol')
            const t = document.querySelector('.tf-flow-on').getBoundingClientRect()
            const r = ol.getBoundingClientRect()
            return { navH: Math.round(document.querySelector('nav.tf-flow').getBoundingClientRect().height), scrollW: ol.scrollWidth, clientW: ol.clientWidth, activeInView: t.left >= r.left - 1 && t.right <= r.right + 1 }
          })
          metrics[`strip_${name}`] = strip
          check(`${name} active tab scrolled into view in the strip`, strip.activeInView, JSON.stringify(strip))
          await page.evaluate(() => window.scrollTo(0, 0))
          await sleep(200)
          await page.screenshot({ path: path.join(OUT, `step6_nav_${name}.png`) })
        }
        // A scrolled capture with the sticky nav under the header (1440 only).
        if (width === 1440) {
          await clickTab(page, 2)
          await page.evaluate(() => window.scrollTo(0, 900))
          await sleep(250)
          await page.screenshot({ path: path.join(OUT, `sticky_nav_${name}.png`) })
        }
        await page.close()
      }

  await browser.close()
  const out = { fails, notes, metrics, log }
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(out, null, 1))
  console.log(JSON.stringify({ fails, console: log.console, pageerrors: log.pageerrors, failed: log.failed }, null, 1))
  console.log(fails.length ? `FAIL ${fails.length}` : 'PASS')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
