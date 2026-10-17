// Findings tab QA (Calm layout): screenshots at 1440 and 390, light and dark, Simple and Detailed; no sideways page
// scroll; zero page and console errors; every number on screen checked against a fresh fetch of the same API; the
// honesty marks (95% CI, floored at 0, in-sample / held-out, post hoc, scored by our enrollment model, upper bounds,
// synthetic population) visible in Simple mode; hover cards on hover, keyboard focus and tap; #findings/<id> deep
// links and the on-page index; the Simple | Detailed switch; and the generic fallback when the stored numbers no
// longer match what the copy deck's sentences quote.
// Usage: node findings.js <baseUrl> <outDir>   (NODE_PATH = C:/Users/micha/Projects/concord/data/work/D/node_modules)
//   Env: API (default http://localhost:8000) for the reference fetches.
//   ROUTES=1 also runs the pre-Calm app-routing checks (Research sub-tabs, pre-pivot deep links, the Clear-it pointer
//   to #findings/allocation). They start the two-minute default clear on the backend, so they are opt-in; the routes
//   themselves are also covered by qa1018_routes.js and calm_interactions.js.
// Prints PASS/FAIL lines and writes qa_findings.json next to the screenshots. Exit code 1 on any FAIL.
const L = require('./lib')
const fs = require('fs')

const BASE = process.argv[2] || 'http://localhost:5173'
const DIR = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/R/findings'
const API = process.env.API || 'http://localhost:8000'
fs.mkdirSync(DIR, { recursive: true })

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}
const eq = (name, want, got) => check(name, JSON.stringify(want) === JSON.stringify(got), { want, got })

/** The page typesets "1.42x" as "1.42×" and "-0.093" as "−0.093"; compare on the stored glyphs. */
const norm = (s) => (s == null ? s : String(s).replace(/×/g, 'x').replace(/\u2212/g, '-').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
const typesetX = (s) => s.replace(/(\d)x\b/g, '$1×')

async function apiGet(path) {
  const r = await fetch(API + path)
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }
}

async function newPage(browser, { w = 1440, h = 900, theme = 'light', density = 'simple', routes = {}, blockClear = true } = {}) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  const mobile = w < 600
  await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
  const log = {}
  L.instrument(page, log)
  await page.evaluateOnNewDocument(
    (t, d) => {
      try {
        localStorage.setItem('concord.theme', t)
        localStorage.setItem('concord.density', d)
      } catch {
        /* storage blocked */
      }
    },
    theme,
    density,
  )
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname
    if (path in routes) {
      const r = routes[path]
      req.respond({ status: r.status ?? 200, contentType: 'application/json', body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) })
    } else if (blockClear && path.startsWith('/api/clear')) req.respond({ status: 503, contentType: 'application/json', body: '{"detail":"blocked in QA"}' })
    else req.continue()
  })
  page.__log = log
  page.__ctx = ctx
  return page
}

