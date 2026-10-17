// Item 4 check: material-threshold shares ("faster by >= 1 month") and beta labels.
// Live pass: the real API. Fixture pass: /api/congestion-test is answered with
// frontend/src/fixtures/congestion_v2.sample.json (placeholder numbers, v2 contract) and the
// robustness grid gets placeholder material shares on every other row; both by request
// interception in the browser, so no app code is mocked.
// Usage: NODE_PATH=<data/work/D>/node_modules node item4.js <baseUrl> <outDir> [desktop|phone|userbeta|all]
const L = require('./lib')
const fs = require('fs')
const path = require('path')

const BASE = process.argv[2] || 'http://localhost:5175'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/ui4'
const MODE = process.argv[4] || 'all'
const FIXTURE = path.join(__dirname, '../../../frontend/src/fixtures/congestion_v2.sample.json')
const API = 'http://localhost:8000'
fs.mkdirSync(OUT, { recursive: true })

const pct = (x) => (typeof x === 'number' && Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : '—')
const n3 = (x) => (x < 0 ? '-' : '') + Math.abs(x).toFixed(3)
const norm = (s) => (s ?? '').replace(/\u00a0/g, ' ').replace(/\u2212/g, '-').replace(/\s+/g, ' ').trim()

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`)
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  phone: { width: 380, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
}

/** Each page gets its own instrumentation log (lib.instrument resets the arrays it fills). */
async function newPage(browser, vp, log, mocks) {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORTS[vp])
  const plog = { vp, mocked: !!mocks }
  L.instrument(page, plog)
  log.pages.push(plog)
  page.plog = plog
  if (mocks) {
    await page.setRequestInterception(true)
    page.on('request', async (req) => {
      const u = req.url()
      try {
        if (mocks.congestion && u.includes('/api/congestion-test')) {
          return await req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(mocks.congestion) })
        }
        if (mocks.robustness && u.includes('/api/robustness')) {
          const r = await fetch(API + u.slice(u.indexOf('/api/robustness')))
          const body = await r.text()
          if (!r.ok) return await req.respond({ status: r.status, contentType: 'application/json', body })
          const d = JSON.parse(body)
          mocks.robustness(d)
          return await req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(d) })
        }
      } catch (e) {
        console.log('mock error', String(e))
      }
      return req.continue()
    })
  }
  return page
}

function lastApi(page, frag, method) {
  return [...page.plog.api].reverse().find((a) => a.url.includes(frag) && (!method || a.method === method) && a.status === 200)?.body
}

async function snap(page, dir, name, log) {
  const lc = await L.layoutCheck(page)
  log.layout[name] = lc
  await L.shot(page, dir, name, true)
  await L.shot(page, dir, name + '_top', false)
  check(`${name}: no page-level horizontal overflow (width ${lc.innerWidth}, doc ${lc.docScrollWidth}, offenders ${lc.offenders.length})`, !lc.overflow && lc.offenders.length === 0, lc.offenders.slice(0, 5))
}

/** Text of the element at selector (first match) inside main. */
const text = (page, sel) => page.evaluate((sel) => document.querySelector(sel)?.innerText ?? null, sel)

async function scrollToText(page, needle) {
  await page.evaluate((needle) => {
    const el = [...document.querySelectorAll('main h2, main h3, main p, main .stat')].find((e) => e.innerText.includes(needle))
    el?.scrollIntoView({ block: 'start' })
  }, needle)
  await L.sleep(300)
}

/** Headline stat + decomposition table cells, compared with the /api/clear summary. */
async function checkClearSummary(page, s, tag, r) {
  const stat = await page.evaluate(() => {
    const st = [...document.querySelectorAll('main .stat')].find((x) => x.querySelector('.stat-label')?.innerText.toLowerCase().startsWith('trials faster'))
    return st ? { label: st.querySelector('.stat-label').innerText, value: st.querySelector('.stat-value').innerText, sub: st.querySelector('.stat-sub').innerText } : null
  })
  const h = s.coord_vs_actual
  check(`${tag}: headline tile label says "faster by ≥ 1 month"`, stat && norm(stat.label).toLowerCase() === 'trials faster by ≥ 1 month', stat?.label)
  check(`${tag}: headline main value = share_faster_material ${pct(h.share_faster_material)}`, stat && norm(stat.value) === pct(h.share_faster_material), stat?.value)
  check(
    `${tag}: headline secondary shows any-change ${pct(h.share_faster)} and slower ≥ 1 mo ${pct(h.share_slower_material)} (any ${pct(h.share_slower)})`,
    stat && norm(stat.sub).startsWith(`${pct(h.share_faster)} any change`) && norm(stat.sub).includes(`slower by ≥ 1 mo: ${pct(h.share_slower_material)} (${pct(h.share_slower)} any change;`),
    stat?.sub,
  )
  const tbl = await page.evaluate(() => {
    const t = [...document.querySelectorAll('main table')].find((x) => [...x.querySelectorAll('thead th')].some((th) => th.innerText.toLowerCase().startsWith('faster')))
    if (!t) return null
    return {
      head: [...t.querySelectorAll('thead th')].map((th) => th.innerText),
      rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => ({ text: td.innerText, sub: td.querySelector('.muted.small')?.innerText ?? null, neg: td.classList.contains('neg') }))),
    }
  })
  check(`${tag}: decomposition headers "Faster ≥ 1 mo" / "Slower ≥ 1 mo"`, tbl && tbl.head.map(norm).map((x) => x.toLowerCase()).includes('faster ≥ 1 mo') && tbl.head.map(norm).map((x) => x.toLowerCase()).includes('slower ≥ 1 mo'), tbl?.head)
  const keys = ['coord_vs_actual', 'indep_vs_actual', 'coordination_no_loser_vs_indep', 'coord_free_vs_actual', 'coord_free_vs_indep']
  let bad = []
  ;(tbl?.rows ?? []).forEach((cells, i) => {
    const c = s[keys[i]]
    const f = cells[3]
    const sl = cells[4]
    const fMain = norm(f.text.replace(f.sub ?? '', ''))
    const sMain = norm(sl.text.replace(sl.sub ?? '', ''))
    if (fMain !== pct(c.share_faster_material) || norm(f.sub) !== `${pct(c.share_faster)} any change`) bad.push({ k: keys[i], faster: f, want: [pct(c.share_faster_material), pct(c.share_faster)] })
    if (sMain !== pct(c.share_slower_material) || norm(sl.sub) !== `${pct(c.share_slower)} any change`) bad.push({ k: keys[i], slower: sl, want: [pct(c.share_slower_material), pct(c.share_slower)] })
    if (sl.neg !== (c.share_slower_material > 0)) bad.push({ k: keys[i], neg: sl.neg })
  })
  check(`${tag}: decomposition faster/slower cells = material (main) + any change (secondary), 5 rows`, tbl && tbl.rows.length === 5 && bad.length === 0, bad)
  // Background caption: material count recomputed here from the per-trial times; any-change count from the API.
  const bgMat = r.trials.filter((t) => !t.movable && typeof t.T_actual === 'number' && (typeof t.T_coord_free !== 'number' || t.T_coord_free >= t.T_actual + 1 - 1e-9)).length
  const main = norm(await text(page, 'main'))
  const want = r.params.sponsor
    ? `${bgMat} of them would enroll more slowly by ≥ 1 month (${s.background_worse_under_coord_free} by any amount)`
    : `${bgMat} of them would be slower by ≥ 1 month (${s.background_worse_under_coord_free} by any amount)`
  check(`${tag}: background caption "${want}"`, main.includes(want))
  return { stat, tbl, bgMat }
}

async function livePass(browser, vp, log) {
  const dir = `${OUT}/${vp}_live`
  fs.mkdirSync(dir, { recursive: true })
  const page = await newPage(browser, vp, log, null)
  const tag = `${vp}/live`
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await L.waitCleared(page, 'US-Northeast')
  await L.settle(page, 1000)
  const r = lastApi(page, '/api/clear', 'POST')
  const s = r.summary
  log.values[tag] = { coord_vs_actual: s.coord_vs_actual, beta: s.assumptions.beta, bg: [s.background_trials, s.background_worse_under_coord_free] }

  // Clear it
  await L.clickTab(page, 'Clear it')
  await page.evaluate(() => {
    const d = document.querySelector('details.assumptions')
    if (d) d.open = true
  })
  await L.sleep(600)
  const cs = await checkClearSummary(page, s, `${tag} Clear it`, r)
  log.values[tag].clear = cs
  const b = s.assumptions.beta
  const grid = norm(await text(page, 'main .raw-grid'))
  check(`${tag} Clear it: assumptions label "default β = full-sample estimate" with ${n3(b.beta)} (95% CI ${n3(b.ci95[0])} to ${n3(b.ci95[1])})`, grid.includes(`Congestion elasticity β ${n3(b.beta)} (95% CI ${n3(b.ci95[0])} to ${n3(b.ci95[1])}) default β = full-sample estimate`), grid.slice(0, 200))
  const hint = norm(await page.evaluate(() => [...document.querySelectorAll('main .field')].find((f) => f.textContent.includes('Congestion elasticity'))?.innerText))
  check(`${tag} Clear it: β box hint "Blank = default β = full-sample estimate (${n3(b.beta)}, …)"`, hint.includes(`Blank = default β = full-sample estimate (${n3(b.beta)}, 95% CI ${n3(b.ci95[0])} to ${n3(b.ci95[1])})`), hint)
  check(`${tag} Clear it: run line "β default (full-sample estimate)"`, norm(await text(page, 'main .runline')).includes('β default (full-sample estimate)'))
  await snap(page, dir, '02_clear', log)
  await scrollToText(page, 'Where the gain comes from')
  await L.shot(page, dir, '02_clear_decomposition', false)

  // Robustness (live grid: computed before the material fields existed)
  await L.clickTab(page, 'Robustness')
  await L.waitNoLoading(page)
  const rob = lastApi(page, '/api/robustness')
  const rr = await page.evaluate(() => {
    const t = document.querySelector('main table.tbl-robust')
    const ix = [...t.querySelectorAll('thead th')].findIndex((th) => th.innerText.toLowerCase().startsWith('slower'))
    return {
      head: t.querySelectorAll('thead th')[ix]?.innerText,
      cells: [...t.querySelectorAll('tbody tr')].map((tr) => ({ text: tr.children[ix].innerText, sub: tr.children[ix].querySelector('.muted.small')?.innerText, beta: tr.children[0].innerText })),
    }
  })
  check(`${tag} Robustness: header "Slower ≥ 1 mo"`, norm(rr.head).toLowerCase() === 'slower ≥ 1 mo', rr.head)
  const robBad = rr.cells.filter((c, i) => {
    const row = rob.rows[i].coord_free_vs_actual
    const want = pct(row.share_slower_material) // '—' when missing
    return norm(c.text.replace(c.sub ?? '', '')) !== want || norm(c.sub) !== `${pct(row.share_slower)} any change`
  })
  const missing = rob.rows.filter((x) => x.coord_free_vs_actual.share_slower_material === undefined).length
  check(`${tag} Robustness: ${rr.cells.length} slower cells; ${missing} rows lack the material field and show "—" (not 0); any-change secondary`, robBad.length === 0 && rr.cells.length === rob.rows.length, robBad.slice(0, 3))
  const gridBeta = rob.rows.find((x) => x.beta_label === 'data estimate')?.beta
  const note = norm(await text(page, 'main p.note'))
  const stale = Math.abs(gridBeta - b.beta) > 5e-4
  const dataRows = rr.cells.filter((c) => c.beta.startsWith('data estimate'))
  const rowLabel = stale ? 'earlier full-sample estimate' : 'default β = full-sample estimate'
  check(`${tag} Robustness: ${dataRows.length} data-estimate rows labelled "${rowLabel}"`, dataRows.length > 0 && dataRows.every((c) => c.beta.includes(rowLabel)))
  check(
    `${tag} Robustness: stale-β note ${stale ? 'shown' : 'absent'} (grid β ${n3(gridBeta)}, default ${n3(b.beta)})`,
    stale ? note.includes(`computed at β = ${n3(gridBeta)}`) && note.includes(`current default β = full-sample estimate is ${n3(b.beta)}`) : !note.includes('computed at β'),
    note,
  )
  check(`${tag} Robustness: lede names "the default β = full-sample estimate"`, norm(await text(page, 'main .view-head')).includes('the default β = full-sample estimate'))
  await snap(page, dir, '03_robustness', log)
  await scrollToText(page, 'Grid')
  await L.shot(page, dir, '03_robustness_grid', false)

  // Model & data (live: no v2 fields, so no subset / parser tables)
  await L.clickTab(page, 'Model & data')
  await page.waitForFunction(() => document.querySelector('main .coefplot'), { timeout: L.LONG })
  await L.settle(page, 500)
  const cong = lastApi(page, '/api/congestion-test')
  const wo = cong.results.within_overlap
  const card = norm(await page.evaluate(() => [...document.querySelectorAll('main .card')].find((c) => c.innerText.includes('Does congestion exist'))?.innerText))
  const dv = Math.max(0, -wo.coef)
  const dci = [Math.max(0, -wo.ci95[1]), Math.max(0, -wo.ci95[0])]
  check(`${tag} Model: "default β = full-sample estimate = ${n3(dv)}" (CI ${n3(dci[0])} to ${n3(dci[1])})`, card.includes(`default β = full-sample estimate = ${n3(dv)} (-1 × the within-site coefficient; 95% CI ${n3(dci[0])} to ${n3(dci[1])})`), card.slice(0, 300))
  check(`${tag} Model: live API has no subsets/parser_sensitivity/se_method and none is rendered`, !cong.subsets && !cong.parser_sensitivity && !cong.se_method && !card.includes('Subset estimates') && !card.includes('parser version') && !card.includes('two-way'))
  await snap(page, dir, '07_model', log)
  await scrollToText(page, 'Does congestion exist')
  await L.shot(page, dir, '07_model_congestion', false)

  // Portfolio (Regeneron preset): shared HeadlineBlock / DecompositionTable (compact) + background caption
  await L.clickTab(page, 'Portfolio')
  await L.clickButton(page, 'Preset: Regeneron')
  await L.waitCleared(page, 'Regeneron')
  await L.settle(page, 800)
  const rp = lastApi(page, '/api/clear', 'POST')
  await checkClearSummary(page, rp.summary, `${tag} Portfolio`, rp)
  check(`${tag} Portfolio: run line "β default (full-sample estimate)"`, norm(await text(page, 'main .runline')).includes('β default (full-sample estimate)'))
  await snap(page, dir, '04_portfolio', log)
  await scrollToText(page, 'Decomposition')
  await L.shot(page, dir, '04_portfolio_decomposition', false)
  await page.close()
}

async function fixturePass(browser, vp, log) {
  const dir = `${OUT}/${vp}_fixture`
  fs.mkdirSync(dir, { recursive: true })
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const injected = {}
  const page = await newPage(browser, vp, log, {
    congestion: fx,
    robustness: (d) => {
      // Placeholder material shares on even rows only; odd rows keep the field missing.
      d.rows.forEach((row, i) => {
        if (i % 2 === 0) {
          const v = Math.round(row.coord_free_vs_actual.share_slower * 0.5 * 100) / 100
          row.coord_free_vs_actual.share_slower_material = v
          row.coord_free_vs_actual.material_threshold_months = 1
          injected[i] = v
        }
      })
    },
  })
  const tag = `${vp}/fixture`
  await page.goto(BASE + '/#model', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('main .coefplot'), { timeout: L.LONG })
  await page.evaluate(() => document.querySelectorAll('main details').forEach((d) => (d.open = true)))
  await L.settle(page, 600)
  const card = await page.evaluate(() => {
    const c = [...document.querySelectorAll('main .card')].find((x) => x.innerText.includes('Does congestion exist'))
    const tableAfter = (h) => {
      const hh = [...c.querySelectorAll('h3')].find((x) => x.innerText.toLowerCase().startsWith(h))
      if (!hh) return null
      let el = hh.nextElementSibling
      while (el && !el.querySelector('table')) el = el.nextElementSibling
      const t = el?.querySelector('table')
      return t ? { head: [...t.querySelectorAll('thead th')].map((x) => x.innerText), rows: [...t.querySelectorAll('tbody tr')].map((tr) => ({ on: tr.classList.contains('row-on'), cells: [...tr.children].map((x) => x.innerText) })) } : null
    }
    return { text: c.innerText, h3: [...c.querySelectorAll('h3')].map((x) => x.innerText), subsets: tableAfter('subset estimates'), parsers: tableAfter('β under each parser') }
  })
  const t = norm(card.text)
  const wo = fx.results.within_overlap
  check(`${tag} Model: se_method next to the primary CI`, t.includes(`95% CI ${n3(wo.ci95[0])} to ${n3(wo.ci95[1])} (two-way clustered (trial, site)) · p =`), t.slice(0, 600))
  check(`${tag} Model: trial-clustered-only CI shown as secondary`, t.includes(`trial-clustered only: 95% CI ${n3(wo.ci95_trial_only[0])} to ${n3(wo.ci95_trial_only[1])}`))
  const db = fx.default_beta
  check(`${tag} Model: default β line uses default_beta (${n3(db.value)}, CI ${n3(db.ci95[0])} to ${n3(db.ci95[1])}) + note`, t.includes(`default β = full-sample estimate = ${n3(db.value)} (-1 × the within-site coefficient; 95% CI ${n3(db.ci95[0])} to ${n3(db.ci95[1])}, two-way clustered (trial, site))`) && t.includes('Subset estimates are reported separately and are not used as the default.'))
  const h3 = card.h3.map((x) => norm(x).toLowerCase())
  check(`${tag} Model: headings "Subset estimates (not the default)" and "β under each parser version"`, h3.includes('subset estimates (not the default)') && h3.includes('β under each parser version'), card.h3)
  const subs = Object.entries(fx.subsets)
  const mc = fx.multiple_comparisons
  const subBad = []
  subs.forEach(([k, sub], i) => {
    const row = card.subsets?.rows[i]?.cells.map(norm)
    const bci = mc.bonferroni_ci95[k]
    const want = [n3(sub.within.coef), `${n3(sub.within.ci95[0])} to ${n3(sub.within.ci95[1])}`, `${n3(bci[0])} to ${n3(bci[1])}`]
    if (!row || !row[0].startsWith(sub.label) || row[1] !== want[0] || row[2] !== want[1] || row[4] !== want[2]) subBad.push({ k, row, want })
  })
  check(`${tag} Model: subset table has ${subs.length} rows with within coef, CI and Bonferroni CI from the response`, card.subsets && card.subsets.rows.length === subs.length && subBad.length === 0, subBad)
  check(`${tag} Model: multiple-comparison note + method/k shown`, t.includes('Fixture placeholder: with three subsets') && t.includes(`(Bonferroni, k = ${mc.k}, α = 0.05.)`))
  const psBad = []
  fx.parser_sensitivity.forEach((ps, i) => {
    const row = card.parsers?.rows[i]
    const c = row?.cells.map(norm)
    if (!c || !c[0].startsWith(`${ps.parser_version} ${ps.commit}`) || c[1] !== n3(ps.within_overlap.coef) || c[2] !== `${n3(ps.within_overlap.ci95[0])} to ${n3(ps.within_overlap.ci95[1])}` || c[4] !== n3(-ps.within_overlap.coef) || c[5] !== String(ps.empty_masks)) psBad.push({ i, c })
  })
  const curIdx = card.parsers?.rows.findIndex((x) => x.on)
  check(`${tag} Model: parser table, ${fx.parser_sensitivity.length} rows oldest→newest with coef, CI, β, empty masks; newest marked current`, card.parsers && card.parsers.rows.length === fx.parser_sensitivity.length && psBad.length === 0 && curIdx === fx.parser_sensitivity.length - 1, psBad)
  check(`${tag} Model: specification table notes the SE method`, t.includes('Confidence intervals and p-values: two-way clustered (trial, site).'))
  await snap(page, dir, '07_model_fixture', log)
  await scrollToText(page, 'Subset estimates')
  await L.shot(page, dir, '07_model_fixture_subsets', false)

  // Robustness with placeholder material shares on even rows
  await L.waitCleared(page, 'US-Northeast')
  await L.clickTab(page, 'Robustness')
  await L.waitNoLoading(page)
  const cells = await page.evaluate(() => {
    const t = document.querySelector('main table.tbl-robust')
    const ix = [...t.querySelectorAll('thead th')].findIndex((th) => th.innerText.toLowerCase().startsWith('slower'))
    return [...t.querySelectorAll('tbody tr')].map((tr) => ({ text: tr.children[ix].innerText, sub: tr.children[ix].querySelector('.muted.small')?.innerText }))
  })
  const bad = cells.filter((c, i) => norm(c.text.replace(c.sub ?? '', '')) !== (i in injected ? pct(injected[i]) : '—'))
  check(`${tag} Robustness: ${Object.keys(injected).length} rows with the material field show it, ${cells.length - Object.keys(injected).length} without show "—"`, cells.length > 0 && bad.length === 0, bad.slice(0, 3))
  await scrollToText(page, 'Grid')
  await L.shot(page, dir, '03_robustness_mixed', false)
  await page.close()
}

/** A user-set β: assumptions carry {beta, source: "user setting"} with no CI. */
async function userBetaPass(browser, log) {
  const dir = `${OUT}/userbeta`
  fs.mkdirSync(dir, { recursive: true })
  const page = await newPage(browser, 'desktop', log, null)
  const tag = 'userbeta'
  await page.goto(BASE + '/#clear', { waitUntil: 'domcontentloaded' })
  await L.waitCleared(page, 'US-Northeast')
  await page.evaluate(() => {
    const d = document.querySelector('details.assumptions')
    if (d) d.open = true
  })
  const input = (
    await page.evaluateHandle(() => [...document.querySelectorAll('main .field')].find((f) => f.textContent.includes('Congestion elasticity'))?.querySelector('input'))
  ).asElement()
  await input.click({ clickCount: 3 })
  await page.keyboard.type('1')
  await L.sleep(300)
  await L.clickButton(page, 'Clear the market')
  // Either the clear finishes or the page crashes (no error boundary: main disappears).
  await page.waitForFunction(
    () => {
      const t = document.querySelector('.run-status')?.innerText ?? ''
      return !document.querySelector('.app') || (t.includes('Cleared') && !t.includes('Clearing'))
    },
    { timeout: 300_000, polling: 500 },
  )
  await L.settle(page, 800)
  const r = lastApi(page, '/api/clear', 'POST')
  const alive = await page.evaluate(() => !!document.querySelector('.app main'))
  const crashes = page.plog.pageerrors
  log.values.userbeta = { beta: r?.summary?.assumptions?.beta, alive, crashes }
  check(`${tag}: page survives a user-set β (assumptions.beta = ${JSON.stringify(r?.summary?.assumptions?.beta)})`, alive && crashes.length === 0, crashes.slice(0, 2))
  if (alive) {
    const grid = norm(await text(page, 'main .raw-grid'))
    check(`${tag}: assumptions show 1.000 · user setting, without the default label`, grid.includes('Congestion elasticity β 1.000 user setting') && !grid.includes('default β'), grid.slice(0, 120))
    check(`${tag}: run line shows β 1`, norm(await text(page, 'main .runline')).includes('β 1 ·'))
  }
  await L.shot(page, dir, 'userbeta', false)
  await page.close()
}

;(async () => {
  const log = { base: BASE, mode: MODE, values: {}, layout: {}, pages: [] }
  const browser = await L.launch()
  try {
    if (MODE === 'all' || MODE === 'desktop') {
      await livePass(browser, 'desktop', log)
      await fixturePass(browser, 'desktop', log)
    }
    if (MODE === 'all' || MODE === 'phone') {
      await livePass(browser, 'phone', log)
      await fixturePass(browser, 'phone', log)
    }
    if (MODE === 'all' || MODE === 'userbeta') await userBetaPass(browser, log)
  } catch (e) {
    log.error = String(e && e.stack ? e.stack : e)
    console.log('ERROR', log.error)
  } finally {
    const pageerrors = log.pages.flatMap((p) => p.pageerrors)
    const errs = log.pages.flatMap((p) => p.console.filter((c) => c.type === 'error'))
    check(`no page errors (${pageerrors.length}) and no console errors (${errs.length})`, pageerrors.length === 0 && errs.length === 0 && !log.error, { pageerrors: pageerrors.slice(0, 3), errs: errs.slice(0, 3) })
    const pages = log.pages.map((p) => ({ vp: p.vp, mocked: p.mocked, console: p.console, pageerrors: p.pageerrors, api: p.api.map((a) => ({ url: a.url, method: a.method, status: a.status })) }))
    L.save(`${OUT}/item4_${MODE}_log.json`, { ...log, pages, checks })
    console.log(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed`)
    await browser.close()
  }
})()
