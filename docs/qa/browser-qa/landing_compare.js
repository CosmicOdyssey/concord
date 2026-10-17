// Landing section "How Concord compares" (#landing-compare, track terms-compare): placement above What we tested, the
// header link and #home/compare deep link, the Simple matrix (8 products + Concord x 6 columns) and the Detailed one
// (18 rows covering 20 products + Concord x 13), the Concord row as in docs/competitive-landscape.md, accessible marks
// (text, not colour alone; text contrast), hover / focus / tap cards with the quote and a source link, every link with
// an href and rel=noopener, Simple vs Detailed, light and dark, 1440 and 390, no horizontal page scroll, no errors.
// usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node landing_compare.js [base] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep, layoutCheck } = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5290'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/compare'
fs.mkdirSync(OUT, { recursive: true })

const SIMPLE_ROWS = [
  'Concord',
  'IQVIA GrantPlan',
  'Medidata Grants Manager',
  'Suvoda (Greenphire)',
  'UpSite TrialPro',
  'Advarra OnCore',
  'Veeva SiteVault',
  'WCG services',
  'Evinova',
]
const SIMPLE_COLS = [
  'Per-patient budget from a protocol or SoA',
  'Benchmarks prices against a database',
  'Coverage analysis or billing grid (NCD 310.1)',
  'Medicare fee-schedule prices with locality adjustment',
  'Share of the budget anchored to public rates',
  'Explains geographic price differences between sites',
]
// The document's Concord row, columns 1-13; Simple shows 1, 2, 3, 4, 6, 7.
const CONCORD = ['Partial', 'Partial', 'Yes, draft', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes, lung only', 'Partial', 'No', 'No', 'Yes', 'Partial']

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
  await sleep(600)
}

/** The open hover card's text and links, or null. */
const openCard = (page) =>
  page.evaluate(() => {
    const c = [...document.querySelectorAll('.hc-card')].find((x) => !x.hidden)
    if (!c) return null
    const r = c.getBoundingClientRect()
    return {
      text: c.innerText,
      links: [...c.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), rel: a.getAttribute('rel'), target: a.getAttribute('target') })),
      inView: r.left >= 0 && r.right <= document.documentElement.clientWidth + 1,
    }
  })