async function openFindings(page, hash = '#findings') {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelectorAll('.fd-card').length >= 3, { timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  await L.sleep(500)
}

const errorsOf = (page) => ({
  pageerrors: page.__log.pageerrors,
  console: page.__log.console.filter((c) => c.type === 'error'),
})

/** What a block shows outside its Details disclosure / details area, per block id. */
function readBlocks(page) {
  return page.evaluate(() => {
    const t = (el) => (el ? el.innerText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() : null)
    return [...document.querySelectorAll('.fd-card')].map((c) => ({
      id: c.dataset.finding,
      summary: c.dataset.summary,
      h2: t(c.querySelector('h2')),
      info: c.querySelector('.hc-info-lg')?.getAttribute('aria-label') ?? null,
      row: t(c.querySelector('.section-row')),
      lede: t(c.querySelector('.section-lede')),
      quals: t(c.querySelector('.section-quals')),
      caption: t(c.querySelector('.section-figure > figcaption')),
      kf: [...c.querySelectorAll('.kf-value')].map(t),
      squares: c.querySelectorAll('.fd-squares .fd-sq').length,
      squaresUb: c.querySelectorAll('.fd-squares .fd-sq-ub').length,
      squareGroups: [...c.querySelectorAll('.fd-squares .fd-sq-group')].map((g) => [...g.children].map((s) => (s.classList.contains('fd-sq-ub') ? 'u' : 'f')).join('')),
      ciVal: [...c.querySelectorAll('.ci-val')].map(t),
      ciInt: [...c.querySelectorAll('.ci-int')].map(t),
      ciRef: t(c.querySelector('.ci-ref-label')),
      ciItems: c.querySelectorAll('.ci-item').length,
      alNames: [...c.querySelectorAll('.al-name')].map(t),
      alVals: [...c.querySelectorAll('.al-vlab')].map(t),
      alNotes: [...c.querySelectorAll('.al-note')].map(t),
      alVlabSize: [...c.querySelectorAll('.al-vlab')].map((e) => getComputedStyle(e).fontSize),
      figs: [...c.querySelectorAll('.fd-fig')].map(t),
      rowsSub: [...c.querySelectorAll('.fd-rows-sub, .fd-rows-bar')].map(t),
      barWidth: c.querySelector('.fd-bar > span')?.style.width ?? null,
      disclosure: !!c.querySelector('details.section-disclosure'),
      disclosureOpen: !!c.querySelector('details.section-disclosure[open]'),
      detailsInline: !!c.querySelector('.section-details'),
      full: t(c.querySelector('.fd-full')),
      tables: [...c.querySelectorAll('.fd-table-block')].map((b) => ({
        title: t(b.querySelector('.fd-table-title')),
        head: [...b.querySelectorAll('thead th')].map((x) => x.textContent.trim()),
        rows: [...b.querySelectorAll('tbody tr')].map((r) => [...r.children].map(t)),
        notes: [...b.querySelectorAll('.fd-notes li')].map(t),
      })),
      caveats: [...c.querySelectorAll('.fd-caveats li')].map(t),
      sources: [...c.querySelectorAll('.fd-sources li')].map(t),
      sourceHrefs: [...c.querySelectorAll('.fd-sources a')].map((a) => a.getAttribute('href')),
      status: t(c.querySelector('.fd-status-v')),
      statusQual: t(c.querySelector('.section-quals .qual')),
    }))
  })
}

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}

const cell = (f, tableId, rowPrefix, col) => f.tables.find((t) => t.id === tableId)?.rows.find((r) => r[0].startsWith(rowPrefix))?.[col]
const lead = (s) => typesetX(String(s).match(/^\s*(\d+(?:\.\d+)?x)/)?.[1] ?? '')

