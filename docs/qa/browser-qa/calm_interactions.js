// Calm foundation interaction checks (puppeteer-core, installed Chrome). Prints PASS/FAIL lines and writes
// interactions.json next to the screenshots.
// usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node calm_interactions.js [base] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep } = require('./lib')

const BASE = process.argv[2] || 'http://127.0.0.1:5201'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/R/foundation'
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

async function fresh(browser, { width = 1440, height = 900, touch = false } = {}) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch })
  // The Research clear is a two-minute computation on the shared backend: never start it from here.
  await page.setRequestInterception(true)
  page.on('request', (r) => (r.url().includes('/api/clear') ? r.respond({ status: 503, contentType: 'application/json', body: '{"detail":"blocked in QA"}' }) : r.continue()))
  page.__errors = []
  page.on('pageerror', (e) => page.__errors.push(String(e)))
  return { ctx, page }
}

;(async () => {
  const browser = await launch()
  try {
    // 1. Hover card measured at a stale left after the viewport shrinks (plumbing review issue 1).
    {
      const { ctx, page } = await fresh(browser)
      await page.goto(`${BASE}/#dev/components`, { waitUntil: 'networkidle0' })
      const tip = await page.$('button[aria-label="Right edge tip"]')
      await tip.hover()
      await sleep(400)
      const first = await page.evaluate(() => {
        const c = [...document.querySelectorAll('.hc-card')].find((x) => !x.hidden)
        const r = c.getBoundingClientRect()
        return { l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }
      })
      await page.mouse.move(5, 5)
      await sleep(500)
      await page.setViewport({ width: 700, height: 900 })
      await sleep(300)
      await page.evaluate(() => document.querySelector('button[aria-label="Right edge tip"]').scrollIntoView({ block: 'center' }))
      await sleep(200)
      const t2 = await page.$('button[aria-label="Right edge tip"]')
      const box = await t2.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      // Sample the card for 700 ms after it opens: its width must not creep.
      const samples = await page.evaluate(
        () =>
          new Promise((res) => {
            const out = []
            const t0 = performance.now()
            const tick = () => {
              const c = [...document.querySelectorAll('.hc-card')].find((x) => !x.hidden)
              if (c) {
                const r = c.getBoundingClientRect()
                out.push(`${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)}`)
              }
              if (performance.now() - t0 < 900) requestAnimationFrame(tick)
              else res(out)
            }
            tick()
          }),
      )
      const widths = [...new Set(samples)]
      check('hover card keeps one size after the viewport shrinks', widths.length === 1 && Number(widths[0].split('x')[0]) >= 300, { first, distinct: widths.slice(0, 8) })
      await ctx.close()
    }

    // 2. Header control: hovered vs pressed are distinguishable (plumbing review issue 3).
    {
      const { ctx, page } = await fresh(browser)
      await page.goto(`${BASE}/#findings`, { waitUntil: 'networkidle0' })
      const btn = await page.$('.theme-seg button[aria-label="Light theme"]')
      await btn.hover()
      await sleep(250)
      const st = await page.evaluate(() => {
        const s = (el) => {
          const c = getComputedStyle(el)
          return { pressed: el.getAttribute('aria-pressed'), bg: c.backgroundColor, color: c.color }
        }
        return {
          hovered: s(document.querySelector('.theme-seg button[aria-label="Light theme"]')),
          pressed: s(document.querySelector('.theme-seg button[aria-pressed="true"]')),
        }
      })
      check('header: hovered unpressed button differs from the pressed one', st.hovered.pressed === 'false' && st.hovered.bg !== st.pressed.bg && st.hovered.color !== st.pressed.color, st)
      await ctx.close()
    }

    // 3. Density: Simple for a new visitor, remembered after a change; the header keeps one height.
    {
      const { ctx, page } = await fresh(browser)
      await page.goto(`${BASE}/#findings`, { waitUntil: 'networkidle0' })
      const d0 = await page.evaluate(() => ({ attr: document.documentElement.dataset.density, pressed: document.querySelector('.density-seg [aria-pressed="true"]')?.innerText, stored: localStorage.getItem('concord.density') }))
      check('density defaults to Simple for a new visitor', d0.attr === 'simple' && d0.pressed === 'Simple' && d0.stored === null, d0)
      await page.click('.density-seg button:nth-child(2)')
      await sleep(200)
      await page.reload({ waitUntil: 'networkidle0' })
      const d1 = await page.evaluate(() => ({ attr: document.documentElement.dataset.density, pressed: document.querySelector('.density-seg [aria-pressed="true"]')?.innerText, stored: localStorage.getItem('concord.density') }))
      check('density choice is remembered', d1.attr === 'detailed' && d1.pressed === 'Detailed' && d1.stored === 'detailed', d1)
      // 4. The QA page's density is local.
      await page.goto(`${BASE}/#dev/components`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.view .density-seg button', { timeout: 30000 })
      const local = await page.$$('.view .density-seg button')
      await local[0].click()
      await sleep(200)
      const d2 = await page.evaluate(() => ({
        html: document.documentElement.dataset.density,
        stored: localStorage.getItem('concord.density'),
        headerPressed: document.querySelector('.appbar .density-seg [aria-pressed="true"]')?.innerText,
        localPressed: document.querySelector('.view .density-seg [aria-pressed="true"]')?.innerText,
        simpleOnly: !!document.querySelector('[data-qa="simple-only"]'),
        disclosure: !!document.querySelector('.view .section-disclosure'),
      }))
      check('dev page density toggle is local (app-wide choice untouched)', d2.html === 'detailed' && d2.stored === 'detailed' && d2.headerPressed === 'Detailed' && d2.localPressed === 'Simple' && d2.simpleOnly && d2.disclosure, d2)
      await ctx.close()
    }

    // 5. Routes: landing at no hash and #home; every existing deep link opens its tab.
    {
      const { ctx, page } = await fresh(browser)
      const routes = [
        ['', 'landing'],
        ['#home', 'landing'],
        ['#findings', 'Findings'],
        ['#findings/allocation', 'Findings'],
        ['#overlap', 'Portfolio overlap'],
        ['#overlap/regeneron', 'Portfolio overlap'],
        ['#terms-flow', 'Protocol to terms'],
        ['#terms-flow/NCT05800015', 'Protocol to terms'],
        ['#site-scores', 'Site scores'],
        ['#financial', 'Financial Coordination'],
        ['#research/model', 'Research'],
        ['#research/robustness', 'Research'],
        ['#model', 'Research'],
        ['#research/portfolio/regeneron', 'Research'],
        ['#dev/components', 'dev'],
        ['#nonsense', 'Findings'],
      ]
      const got = []
      for (const [hash, want] of routes) {
        await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
        await sleep(900)
        const r = await page.evaluate(() => ({
          landing: !!document.querySelector('.lp'),
          tab: document.querySelector('nav.tabs [aria-selected="true"] .tab-label')?.innerText ?? null,
          sub: document.querySelector('.rs-tabs [aria-selected="true"]')?.innerText ?? null,
          h1: document.querySelector('h1')?.innerText ?? null,
        }))
        const ok = want === 'landing' ? r.landing : want === 'dev' ? r.h1 === 'Component check' : r.tab === want
        got.push({ hash, want, ...r, ok })
      }
      check('every route and deep link opens the right page', got.every((g) => g.ok), got.filter((g) => !g.ok).length ? got.filter((g) => !g.ok) : `${got.length} routes`)
      // In-app navigation: wordmark to the landing page, See demo to Findings.
      await page.goto(`${BASE}/#findings`, { waitUntil: 'networkidle0' })
      await page.click('.appbar .wordmark')
      await sleep(600)
      const toLanding = await page.evaluate(() => ({ hash: location.hash, landing: !!document.querySelector('.lp') }))
      await page.click('.lp-actions .btn-primary')
      await sleep(900)
      const toDemo = await page.evaluate(() => ({ hash: location.hash, tab: document.querySelector('nav.tabs [aria-selected="true"] .tab-label')?.innerText }))
      check('wordmark goes to the landing page; See demo goes to Findings', toLanding.landing && toLanding.hash === '#home' && toDemo.hash === '#findings' && toDemo.tab === 'Findings', { toLanding, toDemo })
      check('no page errors while routing', page.__errors.length === 0, page.__errors.slice(0, 3))
      await ctx.close()
    }

    // 6. Landing: section links and deep links scroll; the hero matrix answers hover and keyboard focus; theme switch.
    {
      const { ctx, page } = await fresh(browser)
      await page.goto(`${BASE}/#home/tested`, { waitUntil: 'networkidle0' })
      await sleep(600)
      const deep = await page.evaluate(() => Math.round(document.getElementById('landing-tested').getBoundingClientRect().top))
      check('#home/tested opens the landing page at What we tested', Math.abs(deep) < 90, { top: deep })
      await page.evaluate(() => window.scrollTo(0, 0))
      await sleep(200)
      await page.click('.lp-nav a[href="#home/terms"]')
      await sleep(1200)
      const nav = await page.evaluate(() => ({ top: Math.round(document.getElementById('landing-terms').getBoundingClientRect().top), hash: location.hash, landing: !!document.querySelector('.lp') }))
      check('header section link scrolls to its section and stays on the landing page', nav.landing && nav.hash === '#home/terms' && nav.top >= 0 && nav.top < 120, nav)
      await page.evaluate(() => window.scrollTo(0, 0))
      await sleep(300)
      // The hero matrix is the shared half grid (halfgrid.tsx): .hg-cell buttons, .hg-n numbers.
      const title0 = await page.evaluate(() => document.querySelector('.lp-paircard-title').innerText)
      const cell = await page.$('.lp-hero-fig .hg-cell[aria-label^="TroFuse-007 and NCT06345729"]')
      await cell.hover()
      await sleep(250)
      const title1 = await page.evaluate(() => document.querySelector('.lp-paircard-title').innerText)
      await page.focus('.lp-hero-fig .hg-cell[aria-label^="NCT07190248 and NCT07554339"]')
      await sleep(250)
      const title2 = await page.evaluate(() => ({ t: document.querySelector('.lp-paircard-title').innerText, marks: document.querySelector('.lp-paircard .lp-mark')?.innerText }))
      check('hero matrix: hover and keyboard focus show that pair, with its marks', title0 === 'TroFuse-019 × NCT06623422' && title1 === 'TroFuse-007 × NCT06345729' && title2.t === 'NCT07190248 × NCT07554339' && /Upper bound/.test(title2.marks), { title0, title1, title2 })
      const live = await page.evaluate(() => ({ cells: document.querySelectorAll('.lp-hero-fig .hg-cell').length, n: document.querySelector('.lp-hero-fig .hg-cell[aria-label^="TroFuse-019 and NCT06623422"] .hg-n')?.innerText, money: [...document.querySelectorAll('.lp-money')].map((x) => x.innerText) }))
      check('hero crop has 21 cells and the ledger values', live.cells === 21 && live.n === '20' && live.money.join(' ') === '$6,568.67 $6,193.66 $6,820.11 $5,500.88', live)
      const credit = await page.evaluate(() => {
        const a = document.querySelector('.lp-foot a[href="https://github.com/CosmicOdyssey/concord"]')
        return { text: a?.parentElement.innerText, href: a?.href }
      })
      check(
        'credit line verbatim with the source link',
        credit.text === 'Built by the Bruno Bears, a team from Brown University, for HackHarvard 2026, Regeneron track. · Source code: github.com/CosmicOdyssey/concord',
        credit,
      )
      await page.click('.lp .theme-seg button[aria-label="Dark theme"]')
      await sleep(200)
      const th = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem('concord.theme'), bg: getComputedStyle(document.body).backgroundColor }))
      check('landing theme switch', th.theme === 'dark' && th.stored === 'dark' && th.bg === 'rgb(12, 19, 23)', th)
      check('no page errors on the landing page', page.__errors.length === 0, page.__errors.slice(0, 3))
      await ctx.close()
    }

    // 7. Hover cards open on keyboard focus and on tap.
    {
      const { ctx, page } = await fresh(browser)
      await page.goto(`${BASE}/#dev/components`, { waitUntil: 'networkidle0' })
      // Tab into the trigger (keyboard focus is :focus-visible; a programmatic focus may not be).
      await page.waitForSelector('.view .density-seg button', { timeout: 30000 })
      const order = await page.evaluate(() => [...document.querySelectorAll('button, a[href], select, input')].indexOf(document.querySelector('button[aria-label="About the plain tip"]')))
      await page.focus('.view .density-seg button')
      let opened = false
      for (let i = 0; i < 40 && !opened; i++) {
        await page.keyboard.press('Tab')
        opened = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'About the plain tip')
      }
      await sleep(200)
      const kb = await page.evaluate(() => {
        const t = document.activeElement
        const c = document.getElementById(t.getAttribute('aria-describedby'))
        return { focused: t.getAttribute('aria-label'), open: c && !c.hidden }
      })
      check('hover card opens on keyboard focus', kb.focused === 'About the plain tip' && kb.open, { ...kb, order })
      await ctx.close()
      const tc = await fresh(browser, { width: 390, height: 844, touch: true })
      await tc.page.goto(`${BASE}/#dev/components`, { waitUntil: 'networkidle0' })
      await tc.page.tap('button[aria-label="About the plain tip"]')
      await sleep(250)
      const tap = await tc.page.evaluate(() => {
        const t = document.querySelector('button[aria-label="About the plain tip"]')
        const c = document.getElementById(t.getAttribute('aria-describedby'))
        const r = t.getBoundingClientRect()
        const hit = getComputedStyle(t, '::after')
        return { open: c && !c.hidden, hitW: hit.width, hitH: hit.height, icon: `${Math.round(r.width)}x${Math.round(r.height)}` }
      })
      check('hover card opens on tap; the icon has a 44 px hit area on touch', tap.open && parseFloat(tap.hitW) >= 44 && parseFloat(tap.hitH) >= 44, tap)
      await tc.ctx.close()
    }

    // 9. Research run status (plumbing review issues 2 and 5): it shows in the page, and the header keeps its height.
    for (const width of [390, 700, 1440]) {
      const { ctx, page } = await fresh(browser, { width, height: 900, touch: width < 600 })
      const headerH = () =>
        page.evaluate(() => {
          const a = document.querySelector('.appbar')
          const one = getComputedStyle(a).display !== 'contents'
          return Math.round((one ? a.getBoundingClientRect().height : document.querySelector('.appbar-top').getBoundingClientRect().height + document.querySelector('nav.tabs').getBoundingClientRect().height) * 10) / 10
        })
      await page.goto(`${BASE}/#findings`, { waitUntil: 'networkidle0' })
      const h0 = await headerH()
      await page.goto(`${BASE}/#research/clear`, { waitUntil: 'networkidle0' })
      await page.waitForFunction(() => /Clear failed|Clearing/.test(document.querySelector('.run-status')?.innerText ?? ''), { timeout: 30000 })
      const st = await page.evaluate(() => ({ text: document.querySelector('.run-status').innerText.trim(), inMain: !!document.querySelector('main .run-status') }))
      const h1 = await headerH()
      check(`Research run status at ${width}: in the page, header height unchanged`, st.inMain && h0 === h1, { ...st, h0, h1 })
      if (width === 390) await page.screenshot({ path: path.join(OUT, 'research-clear-status-390.png').replace(/\\/g, '/') })
      await ctx.close()
    }

    // 8. Phone header: one row of controls, the tab bar sticks, no horizontal scroll at 320.
    {
      const { ctx, page } = await fresh(browser, { width: 320, height: 700, touch: true })
      await page.goto(`${BASE}/#site-scores`, { waitUntil: 'networkidle0' })
      await sleep(800)
      const top = await page.evaluate(() => ({ h: Math.round(document.querySelector('.appbar-top').getBoundingClientRect().height), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      await page.evaluate(() => window.scrollTo(0, 1500))
      await sleep(300)
      const stuck = await page.evaluate(() => Math.round(document.querySelector('nav.tabs').getBoundingClientRect().top))
      check('phone 320: controls on one row, tab bar sticks, no horizontal scroll', top.h < 70 && stuck === 0 && top.sw <= top.cw, { ...top, tabsTop: stuck })
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
  fs.writeFileSync(path.join(OUT, 'interactions.json'), JSON.stringify(results, null, 1))
  const fails = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - fails}/${results.length} passed`)
})()
