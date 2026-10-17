// Calm Portfolio overlap QA (puppeteer-core, installed Chrome). Prints PASS/FAIL lines and writes overlap.json and
// screenshots to the output folder.
//  - Every matrix cell, the diagonal, the summary line, the hover card, the pair detail, the summary counts, the trial
//    rows and a per-site table against a fresh GET of the same request, in Simple and Detailed. Simple draws the
//    landing hero's half grid (each pair once, above the diagonal: n(n-1)/2 cells, no diagonal); Detailed the full
//    directional matrix (n(n-1) cells and the diagonal).
//  - grid: the half grid and the full matrix for Merck (worldwide and U.S.), AstraZeneca (anonymized sites), Novartis
//    (mixed) and the Regeneron preset, in both densities, both themes, 1440 and 390, with a card and a selection each.
//  - Honesty: no false zeros (pairs whose sites can't be counted show no number), upper-bound and unreviewed marks on
//    every affected cell and visible beside truncated row labels, the synthetic-population and registered-site
//    qualifiers in view, no forbidden claims. Simple's legend has a "Number" key only when a cell shows a number.
//  - Half grid: the sticky headers cover the gaps beside them only while the box is scrolled (so the first column's
//    selection and focus rings stay whole).
//  - Hover cards on mouse hover, keyboard focus and tap (a bottom sheet on phones); Escape closes.
//  - Controls and deep links: pair list, Clear selection, the Regeneron preset and #overlap/regeneron, sponsor links
//    (#overlap/merck, #overlap/merck/us, #overlap/astrazeneca/us, an unknown sponsor), a link followed while the tab
//    is open, a date after the snapshot, the stale "Updating" state, per-site counts, tab switches.
//  - Light and dark, Simple and Detailed, 1440 and 390 px: horizontal page scroll, page and console errors, touch
//    target sizes on the phone.
// The API is only read (GET). usage:
//   NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node calm_overlap.js [base] [outDir]
//   env API (default http://localhost:8000), ONLY=matrix,hover,flows,links,phone,grid (default all).
const fs = require('fs')
const path = require('path')
const { launch, sleep } = require('./lib')

const BASE = process.argv[2] || 'http://127.0.0.1:5212'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/R/overlap'
const API = process.env.API || 'http://localhost:8000'
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const run = (k) => !ONLY || ONLY.includes(k)
fs.mkdirSync(OUT, { recursive: true })

const results = []
const errors = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}
const eq = (name, expected, got) => check(name, expected === got, expected === got ? got : { expected, got })