;(async () => {
  const out = { base: BASE, api: API, runs: {} }
  const apiF = (await apiGet('/api/findings')).body
  const so = (await apiGet('/api/findings/self-overlap')).body
  const F = Object.fromEntries(apiF.findings.map((f) => [f.id, f]))
  const browser = await L.launch()
  try {
    // ------------------------------------------------------------ 1. every width x theme x density
    for (const [w, h] of [
      [1440, 900],
      [390, 844],
    ])
      for (const theme of ['light', 'dark'])
        for (const density of ['simple', 'detailed']) {
          const tag = `${w}_${theme}_${density}`
          const page = await newPage(browser, { w, h, theme, density })
          await openFindings(page)
          const r = { layout: await L.layoutCheck(page) }
          r.theme = await page.evaluate(() => document.documentElement.dataset.theme)
          r.density = await page.evaluate(() => document.documentElement.dataset.density)
          r.shots = [await L.shot(page, DIR, `findings_${tag}`, true), await L.shot(page, DIR, `findings_${tag}_top`, false)]
          r.blocks = await readBlocks(page)
          check(`${tag}: theme and density applied`, r.theme === theme && r.density === density, { theme: r.theme, density: r.density })
          check(`${tag}: no sideways page scroll`, !r.layout.overflow && r.layout.offenders.length === 0, r.layout.offenders)
          const e = errorsOf(page)
          check(`${tag}: 0 page errors, 0 console errors`, e.pageerrors.length === 0 && e.console.length === 0, e)
          r.api = page.__log.api.map((a) => `${a.method} ${new URL(a.url).pathname} ${a.status}`)
          check(`${tag}: only the two findings files are fetched`, r.api.every((a) => /\/api\/findings(\/self-overlap)? 200$/.test(a)), r.api)
          const ids = r.blocks.map((b) => b.id)
          eq(`${tag}: blocks in order (lead first, then findings.json order)`, ['self-overlap', ...apiF.findings.map((f) => f.id)], ids)
          check(`${tag}: every block has the copy-deck summary (numbers match)`, r.blocks.every((b) => b.summary === 'copy'), r.blocks.map((b) => `${b.id}:${b.summary}`))
          check(`${tag}: each block has a "Details: <title>" info button`, r.blocks.every((b) => b.info === `Details: ${b.h2}`), r.blocks.map((b) => [b.h2, b.info]))
          if (density === 'simple')
            check(`${tag}: Simple puts details in a closed disclosure`, r.blocks.every((b) => b.disclosure && !b.disclosureOpen && !b.detailsInline), r.blocks.map((b) => [b.id, b.disclosure, b.detailsInline]))
          else check(`${tag}: Detailed shows details inline`, r.blocks.every((b) => !b.disclosure && b.detailsInline), r.blocks.map((b) => [b.id, b.disclosure, b.detailsInline]))
          out.runs[tag] = r
          await page.__ctx.close()
        }

    // ------------------------------------------------------------ 2. numbers equal the API (Simple, 1440 light)
    {
      const B = Object.fromEntries(out.runs['1440_light_simple'].blocks.map((b) => [b.id, b]))
      const hd = so.headline
      const p = so.parameters
      const lb = B['self-overlap']
      eq('lead: title (copy deck B5.0)', "Some sponsors' own trials share registered sites and eligible patients", lb.h2)
      check(
        'lead: sentence numbers from self_overlap.json',
        lb.lede.includes(`${hd.count} pairs of trials from the same sponsor, across ${hd.sponsors} sponsors`) &&
          lb.lede.includes(`at least ${p.min_shared_sites} registered sites`) &&
          lb.lede.includes(`at least ${Math.round(p.min_overlap_one_direction * 100)}% of one trial's eligible patients`) &&
          lb.lede.includes('synthetic population'),
        lb.lede,
      )
      check('lead: upper-bound qualifier visible next to the count', lb.quals.includes(`${hd.upper_bound_count} of the ${hd.count} are upper bounds`) && lb.quals.includes('hand-encoded'), lb.quals)
      check('lead: does not lead with the broad count', !lb.row.includes(String(so.count)), lb.row)
      eq('lead: key figures', [String(hd.count), String(hd.sponsors)], lb.kf)
      check('lead: upper-bound figure', lb.row.includes(`† ${hd.upper_bound_count} upper bounds`), lb.row)
      const hand = so.pairs.filter((x) => Object.values(x.eligibility_source).every((s) => s === 'hand-encoded'))
      const groups = new Map()
      for (const x of hand) groups.set(x.sponsor, [...(groups.get(x.sponsor) ?? []), x.upper_bound])
      const wantGroups = [...groups.values()].map((u) => [...u].sort((a, b) => b - a).map((v) => (v ? 'u' : 'f')).join('')).sort((a, b) => b.length - a.length)
      eq('lead: one square per headline pair, outlined = upper bound, grouped by sponsor', { n: hd.count, ub: hd.upper_bound_count, groups: wantGroups }, { n: lb.squares, ub: lb.squaresUb, groups: lb.squareGroups })
      check('lead: caption dates from parameters', lb.caption.includes(`from ${longDate(p.since)} to ${longDate(p.until)}`) && lb.caption.includes('synthetic population'), lb.caption)

      const c = F.congestion
      const it = c.chart.items[0]
      const cb = B.congestion
      eq('congestion: estimate label', [it.estimate.toFixed(2)], cb.ciVal)
      eq('congestion: interval label with 95% CI and the floor', [`95% CI ${it.lo.toFixed(2)} to ${it.hi.toFixed(2)}, floored at 0`], cb.ciInt)
      check('congestion: reference value', cb.ciRef === `${c.chart.reference.value.toFixed(1)} · assumed in our original model`, cb.ciRef)
      const ci = cell(c, 'estimates', 'Within site', 2).replace(/^\[|\]$/g, '').split(', ')
      check('congestion: caption has the coefficient interval crossing zero', norm(cb.caption).includes(`${ci[0]} to ${ci[1]}, crosses zero`), cb.caption)

      const a = F.allocation
      const ab = B.allocation
      const ne = 'allocation-US-Northeast'
      const cal = 'selection-calibrated'
      const pair = (x, y) => `${lead(x)} and ${lead(y)}`
      const wantAl = [
        lead(cell(a, ne, 'Coordination (joint', 1)),
        pair(cell(a, ne, 'Coordination (joint', 3), cell(a, ne, 'Coordination (joint', 5)),
        pair(cell(a, cal, 'Coordination, b = 0.33', 2), cell(a, cal, 'Coordination, b = 0.33', 3)),
        lead(cell(a, ne, 'Site selection alone', 1)),
        pair(cell(a, ne, 'Site selection alone', 3), cell(a, ne, 'Site selection alone', 5)),
        pair(cell(a, cal, 'Site selection alone, b = 0.33', 2), cell(a, cal, 'Site selection alone, b = 0.33', 3)),
      ]
      eq('allocation: every dot-strip label equals the tables', wantAl, ab.alVals)
      eq('allocation: coordination (the weakening result) comes first, with equal weight', ['Coordination across trials', 'Site selection, trial by trial'], ab.alNames)
      check('allocation: value labels share one size', new Set(ab.alVlabSize).size === 1, ab.alVlabSize)
      check(
        'allocation: slower shares from the table',
        ab.alNotes[0].includes(`${cell(a, ne, 'Coordination (joint', 6)} of trials slower (held-out, time split)`) &&
          ab.alNotes[1].includes(`${cell(a, ne, 'Site selection alone', 6)} of trials slower (held-out, time split)`),
        ab.alNotes,
      )
      for (const q of ['In-sample', 'Held-out', 'post hoc', 'b = 0.33', 'scored by our enrollment model', 'pre-registered'])
        check(`allocation: qualifier "${q}" visible in Simple`, ab.row.includes(q), q)
      check('allocation: caption trial count from the table title', ab.caption.startsWith(`${a.tables.find((t) => t.id === ne).title.replace(/ \((\d+) trials\)/, ', $1 trials')}.`), ab.caption)

      const im = F.implication
      const ib = B.implication
      eq('implication: key numbers equal the table', [lead(cell(im, 'data-limits', 'Typical miss', 1)), cell(im, 'data-limits', 'U.S. sites', 1), cell(im, 'data-limits', 'Site-level', 1)], ib.figs)
      check('implication: naive estimate and share', ib.rowsSub[0].includes(`${lead(cell(im, 'data-limits', 'Typical miss', 2))} for a naive estimate`) && ib.rowsSub[1] === cell(im, 'data-limits', 'U.S. sites', 2), ib.rowsSub)
      eq('implication: bar width is the stored share', cell(im, 'data-limits', 'U.S. sites', 2), ib.barWidth)

      const text = out.runs['1440_light_simple'].blocks.map((b) => b.row).join(' ').toLowerCase()
      const banned = ['faster trials', 'faster enrollment', 'speed up', 'accelerat', 'savings', 'better site selection', 'months saved', 'time-to-fill', 'real patients', 'active sites']
      check('Simple text has none of the do-not-say phrases', banned.every((b) => !text.includes(b)), banned.filter((b) => text.includes(b)))
    }

    // ------------------------------------------------------------ 3. Detailed: every table, note, caveat and source
    {
      const B = Object.fromEntries(out.runs['1440_light_detailed'].blocks.map((b) => [b.id, b]))
      for (const f of apiF.findings) {
        const b = B[f.id]
        eq(`${f.id}: Detailed title is the file's title`, f.title, b.h2)
        eq(`${f.id}: full headline`, norm(f.headline), norm(b.full))
        eq(`${f.id}: status`, { final: 'Final', provisional: 'Provisional', missing: 'Not computed' }[f.status] ?? f.status, b.status)
        eq(`${f.id}: table count`, (f.tables ?? []).length, b.tables.length)
        ;(f.tables ?? []).forEach((tb, j) => {
          const st = b.tables[j] ?? {}
          eq(`${f.id} table ${j} title`, norm(tb.title), norm(st.title))
          const filled = (k) => tb.rows.some((r) => (r[k] ?? '').trim() !== '')
          const cols = tb.columns.map((_, k) => k).filter((k) => k === 0 || filled(k))
          eq(`${f.id} table ${j} columns`, cols.map((k) => norm(tb.columns[k]) || 'Note'), (st.head ?? []).map(norm))
          tb.rows.forEach((r, k) => eq(`${f.id} table ${j} row ${k}`, cols.map((m) => ((r[m] ?? '').trim() ? norm(r[m]) : '—')), (st.rows?.[k] ?? []).map(norm)))
          eq(`${f.id} table ${j} notes`, (tb.notes ?? []).map(norm), (st.notes ?? []).map(norm))
        })
        eq(`${f.id}: caveats`, (f.caveats ?? []).map(norm), b.caveats.map(norm))
        eq(`${f.id}: source count`, (f.sources ?? []).length, b.sources.length)
        for (const href of b.sourceHrefs) {
          const r = await fetch(BASE + href)
          check(`${f.id}: source link ${decodeURIComponent(href.split('path=')[1])} resolves`, r.status === 200, r.status)
        }
      }
      const lb = B['self-overlap']
      const hd = so.headline
      check(
        'lead (Detailed): headline sentence with sponsors, upper bounds and thresholds',
        lb.full.startsWith(`${hd.count} `) &&
          lb.full.includes(`across ${hd.sponsors} sponsors`) &&
          lb.full.includes(`For ${hd.upper_bound_count} of them`) &&
          lb.full.includes(`at least ${so.parameters.min_shared_sites} registered sites`) &&
          lb.full.includes(`at least ${Math.round(so.parameters.min_overlap_one_direction * 100)}%`),
        lb.full,
      )
      const src = so.count_by_eligibility_source
      const kind = (x) => {
        const s = Object.values(x.eligibility_source)
        const n = s.filter((v) => v === 'hand-encoded').length
        return n === s.length ? 'both hand-encoded' : n === 0 ? 'both rule-based parse' : 'one of each'
      }
      const ub = (k) => so.pairs.filter((x) => kind(x) === k && x.upper_bound).length
      const t0 = lb.tables[0]
      eq('lead (Detailed): pairs by eligibility source', [
        ['Both hand-encoded and reviewed (headline)', String(src['both hand-encoded']), String(ub('both hand-encoded'))],
        ['One of each', String(src['one of each']), `${ub('one of each')} (set by the hand-encoded trial)`],
        ['Both rule-based parse (unreviewed)', String(src['both rule-based parse']), `${ub('both rule-based parse')} (unflagged, not verified)`],
        ['All (broad count)', String(so.count), String(so.upper_bound_count)],
      ], t0?.rows)
      check('lead (Detailed): the broad count carries its caveat', t0?.notes[0]?.startsWith(`${src['one of each'] + src['both rule-based parse']} of the ${so.count}`) && t0.notes[0].includes('unflagged, not verified'), t0?.notes)
      check('lead (Detailed): caveats from the audit notes', lb.caveats.length >= 4 && lb.caveats.some((c) => c.startsWith('Descriptive:')) && lb.caveats.some((c) => c.startsWith('The count is a floor')), lb.caveats)
    }

    // ------------------------------------------------------------ 4. hover cards: hover, keyboard focus, tap
    {
      const page = await newPage(browser, { w: 1440, h: 900 })
      await openFindings(page)
      const card = () =>
        page.evaluate(() => {
          const c = [...document.querySelectorAll('.hc-card')].find((x) => !x.hidden)
          if (!c) return null
          const r = c.getBoundingClientRect()
          return { text: c.innerText.replace(/\s+/g, ' ').trim(), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }
        })
      const info = await page.$('.fd-card[data-finding="congestion"] .hc-info-lg')
      await info.scrollIntoView()
      await info.hover()
      await L.sleep(450)
      const hover = await card()
      check('hover: info card opens on hover with the copy-deck text and sources', hover?.text.includes('about 6% slower enrollment per doubling') && hover.text.includes('Sources:') && hover.inView, hover)
      await L.shot(page, DIR, 'findings_1440_hover_info', false)
      await page.mouse.move(5, 5)
      await L.sleep(500)
      check('hover: card closes when the pointer leaves', (await card()) === null, await card())
      // Keyboard: Tab from the top of the page until the "95% CI" gloss has focus.
      await page.evaluate(() => {
        document.activeElement?.blur()
        window.scrollTo(0, 0)
      })
      let found = false
      for (let i = 0; i < 80 && !found; i++) {
        await page.keyboard.press('Tab')
        found = await page.evaluate(() => document.activeElement?.closest('.ci-int') !== null && document.activeElement?.classList.contains('hc-trigger'))
      }
      await L.sleep(250)
      const kb = await card()
      check('keyboard: the 95% CI gloss opens its card on focus', found && kb?.text.includes('The range the true value plausibly falls in.'), { found, kb })
      await L.shot(page, DIR, 'findings_1440_focus_gloss', false)
      await page.keyboard.press('Escape')
      await L.sleep(200)
      check('keyboard: Escape closes it', (await card()) === null)
      out.runs.hover_errors = errorsOf(page)
      await page.__ctx.close()

      const phone = await newPage(browser, { w: 390, h: 844 })
      await openFindings(phone)
      const tip = await phone.$('.fd-card[data-finding="self-overlap"] .section-quals .hc-trigger')
      await tip.scrollIntoView()
      await tip.tap()
      await L.sleep(350)
      const tapped = await phone.evaluate(() => {
        const c = [...document.querySelectorAll('.hc-card')].find((x) => !x.hidden)
        if (!c) return null
        const r = c.getBoundingClientRect()
        return { text: c.innerText.replace(/\s+/g, ' ').trim(), left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth }
      })
      check('tap: the "upper bounds" gloss opens on tap and fits the phone', tapped?.text.startsWith('Upper bound') && tapped.left >= 0 && tapped.right <= tapped.vw, tapped)
      await L.shot(phone, DIR, 'findings_390_tap_gloss', false)
      const sizes = await phone.evaluate(() => [...document.querySelectorAll('.fd .hc-info-lg')].map((b) => getComputedStyle(b, '::after').width))
      check('tap: info buttons have a 44 px touch target on coarse pointers', sizes.every((s) => parseFloat(s) >= 44), sizes)
      out.runs.tap_errors = errorsOf(phone)
      await phone.__ctx.close()
    }

    // ------------------------------------------------------------ 5. deep links, on-page index, density switch
    {
      const page = await newPage(browser, { w: 1440, h: 900 })
      const stickyH = async () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-h')) * 16)
      const topOf = (id) => page.evaluate((id) => Math.round(document.getElementById(`finding-${id}`).getBoundingClientRect().top), id)
      for (const id of ['self-overlap', 'congestion', 'allocation']) {
        await page.goto('about:blank')
        await openFindings(page, `#findings/${id}`)
        await L.sleep(600)
        const top = await topOf(id)
        const sh = await stickyH()
        check(`deep link #findings/${id} lands the block under the header`, top >= sh - 2 && top <= sh + 30, { top, sticky: sh })
      }
      await page.goto('about:blank')
      await openFindings(page, '#findings/implication')
      await L.sleep(600)
      const lastTop = await topOf('implication')
      check('deep link #findings/implication scrolls to the last block', (await page.evaluate(() => scrollY)) > 0 && lastTop < 900 / 2, { lastTop })
      // On-page index: a real link; a click scrolls and puts the deep link in the address bar.
      await page.goto('about:blank')
      await openFindings(page)
      const idx = await page.evaluate(() => [...document.querySelectorAll('.fd-index a')].map((a) => [a.textContent, a.getAttribute('href')]))
      eq('index: one link per block, by deep link', [
        ['Same-sponsor overlap', '#findings/self-overlap'],
        ['Congestion', '#findings/congestion'],
        ['Allocation', '#findings/allocation'],
        ['Site-level data', '#findings/implication'],
      ], idx)
      await page.click('.fd-index a[href="#findings/allocation"]')
      await L.sleep(1200)
      const afterIdx = { hash: await page.evaluate(() => location.hash), top: await topOf('allocation') }
      check('index: click scrolls to the block and sets #findings/allocation', afterIdx.hash === '#findings/allocation' && Math.abs(afterIdx.top - (await stickyH())) < 30, afterIdx)
      // In-app hash change (no reload).
      await page.evaluate(() => {
        location.hash = 'findings/congestion'
      })
      await L.sleep(900)
      const ht = await topOf('congestion')
      check('in-app hash change #findings/congestion scrolls there', Math.abs(ht - (await stickyH())) < 30, ht)
      // Density switch in the header: Detailed shows details inline, Simple folds them again; nothing else is lost.
      const countLinks = () => page.evaluate(() => document.querySelectorAll('.fd a[href]').length)
      const linksSimple = await countLinks()
      await page.evaluate(() => [...document.querySelectorAll('.density-seg .seg-btn')].find((b) => b.textContent === 'Detailed').click())
      await L.sleep(500)
      const det = await page.evaluate(() => ({ inline: document.querySelectorAll('.fd .section-details').length, disc: document.querySelectorAll('.fd details.section-disclosure').length, stored: localStorage.getItem('concord.density') }))
      check('switch: Detailed shows every block inline and remembers the choice', det.inline === 4 && det.disc === 0 && det.stored === 'detailed', det)
      const linksDetailed = await countLinks()
      await page.evaluate(() => [...document.querySelectorAll('.density-seg .seg-btn')].find((b) => b.textContent === 'Simple').click())
      await L.sleep(500)
      const sim = await page.evaluate(() => ({ inline: document.querySelectorAll('.fd .section-details').length, disc: document.querySelectorAll('.fd details.section-disclosure').length }))
      check('switch: Simple folds the details into 4 disclosures', sim.inline === 0 && sim.disc === 4, sim)
      await page.evaluate(() => document.querySelectorAll('.fd details.section-disclosure').forEach((d) => (d.open = true)))
      const linksOpen = await countLinks()
      check('switch: the same links (index, sources, overlap) exist in both modes', linksSimple === linksDetailed && linksOpen === linksDetailed, { linksSimple, linksDetailed, linksOpen })
      await L.shot(page, DIR, 'findings_1440_simple_details_open', true)
      out.runs.nav_errors = errorsOf(page)
      check('deep links and switch: 0 page errors', page.__log.pageerrors.length === 0, page.__log.pageerrors)
      await page.__ctx.close()
    }

    // ------------------------------------------------------------ 6. generic fallback when the numbers move
    {
      const moved = JSON.parse(JSON.stringify(apiF))
      const al = moved.findings.find((f) => f.id === 'allocation')
      al.tables.find((t) => t.id === 'allocation-US-Northeast').rows.find((r) => r[0].startsWith('Coordination (joint'))[1] = '1.43x'
      moved.findings.find((f) => f.id === 'congestion').status = 'provisional'
      moved.findings.push({
        id: 'qa-extra',
        title: 'QA extra finding with two intervals',
        status: 'final',
        headline: 'Two intervals against a reference of 1.0.',
        chart: { type: 'ci', reference: { label: 'reference', value: 1 }, items: [{ label: 'first', estimate: 0.4, lo: 0.2, hi: 0.6 }, { label: 'second', estimate: 1.3, lo: 1.1, hi: 1.6 }] },
        tables: [],
        caveats: ['A caveat.'],
        sources: [],
      })
      const { headline: _h, ...countOnly } = so
      for (const [tag, routes] of [
        ['moved', { '/api/findings': { body: moved } }],
        ['overlap-count-only', { '/api/findings/self-overlap': { body: countOnly } }],
        ['overlap-404', { '/api/findings/self-overlap': { status: 404, body: { detail: 'not written yet' } } }],
      ]) {
        const page = await newPage(browser, { w: 1440, h: 900, routes })
        await page.goto(`${BASE}/#findings`, { waitUntil: 'networkidle0' })
        await page.waitForFunction(() => document.querySelectorAll('.fd-card').length >= 3, { timeout: 30000 })
        await L.sleep(500)
        const blocks = await readBlocks(page)
        const by = Object.fromEntries(blocks.map((b) => [b.id, b]))
        if (tag === 'moved') {
          check('fallback: a finding whose numbers moved shows its own title and headline', by.allocation.summary === 'generic' && by.allocation.h2 === al.title && norm(by.allocation.lede) === norm(al.headline), by.allocation)
          check('fallback: a provisional finding keeps its copy and shows "Provisional"', by.congestion.summary === 'copy' && by.congestion.statusQual === 'Provisional', by.congestion)
          check('fallback: an unknown finding renders generically with every interval', by['qa-extra']?.summary === 'generic' && by['qa-extra'].ciItems === 2, by['qa-extra'])
        } else if (tag === 'overlap-count-only') {
          const b = by['self-overlap']
          const unrev = so.count_by_eligibility_source['both rule-based parse'] + so.count_by_eligibility_source['one of each']
          check('fallback: the broad count alone is never shown as the reviewed headline', b?.summary === 'generic' && !b.row.includes('hand-encoded and reviewed'), b)
          check('fallback: the broad count carries its unreviewed-parse caveat', b?.quals.includes('‡ Unreviewed') && b.quals.includes(`${unrev} of these pairs rest on the unreviewed rule-based parse`), b?.quals)
        } else {
          check('fallback: without self_overlap.json the page has no lead block', !by['self-overlap'] && blocks.length === apiF.findings.length, blocks.map((b) => b.id))
        }
        await L.shot(page, DIR, `findings_fallback_${tag}`, true)
        const e = errorsOf(page)
        check(`fallback ${tag}: 0 page errors`, e.pageerrors.length === 0, e)
        await page.__ctx.close()
      }
    }

    // ------------------------------------------------------------ 7. (opt-in) app routing through Research
    if (process.env.ROUTES === '1') {
      const page = await newPage(browser, { w: 1440, h: 900, blockClear: false })
      const log = page.__log
      const route = async (hash) => {
        const before = log.api.length
        await page.goto('about:blank')
        await page.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' })
        await L.sleep(2500)
        const st = await page.evaluate(() => ({
          tab: document.querySelector('nav.tabs .tab-active')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
          sub: document.querySelector('.rs-tab-on')?.innerText ?? null,
          h1: document.querySelector('main h1, h1')?.innerText ?? null,
          allocationTop: Math.round(document.getElementById('finding-allocation')?.getBoundingClientRect().top ?? -1),
        }))
        return { hash, ...st, api: log.api.slice(before).map((a) => `${a.method} ${new URL(a.url).pathname} ${a.status}`) }
      }
      out.runs.routes = []
      for (const h of ['#findings', '#findings/allocation', '#overlap', '#terms-flow', '#research', '#research/robustness', '#robustness', '#model', '#clear', '#map',
        '#research/prices/NCT06452277', '#prices/NCT06452277', '#portfolio', '#portfolio/regeneron', '#terms', '#bogus'])
        out.runs.routes.push(await route(h))
      const r = Object.fromEntries(out.runs.routes.map((x) => [x.hash, x]))
      check('routes: #findings and an unknown hash open Findings', r['#findings'].tab === 'Findings' && r['#bogus'].tab === 'Findings', [r['#findings'], r['#bogus']])
      check('routes: pre-pivot links open Research', ['#robustness', '#model', '#clear', '#map', '#portfolio', '#terms'].every((h) => r[h].tab?.startsWith('Research')), out.runs.routes.map((x) => [x.hash, x.tab, x.sub]))
      // The Clear-it pointer to the held-out results on Findings.
      await page.goto('about:blank')
      await page.goto(BASE + '/#research/clear', { waitUntil: 'domcontentloaded' })
      await L.waitCleared(page, 'US-Northeast')
      await page.waitForSelector('a[href="#findings/allocation"]', { timeout: 60000 })
      await page.evaluate(() => document.querySelector('main a[href="#findings/allocation"]').click())
      await page.waitForSelector('#finding-allocation')
      await L.sleep(1500)
      const after = await page.evaluate(() => ({ hash: location.hash, top: Math.round(document.getElementById('finding-allocation').getBoundingClientRect().top) }))
      check('routes: the Clear-it pointer opens #findings/allocation at the allocation block', after.hash === '#findings/allocation' && after.top < 120, after)
      out.runs.routing_pageerrors = log.pageerrors
      await page.__ctx.close()
    }
  } finally {
    await browser.close()
  }
  out.results = results
  const failed = results.filter((r) => !r.ok)
  out.summary = { checks: results.length, failed: failed.length }
  L.save(`${DIR}/qa_findings.json`, out)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
