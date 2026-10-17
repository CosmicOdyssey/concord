// Landing page that leads with Protocol to terms (track S1): copy, section order, header order, the live terms
// fragment, the Regeneron overlap preview with the fianlimab pair, Simple and Detailed, light and dark, 1440 and 390;
// no horizontal page scroll; no page or console errors. Also the app header: Protocol to terms is the first tab.
// usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node landing_terms.js [base] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep } = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5281'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/landing'
fs.mkdirSync(OUT, { recursive: true })

const H1 = 'Turn a trial protocol into a budget both sides can check.'
const SUB =
  'Concord prices every procedure from public Medicare rates, separates what insurance covers from what the sponsor pays, and shows how much of the budget is settled before anyone negotiates. Demonstrated on lung cancer trials from ClinicalTrials.gov.'
const TABS = ['Protocol to terms', 'Portfolio overlap', 'Findings', 'Site scores', 'Research']

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

async function open(browser, { width, theme, density }) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  const phone = width < 600
  await page.setViewport({ width, height: phone ? 844 : 900, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone })
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
  page.__errors = []
  page.on('pageerror', (e) => page.__errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') page.__errors.push(`console: ${m.text()}`)
  })
  return { ctx, page }
}

async function settle(page) {
  try {
    await page.waitForNetworkIdle({ idleTime: 600, timeout: 30000 })
  } catch {
    /* keep going */
  }
  await page.evaluate(() => document.fonts && document.fonts.ready)
  await sleep(700)
}

