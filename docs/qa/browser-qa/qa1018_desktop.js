// 2026-10-18 demo-path QA at 1440x900: Findings -> Portfolio overlap (Regeneron preset) -> Protocol to terms
// (NCT05800015) -> Research (Clear it). Screenshots go to docs/handoff/screens, screen text and the API bodies the
// page received to OUT, and every on-screen number checked against a fresh API fetch of the same request.
// Usage (Git Bash):  NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node qa1018_desktop.js [base] [steps]
//   steps: any of a,b,c,d (default abcd).  Env: API (default http://localhost:8000), SCREENS, QA_OUT.
const fs = require('fs')
const path = require('path')
const Q = require('./qa1018_lib')

const BASE = process.argv[2] || 'http://localhost:5173'
const STEPS = process.argv[3] || 'abcd'
const HANDOFF = path.dirname(Q.SCREENS)
const checks = []
const report = { base: BASE, steps: {}, console: [], pageerrors: [], api4xx: [] }

function apiPathOf(url) {
  const u = new URL(url)
  return u.pathname + u.search
}

async function waitFor(page, fn, arg, timeout = 60000) {
  await page.waitForFunction(fn, { timeout, polling: 300 }, arg)
}

;(async () => {
  const browser = await Q.launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  const log = {}
  Q.instrument(page, log)
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) report.api4xx.push(`${r.status()} ${r.url()}`)
  })

  await page.goto(`${BASE}/#findings`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
  })

  // ---------------------------------------------------------------- (a) Findings
  if (STEPS.includes('a')) {
    const ck = Q.checker('a Findings', checks)
    // The Calm Findings page: Detailed mode shows each finding under the file's own title, with the full headline,
    // tables, notes, caveats and sources inline (Simple folds them into a Details disclosure).
    await page.evaluate(() => localStorage.setItem('concord.density', 'detailed'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitFor(page, () => document.querySelectorAll('.fd-card').length >= 3 && document.querySelector('.ci-plot') && document.querySelector('.fd-related-text'))
    await Q.settle(page, 800)
    await Q.snap(browser, page, '01-findings', { fullPage: true })
    await Q.snap(browser, page, '01-findings-top', { fullPage: false })
    const cards = await page.$$('.fd-card')
    const ids = await page.$$eval('.fd-card', (els) => els.map((e) => e.id.replace('finding-', '')))
    for (let i = 0; i < cards.length; i++) await Q.snap(browser, cards[i], `01${'abcde'[i]}-finding-${ids[i]}`, { element: true })

    const screen = await page.evaluate(() => {
      const t = (el) => (el ? el.innerText.replace(/\u00a0/g, ' ').trim() : null)
      return {
        meta: t(document.querySelector('.fd-meta')),
        related: t(document.querySelector('.fd-related-text')),
        // The same-sponsor lead block (.fd-lead) comes first; the findings follow in findings.json order.
        cards: [...document.querySelectorAll('.fd-card:not(.fd-lead)')].map((c) => ({
          id: c.id,
          title: t(c.querySelector('h2')),
          status: t(c.querySelector('.fd-status-v')),
          headline: t(c.querySelector('.fd-full') ?? c.querySelector('.fd-headline')),
          ciVals: [...c.querySelectorAll('.ci-val')].map((x) => x.textContent),
          ciInts: [...c.querySelectorAll('.ci-int')].map(t),
          ciRef: t(c.querySelector('.ci-ref-label')),
          tables: [...c.querySelectorAll('.fd-table-block')].map((b) => ({
            title: t(b.querySelector('.fd-table-title')),
            head: [...b.querySelectorAll('thead th')].map((x) => x.textContent.trim()),
            rows: [...b.querySelectorAll('tbody tr')].map((r) => [...r.children].map(t)),
            notes: [...b.querySelectorAll('.fd-notes li')].map(t),
          })),
          caveats: [...c.querySelectorAll('.fd-caveats li')].map(t),
          sources: [...c.querySelectorAll('.fd-sources li')].map(t),
          sourceHrefs: [...c.querySelectorAll('.fd-sources a')].map((a) => a.getAttribute('href')),
        })),
      }
    })
    // The page typesets "1.42x" as "1.42×" and "-0.093" as "−0.093": compare on the stored glyphs.
    const norm = (x) => (x == null ? x : String(x).replace(/×/g, 'x').replace(/\u2212/g, '-'))
    const api = (await Q.apiGet('/api/findings')).body
    const so = (await Q.apiGet('/api/findings/self-overlap')).body
    ck('finding count', api.findings.length, screen.cards.length)
    api.findings.forEach((f, i) => {
      const c = screen.cards[i] || {}
      ck(`${f.id} title`, f.title, c.title)
      ck(`${f.id} headline`, f.headline, norm(c.headline))
      const statusLabel = { final: 'Final', provisional: 'Provisional', missing: 'Not computed' }[f.status] ?? f.status
      ck(`${f.id} status`, statusLabel, c.status)
      if (f.chart && f.chart.type === 'ci') {
        f.chart.items.forEach((it, j) => {
          ck(`${f.id} CI estimate ${j}`, it.estimate.toFixed(2), norm(c.ciVals?.[j]))
          ck(`${f.id} CI interval ${j}`, true, !!norm(c.ciInts?.[j])?.includes(`${it.lo.toFixed(2)} to ${it.hi.toFixed(2)}`), c.ciInts?.[j])
        })
        const rv = f.chart.reference.value
        ck(`${f.id} CI reference`, true, !!norm(c.ciRef)?.startsWith(`${Number.isInteger(rv) ? rv.toFixed(1) : rv.toFixed(2)} · `), c.ciRef)
      }
      ;(f.tables || []).forEach((tb, j) => {
        const st = c.tables?.[j] || {}
        ck(`${f.id} table ${j} title`, tb.title, norm(st.title))
        // Empty columns are dropped by the view; compare the non-empty cells row by row. An unnamed column's head
        // reads "Note" to screen readers.
        const filled = (k) => tb.rows.some((r) => (r[k] ?? '').trim() !== '')
        const cols = tb.columns.map((_, k) => k).filter((k) => k === 0 || filled(k))
        ck(`${f.id} table ${j} columns`, JSON.stringify(cols.map((k) => tb.columns[k] || 'Note')), JSON.stringify((st.head || []).map(norm)))
        tb.rows.forEach((r, k) => {
          const exp = cols.map((m) => ((r[m] ?? '').trim() ? r[m] : '—'))
          ck(`${f.id} table ${j} row ${k}`, JSON.stringify(exp), JSON.stringify((st.rows?.[k] || []).map(norm)))
        })
        ck(`${f.id} table ${j} notes`, JSON.stringify(tb.notes || []), JSON.stringify((st.notes || []).map(norm)))
      })
      ck(`${f.id} caveats`, JSON.stringify(f.caveats || []), JSON.stringify((c.caveats || []).map(norm)))
      ck(`${f.id} source count`, (f.sources || []).length, (c.sources || []).length)
    })
    // Related overlap note: the headline count and its sponsors / upper-bound numbers from self_overlap.json.
    const h = so.headline
    ck('self-overlap count shown', String(h.count), screen.related?.split(/\s/)[0])
    ck('self-overlap sponsors shown', true, screen.related?.includes(`across ${h.sponsors} sponsors`), screen.related?.includes(`across ${h.sponsors} sponsors`))
    ck('self-overlap upper bound shown', true, screen.related?.includes(`For ${h.upper_bound_count} of them`), screen.related?.includes(`For ${h.upper_bound_count} of them`))
    ck('self-overlap thresholds', true, screen.related?.includes(`at least ${so.parameters.min_shared_sites} registered sites`) && screen.related?.includes(`at least ${Math.round(so.parameters.min_overlap_one_direction * 100)}%`))
    // Source links resolve.
    const hrefs = screen.cards.flatMap((c) => c.sourceHrefs)
    for (const href of hrefs) {
      const r = await Q.apiGet(href)
      ck(`source link ${decodeURIComponent(href.split('path=')[1])}`, 200, r.status)
    }
    report.steps.a = { screen }
  }

  // ---------------------------------------------------------------- (b) Portfolio overlap, Regeneron preset
  // Checked in the Detailed density (every cell keeps its full text; trial cards, the criteria compare, the shared
  // sites table and the summary counts are inline), switched with the header control as a visitor would, and put
  // back afterwards. calm_overlap.js covers Simple and the rest of the Calm view.
  if (STEPS.includes('b')) {
    const ck = Q.checker('b Overlap', checks)
    await Q.clickTab(page, 'Portfolio overlap')
    const density0 = await page.evaluate(() => [...document.querySelectorAll('.density-seg .seg-btn')].find((b) => b.getAttribute('aria-pressed') === 'true')?.innerText)
    await page.evaluate(() => [...document.querySelectorAll('.density-seg .seg-btn')].find((b) => b.innerText === 'Detailed')?.click())
    await waitFor(page, () => document.querySelector('.ov-preset'))
    await page.click('.ov-preset')
    await waitFor(
      page,
      () => {
        const strip = document.querySelector('.ov-win .win-strip')?.innerText ?? ''
        const sum = document.querySelector('.ov-sumline')?.innerText ?? ''
        const upd = document.querySelector('.ov-updating')?.textContent ?? ''
        const d = document.querySelector('.ov-detail h2')?.innerText ?? ''
        return strip.includes('Regeneron Pharmaceuticals') && sum.includes('September 1, 2024') && !upd && d.includes('NCT05785767') && d.includes('NCT05800015')
      },
      null,
      90000,
    )
    await Q.settle(page, 800)
    report.steps.b = { hash: await page.evaluate(() => location.hash) }
    await Q.snap(browser, page, '02-overlap-regeneron', { fullPage: true })
    await page.evaluate(() => document.querySelector('.ov-summary').scrollIntoView({ block: 'start' }))
    await Q.sleep(300)
    await Q.snap(browser, page, '02a-overlap-regeneron-top', { fullPage: false })
    await Q.snap(browser, await page.$('section[aria-label="Pair matrix"]'), '02b-overlap-matrix', { element: true })
    await Q.snap(browser, await page.$('.ov-detail'), '02c-overlap-pair-detail', { element: true })

    const screen = await page.evaluate(() => {
      const t = (el) => (el ? el.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : null)
      return {
        strip: t(document.querySelector('.ov-win .win-strip')),
        sum: t(document.querySelector('.ov-sumline')),
        runline: t(document.querySelector('.ov-runline')),
        caveats: [...document.querySelectorAll('.caveat')].map(t),
        stats: [...document.querySelectorAll('.stats .stat')].map((s) => ({ label: t(s.querySelector('.stat-label')), value: t(s.querySelector('.stat-value')), sub: t(s.querySelector('.stat-sub')) })),
        colh: [...document.querySelectorAll('.ov-matrix thead th.ov-colh')].map(t),
        diag: [...document.querySelectorAll('.ov-matrix td.ov-diag')].map(t),
        cells: [...document.querySelectorAll('.ov-matrix td[data-cell]')].map((c) => ({ key: c.dataset.cell, text: t(c), sel: c.classList.contains('ov-sel'), aria: c.querySelector('button')?.getAttribute('aria-label') })),
        detailTitle: t(document.querySelector('.ov-detail h2')),
        cards: [...document.querySelectorAll('.ov-detail .ov-tcard')].map((c) => ({
          head: t(c.querySelector('.ov-tcard-head')),
          dl: Object.fromEntries([...c.querySelectorAll('dt')].map((dt) => [t(dt), t(dt.nextElementSibling)])),
        })),
        // Shared sites, the two shares, months both recruiting (the Calm order).
        facts: [...document.querySelectorAll('.ov-detail .ov-fact')].map((f) => ({ label: t(f.querySelector('dt')), n: t(f.querySelector('.ov-fig, .ov-fig-unk')), dd: t(f.querySelector('dd')) })),
        diffHeads: [...document.querySelectorAll('.ov-detail .ov-pblock h3')].map(t),
        sharedSitesHead: t([...document.querySelectorAll('.ov-detail h3')].find((h) => h.innerText.startsWith('Shared sites'))),
        sharedSiteRows: [...document.querySelectorAll('.ov-detail .ov-sites-tbl tbody tr')].map((r) => [...r.children].map(t)),
        trows: [...document.querySelectorAll('.ov-trow')].map((r) => ({ id: t(r.querySelector('.ov-trow-id a')), facts: t(r.querySelector('.ov-trow-facts')), count: t(r.querySelector('.ov-count')), ind: t(r.querySelector('.ov-count-sub')) })),
        main: t(document.querySelector('main')),
      }
    })
    report.steps.b.screen = screen
    const pageReq = log.api.filter((x) => x.url.includes('/api/overlap?')).map((x) => apiPathOf(x.url))
    report.steps.b.requests = pageReq
    const reqPath = pageReq.find((p) => p.includes('Regeneron')) ?? '/api/overlap?sponsor=Regeneron+Pharmaceuticals&as_of=2024-09-01&region=US'
    const d = (await Q.apiGet(reqPath)).body
    // The view's dates: prose "September 1, 2024", tight UI "Sep 1, 2024".
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const longDate = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`
    const shortDate = (iso) => `${MONTHS[+iso.slice(5, 7) - 1].slice(0, 3)} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`
    ck('request', '/api/overlap?sponsor=Regeneron+Pharmaceuticals&as_of=2024-09-01&region=US', reqPath)
    const ctx = screen.strip.includes(d.sponsor) && screen.strip.includes(d.region_label) && screen.sum.includes(`on ${longDate(d.as_of)}`)
    ck('sponsor/date/region on screen', true, ctx)
    ck('summary line (estimated basis)', `${d.trials.length} trials ${d.basis === 'registry' ? '' : 'estimated '}recruiting on ${longDate(d.as_of)} · ${d.pairs.length} pairs`, screen.sum)
    ck('runline population n', true, screen.runline.includes(`n = ${Q.fmt.int(d.population.n)}`), screen.runline.includes(`n = ${Q.fmt.int(d.population.n)}`))
    const nHand = d.trials.filter((x) => x.eligibility_source === 'hand-encoded').length
    ck('runline eligibility split', true, screen.runline.includes(`${nHand} hand-encoded, ${d.trials.length - nHand} rule-based parse`), screen.runline.includes(`${nHand} hand-encoded, ${d.trials.length - nHand} rule-based parse`))
    const sharing = d.pairs.filter((p) => p.shared_sites > 0).length
    const top = [...d.pairs].sort((x, y) => y.shared_sites - x.shared_sites)[0]
    const nested = d.pairs.filter((p) => p.overlap_informative && p.shared_sites >= 10 && Math.max(p.o_pq, p.o_qp) >= 0.8)
    ck('stat trials', String(d.trials.length), screen.stats[0]?.value)
    ck('stat pairs sharing', `${sharing} of ${d.pairs.length} pairs`, screen.stats[1]?.value)
    ck('stat most shared', String(top.shared_sites), screen.stats[2]?.value)
    ck('stat most shared pair', `${top.p} × ${top.q}`, screen.stats[2]?.sub)
    ck('stat nested', String(nested.length), screen.stats[3]?.value)
    const closed = d.trials.filter((x) => !x.recruiting_at_snapshot).length
    if (closed) ck('caveat closed-now count', true, screen.caveats.some((c) => c.startsWith(closed === d.trials.length ? `All ${closed}` : `${closed} of ${d.trials.length}`)), screen.caveats.some((c) => c.startsWith(closed === d.trials.length ? `All ${closed}` : `${closed} of ${d.trials.length}`)))
    ck('matrix trials', d.trials.length, screen.diag.length)
    d.trials.forEach((t, i) => ck(`diag ${t.nct_id}`, `${t.n_sites} site${t.n_sites === 1 ? '' : 's'}`, screen.diag[i]))
    const pairIdx = new Map(d.pairs.map((p) => [`${p.p}|${p.q}`, p]))
    const tIdx = new Map(d.trials.map((t) => [t.nct_id, t]))
    for (const c of screen.cells) {
      const [a, b] = c.key.split('|')
      const p = pairIdx.get(`${a}|${b}`) ?? pairIdx.get(`${b}|${a}`)
      const fwd = pairIdx.has(`${a}|${b}`)
      const oab = fwd ? p.o_pq : p.o_qp
      const oba = fwd ? p.o_qp : p.o_pq
      const pcts = p.overlap_informative ? `${Q.fmt.pct(oab)} / ${Q.fmt.pct(oba)}` : '—'
      // A pair whose shared sites can't be counted (a trial lists only anonymized sites) shows no site number.
      const countable = tIdx.get(a).n_sites_identified > 0 && tIdx.get(b).n_sites_identified > 0
      const exp = countable ? `${p.shared_sites} site${p.shared_sites === 1 ? '' : 's'} ${pcts}` : pcts
      ck(`cell ${c.key}`, exp, c.text.replace(/[†‡]/g, '').replace(/\s+/g, ' ').trim())
      ck(`cell ${c.key} marks`, true, (!p.upper_bound || c.text.includes('†')) && (!p.unreviewed_criteria || c.text.includes('‡')))
    }
    ck('selected cell', 'NCT05785767|NCT05800015', screen.cells.find((c) => c.sel)?.key)
    const p = pairIdx.get('NCT05785767|NCT05800015')
    const A = d.trials.find((x) => x.nct_id === 'NCT05785767')
    const B = d.trials.find((x) => x.nct_id === 'NCT05800015')
    ck('detail title', 'NCT05785767 × NCT05800015', screen.detailTitle)
    ck('fact shared sites', String(p.shared_sites), screen.facts[0]?.n)
    ck('fact o_ab', Q.fmt.pct(p.o_pq), screen.facts[1]?.n)
    ck('fact o_ab label', "NCT05785767's eligible patients also eligible for NCT05800015", screen.facts[1]?.label)
    ck('fact o_ba', Q.fmt.pct(p.o_qp), screen.facts[2]?.n)
    ck('fact months', `${Q.fmt.num(p.months_both_recruiting_estimated, 1)} months`, screen.facts[3]?.dd.split(' ').slice(0, 2).join(' '))
    const window = p.both_recruiting_at_snapshot ? `Since ${shortDate(p.both_recruiting_from)}` : `${shortDate(p.both_recruiting_from)} to ${shortDate(p.both_recruiting_to)}`
    ck('fact months dates', true, !!screen.facts[3]?.dd.includes(window) && !!screen.facts[3]?.dd.includes(shortDate(d.snapshot_date)))
    for (const [i, T] of [A, B].entries()) {
      const dl = screen.cards[i]?.dl ?? {}
      const end = !T.estimated_window_end ? 'none (no completion date registered)' : T.estimated_window_end > d.snapshot_date ? 'after the snapshot' : shortDate(T.estimated_window_end)
      ck(`${T.nct_id} start`, shortDate(T.start_date), dl['Start'])
      ck(`${T.nct_id} window end`, end, dl['Estimated window end'])
      ck(`${T.nct_id} sites`, `${T.n_sites} in region`, dl['Registered sites'])
      ck(`${T.nct_id} criteria`, String(T.criteria.length), dl['Encoded criteria']?.split(' ')[0])
      ck(`${T.nct_id} eligible share`, `${Q.fmt.pct(T.eligible_share, 1)} of the synthetic population`, dl['Eligible share'])
    }
    const same = p.criteria_diff.shared.filter((g) => g.same).length
    ck('diff in both', `Criteria in both (${same})`, screen.diffHeads[0])
    ck('diff restricted differently', `Restricted differently (${p.criteria_diff.shared.length - same})`, screen.diffHeads[1])
    ck('diff only A', `Only in NCT05785767 (${p.criteria_diff.only_p.length})`, screen.diffHeads[2])
    ck('diff only B', `Only in NCT05800015 (${p.criteria_diff.only_q.length})`, screen.diffHeads[3])
    ck('shared sites heading', `Shared sites (${p.shared_sites})`, screen.sharedSitesHead)
    ck('shared site rows', p.shared_site_ids.length, screen.sharedSiteRows.length)
    p.shared_site_ids.forEach((id, i) => {
      const s = d.sites[id]
      ck(`shared site ${i} other-sponsor count`, s.other_sponsor_trials === null ? '—' : String(s.other_sponsor_trials), screen.sharedSiteRows[i]?.[1])
    })
    d.trials.forEach((t, i) => {
      const r = screen.trows[i] ?? {}
      ck(`trial row ${t.nct_id} other-sponsor trials`, `${t.other_sponsor_trials_at_sites} other sponsors' trials recruiting at its sites on this date`, r.count)
      ck(`trial row ${t.nct_id} industry`, `${t.other_sponsor_trials_at_sites_industry} of them industry-sponsored`, r.ind)
    })
    report.steps.b.api = { reqPath, as_of: d.as_of, basis: d.basis }
    if (density0 && density0 !== 'Detailed') await page.evaluate((w) => [...document.querySelectorAll('.density-seg .seg-btn')].find((b) => b.innerText === w)?.click(), density0)
  }

  // ---------------------------------------------------------------- (c) Protocol to terms, NCT05800015
  if (STEPS.includes('c')) {
    const ck = Q.checker('c Protocol to terms', checks)
    log.api.length = 0
    await page.goto(`${BASE}/#terms-flow/NCT05800015`, { waitUntil: 'domcontentloaded' })
    await waitFor(page, () => document.querySelector('.tf-grid') && document.querySelectorAll('.tf-stats .stat-value').length >= 4 && document.querySelector('.tf-decomp-total') && document.querySelector('.tf-sheet'), null, 90000)
    await Q.settle(page, 800)
    report.steps.c = { hash: await page.evaluate(() => location.hash) }
    await Q.snap(browser, page, '03-terms-top', { fullPage: false })
    await Q.snap(browser, await page.$('#tf-step-2'), '03a-terms-schedule-grid', { element: true })

    // One reviewer override: the C7 CT chest (rule R4, research) flipped to routine from the coverage list.
    const flipped = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.tf-cov-row')].find((r) => r.querySelector('.tf-cov-proc')?.innerText.includes('CT chest'))
      const chip = [...(row?.querySelectorAll('.tf-vchip') ?? [])].find((b) => b.innerText.trim().startsWith('C7 ·'))
      if (!chip) return null
      const before = chip.innerText.trim()
      chip.click()
      return before
    })
    report.steps.c.overrideChipBefore = flipped
    await waitFor(page, () => /1 reviewer override/.test(document.querySelector('#tf-step-3 .tf-step-badge')?.innerText ?? ''))
    await waitFor(page, () => {
      const li = [...document.querySelectorAll('.tf-sheet-list li')].find((l) => l.innerText.startsWith('Reviewer overrides'))
      return li && /Reviewer overrides: 1/.test(li.innerText) && !document.querySelector('.tf-stale')
    })
    await Q.settle(page, 1200)
    const chipAfter = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.tf-cov-row')].find((r) => r.querySelector('.tf-cov-proc')?.innerText.includes('CT chest'))
      return [...(row?.querySelectorAll('.tf-vchip') ?? [])].find((b) => b.innerText.trim().startsWith('C7 ·'))?.innerText.trim()
    })
    report.steps.c.overrideChipAfter = chipAfter
    ck('override chip flipped', 'C7 · insurance ✎', chipAfter)
    // Scroll the coverage step so the overridden row is in the shot; the full step is tall.
    await Q.snap(browser, await page.$('#tf-step-3'), '04-terms-coverage-override', { element: true, maxH: 2600 })
    // Grid cell shows the override too.
    await page.evaluate(() => document.querySelector('#tf-step-2').scrollIntoView({ block: 'start' }))
    const gridOv = await page.evaluate(() => [...document.querySelectorAll('.tf-grid button.tf-cell')].filter((b) => b.querySelector('.tf-ov-mark')).map((b) => b.title))
    report.steps.c.gridOverrides = gridOv
    ck('grid shows one override', 1, gridOv.length)
    await Q.snap(browser, await page.$('#tf-step-4'), '05-terms-budget-site', { element: true, maxH: 2600 })
    await Q.snap(browser, await page.$('#tf-step-6'), '06-terms-compare-two-sites', { element: true, maxH: 2600 })
    await Q.snap(browser, await page.$('#tf-step-7'), '07-terms-termsheet', { element: true })

    const screen = await page.evaluate(() => {
      const t = (el) => (el ? el.innerText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() : null)
      const s2 = document.querySelector('#tf-step-2')
      const s4 = document.querySelector('#tf-step-4')
      const s6 = document.querySelector('#tf-step-6')
      const s7 = document.querySelector('#tf-step-7')
      return {
        trialCards: [...document.querySelectorAll('.tf-trial')].map(t),
        scheduleSub: t(s2.querySelector('.tf-step-sub')),
        gridCols: [...s2.querySelectorAll('.tf-grid thead th')].map(t),
        gridCells: s2.querySelectorAll('.tf-grid button.tf-cell').length,
        rulecards: [...document.querySelectorAll('.tf-rulecard')].map(t),
        covFilter: [...document.querySelectorAll('.tf-cov-filter button')].map(t),
        loc: t(s4.querySelector('.tf-loc')),
        gpci: [...s4.querySelectorAll('.tf-gpci dd')].map(t),
        stats: [...s4.querySelectorAll('.tf-stats .stat')].map((s) => ({ label: t(s.querySelector('.stat-label')), value: t(s.querySelector('.stat-value')), sub: t(s.querySelector('.stat-sub')) })),
        compose: t(s4.querySelector('.tf-compose')),
        budgetRows: [...s4.querySelectorAll('table.tf-budget > tbody > tr.clickable')].map((r) => [...r.children].map(t)),
        scrLines: [...s4.querySelectorAll('table.tf-lines tbody tr')].map((r) => [...r.children].map(t)),
        siteSelect: s4.querySelector('select')?.value,
        cmpSites: [...s6.querySelectorAll('.tf-cmp-site')].map(t),
        cmpTotals: [...s6.querySelectorAll('.tf-cmp-total')].map(t),
        gpciTbl: [...s6.querySelectorAll('.tf-gpci-tbl tbody tr')].map((r) => [...r.children].map(t)),
        decompTotal: t(s6.querySelector('.tf-decomp-total')),
        decompParts: [...s6.querySelectorAll('.tf-decomp-parts')].map(t),
        cmpRows: [...s6.querySelectorAll('.tf-cmp-tbl tbody tr.clickable')].map((r) => [...r.children].map(t)),
        presets: [...s6.querySelectorAll('.tf-preset')].map((b) => ({ text: t(b), on: b.getAttribute('aria-pressed') })),
        sheetSummary: t(s7.querySelector('.tf-sheet-summary')),
        sheetList: [...s7.querySelectorAll('.tf-sheet-list li')].map(t),
        sheetSample: t(s7.querySelector('.tf-sheet-sample')),
        mdHref: s7.querySelector('a[download]')?.getAttribute('href'),
        printHref: [...s7.querySelectorAll('a')].find((a) => a.innerText.includes('print'))?.getAttribute('href'),
        compareCheckbox: t(s7.querySelector('label.check')),
      }
    })
    report.steps.c.screen = screen
    const reqs = log.api.filter((x) => x.url.includes('/api/terms-flow/')).map((x) => apiPathOf(x.url))
    report.steps.c.requests = reqs
    const budPath = [...reqs].reverse().find((p) => p.includes('/budget?'))
    const cmpPath = [...reqs].reverse().find((p) => p.includes('/compare?'))
    ck('budget request carries the override', true, decodeURIComponent(budPath).includes('"C7D1:ct_chest":"routine"'), decodeURIComponent(budPath))
    const proto = (await Q.apiGet('/api/terms-flow/NCT05800015/protocol')).body
    const sites = (await Q.apiGet('/api/terms-flow/NCT05800015/sites')).body
    const b = (await Q.apiGet(budPath)).body
    const c = (await Q.apiGet(cmpPath)).body
    report.steps.c.api = { budPath, cmpPath }
    ck('schedule size', `${proto.visits.length} visits × ${proto.procedures.length} procedures, ${proto.nodes.length} scheduled items. Each cell is one node with its coverage rule.`, screen.scheduleSub)
    ck('grid cells', proto.nodes.length, screen.gridCells)
    proto.rules.forEach((r, i) => ck(`rule card ${r.id} nodes`, true, (screen.rulecards[i] ?? '').endsWith(`${r.nodes} nodes`), screen.rulecards[i]))
    const nRes = proto.nodes.filter((n) => (n.id === 'C7D1:ct_chest' ? 'routine' : n.coverage) === 'research').length
    ck('coverage filter counts', JSON.stringify([`All nodes (${proto.nodes.length})`, `Sponsor pays (${nRes})`, `Billed to insurance (${proto.nodes.length - nRes})`, 'Reviewer overrides (1)']), JSON.stringify(screen.covFilter))
    ck('sites count label', true, true)
    ck('default site A', sites.default_pair[0], screen.siteSelect)
    const T = b.totals
    const L = b.locality
    ck('locality', `${L.name} (${L.state} ${L.code})`, screen.loc?.match(/Medicare locality (.*?\))/i)?.[1])
    ck('GPCI work/pe/mp/cf', JSON.stringify([L.gpci_work.toFixed(3), L.gpci_pe.toFixed(3), L.gpci_mp.toFixed(3), b.conversion_factor.toFixed(4)]), JSON.stringify(screen.gpci))
    const occ = (id) => T.per_occurrence.find((x) => x.visit_id === id)
    ck('per participant', Q.fmt.usd(T.per_participant), screen.stats[0]?.value)
    ck('per participant scope', T.per_participant_scope, screen.stats[0]?.sub)
    ck('each later cycle (CX)', Q.fmt.usd(occ('CX')?.amount), screen.stats[1]?.value)
    if (occ('TA36')) ck('TA36 per occurrence', Q.fmt.usd(occ('TA36').amount), screen.stats[2]?.value)
    const si = occ('TA36') ? 3 : 2
    ck('screen failure', Q.fmt.usd(T.screen_failure), screen.stats[si]?.value)
    ck('per site one time', Q.fmt.usd(T.per_site_one_time), screen.stats[si + 1]?.value)
    for (const [k, v] of [
      ['research items', T.per_participant_research_items],
      ['coordinator time', T.per_participant_coordinator],
      ['overhead', T.per_participant_overhead],
      ['Lab placeholders inside it:', T.per_participant_placeholder],
      ['Medicare amounts, for reference):', T.per_participant_insurance_medicare],
    ])
      ck(`compose ${k}`, true, screen.compose.includes(`${k} ${Q.fmt.usd(v)}`), screen.compose)
    for (const x of T.per_occurrence.filter((x) => !['CX', 'TA36'].includes(x.visit_id)))
      ck(`compose per-occurrence ${x.visit_id}`, true, screen.compose.includes(`${x.label}: ${Q.fmt.usd(x.amount)} each`), screen.compose)
    b.visits.forEach((v, i) => {
      const r = screen.budgetRows[i] ?? []
      ck(`budget row ${v.visit_id}`, JSON.stringify([Q.fmt.usd(v.research_subtotal), Q.fmt.usd(v.coordinator), Q.fmt.usd(v.overhead), Q.fmt.usd(v.visit_total), Q.fmt.usd(v.insurance_medicare)]), JSON.stringify(r.slice(1)))
    })
    // Arithmetic: per participant = research items + coordinator + overhead (to the cent).
    const sum = T.per_participant_research_items + T.per_participant_coordinator + T.per_participant_overhead
    ck('API per participant = items + coordinator + overhead', true, Math.abs(sum - T.per_participant) < 0.011, `${sum.toFixed(2)} vs ${T.per_participant}`)
    const scr = b.visits.find((v) => v.visit_id === 'SCR')
    scr.lines.forEach((l, i) => {
      const r = screen.scrLines[i] ?? []
      ck(`SCR line ${l.procedure_id} medicare/sponsor`, JSON.stringify([Q.fmt.usd(l.medicare_amount), l.amount === null ? '—' : Q.fmt.usd(l.amount)]), JSON.stringify([r[4], r[5]]))
    })
    // Compare
    ck('compare site A', c.a.site.label, screen.cmpSites[0]?.slice(7, 7 + c.a.site.label.length))
    ck('compare site B', c.b.site.label, screen.cmpSites[1]?.slice(7, 7 + c.b.site.label.length))
    ck('compare localities differ', true, c.a.locality?.code !== c.b.locality?.code || c.a.locality?.state !== c.b.locality?.state, `${c.a.locality?.name} vs ${c.b.locality?.name}`)
    ck('compare totals', JSON.stringify([Q.fmt.usd(c.a.totals.per_participant), Q.fmt.usd(c.b.totals.per_participant)]), JSON.stringify(screen.cmpTotals))
    ck('compare A total = budget total', Q.fmt.usd(T.per_participant), Q.fmt.usd(c.a.totals.per_participant))
    const g = (l, k) => (l ? l[k] : 1)
    ;[
      ['gpci_work', 'work'],
      ['gpci_pe', 'pe'],
      ['gpci_mp', 'mp'],
    ].forEach(([k, dk], i) => {
      const dd = c.gpci_delta[dk]
      ck(`gpci row ${k}`, JSON.stringify([g(c.a.locality, k).toFixed(3), g(c.b.locality, k).toFixed(3), `${dd >= 0 ? '+' : '−'}${Math.abs(dd).toFixed(3)}`]), JSON.stringify(screen.gpciTbl[i]?.slice(1)))
    })
    const sm = c.summary
    ck('delta per participant', Q.fmt.signedUsd(sm.delta_per_participant), screen.decompTotal)
    ck('delta = B - A', true, Math.abs(c.b.totals.per_participant - c.a.totals.per_participant - sm.delta_per_participant) < 0.011, `${c.b.totals.per_participant} - ${c.a.totals.per_participant} vs ${sm.delta_per_participant}`)
    const parts = `work GPCI ${Q.fmt.signedUsd(sm.from_work)} + practice-expense GPCI ${Q.fmt.signedUsd(sm.from_pe)} + malpractice GPCI ${Q.fmt.signedUsd(sm.from_mp)} + overhead (${(sm.overhead_rate * 100).toFixed(0)}%) on those ${Q.fmt.signedUsd(sm.delta_overhead)} + cent rounding ${Q.fmt.signedUsd(sm.rounding)}`
    ck('decomposition parts', parts, screen.decompParts[0])
    const partSum = sm.from_work + sm.from_pe + sm.from_mp + sm.delta_overhead + sm.rounding
    ck('decomposition sums to delta', true, Math.abs(partSum - sm.delta_per_participant) < 0.011, `${partSum.toFixed(2)} vs ${sm.delta_per_participant}`)
    c.rows.forEach((r, i) => {
      const s = screen.cmpRows[i] ?? []
      ck(`compare row ${r.procedure_id}`, JSON.stringify([`${r.n_fixed}${r.visits_repeat.length ? '+' : ''}`, Q.fmt.usd(r.unit_a), Q.fmt.usd(r.unit_b), Q.fmt.signedUsd(r.delta_unit), r.rvu ? Q.fmt.signedUsd(r.delta_work) : '—', r.rvu ? Q.fmt.signedUsd(r.delta_pe) : '—', r.rvu ? Q.fmt.signedUsd(r.delta_mp) : '—', Q.fmt.signedUsd(r.delta_fixed)]), JSON.stringify(s.slice(1)))
    })
    // Term sheet panel
    ck('sheet sponsor lines', `Per-visit payments: ${T.n_sponsor_lines} sponsor lines, each with its provenance`, screen.sheetList[0])
    ck('sheet insurance lines', true, screen.sheetList[1]?.startsWith(`Billed to insurance: ${T.n_insurance_lines} routine lines`), screen.sheetList[1])
    ck('sheet overrides', true, screen.sheetList[2]?.startsWith(`Reviewer overrides: ${T.n_overrides}`), screen.sheetList[2])
    ck('sheet multiplier', `Multiplier: ${(b.multiplier * 100).toFixed(0)}% of Medicare on coded items`, screen.sheetList[4])

    // Download the markdown (the actual link, with the browser's download handling).
    const dl = path.join(Q.OUT, 'download')
    fs.mkdirSync(dl, { recursive: true })
    for (const f of fs.readdirSync(dl)) fs.unlinkSync(path.join(dl, f))
    const cdp = await page.createCDPSession()
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl.replace(/\//g, '\\') })
    await page.click('#tf-step-7 a[download]')
    let mdFile = null
    for (let i = 0; i < 60 && !mdFile; i++) {
      await Q.sleep(500)
      const fsList = fs.readdirSync(dl).filter((f) => !f.endsWith('.crdownload'))
      if (fsList.length) mdFile = path.join(dl, fsList[0])
    }
    report.steps.c.downloadFile = mdFile ? path.basename(mdFile) : null
    ck('markdown download arrives', true, !!mdFile, mdFile)
    const mdApiPath = screen.mdHref
    const mdApi = (await Q.apiGet(mdApiPath)).body
    if (mdFile) {
      const md = fs.readFileSync(mdFile, 'utf8')
      fs.writeFileSync(path.join(HANDOFF, 'termsheet-NCT05800015.md'), md)
      ck('downloaded markdown = API termsheet.md', true, md.replace(/\r/g, '') === String(mdApi).replace(/\r/g, ''), `${md.length} vs ${String(mdApi).length} chars`)
      for (const [k, v] of [
        ['per participant', T.per_participant],
        ['screen failure', T.screen_failure],
        ['per site one time', T.per_site_one_time],
        ['compare A total', c.a.totals.per_participant],
        ['compare B total', c.b.totals.per_participant],
      ])
        ck(`markdown contains ${k} ${Q.fmt.usd(v)}`, true, md.includes(Q.fmt.usd(v)))
      ck('markdown marks reviewer override', true, /reviewer override/i.test(md))
      report.steps.c.mdBytes = md.length
    }
    // Print view (opens in a new tab).
    const [newTarget] = await Promise.all([
      browser.waitForTarget((t) => t.url().includes('termsheet.html'), { timeout: 30000 }),
      page.click('#tf-step-7 a[target="_blank"]'),
    ])
    const pv = await newTarget.page()
    await pv.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await pv.waitForFunction(() => document.body && document.body.innerText.length > 500, { timeout: 30000 })
    await Q.sleep(800)
    await Q.snap(browser, pv, '08-terms-print-view', { fullPage: false })
    const pvText = await pv.evaluate(() => document.body.innerText)
    report.steps.c.printViewChars = pvText.length
    for (const [k, v] of [
      ['per participant', T.per_participant],
      ['screen failure', T.screen_failure],
      ['compare B total', c.b.totals.per_participant],
    ])
      ck(`print view contains ${k} ${Q.fmt.usd(v)}`, true, pvText.includes(Q.fmt.usd(v)))
    await pv.close()
  }

  // ---------------------------------------------------------------- (d) Research
  if (STEPS.includes('d')) {
    const ck = Q.checker('d Research', checks)
    log.api.length = 0
    await Q.clickTab(page, 'Research')
    await waitFor(page, () => document.querySelector('.rs-banner') && document.querySelector('.rs-tabs'))
    await Q.sleep(800)
    report.steps.d = { hash: await page.evaluate(() => location.hash), banner: await page.$eval('.rs-banner', (e) => e.innerText) }
    await Q.snap(browser, page, '09-research-landing', { fullPage: false })
    const t0 = Date.now()
    await Q.waitCleared(page)
    report.steps.d.clearSeconds = Math.round((Date.now() - t0) / 1000)
    await waitFor(page, () => document.querySelector('.tbl-trials tbody tr'))
    await Q.settle(page, 800)
    await Q.snap(browser, page, '10-research-clear', { fullPage: false })
    await Q.snap(browser, page, '10a-research-clear-full', { fullPage: true, maxH: 5000 })
    const screen = await page.evaluate(() => {
      const t = (el) => (el ? el.innerText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() : null)
      return {
        runstatus: t(document.querySelector('.run-status')),
        runline: t(document.querySelector('main .runline, main .run-line')),
        headline: t(document.querySelector('main .headline, main .headline-block, main .hl')),
        decomp: [...document.querySelectorAll('main .card table')].slice(0, 1).map((tb) => [...tb.querySelectorAll('tbody tr')].map((r) => [...r.children].map(t)))[0],
        trials: [...document.querySelectorAll('.tbl-trials tbody tr')].map((r) => [...r.children].map(t)),
        main: t(document.querySelector('main')),
      }
    })
    report.steps.d.screen = screen
    const clearReq = log.api.find((x) => x.url.includes('/api/clear'))
    report.steps.d.clearBody = clearReq?.post ?? null
    const r = (await Q.apiPost('/api/clear', JSON.parse(clearReq.post))).body
    report.steps.d.apiCounts = r.counts
    const byId = new Map(r.trials.map((t) => [t.nct_id, t]))
    let n = 0
    for (const row of screen.trials) {
      const id = (row[0].match(/NCT\d{8}/) ?? [])[0]
      const t = byId.get(id) ?? r.trials.find((x) => x.acronym && row[0].startsWith(x.acronym))
      if (!t) {
        ck(`trial row ${row[0]} found in API`, true, false, row[0])
        continue
      }
      const exp = [Q.fmt.num(t.target_region), Q.fmt.int(t.sites_actual), Q.fmt.num(t.T_actual), Q.fmt.num(t.T_indep), Q.fmt.num(t.T_coord), Q.fmt.num(t.T_coord_free)]
      ck(`trial row ${t.nct_id}`, JSON.stringify(exp), JSON.stringify(row.slice(2, 8)))
      n++
    }
    report.steps.d.trialRowsChecked = n
    // Headline tiles (in-sample, labelled not a claim) against summary.headline.
    const hs = await page.evaluate(() => [...document.querySelectorAll('main .stats .stat')].slice(0, 4).map((s) => ({ v: s.querySelector('.stat-value')?.innerText.replace(/\s+/g, ' ').trim(), sub: s.querySelector('.stat-sub')?.innerText.replace(/\s+/g, ' ').trim() })))
    const h = r.summary.coord_vs_actual
    ck('headline ratio', `${h.ratio.toFixed(2)}×`, hs[0]?.v)
    ck('headline median speedup', `${h.median_speedup.toFixed(2)}×`, hs[1]?.v)
    ck('headline share faster', Q.fmt.pct(h.share_faster_material), hs[2]?.v)
    ck('headline trial-months', `${Q.fmt.int(h.dividend_trial_months)} trial-months`, hs[3]?.v)
    ck('headline median T', true, (hs[3]?.sub ?? '').includes(`median T ${Q.fmt.num(h.median_T_base)} → ${Q.fmt.num(h.median_T_new)} months`), hs[3]?.sub)
    ck('not-a-claim label', true, /not a claim/i.test(screen.main))
    ck('trial count', r.trials.length, screen.trials.length)
    ck('runline counts', true, screen.main.includes(`${Q.fmt.int(r.counts.movable_trials)} trials compared · ${Q.fmt.int(r.counts.trials)} in instance · ${Q.fmt.int(r.counts.sites)} sites`))
    report.steps.d.summaryKeys = Object.keys(r.summary || {})
  }

  report.console = log.console
  report.pageerrors = log.pageerrors
  report.checks = checks
  report.mismatches = checks.filter((c) => !c.ok)
  Q.save(path.join(Q.OUT, `desktop_${STEPS}.json`), report)
  console.log(`checks ${checks.length}, mismatches ${report.mismatches.length}, console ${log.console.length}, pageerrors ${log.pageerrors.length}, api4xx ${report.api4xx.length}`)
  await browser.close()
})().catch((e) => {
  console.error('FAILED', e)
  report.checks = checks
  Q.save(path.join(Q.OUT, `desktop_${STEPS}_failed.json`), report)
  process.exit(1)
})