;(async () => {
  const browser = await launch()
  try {
    for (const width of [1440, 390])
      for (const theme of ['light', 'dark'])
        for (const density of ['simple', 'detailed']) {
          const tag = `${width}-${theme}-${density}`
          const detailed = density === 'detailed'
          const { ctx, page } = await open(browser, { width, theme, density })
          await page.goto(`${BASE}/#home/compare`, { waitUntil: 'domcontentloaded', timeout: 90000 })
          await page.waitForSelector('#landing-compare .cmp-tbl', { timeout: 30000 })
          await settle(page)
          const r = await page.evaluate(() => {
            const de = document.documentElement
            const q = (s) => document.querySelector(s)
            const sec = q('#landing-compare')
            const txt = (el) => (el ? el.innerText.replace(/\s+/g, ' ').trim() : '')
            // Visible text only (screen-reader-only spans removed).
            const seen = (el) => {
              if (!el) return ''
              const c = el.cloneNode(true)
              c.querySelectorAll('.sr-only').forEach((x) => x.remove())
              return c.textContent.replace(/\s+/g, ' ').trim()
            }
            const tbl = sec.querySelector('.cmp-tbl')
            const rows = [...tbl.querySelectorAll('tbody tr')]
            const scrollEl = sec.querySelector('.cmp-scroll')
            const scroller = scrollEl.getBoundingClientRect()
            const hintEl = sec.querySelector('.cmp-scroll-hint')
            // WCAG contrast of an element's text against the first opaque background behind it.
            const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number)
            const lum = ([r, g, b]) => {
              const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
              return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
            }
            const bgOf = (el) => {
              for (let a = el; a; a = a.parentElement) {
                const c = rgb(getComputedStyle(a).backgroundColor)
                if (c.length >= 3 && (c.length === 3 || c[3] > 0.5)) return c.slice(0, 3)
              }
              return [255, 255, 255]
            }
            const ratio = (el) => {
              const a = lum(rgb(getComputedStyle(el).color).slice(0, 3))
              const b = lum(bgOf(el))
              return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
            }
            const lowContrast = [...sec.querySelectorAll('.cmp-word, .cmp-none, .cmp-no, .cmp-users, .cmp-key, .cmp-caveat, .cmp-legend, .cmp-pain-t, .cmp-pain-src, .cmp-colh, a.cmp-link')]
              .filter((el) => el.getClientRects().length)
              .map((el) => ({ cls: el.className, r: Math.round(ratio(el) * 100) / 100 }))
              .filter((x) => x.r < 4.5)
            const links = [...sec.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), rel: a.getAttribute('rel') || '', target: a.getAttribute('target') }))
            return {
              theme: de.dataset.theme,
              density: de.dataset.density,
              sections: [...document.querySelectorAll('#landing-main > section')].map((s) => s.id || s.className.split(' ')[0]),
              nav: [...document.querySelectorAll('.lp-nav a')].map((a) => `${a.innerText.trim()}|${a.getAttribute('href')}`),
              top: Math.round(sec.getBoundingClientRect().top),
              h2: txt(q('#lp-h-compare')),
              body: txt(sec.querySelector('.lp-body')),
              rowNames: rows.map((tr) => txt(tr.querySelector('.cmp-name'))),
              colHeads: [...tbl.querySelectorAll('thead .cmp-colh')].map((th) => txt(th)),
              concord: [...rows[0].querySelectorAll('td')].map((td) => seen(td.querySelector('.cmp-word, .cmp-no, .cmp-none'))),
              cells: rows.reduce((n, tr) => n + tr.querySelectorAll('td').length, 0),
              cellsWithMark: rows.reduce((n, tr) => n + [...tr.querySelectorAll('td')].filter((td) => td.querySelector('.cmp-mark') && txt(td)).length, 0),
              buttons: [...tbl.querySelectorAll('button.cmp-btn')].map((b) => b.getAttribute('aria-label')),
              noneSr: [...tbl.querySelectorAll('.cmp-none .sr-only')].every((s) => s.textContent === 'Not stated publicly'),
              legend: txt(sec.querySelector('.cmp-legend')),
              diffs: sec.querySelectorAll('.cmp-grid > .cmp-block:first-child > .cmp-list > li').length,
              theyDo: txt([...sec.querySelectorAll('.cmp-h3')].find((h) => /What they have|They do/.test(h.innerText))?.parentElement),
              pain: [...sec.querySelectorAll('.cmp-pain-item')].map((x) => txt(x)),
              painRows: sec.querySelectorAll('.cmp-pain-tbl tbody tr').length,
              notUnique: !!sec.querySelector('.cmp-grid') && /Not unique/.test(sec.innerText),
              method: /Epic's research billing/.test(sec.innerText) && /Rule used throughout/.test(sec.innerText),
              sourcesDetails: sec.querySelectorAll('details.cmp-details').length,
              links,
              lowContrast,
              scrollerFits: scroller.left >= -1 && scroller.right <= de.clientWidth + 1,
              // The table inside the box: wider than the box means it scrolls sideways, and the hint must say so.
              inner: [scrollEl.scrollWidth, scrollEl.clientWidth],
              innerOverflows: scrollEl.scrollWidth > scrollEl.clientWidth + 1,
              hint: hintEl && hintEl.getClientRects().length > 0 ? txt(hintEl) : '',
              capsList: [...sec.querySelectorAll('.cmp-legend .cmp-caps li')].map((li) => txt(li)),
              simpleCaveats: [...sec.querySelectorAll('.cmp-caveat')].map((x) => txt(x)),
              hscroll: de.scrollWidth > de.clientWidth + 1,
              scrollWidth: de.scrollWidth,
              clientWidth: de.clientWidth,
              checkedDate: /checked 17 Oct 2026/i.test(sec.innerText),
            }
          })
          check(`${tag}: theme and density applied`, r.theme === theme && r.density === density, [r.theme, r.density])
          check(
            `${tag}: section order hero, Protocol to terms, Portfolio overlap, How Concord compares, What we tested`,
            r.sections.slice(0, 5).join(',') === 'lp-hero,landing-terms,landing-overlap,landing-compare,landing-tested',
            r.sections,
          )
          check(
            `${tag}: header link How we compare between Portfolio overlap and What we tested`,
            r.nav.join(',') === 'Protocol to terms|#home/terms,Portfolio overlap|#home/overlap,How we compare|#home/compare,What we tested|#home/tested',
            r.nav,
          )
          check(`${tag}: #home/compare opens at the section`, Math.abs(r.top) < 90, r.top)
          check(`${tag}: heading, sentence and checked date`, r.h2 === 'How Concord compares' && /proprietary data and human services/.test(r.body) && r.checkedDate, r.body)
          if (detailed) {
            check(`${tag}: full matrix, Concord + 18 rows x 13 capabilities`, r.rowNames.length === 19 && r.colHeads.length === 13 && r.rowNames[0] === 'Concord', {
              rows: r.rowNames.length,
              cols: r.colHeads.length,
            })
            check(`${tag}: Concord row as in the document (no for site payments and CTA redlining; lung only)`, r.concord.join('|') === CONCORD.join('|'), r.concord)
          } else {
            check(`${tag}: Simple matrix: Concord + 8 products`, r.rowNames.join('|') === SIMPLE_ROWS.join('|'), r.rowNames)
            check(`${tag}: Simple columns`, r.colHeads.join('|') === SIMPLE_COLS.join('|'), r.colHeads)
            check(`${tag}: Concord row (columns 1, 2, 3, 4, 6, 7)`, r.concord.join('|') === [0, 1, 2, 3, 5, 6].map((i) => CONCORD[i]).join('|'), r.concord)
          }
          check(
            `${tag}: every cell shows a text mark, not colour alone; dashes read "Not stated publicly"`,
            r.cells === r.cellsWithMark && r.noneSr && r.buttons.every((l) => /^(Yes|Partial)/.test(l) && /Evidence [A-Z]+\d+$/.test(l)),
            { cells: r.cells, marked: r.cellsWithMark, buttons: r.buttons.length },
          )
          check(`${tag}: legend: - means not stated publicly, not that the product lacks it`, /not stated publicly, not that the product lacks it/.test(r.legend), r.legend)
          check(`${tag}: five differentiators`, r.diffs === 5, r.diffs)
          check(
            `${tag}: what they have that we don't`,
            /Negotiated-price benchmarks/.test(r.theyDo) && /site payments|Site payments/.test(r.theyDo) && /CTA redlining/.test(r.theyDo) && /U\.S\. Medicare/.test(r.theyDo),
            r.theyDo.slice(0, 200),
          )
          if (detailed) {
            check(`${tag}: all 14 verified pain rows, not-unique list, method notes, evidence and sources`, r.painRows === 14 && r.notUnique && r.method && r.sourcesDetails === 2, {
              painRows: r.painRows,
              notUnique: r.notUnique,
              method: r.method,
              details: r.sourcesDetails,
            })
          } else {
            check(
              `${tag}: three pain numbers with sources (59% keeps the document's "derived" qualifier)`,
              r.pain.length === 3 &&
                /^73%/.test(r.pain[0]) &&
                /611 sites/.test(r.pain[0]) &&
                /^53%/.test(r.pain[1]) &&
                /^59%/.test(r.pain[2]) &&
                /\(derived: 41% declined none\)/.test(r.pain[2]),
              r.pain,
            )
          }
          const badLinks = r.links.filter((l) => !l.href || (l.target === '_blank' && !/\bnoopener\b/.test(l.rel)) || !/^(https:\/\/|#)/.test(l.href))
          check(`${tag}: every link has an href; new-tab links have rel=noopener`, r.links.length > 0 && badLinks.length === 0, { n: r.links.length, bad: badLinks.slice(0, 3) })
          check(`${tag}: text contrast at least 4.5:1`, r.lowContrast.length === 0, r.lowContrast.slice(0, 5))
          check(`${tag}: matrix box fits the screen (scrolls inside it)`, r.scrollerFits)
          if (width === 1440) check(`${tag}: every column fits inside the matrix box (no clipped column)`, !r.innerOverflows, r.inner)
          check(
            `${tag}: the "scroll sideways" hint shows exactly when the table is wider than its box`,
            r.innerOverflows ? /Scroll the table sideways/.test(r.hint) : r.hint === '',
            { inner: r.inner, hint: r.hint },
          )
          check(
            `${tag}: the legend lists every column's full name (${detailed ? 'all 13' : 'the 6 shown, in order'})`,
            detailed
              ? r.capsList.length === 13
              : r.capsList.length === 6 &&
                  /^Builds a per-patient budget/.test(r.capsList[0]) &&
                  /routine care vs research, NCD 310\.1/.test(r.capsList[2]) &&
                  /anchored to public rates vs negotiated/.test(r.capsList[4]),
            r.capsList,
          )
          if (!detailed)
            check(`${tag}: Simple caveats carry no evidence keys`, r.simpleCaveats.length === 4 && r.simpleCaveats.every((c) => !/\([A-Z]+\d+\)/.test(c)), r.simpleCaveats)
          check(`${tag}: no horizontal page scroll`, !r.hscroll, [r.scrollWidth, r.clientWidth])
          if (r.hscroll) console.log('  offenders', JSON.stringify((await layoutCheck(page)).offenders.slice(0, 6)))

          // A mark's card: hover (mouse) or tap (phone) on IQVIA's first cell.
          const first = '#landing-compare tbody tr:nth-child(2) button.cmp-btn'
          await page.$eval(first, (b) => b.scrollIntoView({ block: 'center' }))
          if (width < 600) await page.tap(first)
          else await page.hover(first)
          await sleep(500)
          const card = await openCard(page)
          check(
            `${tag}: ${width < 600 ? 'tap' : 'hover'} opens the card with the quote and a source link`,
            !!card && /"/.test(card.text) && /IQVIA/.test(card.text) && card.links.length > 0 && card.links.every((l) => /^https:\/\//.test(l.href) && /\bnoopener\b/.test(l.rel)) && card.inView,
            card && { text: card.text.slice(0, 140), links: card.links, inView: card.inView },
          )
          await page.mouse.move(2, 2)
          await page.keyboard.press('Escape')
          await sleep(250)

          await page.addStyleTag({ content: '.lp-head{position:static!important}' })
          await (await page.$('#landing-compare')).screenshot({ path: path.join(OUT, `compare-${tag}.png`) })
          await page.screenshot({ path: path.join(OUT, `compare-${tag}-viewport.png`), fullPage: false })
          check(`${tag}: no page or console errors`, page.__errors.length === 0, page.__errors.slice(0, 3))
          await ctx.close()
        }

    // Keyboard: focus a mark, the card opens; Tab moves into the card's link; Escape closes and returns focus.
    for (const theme of ['light', 'dark']) {
      const { ctx, page } = await open(browser, { width: 1440, theme, density: 'simple' })
      await page.goto(`${BASE}/#home/compare`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('#landing-compare .cmp-tbl', { timeout: 30000 })
      await settle(page)
      // Reach the first mark with the keyboard: focus the element before it, then Tab.
      await page.evaluate(() => {
        const t = document.querySelector('#landing-compare .cmp-tbl')
        const prev = document.createElement('button')
        prev.id = 'qa-before'
        prev.textContent = 'before'
        t.parentElement.insertBefore(prev, t)
        prev.focus()
      })
      await page.keyboard.press('Tab')
      await sleep(400)
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
      const c1 = await openCard(page)
      check(`keyboard ${theme}: Tab to a mark opens its card`, /^Partial: Concord/.test(focused ?? '') && !!c1 && /K1/.test(c1.text), { focused, card: c1?.text.slice(0, 100) })
      await page.keyboard.press('Tab')
      await sleep(200)
      const inCard = await page.evaluate(() => {
        const a = document.activeElement
        return { inCard: !!a?.closest('.hc-card'), tag: a?.tagName, href: a?.getAttribute('href'), rel: a?.getAttribute('rel') }
      })
      check(`keyboard ${theme}: Tab moves into the card's source link`, inCard.inCard && inCard.tag === 'A' && /^https:\/\//.test(inCard.href) && /noopener/.test(inCard.rel), inCard)
      await page.screenshot({ path: path.join(OUT, `compare-keyboard-card-${theme}.png`), fullPage: false })
      await page.keyboard.press('Escape')
      await sleep(250)
      const after = await page.evaluate(() => ({ open: [...document.querySelectorAll('.hc-card')].some((x) => !x.hidden), focus: document.activeElement?.getAttribute('aria-label') }))
      check(`keyboard ${theme}: Escape closes the card and returns focus to the mark`, !after.open && /^Partial: Concord/.test(after.focus ?? ''), after)

      // Simple -> Detailed with the header control.
      await page.evaluate(() => [...document.querySelectorAll('.density-seg button')].find((b) => b.innerText.trim() === 'Detailed').click())
      await sleep(400)
      const n = await page.evaluate(() => [document.querySelectorAll('#landing-compare .cmp-tbl tbody tr').length, document.querySelectorAll('#landing-compare .cmp-tbl thead .cmp-colh').length])
      check(`density ${theme}: switching to Detailed shows 19 rows x 13 columns`, n[0] === 19 && n[1] === 13, n)
      // A narrower desktop: the 13 columns no longer fit, so the table scrolls inside its box and the hint appears.
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
      await sleep(500)
      const narrow = await page.evaluate(() => {
        const b = document.querySelector('#landing-compare .cmp-scroll')
        const h = document.querySelector('#landing-compare .cmp-scroll-hint')
        const de = document.documentElement
        return { inner: [b.scrollWidth, b.clientWidth], hint: h && h.getClientRects().length ? h.innerText.trim() : '', hscroll: de.scrollWidth > de.clientWidth + 1 }
      })
      check(
        `density ${theme}: Detailed at 1280 scrolls inside the box and shows the scroll hint, no page scroll`,
        narrow.inner[0] > narrow.inner[1] && /Scroll the table sideways/.test(narrow.hint) && !narrow.hscroll,
        narrow,
      )
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
      await sleep(300)
      // The header link scrolls to the section.
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.click('.lp-nav a[href="#home/compare"]')
      await sleep(1200)
      const nav = await page.evaluate(() => ({ hash: location.hash, top: Math.round(document.getElementById('landing-compare').getBoundingClientRect().top) }))
      check(`nav ${theme}: How we compare link goes to #home/compare`, nav.hash === '#home/compare' && Math.abs(nav.top) < 90, nav)
      check(`interactions ${theme}: no page or console errors`, page.__errors.length === 0, page.__errors.slice(0, 3))
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
  fs.writeFileSync(path.join(OUT, 'landing_compare.json'), JSON.stringify(results, null, 1))
  const bad = results.filter((r) => !r.ok)
  console.log(`\n${results.length} checks, ${bad.length} failed`)
  process.exitCode = bad.length ? 1 : 0
})()