// ---- the view's own formatting (OverlapView.tsx, format.ts) ----
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}
const shortDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`
}
const pct = (x) => `${(x * 100).toFixed(0)}%`
const num1 = (x) => x.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const int = (x) => Math.round(x).toLocaleString('en-US')
const label = (t) => t.acronym || t.nct_id
const known = (a, b) => a.n_sites_identified > 0 && b.n_sites_identified > 0
const marks = (p) => (p.upper_bound ? '†' : '') + (p.unreviewed_criteria ? '‡' : '')
const heat = (o) => {
  if (!o.p.overlap_informative) return 'x'
  const s = Math.round(Math.max(o.ab, o.ba) * 100)
  return String(s === 0 ? 0 : s < 25 ? 1 : s < 50 ? 2 : s < 80 ? 3 : 4)
}
const norm = (s) =>
  (s ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([†‡])/g, '$1')
    .trim()

async function apiGet(p) {
  const r = await fetch(API + p)
  return r.json()
}
const auditPath = (q) => `/api/overlap?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '')).toString()}`

function orient(d, a, b) {
  const p = d.pairs.find((x) => x.p === a && x.q === b)
  if (p) return { p, ab: p.o_pq, ba: p.o_qp }
  const r = d.pairs.find((x) => x.p === b && x.q === a)
  return { p: r, ab: r.o_qp, ba: r.o_pq }
}

async function openPage(browser, { width = 1440, theme = 'light', density = 'simple', hash = '#overlap', delay = 0 } = {}) {
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
  page.__log = { errors: [], requests: [] }
  const tag = `${hash} ${density} ${theme} ${width}`
  page.on('pageerror', (e) => page.__log.errors.push(`${tag} [pageerror] ${e}`))
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && page.__log.errors.push(`${tag} [${m.type()}] ${m.text()}`))
  page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && page.__log.errors.push(`${tag} [http ${r.status()}] ${r.url()}`))
  await page.setRequestInterception(true)
  page.on('request', async (r) => {
    const u = r.url()
    if (u.includes('/api/clear')) return r.respond({ status: 503, contentType: 'application/json', body: '{"detail":"blocked in QA"}' })
    if (u.includes('/api/overlap')) page.__log.requests.push(u.slice(u.indexOf('/api/')))
    if (page.__delay && u.includes('/api/overlap?')) await sleep(page.__delay)
    r.continue()
  })
  page.__delay = delay
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
  return { ctx, page }
}

async function ready(page, timeout = 120000) {
  await page.waitForFunction(
    () =>
      document.querySelector('.ov-sumline') &&
      !(document.querySelector('.ov-updating')?.textContent ?? '').trim() &&
      !document.querySelector('main .loading') &&
      (document.querySelector('.ov-detail h2') || document.querySelector('.empty')),
    { timeout, polling: 250 },
  )
  await page.evaluate(() => document.fonts && document.fonts.ready)
  await sleep(500)
}

const screen = (page) =>
  page.evaluate(() => {
    const t = (el) => (el ? el.innerText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() : null)
    return {
      hash: location.hash,
      sponsor: document.querySelector('.ov-f-sponsor select')?.value,
      asOf: document.querySelector('.ov-f-date input')?.value,
      region: document.querySelector('.ov-f-region select')?.value,
      regionText: document.querySelector('.ov-f-region select')?.selectedOptions[0]?.textContent,
      sum: t(document.querySelector('.ov-sumline')),
      strip: t(document.querySelector('.ov-win .win-strip')),
      caption: t(document.querySelector('.ov-caption')),
      anon: t(document.querySelector('.ov-anon')),
      notes: [...document.querySelectorAll('.ov-notes .caveat, main .caveat')].map(t),
      detail: t(document.querySelector('.ov-detail h2')),
      empty: t(document.querySelector('.empty')),
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }
  })

// A pair cell: the full matrix's <td data-cell> (Detailed) or the half grid's [data-cell] wrapper (Simple), and its
// hover-card button (.ov-cell / .hg-cell).
const CELL = '.ov-matrix td[data-cell], .ov-hg [data-cell]'
const CELL_BTN = ':is(.ov-cell, .hg-cell)'
const cellBtn = (key) => `[data-cell="${key}"] ${CELL_BTN}`

const cellsOf = (page) =>
  page.$$eval(CELL, (tds) =>
    tds.map((td) => {
      const b = td.querySelector('.ov-cell, .hg-cell')
      const r = b.getBoundingClientRect()
      return {
        key: td.dataset.cell,
        text: b.innerText,
        heat: (b.className.match(/(?:ov|hg)-h(\w)/) || [])[1],
        hi: !!b.querySelector('.ov-hi, .hg-hi'),
        sel: td.classList.contains('ov-sel'),
        aria: b.getAttribute('aria-label'),
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
      }
    }),
  )

/** Every cell, the diagonal and the headers against the API body. */
async function checkMatrix(page, d, density, tag) {
  const detailed = density === 'detailed'
  const tIdx = new Map(d.trials.map((t) => [t.nct_id, t]))
  const n = d.trials.length
  const cells = await cellsOf(page)
  eq(`${tag} cell count${detailed ? '' : ' (half grid: n(n-1)/2)'}`, detailed ? n * (n - 1) : (n * (n - 1)) / 2, cells.length)
  if (!detailed) {
    // Each pair once, above the diagonal: the row trial comes before the column trial, and every API pair has a cell
    // in its own row (rows: trials 1..n-1) and column (columns: trials 2..n).
    const at = new Map(d.trials.map((t, i) => [t.nct_id, i]))
    const keys = new Set(cells.map((c) => c.key))
    const below = cells.filter((c) => {
      const [a, b] = c.key.split('|')
      return !(at.get(a) < at.get(b))
    })
    const absent = d.pairs.filter((p) => !keys.has(`${p.p}|${p.q}`) && !keys.has(`${p.q}|${p.p}`))
    check(`${tag} half grid: each pair once, above the diagonal`, below.length === 0 && absent.length === 0 && keys.size === cells.length, { below: below.length, absent: absent.length, dup: cells.length - keys.size })
    const heads = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.ov-hg .hg-rowh')].map((h) => {
        const r = h.getBoundingClientRect()
        return { t: h.querySelector('.hg-rowh-label').innerText, y: r.top + r.height / 2 }
      }),
      cols: [...document.querySelectorAll('.ov-hg .hg-colh')].map((h) => {
        const r = h.getBoundingClientRect()
        return { t: h.querySelector('.hg-vt').innerText, x: r.left + r.width / 2 }
      }),
    }))
    const lab = (t) => label(t) + (t.eligibility_source !== 'hand-encoded' ? '‡' : '')
    eq(`${tag} half grid row headers: trials 1..n-1 (label + ‡ for the rule-based parse)`, JSON.stringify(d.trials.slice(0, -1).map(lab)), JSON.stringify(heads.rows.map((h) => norm(h.t))))
    eq(`${tag} half grid column headers: trials 2..n`, JSON.stringify(d.trials.slice(1).map(lab)), JSON.stringify(heads.cols.map((h) => norm(h.t))))
    // Geometry: every cell sits in its row trial's row and its column trial's column (so the grid is the upper half).
    const misplaced = cells.filter((c) => {
      const [a, b] = c.key.split('|')
      const row = heads.rows[at.get(a)]
      const col = heads.cols[at.get(b) - 1]
      return !row || !col || Math.abs(row.y - c.y) > 1.5 || Math.abs(col.x - c.x) > 1.5
    })
    check(`${tag} half grid: every cell under its column trial and beside its row trial`, misplaced.length === 0, misplaced.slice(0, 3).map((c) => c.key))
  }
  const bad = []
  let falseZero = 0
  let missingMark = 0
  for (const c of cells) {
    const [a, b] = c.key.split('|')
    const A = tIdx.get(a)
    const B = tIdx.get(b)
    const o = orient(d, a, b)
    const k = known(A, B)
    const mk = marks(o.p)
    const pcts = o.p.overlap_informative ? `${pct(o.ab)} / ${pct(o.ba)}` : '—'
    const n = o.p.shared_sites
    const exp = detailed ? (k ? `${n} ${n === 1 ? 'site' : 'sites'}${mk} ${pcts}` : `${pcts}${mk}`) : `${k ? n : ''}${mk}`
    const got = norm(c.text)
    const hiExp = o.p.overlap_informative && Math.round(Math.max(o.ab, o.ba) * 100) >= 80
    if (got !== exp || c.heat !== heat(o) || c.hi !== hiExp) bad.push({ key: c.key, exp, got, heat: [heat(o), c.heat], hi: [hiExp, c.hi] })
    // Simple shows only the site count as a number; Detailed starts uncountable cells with the shares instead.
    if (!k && (detailed ? /^\d+ sites?/.test(got) : /^\d/.test(got))) falseZero++
    if ((o.p.upper_bound && !got.includes('†')) || (o.p.unreviewed_criteria && !got.includes('‡'))) missingMark++
    if (!k && !/can't be counted/.test(c.aria)) bad.push({ key: c.key, aria: c.aria })
  }
  check(`${tag} every cell matches the API (text, shade, 80% dot)`, bad.length === 0, bad.length ? bad.slice(0, 5) : `${cells.length} cells`)
  // A long row label truncates, but its ‡ must stay inside the label's visible box (not lost to the ellipsis).
  const rowMarks = await page.$$eval(':is(.ov-matrix .ov-rh-label, .ov-hg .hg-rowh-label)', (els) =>
    els
      .filter((l) => l.querySelector('.ov-hmk'))
      .map((l) => {
        const a = l.getBoundingClientRect()
        const m = l.querySelector('.ov-hmk').getBoundingClientRect()
        const t = l.querySelector('.ov-rl-text')
        return { label: l.innerText, cut: !!t && t.scrollWidth > t.clientWidth, lost: m.width === 0 || m.left < a.left - 0.5 || m.right > a.right + 0.5 }
      }),
  )
  check(
    `${tag} every ‡ on a row header is visible, truncated labels included`,
    rowMarks.every((r) => !r.lost),
    { marks: rowMarks.length, truncated: rowMarks.filter((r) => r.cut).map((r) => norm(r.label)), lost: rowMarks.filter((r) => r.lost).map((r) => norm(r.label)) },
  )
  if (!detailed) {
    // Simple's legend keeps only the keys its half grid needs: no "Number" key when no cell shows a number.
    const lg = await page.$eval('.ov-legend', (e) => e.innerText).catch(() => '')
    const anyNum = cells.some((c) => /^\d/.test(norm(c.text)))
    eq(`${tag} Simple legend: "Number" key exactly when a cell shows a number`, anyNum, lg.includes('Number:'))
    const h1 = await page.$eval('.ov-legend .ov-sw.ov-h1', (e) => getComputedStyle(e).boxShadow).catch(() => null)
    check(`${tag} Simple legend: the lightest shade swatch is outlined`, !!h1 && h1 !== 'none', h1)
  }
  check(`${tag} no number on uncountable pairs`, falseZero === 0, falseZero)
  check(`${tag} upper-bound / unreviewed marks on every affected cell`, missingMark === 0, missingMark)
  const diag = await page.$$eval('.ov-matrix td.ov-diag .ov-cell', (els) => els.map((e) => e.innerText))
  if (detailed) {
    const diagExp = d.trials.map((t) => `${t.n_sites} ${t.n_sites === 1 ? 'site' : 'sites'}`)
    eq(`${tag} diagonal = registered sites`, JSON.stringify(diagExp), JSON.stringify(diag.map(norm)))
    const rowh = await page.$$eval('.ov-matrix .ov-rowh .ov-rh-label', (els) => els.map((e) => e.innerText))
    const rowExp = d.trials.map((t) => label(t) + (t.eligibility_source !== 'hand-encoded' ? '‡' : ''))
    eq(`${tag} row headers (label + ‡ for the rule-based parse)`, JSON.stringify(rowExp), JSON.stringify(rowh.map(norm)))
  } else {
    const full = await page.$$eval('.ov-matrix', (e) => e.length)
    check(`${tag} half grid: no diagonal, no full matrix`, diag.length === 0 && full === 0, { diag: diag.length, full })
  }
  return cells
}

const visibleCard = (page) =>
  page.evaluate(() => {
    const c = [...document.querySelectorAll('.hc-card')].find((x) => !x.hidden)
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { text: c.innerText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(), role: c.getAttribute('role'), l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight }
  })

function checkPairCard(card, d, key, density, tag) {
  const [a, b] = key.split('|')
  const tIdx = new Map(d.trials.map((t) => [t.nct_id, t]))
  const A = tIdx.get(a)
  const B = tIdx.get(b)
  const o = orient(d, a, b)
  const want = [
    `${label(A)} × ${label(B)}`,
    'Shared registered sites',
    known(A, B) ? `Shared registered sites ${o.p.shared_sites}` : "can't be counted (sites anonymized on CT.gov)",
    `Months both recruiting (estimated) ${num1(o.p.months_both_recruiting_estimated)}`,
    'Synthetic population. Registered sites, not confirmed enrolling.',
  ]
  if (o.p.overlap_informative)
    want.push(
      `${label(A)}'s eligible patients also eligible for ${label(B)} ${pct(o.ab)}`,
      `${label(B)}'s eligible patients also eligible for ${label(A)} ${pct(o.ba)}`,
    )
  if (o.p.upper_bound) want.push('† Upper bound')
  if (o.p.unreviewed_criteria) want.push('‡ Unreviewed')
  // Both trials named (as on the landing hero's card).
  want.push(`${A.nct_id} · `, ` — ${B.nct_id} · `)
  if (density === 'detailed') want.push('Both recruiting', 'Criteria in both', `Only in ${label(A)}`)
  else if (o.p.upper_bound) want.push("Upper bound: a trial has restrictions the synthetic population can't represent, so these shares are ceilings.")
  const missing = want.filter((w) => !card?.text.includes(w))
  check(`${tag} pair card content = API (${key})`, !!card && missing.length === 0, missing.length ? { missing, text: card?.text } : undefined)
  check(`${tag} pair card inside the viewport`, !!card && card.l >= 0 && card.t >= 0 && card.r <= card.vw && card.b <= card.vh, card && [card.l, card.t, card.r, card.b])
}