;(async () => {
  const browser = await launch()
  try {
    for (const width of [1440, 390])
      for (const theme of ['light', 'dark'])
        for (const density of ['simple', 'detailed']) {
          const tag = `${width}-${theme}-${density}`
          const { ctx, page } = await open(browser, { width, theme, density })
          await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 })
          await page.waitForSelector('.lp-paircard', { timeout: 30000 })
          await settle(page)
          const r = await page.evaluate(() => {
            const de = document.documentElement
            const q = (s) => document.querySelector(s)
            const sections = [...document.querySelectorAll('#landing-main > section')].map((s) => s.id || s.className.split(' ')[0])
            return {
              hash: location.hash,
              theme: de.dataset.theme,
              density: de.dataset.density,
              h1: q('#lp-h1')?.innerText.trim(),
              sub: q('.lp-sub')?.innerText.trim().replace(/\s+/g, ' '),
              sections,
              nav: [...document.querySelectorAll('.lp-nav a')].map((a) => `${a.innerText.trim()}|${a.getAttribute('href')}`),
              headCta: [q('.lp-head .lp-demo')?.innerText.trim(), q('.lp-head .lp-demo')?.getAttribute('href')],
              headCtaShown: !!q('.lp-head .lp-demo') && getComputedStyle(q('.lp-head .lp-demo')).display !== 'none',
              publicLine: q('#landing-terms .lp-public')?.innerText.replace(/\s+/g, ' ') ?? '',
              proto: q('#landing-terms .lp-proto')?.innerText.replace(/\s+/g, ' ') ?? '',
              heroCta: [...document.querySelectorAll('.lp-hero .lp-actions a')].map((a) => `${a.innerText.trim()}|${a.getAttribute('href')}`),
              money: [...document.querySelectorAll('.lp-money')].map((x) => x.innerText),
              illustrative: q('#landing-terms .lp-caution')?.innerText,
              fmv: /Decision support, not a fair-market-value legal opinion\./.test(q('#landing-terms')?.innerText ?? ''),
              sheet: !!q('.lp-sheet'),
              cardTitle: q('.lp-paircard-title')?.innerText.trim(),
              cardFigs: [...document.querySelectorAll('.lp-paircard .lp-fig')].map((x) => x.innerText.trim()),
              cardFoot: q('.lp-paircard-foot')?.innerText,
              legend: q('.lp-legend')?.innerText.replace(/\s+/g, ' '),
              figcap: q('.lp-figcap')?.innerText,
              cells: document.querySelectorAll('.lp-cell').length,
              strip: q('#landing-overlap .win-strip')?.innerText.replace(/\s+/g, ' '),
              crit: !!q('.lp-crit'),
              tested: !!q('#landing-tested .lp-results'),
              credit: /Bruno Bears/.test(q('.lp-foot-credit')?.innerText ?? ''),
              hscroll: de.scrollWidth > de.clientWidth + 1,
              scrollWidth: de.scrollWidth,
              clientWidth: de.clientWidth,
            }
          })
          check(`${tag}: theme and density applied`, r.theme === theme && r.density === density, [r.theme, r.density])
          check(`${tag}: empty hash shows the landing`, r.hash === '' && !!r.h1)
          check(`${tag}: hero headline and subhead verbatim`, r.h1 === H1 && r.sub === SUB, { h1: r.h1, sub: r.sub })
          check(`${tag}: sections: hero, Protocol to terms, Portfolio overlap, What we tested`, r.sections.slice(0, 4).join(',') === 'lp-hero,landing-terms,landing-overlap,landing-tested', r.sections)
          // Phones (640 px or less) hide the header's copy of the primary action: the hero's identical button is the first
          // thing on the page. Wider screens show it in the sticky header.
          check(
            `${tag}: header nav order and primary action (${width > 640 ? 'shown in the header' : 'hidden in the header; the hero button carries it'})`,
            r.nav.join(',') === 'Protocol to terms|#home/terms,Portfolio overlap|#home/overlap,What we tested|#home/tested' &&
              r.headCta[1] === '#terms-flow' &&
              r.headCtaShown === width > 640,
            { nav: r.nav, cta: r.headCta, shown: r.headCtaShown },
          )
          check(`${tag}: hero primary goes to #terms-flow, one quiet secondary`, r.heroCta.length === 2 && r.heroCta[0].endsWith('|#terms-flow') && /Protocol to terms/.test(r.heroCta[0]), r.heroCta)
          check(`${tag}: terms fragment (live) and its marks`, r.money.length === 4 && r.illustrative === 'Illustrative, authored from public trial information' && r.fmv, { money: r.money, ill: r.illustrative })
          check(`${tag}: term-sheet line only in Detailed`, r.sheet === (density === 'detailed'))
          // How much of the sponsor total is priced from public CMS fee schedules: recomputed here from the comparison API.
          {
            const want = await page.evaluate(async () => {
              const c = await (await fetch('/api/terms-flow/NCT05800015/compare?site_a=334d690736c4&site_b=0bf11037dddd&multiplier=1')).json()
              const usd = (x) => x.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
              const side = (k) => {
                const t = c[k].totals
                const cms = Math.round(c.rows.filter((x) => x.schedule === 'PFS' || x.schedule === 'CLFS').reduce((s, x) => s + x[k === 'a' ? 'unit_a' : 'unit_b'] * x.n_fixed, 0) * 100) / 100
                return { cms: usd(cms), rest: usd(t.per_participant - cms), total: usd(t.per_participant), pct: `${Math.round((cms / t.per_participant) * 100)}%` }
              }
              return { a: side('a'), b: side('b') }
            })
            const L = r.publicLine
            const okA = L.includes(want.a.cms) && L.includes(want.a.total) && L.includes(want.a.pct) && L.includes(want.a.rest)
            const okB = density === 'simple' || (L.includes(want.b.cms) && L.includes(want.b.total) && L.includes(want.b.pct))
            check(`${tag}: public-source share of the sponsor total (from the API) with the assumption label`, okA && okB && /CMS 2026 fee/.test(L) && /assumption/.test(L), { line: L, want })
          }
          check(`${tag}: Terms window names the protocol by its official-title paraphrase`, /vs cemiplimab \+ chemotherapy/.test(r.proto) && !/placebo/.test(r.proto), r.proto)
          check(`${tag}: overlap preview is the Regeneron preset with the fianlimab pair`, r.cardTitle === 'NCT05785767 × NCT05800015' && r.cells === 10 && /Regeneron Pharmaceuticals · Sep 1, 2024/.test(r.strip), {
            title: r.cardTitle,
            figs: r.cardFigs,
            cells: r.cells,
            strip: r.strip,
          })
          check(`${tag}: fianlimab pair numbers`, r.cardFigs.join(',') === '16,100%,26%', r.cardFigs)
          check(
            `${tag}: overlap honesty marks visible`,
            /synthetic population/.test(r.cardFoot) &&
              /Registered sites, not confirmed enrolling/.test(r.cardFoot) &&
              /Upper bound/.test(r.legend) &&
              /estimated/.test(r.figcap) &&
              /assumption/.test(r.figcap) &&
              (density === 'simple' || /65%/.test(r.figcap)) &&
              /not sites confirmed enrolling/.test(r.figcap),
            { foot: r.cardFoot, legend: r.legend, figcap: r.figcap },
          )
          check(`${tag}: criteria only in Detailed`, r.crit === (density === 'detailed'))
          check(`${tag}: What we tested and the credit line stay`, r.tested && r.credit)
          check(`${tag}: no horizontal page scroll`, !r.hscroll, [r.scrollWidth, r.clientWidth])
          await page.screenshot({ path: path.join(OUT, `landing-${tag}.png`), fullPage: true })
          await page.screenshot({ path: path.join(OUT, `landing-${tag}-top.png`), fullPage: false })
          // Element shots: unstick the header first so it is not painted over the section.
          await page.addStyleTag({ content: '.lp-head{position:static!important}' })
          for (const s of ['terms', 'overlap']) await (await page.$(`#landing-${s}`)).screenshot({ path: path.join(OUT, `landing-${tag}-${s}.png`) })
          check(`${tag}: no page or console errors`, page.__errors.length === 0, page.__errors.slice(0, 3))
          await ctx.close()
        }

    // Keyboard and hover on the preview; the primary action opens Protocol to terms; the app header.
    {
      const { ctx, page } = await open(browser, { width: 1440, theme: 'light', density: 'simple' })
      await page.goto(`${BASE}/#home/overlap`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.lp-paircard', { timeout: 30000 })
      await settle(page)
      const top = await page.evaluate(() => Math.round(document.getElementById('landing-overlap').getBoundingClientRect().top))
      check('#home/overlap opens the landing at Portfolio overlap', Math.abs(top) < 90, { top })
      await page.focus('.lp-cell[aria-label^="NCT05785767 and NCT06161441"]')
      await sleep(200)
      const t1 = await page.$eval('.lp-paircard-title', (e) => e.innerText.trim())
      const other = await page.$('.lp-cell[aria-label^="NCT05557591 and NCT05785767"]')
      await other.hover()
      await sleep(250)
      const t2 = await page.$eval('.lp-paircard-title', (e) => e.innerText.trim())
      check('preview: keyboard focus and hover show that pair', t1 === 'NCT05785767 × NCT06161441' && t2 === 'NCT05557591 × NCT05785767', { t1, t2 })
      const src = await page.$('#landing-terms .lp-terms-lead button')
      await src.hover()
      await sleep(500)
      const card = await page.evaluate(() => [...document.querySelectorAll('.hc-card')].find((x) => !x.hidden)?.innerText ?? '')
      check('terms sources hover card names CMS files and the assumption', /rvu26d\.zip/.test(card) && /Clinical Laboratory Fee Schedule/.test(card) && /Assumption/.test(card), card.slice(0, 160))
      await page.mouse.move(5, 5)
      await page.click('.lp-hero .lp-cta')
      await page.waitForSelector('nav.tabs', { timeout: 30000 })
      await settle(page)
      const app = await page.evaluate(() => ({
        hash: location.hash,
        tabs: [...document.querySelectorAll('nav.tabs .tab-label')].map((x) => x.innerText.trim()),
        active: document.querySelector('nav.tabs [aria-selected="true"] .tab-label')?.innerText.trim(),
      }))
      check('primary action opens Protocol to terms', /^#terms-flow\b/.test(app.hash) && app.active === 'Protocol to terms', app)
      check('app tab order', JSON.stringify(app.tabs) === JSON.stringify(TABS), app.tabs)
      check('Financial stays out of the main navigation', !app.tabs.some((t) => /Financial/i.test(t)), app.tabs)
      check('no page or console errors (interactions)', page.__errors.length === 0, page.__errors.slice(0, 3))
      await ctx.close()
    }
    // The preview's link opens the Portfolio overlap tab on the same preset, with the fianlimab pair selected.
    {
      const { ctx, page } = await open(browser, { width: 1440, theme: 'light', density: 'simple' })
      await page.goto(`${BASE}/#home/overlap`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.lp-paircard', { timeout: 30000 })
      await settle(page)
      await page.click('#landing-overlap a.lp-open')
      await page.waitForSelector('nav.tabs', { timeout: 30000 })
      await settle(page)
      const ov = await page.evaluate(() => ({
        hash: location.hash,
        active: document.querySelector('nav.tabs [aria-selected="true"] .tab-label')?.innerText.trim(),
        text: document.querySelector('main')?.innerText ?? '',
      }))
      check(
        'preview link opens Portfolio overlap on the Regeneron preset with the fianlimab pair',
        ov.hash === '#overlap/regeneron' && ov.active === 'Portfolio overlap' && /Regeneron/.test(ov.text) && /NCT05785767/.test(ov.text) && /NCT05800015/.test(ov.text),
        { hash: ov.hash, active: ov.active },
      )
      check('no page or console errors (preview link)', page.__errors.length === 0, page.__errors.slice(0, 3))
      await ctx.close()
    }
    for (const width of [1440, 390])
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await open(browser, { width, theme, density: 'simple' })
        await page.goto(`${BASE}/#terms-flow`, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('nav.tabs', { timeout: 30000 })
        await settle(page)
        const hs = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
        check(`app header ${width} ${theme}: no horizontal page scroll`, !hs)
        await page.screenshot({ path: path.join(OUT, `app-header-${width}-${theme}.png`), clip: { x: 0, y: 0, width, height: width < 600 ? 260 : 200 } })
        check(`app header ${width} ${theme}: no page or console errors`, page.__errors.length === 0, page.__errors.slice(0, 3))
        await ctx.close()
      }
  } finally {
    await browser.close()
  }
  fs.writeFileSync(path.join(OUT, 'landing_terms.json'), JSON.stringify(results, null, 1))
  const bad = results.filter((r) => !r.ok)
  console.log(`\n${results.length} checks, ${bad.length} failed`)
  process.exitCode = bad.length ? 1 : 0
})()