;(async () => {
  const browser = await launch()
  const sponsorsWorld = await apiGet('/api/overlap/sponsors')
  const defSponsor = (sponsorsWorld.sponsors.find((s) => !(typeof s.identified_share === 'number' && s.identified_share < 0.5)) ?? sponsorsWorld.sponsors[0]).sponsor
  const dDefault = await apiGet(auditPath({ sponsor: defSponsor }))
  const snapshot = dDefault.snapshot_date
  try {
    // ------------------------------------------------------------------ 1. matrix, both densities, themes, widths
    if (run('matrix'))
      for (const density of ['simple', 'detailed'])
        for (const theme of ['light', 'dark'])
          for (const width of [1440, 390]) {
            const tag = `[${density} ${theme} ${width}]`
            const { ctx, page } = await openPage(browser, { width, theme, density })
            await ready(page)
            const s = await screen(page)
            eq(`${tag} default sponsor (first with identifiable sites, worldwide)`, defSponsor, s.sponsor)
            eq(`${tag} default region: All registered sites worldwide`, 'All registered sites worldwide', s.regionText)
            eq(
              `${tag} summary line`,
              `${dDefault.trials.length} trials recruiting on ${longDate(dDefault.as_of)} · ${dDefault.pairs.length} pairs`,
              s.sum,
            )
            check(`${tag} strip names sponsor and region`, s.strip?.includes(dDefault.sponsor) && s.strip?.includes(dDefault.region_label), s.strip)
            check(`${tag} caption keeps the synthetic and registered-site qualifiers`, /Synthetic population\. Registered sites, not confirmed enrolling\./.test(s.caption ?? ''), s.caption)
            check(`${tag} no horizontal page scroll`, s.sw <= s.iw, `${s.sw} / ${s.iw}`)
            // Rule 1 and the copy deck's do-not-say list, over the view's text (the definitions' own "not shown" line aside).
            const text = await page.evaluate(() => {
              const m = document.querySelector('main').cloneNode(true)
              m.querySelectorAll('.ov-defs').forEach((e) => e.remove())
              return m.textContent
            })
            const banned = text.match(/faster|speed ?up|accelerat|time-to-fill|savings|months saved|sites hidden|cannibali|compete for patients|real patients|real-time|enrolling sites|active sites/gi)
            check(`${tag} no forbidden claims in the view's text`, !banned, banned)
            const meta = await page.$eval('.page-head-meta', (e) => e.innerText).catch(() => null)
            eq(`${tag} snapshot meta`, `Registry snapshot: ${shortDate(snapshot)}`, meta)
            await checkMatrix(page, dDefault, density, tag)
            if (density === 'detailed') {
              const stats = await page.$$eval('.ov-stats .stat', (els) => els.map((e) => ({ v: e.querySelector('.stat-value').innerText.replace(/\s+/g, ' ').trim(), s: e.querySelector('.stat-sub')?.innerText })))
              const pairs = dDefault.pairs.filter((p) => known(dDefault.trials.find((t) => t.nct_id === p.p), dDefault.trials.find((t) => t.nct_id === p.q)))
              const top = [...pairs].sort((x, y) => y.shared_sites - x.shared_sites)[0]
              const nested = pairs.filter((p) => p.overlap_informative && p.shared_sites >= 10 && Math.max(p.o_pq, p.o_qp) >= 0.8)
              eq(`${tag} stat trials`, String(dDefault.trials.length), stats[0]?.v)
              eq(`${tag} stat pairs sharing`, `${pairs.filter((p) => p.shared_sites > 0).length} of ${pairs.length} pairs`, stats[1]?.v)
              eq(`${tag} stat most shared`, String(top.shared_sites), stats[2]?.v)
              eq(`${tag} stat most shared pair`, `${top.p} × ${top.q}`, stats[2]?.s)
              eq(`${tag} stat nested`, String(nested.length), stats[3]?.v)
              const rows = await page.$$eval('.ov-trow', (els) =>
                els.map((r) => ({
                  id: r.querySelector('.ov-trow-id a')?.innerText,
                  count: r.querySelector('.ov-count')?.innerText.replace(/\s+/g, ' ').trim(),
                  ind: r.querySelector('.ov-count-sub')?.innerText,
                })),
              )
              const badRows = dDefault.trials.filter((t, i) => {
                const r = rows[i] ?? {}
                return (
                  r.id !== t.nct_id ||
                  r.count !== `${t.other_sponsor_trials_at_sites} other sponsors' trials recruiting at its sites on this date` ||
                  r.ind !== `${t.other_sponsor_trials_at_sites_industry} of them industry-sponsored`
                )
              })
              check(`${tag} trial rows = API (other sponsors' trials, industry)`, badRows.length === 0, badRows.map((t) => t.nct_id))
            } else {
              const inDisclosure = await page.$$eval('details .ov-stats .stat', (e) => e.length)
              eq(`${tag} summary counts kept in a Details disclosure`, 4, inDisclosure)
            }
            await page.evaluate(() => window.scrollTo(0, 0))
            await page.screenshot({ path: path.join(OUT, `overlap-${density}-${theme}-${width}-top.png`) })
            await page.screenshot({ path: path.join(OUT, `overlap-${density}-${theme}-${width}-full.png`), fullPage: true })
            errors.push(...page.__log.errors)
            await ctx.close()
          }

    // ------------------------------------------------------------------ 2. hover cards: mouse, keyboard, legend, headers
    if (run('hover'))
      for (const density of ['simple', 'detailed']) {
        const tag = `[hover ${density}]`
        const { ctx, page } = await openPage(browser, { density })
        await ready(page)
        const tIdx = new Map(dDefault.trials.map((t) => [t.nct_id, t]))
        const pick = dDefault.pairs.find((p) => p.upper_bound && p.unreviewed_criteria && known(tIdx.get(p.p), tIdx.get(p.q))) ?? dDefault.pairs[0]
        const key = `${pick.p}|${pick.q}`
        const cell = await page.$(cellBtn(key))
        await cell.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'center' }))
        await sleep(200)
        const box = await cell.boundingBox()
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await sleep(450)
        const card = await visibleCard(page)
        checkPairCard(card, dDefault, key, density, `${tag} mouse`)
        check(
          `${tag} card sits beside its cell, not over it`,
          !!card && (card.b <= box.y + 1 || card.t >= box.y + box.height - 1 || card.r <= box.x + 1 || card.l >= box.x + box.width - 1),
          card && { card: [card.l, card.t, card.r, card.b], cell: [box.x, box.y, box.x + box.width, box.y + box.height] },
        )
        await page.screenshot({ path: path.join(OUT, `hover-${density}-mouse.png`) })
        await page.mouse.move(5, 5)
        await sleep(450)
        check(`${tag} card closes when the pointer leaves`, !(await visibleCard(page)))
        // Click selects the pair (and pins the card); the detail follows.
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        await page.waitForFunction((t) => (document.querySelector('.ov-detail h2')?.innerText ?? '').replace(/\s+/g, ' ').trim() === t, { timeout: 5000 }, `${label(tIdx.get(pick.p))} × ${label(tIdx.get(pick.q))}`).catch(() => {})
        eq(`${tag} click selects the pair`, `${label(tIdx.get(pick.p))} × ${label(tIdx.get(pick.q))}`, (await screen(page)).detail)
        const live = await page.$eval('main .sr-only[aria-live]', (e) => e.textContent)
        check(`${tag} selection announced`, live.startsWith('Selected '), live)
        check(`${tag} click pins the card`, !!(await visibleCard(page)))
        await page.keyboard.press('Escape')
        await sleep(150)
        check(`${tag} Escape closes the card`, !(await visibleCard(page)))
        // Keyboard: Tab onto the next cell in the row opens its card; Enter selects it. (Cells are in row order in
        // both the full matrix and the half grid; at a row's last cell, start one cell earlier.)
        const next = await page.evaluate(
          (key, sel) => {
            const all = [...document.querySelectorAll(sel)]
            const i = all.findIndex((c) => c.dataset.cell === key)
            const row = (c) => c?.dataset.cell.split('|')[0]
            const fwd = row(all[i + 1]) === row(all[i])
            const from = fwd ? all[i] : all[i - 2]
            const to = fwd ? all[i + 1] : all[i - 1]
            from?.querySelector('button')?.focus()
            return to?.dataset.cell
          },
          key,
          CELL,
        )
        await page.keyboard.press('Tab')
        await sleep(250)
        const focused = await page.evaluate(() => document.activeElement?.closest('[data-cell]')?.dataset.cell)
        eq(`${tag} Tab moves to the next cell`, next, focused)
        const kcard = await visibleCard(page)
        checkPairCard(kcard, dDefault, next, density, `${tag} keyboard focus`)
        await page.screenshot({ path: path.join(OUT, `hover-${density}-keyboard.png`) })
        await page.keyboard.press('Enter')
        await sleep(300)
        const [na, nb] = next.split('|')
        eq(`${tag} Enter selects the focused pair`, `${label(tIdx.get(na))} × ${label(tIdx.get(nb))}`, (await screen(page)).detail)
        // Trial header card and the legend's glosses.
        const hb = await page.$(':is(.ov-matrix .ov-rowh, .ov-hg .hg-rowh) .hc-trigger')
        const hbb = await hb.boundingBox()
        await page.mouse.move(hbb.x + 10, hbb.y + 10)
        await sleep(450)
        const hcard = await visibleCard(page)
        const T = dDefault.trials[0]
        check(
          `${tag} row header card: label, NCT, sites, criteria source`,
          !!hcard && hcard.text.includes(label(T)) && hcard.text.includes(T.nct_id) && hcard.text.includes(`${T.n_sites} registered sites`) && /Hand-encoded and reviewed|Rule-based parse, unreviewed/.test(hcard.text),
          hcard?.text,
        )
        await page.mouse.move(5, 5)
        await sleep(400)
        const ub = await page.evaluateHandle(() => [...document.querySelectorAll('.ov-legend .hc-trigger')].find((b) => b.textContent === 'Upper bound'))
        const ubb = await ub.asElement().boundingBox()
        await page.mouse.move(ubb.x + 5, ubb.y + 5)
        await sleep(450)
        const lcard = await visibleCard(page)
        check(`${tag} legend "Upper bound" tooltip`, lcard?.role === 'tooltip' && lcard.text.startsWith('A ceiling, not a measurement.'), lcard?.text)
        errors.push(...page.__log.errors)
        await ctx.close()
      }

    // ------------------------------------------------------------------ 3. flows: list, clear, preset, stale, date, per-site, tab switch
    if (run('flows')) {
      const tag = '[flows]'
      const { ctx, page } = await openPage(browser, { density: 'simple' })
      await ready(page)
      // Pair list
      await page.evaluate(() => [...document.querySelectorAll('.ov-mode .seg-btn')].find((b) => b.innerText === 'Pair list').click())
      await page.waitForSelector('.ov-pairs tbody tr')
      const rows = await page.$$eval('.ov-pairs tbody tr', (rs) => rs.map((r) => [...r.children].map((c) => c.innerText.trim())))
      eq(`${tag} pair list rows`, dDefault.pairs.length, rows.length)
      const badList = rows.filter((r) => {
        const p = dDefault.pairs.find((x) => x.p === r[0] && x.q === r[1])
        return !p || JSON.stringify([String(p.shared_sites), pct(p.o_pq), pct(p.o_qp), `${num1(p.months_both_recruiting_estimated)} mo`]) !== JSON.stringify(r.slice(2, 6))
      })
      check(`${tag} pair list values = API`, badList.length === 0, badList.slice(0, 3))
      const markRows = rows.filter((r) => {
        const p = dDefault.pairs.find((x) => x.p === r[0] && x.q === r[1])
        return (p.upper_bound && !r[6].includes('Upper bound')) || (p.unreviewed_criteria && !r[6].includes('Unreviewed'))
      })
      check(`${tag} pair list marks spelled out`, markRows.length === 0, markRows.length)
      const target = rows[3]
      await page.evaluate((a, b) => [...document.querySelectorAll('.ov-pairs tbody tr')].find((r) => r.children[0].innerText.trim() === a && r.children[1].innerText.trim() === b).click(), target[0], target[1])
      await sleep(300)
      const tIdx = new Map(dDefault.trials.map((t) => [t.nct_id, t]))
      eq(`${tag} list row selects the pair`, `${label(tIdx.get(target[0]))} × ${label(tIdx.get(target[1]))}`, (await screen(page)).detail)
      const figs = await page.$$eval('.ov-detail .ov-fact', (fs) => fs.map((f) => f.querySelector('dd').innerText.replace(/\s+/g, ' ').trim()))
      const p2 = dDefault.pairs.find((x) => x.p === target[0] && x.q === target[1])
      check(
        `${tag} pair detail figures = API`,
        figs[0]?.startsWith(String(p2.shared_sites)) && figs[1]?.startsWith(pct(p2.o_pq)) && figs[2]?.startsWith(pct(p2.o_qp)) && figs[3]?.startsWith(`${num1(p2.months_both_recruiting_estimated)} months`),
        figs,
      )
      check(`${tag} pair detail keeps upper-bound mark next to the share`, !p2.upper_bound || (figs[1].includes('Upper bound') && figs[2].includes('Upper bound')), figs[1])
      const heads = await page.$$eval('.ov-detail .ov-pblock h3', (h) => h.map((x) => x.innerText))
      const same = p2.criteria_diff.shared.filter((g) => g.same).length
      eq(
        `${tag} criteria compare headings = API`,
        JSON.stringify([`Criteria in both (${same})`, `Restricted differently (${p2.criteria_diff.shared.length - same})`, `Only in ${label(tIdx.get(p2.p))} (${p2.criteria_diff.only_p.length})`, `Only in ${label(tIdx.get(p2.q))} (${p2.criteria_diff.only_q.length})`]),
        JSON.stringify(heads),
      )
      // Shared sites table inside its disclosure.
      await page.evaluate(() => [...document.querySelectorAll('.ov-detail details > summary')].find((s) => s.innerText.startsWith('Shared sites')).click())
      await sleep(200)
      const siteRows = await page.$$eval('.ov-detail .ov-sites-tbl tbody tr', (rs) => rs.map((r) => r.children[1].innerText.trim()))
      eq(`${tag} shared site rows = API`, JSON.stringify(p2.shared_site_ids.map((id) => (dDefault.sites[id].other_sponsor_trials === null ? '—' : String(dDefault.sites[id].other_sponsor_trials)))), JSON.stringify(siteRows))
      await page.evaluate(() => [...document.querySelectorAll('.ov-mode .seg-btn')].find((b) => b.innerText === 'Matrix').click())
      // Clear selection
      await page.click('.ov-clear')
      await sleep(200)
      check(`${tag} Clear selection hides the pair detail`, !(await page.$('.ov-detail')))
      // Per-site counts (Simple: inside the trials disclosure)
      await page.evaluate(() => document.querySelector('.ov-trials details > summary').click())
      await sleep(150)
      const t0 = dDefault.trials[0]
      await page.evaluate(() => document.querySelector('.ov-trials .ov-sites-btn').click())
      await sleep(250)
      const per = await page.$$eval('.ov-trow-sites tbody tr', (rs) => rs.map((r) => r.children[1].innerText.trim()))
      eq(`${tag} per-site counts = API (${t0.nct_id})`, JSON.stringify(t0.site_ids.map((id) => (dDefault.sites[id].other_sponsor_trials === null ? '—' : String(dDefault.sites[id].other_sponsor_trials)))), JSON.stringify(per))
      // Tab switch keeps the view's state.
      await page.evaluate(() => [...document.querySelectorAll('nav.tabs button')].find((b) => b.innerText.startsWith('Findings')).click())
      await sleep(600)
      await page.evaluate(() => [...document.querySelectorAll('nav.tabs button')].find((b) => b.innerText.startsWith('Portfolio overlap')).click())
      await ready(page)
      eq(`${tag} sponsor kept across a tab switch`, defSponsor, (await screen(page)).sponsor)
      // Stale state: a slow response keeps the old matrix, dimmed, with "Updating…".
      page.__delay = 2500
      await page.select('.ov-f-region select', 'US')
      await page.waitForFunction(() => document.querySelector('.ov-updating')?.textContent === 'Updating…', { timeout: 8000 }).catch(() => {})
      const stale = await page.evaluate(() => ({ upd: document.querySelector('.ov-updating')?.textContent, dim: !!document.querySelector('.ov-win.ov-stale'), busy: !!document.querySelector('.ov-win [aria-busy="true"]') }))
      check(`${tag} stale state: "Updating…", dimmed, aria-busy`, stale.upd === 'Updating…' && stale.dim && stale.busy, stale)
      await page.screenshot({ path: path.join(OUT, 'flow-stale.png') })
      page.__delay = 0
      await ready(page)
      const dUS = await apiGet(auditPath({ sponsor: defSponsor, region: 'US' }))
      eq(`${tag} region change reloads (U.S. sites)`, `${dUS.trials.length} trials recruiting on ${longDate(dUS.as_of)} · ${dUS.pairs.length} pairs`, (await screen(page)).sum)
      eq(`${tag} control change resets the hash`, '#overlap', (await screen(page)).hash)
      // A date after the snapshot is refused.
      const later = `${Number(snapshot.slice(0, 4)) + 1}${snapshot.slice(4)}`
      await page.evaluate((v) => {
        const i = document.querySelector('.ov-f-date input')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v)
        i.dispatchEvent(new Event('input', { bubbles: true }))
      }, later)
      await sleep(300)
      const inv = await page.$eval('.ov-invalid', (e) => e.innerText).catch(() => null)
      check(`${tag} date after the snapshot refused`, !!inv && inv.includes('Later dates would be projections') && inv.includes(longDate(snapshot)), inv)
      await page.evaluate(() => document.querySelector('.ov-invalid button').click())
      await ready(page)
      check(`${tag} "Use snapshot" restores the snapshot date`, !(await page.$('.ov-invalid')))
      // Preset button
      const log0 = page.__log.requests.length
      await page.click('.ov-preset')
      await page.waitForFunction(() => (document.querySelector('.ov-sumline')?.innerText ?? '').includes('September 1, 2024'), { timeout: 60000 })
      await ready(page)
      const dR = await apiGet('/api/overlap?sponsor=Regeneron+Pharmaceuticals&as_of=2024-09-01&region=US')
      const sR = await screen(page)
      eq(`${tag} preset hash`, '#overlap/regeneron', sR.hash)
      check(`${tag} preset request`, page.__log.requests.slice(log0).includes('/api/overlap?sponsor=Regeneron+Pharmaceuticals&as_of=2024-09-01&region=US'), page.__log.requests.slice(log0))
      eq(`${tag} preset summary (estimated)`, `${dR.trials.length} trials estimated recruiting on September 1, 2024 · ${dR.pairs.length} pairs`, sR.sum)
      eq(`${tag} preset selects the fianlimab pair`, 'NCT05785767 × NCT05800015', sR.detail)
      const closed = dR.trials.filter((t) => !t.recruiting_at_snapshot).length
      check(`${tag} preset: closed-since note visible in Simple`, sR.notes.some((n) => n.includes(closed === dR.trials.length ? `All ${closed}` : `${closed} of ${dR.trials.length}`) && n.includes('estimated')), sR.notes)
      await page.screenshot({ path: path.join(OUT, 'flow-preset-simple.png'), fullPage: true })
      errors.push(...page.__log.errors)
      await ctx.close()
    }

    // ------------------------------------------------------------------ 4. deep links
    if (run('links')) {
      const links = [
        ['#overlap/regeneron', { sponsor: 'Regeneron Pharmaceuticals', as_of: '2024-09-01', region: 'US' }, 'NCT05785767 × NCT05800015'],
        ['#overlap/merck', { sponsor: 'Merck Sharp & Dohme LLC' }],
        ['#overlap/merck/us', { sponsor: 'Merck Sharp & Dohme LLC', region: 'US' }],
        ['#overlap/astrazeneca/us', { sponsor: 'AstraZeneca', region: 'US' }],
        ['#overlap/novartis', { sponsor: 'Novartis Pharmaceuticals' }],
        ['#overlap/no-such-sponsor-xyz', { sponsor: defSponsor }],
      ]
      for (const [hash, q, pair] of links) {
        for (const density of hash.includes('astrazeneca') || hash.includes('novartis') ? ['simple', 'detailed'] : ['simple']) {
          const tag = `[link ${hash} ${density}]`
          const { ctx, page } = await openPage(browser, { hash, density })
          await ready(page)
          const d = await apiGet(auditPath(q))
          const s = await screen(page)
          eq(`${tag} sponsor`, q.sponsor, s.sponsor)
          eq(`${tag} region`, q.region ?? '', s.region)
          eq(`${tag} summary`, `${d.trials.length} trials ${d.basis === 'registry' ? '' : 'estimated '}recruiting on ${longDate(d.as_of)} · ${d.pairs.length} pairs`, s.sum)
          if (pair) eq(`${tag} selected pair`, pair, s.detail)
          if (hash.includes('no-such')) check(`${tag} unknown sponsor explained`, s.notes.some((n) => n.startsWith('No sponsor named “no such sponsor xyz”')), s.notes)
          if (d.trials.length >= 2) await checkMatrix(page, d, density, tag)
          if (hash.includes('astrazeneca')) {
            check(`${tag} anonymized-sponsor note (copy deck B6)`, (s.anon ?? '').startsWith('This sponsor lists its sites on ClinicalTrials.gov only as anonymized'), s.anon)
            const legend = await page.$eval('.ov-legend', (e) => e.innerText)
            check(`${tag} legend explains "No number"`, legend.includes('No number'), legend)
          }
          if (hash.includes('novartis')) {
            const hx = await page.$$eval('.ov-matrix .ov-cell.ov-hx, .ov-hg .hg-cell.ov-hx', (e) => e.length)
            const nonInf = d.pairs.filter((p) => !p.overlap_informative).length * (density === 'detailed' ? 2 : 1)
            eq(`${tag} hatched cells = uninformative pairs (${density === 'detailed' ? 'both halves' : 'once each'})`, nonInf, hx)
          }
          await page.screenshot({ path: path.join(OUT, `link-${hash.slice(1).replace(/\//g, '_')}-${density}.png`), fullPage: false })
          errors.push(...page.__log.errors)
          await ctx.close()
        }
      }
      // A link followed while the tab is open.
      const { ctx, page } = await openPage(browser, { hash: '#overlap' })
      await ready(page)
      await page.evaluate(() => {
        location.hash = '#overlap/bristol/us'
      })
      await page.waitForFunction(() => (document.querySelector('.ov-f-sponsor select')?.value ?? '').startsWith('Bristol'), { timeout: 30000 }).catch(() => {})
      await ready(page)
      const s = await screen(page)
      const dB = await apiGet(auditPath({ sponsor: 'Bristol-Myers Squibb', region: 'US' }))
      eq('[link while open] sponsor', 'Bristol-Myers Squibb', s.sponsor)
      eq('[link while open] summary', `${dB.trials.length} trials recruiting on ${longDate(dB.as_of)} · ${dB.pairs.length} pairs`, s.sum)
      await page.evaluate(() => {
        location.hash = '#overlap/regeneron'
      })
      await page.waitForFunction(() => (document.querySelector('.ov-detail h2')?.innerText ?? '').includes('NCT05785767'), { timeout: 60000 }).catch(() => {})
      await ready(page)
      eq('[link while open] preset', 'NCT05785767 × NCT05800015', (await screen(page)).detail)
      errors.push(...page.__log.errors)
      await ctx.close()
    }

    // ------------------------------------------------------------------ 5. phone: tap, bottom sheet, touch targets
    if (run('phone'))
      for (const density of ['simple', 'detailed']) {
        const tag = `[phone ${density}]`
        const { ctx, page } = await openPage(browser, { width: 390, density })
        await ready(page)
        const tIdx = new Map(dDefault.trials.map((t) => [t.nct_id, t]))
        const pick = dDefault.pairs.find((p) => p.upper_bound && known(tIdx.get(p.p), tIdx.get(p.q)) && p.p !== dDefault.trials[0].nct_id) ?? dDefault.pairs[5]
        const key = `${pick.p}|${pick.q}`
        // Centre the cell in the matrix scroller first: the sticky row header would cover a cell scrolled to its edge.
        await page.$eval(cellBtn(key), (e) => e.scrollIntoView({ block: 'center', inline: 'center' }))
        await sleep(200)
        await page.tap(cellBtn(key))
        await sleep(450)
        const card = await visibleCard(page)
        checkPairCard(card, dDefault, key, density, `${tag} tap`)
        check(
          `${tag} bottom sheet (full width, at the bottom)`,
          !!card && Math.abs(card.l - 12) <= 1 && Math.abs(card.vw - 12 - card.r) <= 1 && Math.abs(card.vh - 12 - card.b) <= 2,
          card && { l: card.l, r: card.r, b: card.b, vw: card.vw, vh: card.vh },
        )
        eq(`${tag} tap selects the pair`, `${label(tIdx.get(pick.p))} × ${label(tIdx.get(pick.q))}`, (await screen(page)).detail)
        await page.screenshot({ path: path.join(OUT, `phone-${density}-tap-sheet.png`) })
        await page.tap('h1')
        await sleep(300)
        check(`${tag} tap outside closes the sheet`, !(await visibleCard(page)))
        const small = await page.evaluate(() =>
          [...document.querySelectorAll('main button, main select, main input, main summary')]
            .filter((e) => e.offsetParent !== null && !e.closest('.hc-card') && !e.classList.contains('hc-info'))
            .map((e) => {
              const r = e.getBoundingClientRect()
              return { cls: e.className, text: (e.innerText || e.getAttribute('aria-label') || e.value || '').slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), inline: !!e.closest('p, li, dd, .ov-legend, .qual, .ov-runline') }
            })
            .filter((c) => !c.inline && (c.h < 44 || c.w < 44)),
        )
        check(`${tag} touch targets >= 44 px (controls outside running text)`, small.length === 0, small.slice(0, 8))
        const s = await screen(page)
        check(`${tag} no horizontal page scroll`, s.sw <= s.iw, `${s.sw} / ${s.iw}`)
        errors.push(...page.__log.errors)
        await ctx.close()
      }

    // ------------------------------------------------------------------ 6. grid: sponsors x densities x themes x widths
    // Simple's half grid and Detailed's full matrix against the API for Merck (worldwide and U.S.), AstraZeneca (every
    // site anonymized: no numbers anywhere), Novartis (mixed: some pairs uncountable, some uninformative) and the
    // Regeneron preset; a pair card (hover on desktop, tap on phones) and a selection each; keyboard focus and Escape.
    if (run('grid')) {
      const configs = [
        ['#overlap/merck', { sponsor: 'Merck Sharp & Dohme LLC' }],
        ['#overlap/merck/us', { sponsor: 'Merck Sharp & Dohme LLC', region: 'US' }],
        ['#overlap/astrazeneca', { sponsor: 'AstraZeneca' }],
        ['#overlap/novartis', { sponsor: 'Novartis Pharmaceuticals' }],
        ['#overlap/regeneron', { sponsor: 'Regeneron Pharmaceuticals', as_of: '2024-09-01', region: 'US' }, ['NCT05785767', 'NCT05800015']],
      ]
      const bodies = new Map()
      for (const [hash, q, preset] of configs)
        for (const density of ['simple', 'detailed'])
          for (const theme of ['light', 'dark'])
            for (const width of [1440, 390]) {
              const tag = `[grid ${hash} ${density} ${theme} ${width}]`
              const { ctx, page } = await openPage(browser, { hash, density, theme, width })
              await ready(page)
              if (!bodies.has(hash)) bodies.set(hash, await apiGet(auditPath(q)))
              const d = bodies.get(hash)
              const tIdx = new Map(d.trials.map((t) => [t.nct_id, t]))
              const s = await screen(page)
              eq(`${tag} sponsor`, q.sponsor, s.sponsor)
              eq(`${tag} summary`, `${d.trials.length} trials ${d.basis === 'registry' ? '' : 'estimated '}recruiting on ${longDate(d.as_of)} · ${d.pairs.length} pairs`, s.sum)
              await checkMatrix(page, d, density, tag)
              if (preset) {
                const sel = await page.$$eval(`${CELL.split(', ').map((c) => `${c}.ov-sel`).join(', ')}`, (e) => e.map((x) => x.dataset.cell))
                eq(`${tag} preset: the fianlimab pair's cell is selected`, JSON.stringify(density === 'detailed' ? [preset.join('|'), [...preset].reverse().join('|')] : [preset.join('|')]), JSON.stringify(sel))
              }
              check(`${tag} no horizontal page scroll`, s.sw <= s.iw, `${s.sw} / ${s.iw}`)
              const box = await page.$eval('.ov-win .ov-mscroll', (e) => ({ sw: e.scrollWidth, cw: e.clientWidth, ox: getComputedStyle(e).overflowX }))
              check(`${tag} the matrix box scrolls sideways when it must (overflow-x auto)`, box.ox === 'auto', box)
              if (density === 'simple') {
                // The sticky headers cover the gaps beside them only while the box is scrolled; unscrolled, a cover
                // would paint over the left side of the first column's selection and focus rings.
                const cover = await page.evaluate(async () => {
                  const b = document.querySelector('.ov-win .ov-mscroll')
                  const hs = [...b.querySelectorAll('.ov-hg :is(.hg-rowh, .hg-corner)')]
                  const st = () => ({ sl: b.scrollLeft, attr: b.hasAttribute('data-scrolled'), covered: hs.filter((h) => getComputedStyle(h).boxShadow !== 'none').length, of: hs.length })
                  const wait = () => new Promise((r) => setTimeout(r, 150))
                  const prev = b.scrollLeft
                  b.scrollLeft = 0
                  await wait()
                  const at0 = st()
                  let moved = null
                  if (b.scrollWidth > b.clientWidth) {
                    b.scrollLeft = 40
                    await wait()
                    moved = st()
                  }
                  b.scrollLeft = prev
                  await wait()
                  return { at0, moved, back: st() }
                })
                check(`${tag} half grid unscrolled: no gap cover on the sticky headers`, !cover.at0.attr && cover.at0.covered === 0, cover.at0)
                if (cover.moved) check(`${tag} half grid scrolled: every sticky header covers its gaps`, cover.moved.attr && cover.moved.covered === cover.moved.of, cover.moved)
                check(`${tag} half grid: cover state follows the scroll position`, cover.back.attr === cover.back.sl > 0, cover.back)
              }
              await page.evaluate(() => window.scrollTo(0, 0))
              const name = `grid-${hash.slice(1).replace(/\//g, '_')}-${density}-${theme}-${width}`
              await (await page.$('.ov-win')).screenshot({ path: path.join(OUT, `${name}-matrix.png`) })
              // A pair card: an uncountable pair when there is one (the card must say so and still give both shares),
              // else an upper-bound pair.
              const pick =
                d.pairs.find((p) => !known(tIdx.get(p.p), tIdx.get(p.q)) && p.overlap_informative) ??
                d.pairs.find((p) => p.upper_bound && known(tIdx.get(p.p), tIdx.get(p.q))) ??
                d.pairs[0]
              const key = `${pick.p}|${pick.q}`
              await page.$eval(cellBtn(key), (e) => e.scrollIntoView({ block: 'center', inline: 'center' }))
              await sleep(250)
              if (width < 600) {
                await page.tap(cellBtn(key))
                await sleep(450)
                const card = await visibleCard(page)
                checkPairCard(card, d, key, density, `${tag} tap`)
                check(
                  `${tag} tap: bottom sheet`,
                  !!card && Math.abs(card.l - 12) <= 1 && Math.abs(card.vw - 12 - card.r) <= 1 && Math.abs(card.vh - 12 - card.b) <= 2,
                  card && { l: card.l, r: card.r, b: card.b, vw: card.vw, vh: card.vh },
                )
                await page.screenshot({ path: path.join(OUT, `${name}-card.png`) })
              } else {
                const b = await (await page.$(cellBtn(key))).boundingBox()
                await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
                await sleep(450)
                const card = await visibleCard(page)
                checkPairCard(card, d, key, density, `${tag} hover`)
                await page.screenshot({ path: path.join(OUT, `${name}-card.png`) })
                await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
              }
              await page.waitForFunction((t) => (document.querySelector('.ov-detail h2')?.innerText ?? '').replace(/\s+/g, ' ').trim() === t, { timeout: 5000 }, `${label(tIdx.get(pick.p))} × ${label(tIdx.get(pick.q))}`).catch(() => {})
              eq(`${tag} ${width < 600 ? 'tap' : 'click'} selects the pair (pair detail)`, `${label(tIdx.get(pick.p))} × ${label(tIdx.get(pick.q))}`, (await screen(page)).detail)
              const selNow = await page.$$eval('.ov-sel[data-cell]', (e) => e.map((x) => x.dataset.cell))
              check(`${tag} the selected cell is marked`, selNow.includes(key), selNow)
              if (width >= 600) {
                await page.keyboard.press('Escape')
                await sleep(150)
                check(`${tag} Escape closes the card`, !(await visibleCard(page)))
                // Keyboard: Tab from a cell onto the next one in its row opens that cell's card.
                const want = await page.evaluate(
                  (key, sel) => {
                    const all = [...document.querySelectorAll(sel)]
                    const i = all.findIndex((c) => c.dataset.cell === key)
                    const row = (c) => c?.dataset.cell.split('|')[0]
                    const fwd = row(all[i + 1]) === row(all[i])
                    ;(fwd ? all[i] : all[i - 2])?.querySelector('button')?.focus()
                    return (fwd ? all[i + 1] : all[i - 1])?.dataset.cell
                  },
                  key,
                  CELL,
                )
                await page.keyboard.press('Tab')
                await sleep(300)
                const fk = await page.evaluate(() => document.activeElement?.closest('[data-cell]')?.dataset.cell)
                eq(`${tag} Tab moves to the next cell`, want, fk)
                if (fk) checkPairCard(await visibleCard(page), d, fk, density, `${tag} keyboard focus`)
                await page.keyboard.press('Escape')
                await sleep(150)
                check(`${tag} Escape closes the focused card`, !(await visibleCard(page)))
              }
              const s2 = await screen(page)
              check(`${tag} no horizontal page scroll after the card`, s2.sw <= s2.iw, `${s2.sw} / ${s2.iw}`)
              errors.push(...page.__log.errors)
              await ctx.close()
            }
    }
  } catch (e) {
    check('script ran to the end', false, String(e && e.stack ? e.stack : e))
  } finally {
    await browser.close()
  }
  check('no page or console errors, no API errors', errors.length === 0, errors.slice(0, 10))
  const failed = results.filter((r) => !r.ok)
  fs.writeFileSync(path.join(OUT, 'overlap.json'), JSON.stringify({ base: BASE, api: API, results, errors }, null, 2))
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
  process.exit(failed.length ? 1 : 0)
})()
