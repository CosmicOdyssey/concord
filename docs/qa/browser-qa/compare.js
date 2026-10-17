// Compare every number on screen (desktop_log.json grabs) with the API responses the page received,
// and with an independent fetch of the same endpoint. Formatting functions copied from src/format.ts.
// Usage: node compare.js [logName]
const fs = require('fs')
const W = 'C:/Users/micha/Projects/concord/data/work/D'
const NAME = process.argv[2] || 'desktop'
const log = JSON.parse(fs.readFileSync(`${W}/${NAME}_log.json`, 'utf8'))
for (const v of Object.values(log.views)) for (const t of v.tables) { t.head = t.head.map((r) => r.map((c) => (c ?? '').toLowerCase())); t.foot = t.foot.map((r) => r.map((c, i) => (i === 0 ? (c ?? '').toLowerCase() : c))) }

// ---- format.ts (verbatim logic) ----
const DASH = '—'
const isNum = (x) => typeof x === 'number' && Number.isFinite(x)
const num = (x, d = 1) => (!isNum(x) ? DASH : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))
const int = (x) => (!isNum(x) ? DASH : Math.round(x).toLocaleString('en-US'))
const pct = (x, d = 0) => (!isNum(x) ? DASH : `${(x * 100).toFixed(d)}%`)
const times = (x, d = 2) => (!isNum(x) ? DASH : `${x.toFixed(d)}×`)
const money = (x) => {
  if (!isNum(x)) return DASH
  const a = Math.abs(x)
  if (a >= 1e9) return `$${(x / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(x / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `$${(x / 1e3).toFixed(0)}K`
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const usd = (x) => (!isNum(x) ? DASH : `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const signedMonths = (x) => (!isNum(x) ? DASH : `${x > 0 ? '+' : x < 0 ? '−' : ''}${num(Math.abs(x))}`)
const worst = (c) => (!isNum(c.worst_slowdown_months) || c.worst_slowdown_months <= 1e-6 ? 'none slower' : `${num(c.worst_slowdown_months)} mo`)
const ALLOC_LABEL = { actual: 'Registered', indep: 'Best response', coord: 'Coordinated (no losers)', coord_free: 'Joint optimum', coord_nl_indep: 'Pure coordination' }

const out = { checks: [], mismatches: [], notes: [] }
let nCheck = 0
function eq(view, what, screen, expected) {
  nCheck++
  const ok = screen === expected
  out.checks.push({ view, what, ok })
  if (!ok) out.mismatches.push({ view, what, screen, expected })
  return ok
}
function contains(view, what, text, expected) {
  nCheck++
  const ok = (text ?? '').includes(expected)
  out.checks.push({ view, what, ok })
  if (!ok) out.mismatches.push({ view, what, screen: '(not found in view text)', expected })
  return ok
}
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()

const apiAll = log.api
const findApi = (pred) => {
  for (let i = apiAll.length - 1; i >= 0; i--) if (pred(apiAll[i])) return apiAll[i]
  return null
}
const clears = apiAll.filter((a) => a.url.endsWith('/api/clear') && a.status === 200)
const clearNE = clears.find((a) => JSON.parse(a.post).region === 'US-Northeast' && !JSON.parse(a.post).sponsor)?.body
const clearRG = clears.find((a) => JSON.parse(a.post).sponsor === 'Regeneron')?.body

// ---------- headline / decomposition (shared by Clear it and Portfolio) ----------
const COMPS = [
  ['coord_vs_actual', 'Headline: coordinated, no trial worse off (vs registered)'],
  ['indep_vs_actual', 'Site selection alone (best response vs registered)'],
  ['coordination_no_loser_vs_indep', 'Pure coordination, no losers (vs best response)'],
  ['coord_free_vs_actual', 'Joint optimum, losers allowed (vs registered)'],
  ['coord_free_vs_indep', 'Joint optimum, losers allowed (vs best response)'],
]
function checkHeadline(view, g, r) {
  const s = r.summary
  const h = s.coord_vs_actual
  const st = Object.fromEntries(g.stats.map((x) => [(x.label ?? '').toLowerCase(), x]))
  eq(view, 'headline ratio', st['enrollment-time ratio']?.value, times(h.ratio))
  eq(view, 'median speedup', st['median per-trial speedup']?.value, times(h.median_speedup))
  eq(view, 'share faster', st['trials faster']?.value, pct(h.share_faster))
  eq(view, 'share slower sub', norm(st['trials faster']?.sub), norm(`${pct(h.share_slower)} slower (${worst(h)}) by construction`))
  eq(view, 'dividend', norm(st['coordination dividend']?.value), norm(`${int(h.dividend_trial_months)} trial-months`))
  eq(view, 'median T', norm(st['coordination dividend']?.sub), norm(`median T ${num(h.median_T_base)} → ${num(h.median_T_new)} months`))
  eq(view, 'dollars', st['dollar conversion']?.value, money(s.dollars_direct))
  eq(view, 'dollars sub', norm(st['dollar conversion']?.sub), norm(`direct cost · ${money(s.dollars_lost_sales)} lost-sales equivalent · ${int(s.dividend_days)} trial-days`))
  contains(view, 'trials compared line', norm(g.main), `${int(h.trials)} trials compared · ${int(s.background_trials)} held fixed as background`)
  // decomposition table
  const t = g.tables.find((x) => (x.head[0] || [])[0] === 'comparison')
  if (!t) return eq(view, 'decomposition table present', 'missing', 'present')
  COMPS.forEach(([k, label], i) => {
    const c = s[k]
    const row = t.rows[i] || []
    contains(view, `decomp ${k} label`, row[0], label)
    eq(view, `decomp ${k} ratio`, row[1], times(c.ratio))
    eq(view, `decomp ${k} median`, row[2], times(c.median_speedup))
    eq(view, `decomp ${k} faster`, row[3], pct(c.share_faster))
    eq(view, `decomp ${k} slower`, row[4], pct(c.share_slower))
    eq(view, `decomp ${k} worst`, row[5], worst(c))
    eq(view, `decomp ${k} trial-months`, row[6], int(c.dividend_trial_months))
    eq(view, `decomp ${k} median T`, norm(row[7]), norm(`${num(c.median_T_base)} → ${num(c.median_T_new)}`))
  })
}

// Recompute the comparison blocks from the per-trial times (API internal consistency).
function recompute(r) {
  const mv = r.trials.filter((t) => t.movable)
  const blk = (b, n) => {
    const B = mv.map((t) => t[`T_${b}`])
    const N = mv.map((t) => t[`T_${n}`])
    const sb = B.reduce((a, x) => a + x, 0)
    const sn = N.reduce((a, x) => a + x, 0)
    return { ratio: sb / sn, dividend: sb - sn, faster: N.filter((x, i) => x < B[i] - 1e-6).length / mv.length }
  }
  return {
    coord_vs_actual: blk('actual', 'coord'),
    indep_vs_actual: blk('actual', 'indep'),
    coordination_no_loser_vs_indep: blk('indep', 'coord_nl_indep'),
    coord_free_vs_actual: blk('actual', 'coord_free'),
    coord_free_vs_indep: blk('indep', 'coord_free'),
  }
}
function checkConsistency(view, r) {
  const rc = recompute(r)
  for (const [k, v] of Object.entries(rc)) {
    const c = r.summary[k]
    // T values are rounded to 2 dp in the API (_m), so allow a small tolerance.
    nCheck++
    const ok = Math.abs(v.ratio - c.ratio) < 2e-3 && Math.abs(v.faster - c.share_faster) < 1e-9
    if (!ok) out.mismatches.push({ view, what: `API consistency ${k}`, screen: `recomputed ratio ${v.ratio.toFixed(4)} faster ${v.faster}`, expected: `summary ratio ${c.ratio.toFixed(4)} faster ${c.share_faster}` })
    out.checks.push({ view, what: `API consistency ${k}`, ok })
  }
}

// ---------- MAP ----------
function checkMap() {
  const r = clearNE
  const ALLOCS = ['actual', 'indep', 'coord', 'coord_free']
  const stats = {}
  for (const a of ALLOCS) {
    const loads = r.sites.map((s) => ({ s, n: s[`load_${a}`] }))
    const slots = loads.reduce((acc, x) => acc + x.n, 0)
    const amc = loads.reduce((acc, x) => acc + (x.s.is_amc ? x.n : 0), 0)
    const top10 = [...loads].sort((x, y) => y.n - x.n).slice(0, 10).reduce((acc, x) => acc + x.n, 0)
    const usedLoads = loads.filter((x) => x.n > 0).length
    stats[a] = { used: r.counts[`sites_used_${a}`], usedLoads, top10: top10 / slots, amc: amc / slots, max: Math.max(...loads.map((x) => x.n)), slots }
    // API consistency: sites_used count vs sites with load > 0; slots vs assignments length
    nCheck++
    if (stats[a].used !== usedLoads) out.mismatches.push({ view: 'map', what: `API sites_used_${a} vs sites with load>0`, screen: usedLoads, expected: stats[a].used })
    if (slots !== r.assignments[a].length) out.mismatches.push({ view: 'map', what: `API slots ${a} vs assignments`, screen: slots, expected: r.assignments[a].length })
  }
  for (const a of ALLOCS) {
    const g = log.views[`01_map_${a}`]
    if (!g) {
      out.mismatches.push({ view: 'map', what: `view ${a} missing`, screen: null, expected: 'grab' })
      continue
    }
    const t = g.tables[0]
    ALLOCS.forEach((b, i) => {
      const row = t.rows[i]
      eq(`map/${a}`, `conc ${b} label`, row[0], ALLOC_LABEL[b])
      eq(`map/${a}`, `conc ${b} used`, row[1], int(stats[b].used))
      eq(`map/${a}`, `conc ${b} top10`, row[2], pct(stats[b].top10))
      eq(`map/${a}`, `conc ${b} amc`, row[3], pct(stats[b].amc))
      eq(`map/${a}`, `conc ${b} max`, row[4], int(stats[b].max))
    })
    contains(
      `map/${a}`,
      'site/trial counts',
      norm(g.main),
      norm(g.main).includes('candidate sites, ')
        ? `Of ${int(r.counts.sites)} candidate sites, ${int(r.counts.trials)} trials.` // before the label fix
        : `${int(r.counts.sites)} sites in the region instance (${int(r.summary.assumptions.candidate_sites)} open to reassignment), ${int(r.counts.trials)} trials.`,
    )
    contains(
      `map/${a}`,
      'concentration sentence',
      norm(g.main),
      `The 10 busiest sites hold ${pct(stats.actual.top10)} of trial–site slots as registered, ${pct(stats.indep.top10)} under each trial’s best response, ${pct(stats.coord_free.top10)} under the joint optimum and ${pct(stats.coord.top10)} under the no-loser headline allocation.`,
    )
    // busiest list
    const top = [...r.sites].filter((s) => s[`load_${a}`] > 0).sort((x, y) => y[`load_${a}`] - x[`load_${a}`] || y.k - x.k).slice(0, 10)
    for (const s of top) contains(`map/${a}`, `top ${s.facility}`, norm(g.main), norm(`${s[`load_${a}`]} / cap ${s.k}`))
    const ol = g.main.split('Busiest sites')[1] ?? ''
    const names = top.map((s) => s.facility)
    let pos = 0
    let inOrder = true
    for (const n of names) {
      const p = ol.indexOf(n, pos)
      if (p < 0) inOrder = false
      else pos = p
    }
    eq(`map/${a}`, 'busiest list order', inOrder, true)
    out.notes.push(`map/${a}: slots=${stats[a].slots}, used=${stats[a].used}`)
  }
}

// ---------- CLEAR IT ----------
function checkClear() {
  const g = log.views['02_clear_default']
  const r = clearNE
  const s = r.summary
  checkHeadline('clear', g, r)
  checkConsistency('clear', r)
  const m = norm(g.main)
  contains('clear', 'runline counts', m, `${int(r.counts.movable_trials)} trials compared · ${int(r.counts.trials)} in instance · ${int(r.counts.sites)} sites`)
  const b = s.assumptions.beta
  contains('clear', 'beta', m, `${num(b.beta, 3)} (95% CI ${num(b.ci95[0], 3)} to ${num(b.ci95[1], 3)})`)
  contains('clear', 'beta source', m, b.source)
  contains('clear', 'level factor', m, `level factor ×${num(s.assumptions.level_factor, 3)}`)
  contains('clear', 'rate cap', m, `capped at q${num(s.assumptions.rate_cap_q * 100, 0)}`)
  contains('clear', 'candidate sites', m, `${int(s.assumptions.candidate_sites)} candidate sites`)
  contains('clear', 'plausible cap', m, `trials over ${int(s.assumptions.plausible_T_cap_months)} mo held as background`)
  contains('clear', 'beta hint', m, `Blank = data estimate (${num(b.beta, 3)}, 95% CI ${num(b.ci95[0], 3)} to ${num(b.ci95[1], 3)}).`)
  const c = s.calibration_check
  contains('clear', 'calib phase3', m, `${num(c.model_median_T_actual_phase3)} mo (${int(c.phase3_trials_in_instance)} trials)`)
  contains('clear', 'calib real', m, `median enrollment window ${num(c.real_completed_phase3_median_enrollment_window)} mo (start to primary completion ${num(c.real_completed_phase3_median_start_to_primary_completion)} mo`)
  contains('clear', 'calib n', m, `n = ${int(c.real_n)}`)
  const ratio = c.model_median_T_actual_phase3 / c.real_completed_phase3_median_enrollment_window
  if (ratio > 1.25) contains('clear', 'calib badge', m, `${num(ratio, 1)}× longer than completed trials`)
  for (const [k, st] of Object.entries(s.solver))
    contains('clear', `solver ${k}`, m, `${ALLOC_LABEL[k] ?? k}: ${num(st.seconds, 1)} s, ${int(st.improvements)} improving moves`)
  contains('clear', 'background note', m, `${int(s.background_trials)} background trials are held at their registered sites and excluded from every number. Under the joint optimum with losers allowed, ${int(s.background_worse_under_coord_free)} of them would be slower`)
  // Trials table
  const t = g.tables.find((x) => x.cls.includes('tbl-trials'))
  const byId = new Map(r.trials.map((x) => [x.nct_id, x]))
  let rowsChecked = 0
  for (const row of t.rows) {
    const id = (row[0].match(/NCT\d{8}/) || [])[0]
    const tr = byId.get(id)
    if (!tr) {
      out.mismatches.push({ view: 'clear', what: 'trial row id', screen: row[0].slice(0, 40), expected: 'an NCT id in API' })
      continue
    }
    rowsChecked++
    eq('clear', `${id} sponsor`, row[1], tr.sponsor ?? '—')
    eq('clear', `${id} target`, row[2], num(tr.target_region))
    eq('clear', `${id} sites`, row[3], int(tr.sites_actual))
    ;['actual', 'indep', 'coord', 'coord_free'].forEach((k, i) => eq('clear', `${id} T_${k}`, row[4 + i], num(tr[`T_${k}`])))
    const d = isNum(tr.T_actual) && isNum(tr.T_coord) ? tr.T_actual - tr.T_coord : null
    eq('clear', `${id} saved`, row[9], tr.movable ? signedMonths(d) : 'excluded')
  }
  eq('clear', 'trial rows shown', rowsChecked, r.trials.length)
  // Order: movable first, by months saved desc
  const ids = t.rows.map((row) => (row[0].match(/NCT\d{8}/) || [])[0])
  const exp = [...r.trials]
    .sort((a, b) => {
      if (a.movable !== b.movable) return a.movable ? -1 : 1
      const va = isNum(a.T_actual) && isNum(a.T_coord) ? a.T_actual - a.T_coord : null
      const vb = isNum(b.T_actual) && isNum(b.T_coord) ? b.T_actual - b.T_coord : null
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return vb - va
    })
    .map((x) => x.nct_id)
  eq('clear', 'trial order', JSON.stringify(ids.slice(0, 20)), JSON.stringify(exp.slice(0, 20)))
  // background count in filter label
  contains('clear', 'background count', m, `Background trials (${r.trials.filter((x) => !x.movable).length})`)
}

// ---------- ROBUSTNESS ----------
function rng(xs) {
  const v = xs.filter(isNum)
  if (!v.length) return DASH
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  return Math.abs(hi - lo) < 0.005 ? times(lo) : `${times(lo)}–${times(hi)}`
}
function checkRobust(viewName, matchFn) {
  const g = log.views[viewName]
  if (!g) return
  // the robustness response the page used: last robustness response before this snapshot that matches
  const resp = apiAll.filter((a) => a.url.includes('/api/robustness') && a.status === 200 && matchFn(a.url))
  const d = resp[resp.length - 1]?.body
  if (!d) return out.mismatches.push({ view: viewName, what: 'robustness API response', screen: null, expected: 'captured' })
  const rows = d.rows
  const assumed = (r) => r.beta_label.toLowerCase().includes('assumed')
  const data = rows.filter((r) => !assumed(r))
  const m = norm(g.main)
  contains(viewName, 'pure data range', m, `${rng(data.map((r) => r.coordination_no_loser_vs_indep.ratio))} with β from the data`)
  if (rows.some(assumed)) contains(viewName, 'pure assumed range', m, `against ${rng(rows.filter(assumed).map((r) => r.coordination_no_loser_vs_indep.ratio))} under the assumed β = 1`)
  contains(viewName, 'headline range', m, `(no trial worse off vs registered sites): ${rng(data.map((r) => r.coord_vs_actual.ratio))}`)
  contains(viewName, 'selection range', m, `(best response vs registered): ${rng(data.map((r) => r.indep_vs_actual.ratio))}`)
  const t = g.tables.find((x) => x.cls.includes('tbl-robust'))
  eq(viewName, 'grid rows', t.rows.length, rows.length)
  rows.forEach((r, i) => {
    const row = t.rows[i]
    contains(viewName, `row ${i} beta`, row[0], `β = ${num(r.beta, 3)}`)
    eq(viewName, `row ${i} headline`, norm(row[3]), norm(`${times(r.coord_vs_actual.ratio)} (${times(r.coord_vs_actual.median_speedup)})`))
    eq(viewName, `row ${i} pure`, row[4], times(r.coordination_no_loser_vs_indep.ratio, 3))
    eq(viewName, `row ${i} joint`, row[5], times(r.coord_free_vs_actual.ratio))
    eq(viewName, `row ${i} share slower`, row[6], pct(r.coord_free_vs_actual.share_slower))
    eq(viewName, `row ${i} selection`, row[7], times(r.indep_vs_actual.ratio))
    eq(viewName, `row ${i} trials`, row[8], int(r.coord_vs_actual.trials))
  })
  out.notes.push(`${viewName}: params ${JSON.stringify(d.params)}`)
  return d
}

// ---------- PRICE TAGS / SLOTS ----------
function checkPriceTags() {
  const g = log.views['04_pricetags']
  const tg = findApi((a) => a.url.includes('/price-tags') && a.status === 200)?.body
  if (!g || !tg) return out.mismatches.push({ view: 'price tags', what: 'data', screen: !!g, expected: !!tg })
  const tr = clearNE.trials.find((t) => t.nct_id === tg.nct_id)
  const m = norm(g.main)
  contains('price tags', 'T registered', m, `T registered ${num(tr.T_actual)} mo`)
  contains('price tags', 'T best response', m, `T best response ${num(tr.T_indep)} mo`)
  contains('price tags', 'T coordinated', m, `T coordinated ${num(tr.T_coord)} mo`)
  contains('price tags', 'T joint', m, `T joint optimum ${num(tr.T_coord_free)} mo`)
  contains('price tags', 'target', m, `regional target ${num(tr.target_region)} pts`)
  contains('price tags', 'f', m, `eligible fraction (synthetic) ${num(tr.f * 100, 1)}%`)
  contains('price tags', 'n criteria', m, `Price tags · ${tg.criteria.length} parsed criteria`)
  contains('price tags', 'reference T', m, `(T = ${num(tg.T_coord)} months)`)
  for (const c of tg.criteria) {
    const sign = c.months_saved_trial > 0 ? '−' : c.months_saved_trial < 0 ? '+' : ''
    contains('price tags', `${c.label} trial`, m, `${c.label}`)
    contains('price tags', `${c.label} months`, m, `this trial, if relaxed ${sign}${num(Math.abs(c.months_saved_trial))} mo portfolio ${num(c.months_saved_portfolio)} trial-mo pool ${times(c.pool_multiplier)}`)
  }
  if (tg.alternatives_not_priced?.length) contains('price tags', 'alternatives', m, tg.alternatives_not_priced.join(', '))
  out.notes.push(`price tags ${tg.nct_id}: ${JSON.stringify(tg.criteria.map((c) => [c.label, c.months_saved_trial, c.months_saved_portfolio, c.pool_multiplier]))}; T_ref=${tg.T_coord}; alternatives=${JSON.stringify(tg.alternatives_not_priced)}`)
}
function checkSlots() {
  const g = log.views['05_slotvalues']
  const sv = findApi((a) => a.url.includes('/slot-values') && a.status === 200)?.body
  if (!g || !sv) return out.mismatches.push({ view: 'slot values', what: 'data', screen: !!g, expected: !!sv })
  const t = g.tables.find((x) => (x.head[0] || []).includes('hist. rate (pts/mo)'))
  if (sv.length === 0) return contains('slot values', 'empty msg', g.main, 'No site is at capacity')
  eq('slot values', 'rows', t.rows.length, sv.length)
  sv.forEach((s, i) => {
    const row = t.rows[i]
    contains('slot values', `${s.site_id} name`, row[0], s.facility)
    eq('slot values', `${s.site_id} k`, row[1], int(s.k))
    eq('slot values', `${s.site_id} rate`, norm(row[2]), norm(`${num(s.lam_hist, 2)}${s.lam_ci ? ` [${num(s.lam_ci[0], 2)}–${num(s.lam_ci[1], 2)}]` : ''}`))
    eq('slot values', `${s.site_id} n hist`, row[3], int(s.n_hist))
    eq('slot values', `${s.site_id} saved`, row[4], num(s.months_saved))
    // label check: "posterior mean" -> lam_hist should be the raw posterior mean unless capped
    if (isNum(s.lam_raw) && Math.abs(s.lam_raw - s.lam_hist) > 1e-9)
      out.notes.push(`slot ${s.facility}: lam_hist ${s.lam_hist} differs from posterior mean lam_raw ${s.lam_raw} (capped low-history rate)`)
    if (s.lam_ci && (s.lam_hist < s.lam_ci[0] || s.lam_hist > s.lam_ci[1]))
      out.notes.push(`slot ${s.facility}: shown rate ${s.lam_hist} outside its own 10-90 bracket ${s.lam_ci}`)
  })
  out.notes.push(`slot values: ${JSON.stringify(sv.map((s) => [s.facility, s.k, s.months_saved, s.lam_hist, s.n_hist]))}`)
}

// ---------- TERMS ----------
function checkTerms() {
  const g = log.views['06_terms']
  const ts = findApi((a) => a.url.includes('/api/termsheet') && a.status === 200)
  if (!g || !ts) return out.mismatches.push({ view: 'terms', what: 'data', screen: !!g, expected: !!ts })
  const d = ts.body
  const b = d.budget
  const m = norm(g.main)
  const st = Object.fromEntries(g.stats.map((x) => [(x.label ?? '').toLowerCase(), x]))
  eq('terms', 'expected patients', st['expected patients at this site']?.value, num(d.expected_patients))
  eq('terms', 'per patient', st['per-patient budget']?.value, usd(b.per_patient_total))
  eq('terms', 'site total', st['expected site total']?.value, usd(d.expected_site_total))
  contains('terms', 'facility', m, d.site.facility)
  // coverage grid
  const cov = g.tables.find((x) => x.cls.includes('tbl-coverage'))
  eq('terms', 'coverage rows', cov.rows.length, d.coverage_grid.length)
  d.coverage_grid.forEach((row, i) => {
    const r = cov.rows[i]
    eq('terms', `cov ${i} visit`, r[0], row.visit)
    eq('terms', `cov ${i} code`, r[2], row.code)
    eq('terms', `cov ${i} coverage`, r[3], row.coverage)
    eq('terms', `cov ${i} payer`, r[4], row.payer)
    eq('terms', `cov ${i} schedule`, r[6], row.schedule ?? '—')
    contains('terms', `cov ${i} amount`, r[7], usd(row.medicare_amount))
    contains('terms', `cov ${i} mark`, r[7], row.verified ? 'CMS 2026' : 'placeholder')
  })
  // procedure lines
  const pt = g.tables.find((x) => (x.head[0] || []).includes('local (billed)'))
  eq('terms', 'procedure rows', pt.rows.length, b.procedure_lines.length)
  b.procedure_lines.forEach((l, i) => {
    const r = pt.rows[i]
    eq('terms', `proc ${i} code`, r[1], l.code)
    eq('terms', `proc ${i} national`, r[3], usd(l.national))
    contains('terms', `proc ${i} local`, r[4], usd(l.amount))
  })
  eq('terms', 'procedures total', pt.foot[0][1], usd(b.procedures_total))
  // internal arithmetic: procedures total = sum of priced lines
  const sumLines = b.procedure_lines.reduce((a, l) => a + (isNum(l.amount) ? l.amount : 0), 0)
  if (Math.abs(sumLines - b.procedures_total) > 0.011) out.mismatches.push({ view: 'terms', what: 'API procedures_total vs sum of lines', screen: sumLines.toFixed(2), expected: b.procedures_total })
  const ppSum = b.per_patient_items.reduce((a, i) => a + i.amount, 0) + b.procedures_total
  if (Math.abs(ppSum - b.per_patient_total) > 0.011) out.notes.push(`terms: per_patient_total ${b.per_patient_total} vs procedures + per-patient items ${ppSum.toFixed(2)}`)
  const fixed = b.per_site_items.filter((i) => i.unit === 'per_site').reduce((a, i) => a + i.amount, 0)
  const allSite = b.per_site_items.reduce((a, i) => a + i.amount, 0)
  const expTotal = fixed + b.per_patient_total * d.expected_patients
  out.notes.push(`terms: per_site units ${JSON.stringify(b.per_site_items.map((i) => [i.label, i.unit, i.amount]))}; fixed(per_site)=${fixed}; all site items=${allSite}; fixed+pp*expected=${expTotal.toFixed(2)}; API expected_site_total=${d.expected_site_total}; expected_patients=${d.expected_patients} (${d.expected_source})`)
  if (Math.abs(expTotal - d.expected_site_total) > 0.02)
    out.mismatches.push({ view: 'terms', what: 'expected site total = per-site fixed + per-patient × expected (screen label)', screen: `${usd(fixed)} + ${usd(b.per_patient_total)} × ${num(d.expected_patients)} = ${usd(expTotal)}`, expected: usd(d.expected_site_total) })
  // per-patient and per-site tables
  const two = g.tables.filter((x) => x.cls.includes('tbl-compact'))
  const ppT = two.find((x) => x.foot.length && x.foot[0][0].startsWith('per-patient total'))
  const psT = two.find((x) => x.foot.length && x.foot[0][0].startsWith('per-site fixed total'))
  b.per_patient_items.forEach((it, i) => eq('terms', `pp ${it.id}`, ppT.rows[i][1], usd(it.amount)))
  eq('terms', 'pp total', ppT.foot[0][1], usd(b.per_patient_total))
  b.per_site_items.forEach((it, i) => eq('terms', `ps ${it.id}`, psT.rows[i][1], usd(it.amount)))
  eq('terms', 'ps total', psT.foot[0][1], usd(fixed))
  if (isNum(b.conversion_factor)) contains('terms', 'conversion factor', m, `PFS conversion factor $${num(b.conversion_factor, 4)}`)
  contains('terms', 'locality', m, `Medicare locality ${b.locality ?? 'national (no locality match)'}`)
  if (b.unpriced_codes.length) contains('terms', 'unpriced', m, b.unpriced_codes.join(', '))
  // expected patients cross-check against the headline allocation: trial has this site in coord
  const u = new URL(ts.url)
  const sid = u.searchParams.get('site_id')
  const nct = u.searchParams.get('nct_id')
  const inCoord = clearNE.assignments.coord.some(([s, t]) => s === sid && t === nct)
  out.notes.push(`terms: site ${sid} trial ${nct} in coord assignments: ${inCoord}; expected_source ${d.expected_source}`)
  const siteObj = clearNE.sites.find((s) => s.site_id === sid)
  const busiest = Math.max(...clearNE.sites.filter((s) => clearNE.assignments.coord.some(([x]) => x === s.site_id)).map((s) => s.load_coord))
  eq('terms', 'default site is busiest coordinated', siteObj?.load_coord, busiest)
}

// ---------- MODEL ----------
function checkModel() {
  const g = log.views['07_model']
  const st = findApi((a) => a.url.endsWith('/api/status') && a.status === 200)?.body
  const cg = findApi((a) => a.url.endsWith('/api/congestion-test') && a.status === 200)?.body
  const cp = findApi((a) => a.url.endsWith('/api/compile/eligibility') && a.status === 200)?.body
  if (!g || !st || !cg) return out.mismatches.push({ view: 'model', what: 'data', screen: !!g, expected: `${!!st} ${!!cg}` })
  const m = norm(g.main)
  const sts = Object.fromEntries(g.stats.map((x) => [(x.label ?? '').toLowerCase(), x]))
  eq('model', 'trials', sts['trials']?.value, int(st.counts.trials))
  eq('model', 'sites', sts['sites']?.value, int(st.counts.sites))
  eq('model', 'links', sts['trial–site links']?.value, int(st.counts.trial_sites))
  // crawls table
  const ct = g.tables.find((x) => (x.head[0] || [])[0] === 'crawl')
  Object.values(st.crawls).forEach((c, i) => {
    eq('model', `crawl ${c.name} studies`, ct.rows[i][2], `${int(c.studies)} / ${int(c.total)}`)
    eq('model', `crawl ${c.name} state`, ct.rows[i][3], c.done ? 'complete' : 'in progress')
  })
  // congestion card
  const prim = cg.results[cg.primary]
  contains('model', 'cong n', m, `${int(cg.n_trials)} completed trials (${int(cg.n_trial_sites)} trial–site rows)`)
  contains('model', 'cong implied', m, `assumed a coefficient of ${num(cg.model_implied_coef_overlap, 0)} on log(1 + Σ overlap)`)
  eq('model', 'cong estimate', sts['within-site estimate']?.value, num(prim.coef, 3))
  eq('model', 'cong ci', norm(sts['within-site estimate']?.sub), norm(`95% CI ${num(prim.ci95[0], 3)} to ${num(prim.ci95[1], 3)} · p = ${num(prim.p, 2)}`))
  eq('model', 'cong assumed', sts['model had assumed']?.value, num(cg.model_implied_coef_overlap, 0))
  const outside = cg.model_implied_coef_overlap < prim.ci95[0] || cg.model_implied_coef_overlap > prim.ci95[1]
  eq('model', 'cong outside', sts['model had assumed']?.sub, outside ? 'Outside the 95% CI' : 'Inside the 95% CI')
  eq('model', 'cong n rows', sts['observations']?.value, int(prim.n_rows))
  if (cg.results.pooled_overlap) contains('model', 'pooled', m, `(pooled coefficient ${num(cg.results.pooled_overlap.coef, 3)}, 95% CI ${num(cg.results.pooled_overlap.ci95[0], 3)} to ${num(cg.results.pooled_overlap.ci95[1], 3)})`)
  const spec = g.tables.find((x) => (x.head[0] || [])[0] === 'design')
  const keys = []
  for (const sp of ['within', 'site_fe', 'pooled']) for (const ex of ['overlap', 'start', 'avg']) if (cg.results[`${sp}_${ex}`]) keys.push(`${sp}_${ex}`)
  eq('model', 'spec rows', spec.rows.length, keys.length)
  keys.forEach((k, i) => {
    const rr = cg.results[k]
    eq('model', `${k} coef`, spec.rows[i][2], num(rr.coef, 4))
    eq('model', `${k} ci`, spec.rows[i][3], `${num(rr.ci95[0], 4)} to ${num(rr.ci95[1], 4)}`)
    eq('model', `${k} p`, spec.rows[i][4], num(rr.p, 3))
    eq('model', `${k} n`, spec.rows[i][5], int(rr.n_rows))
  })
  const extra = Object.keys(cg.results).filter((k) => !keys.includes(k))
  if (extra.length) out.notes.push(`congestion results not shown in the specifications table: ${extra.join(', ')}`)
  // the clear's beta vs the congestion test
  const b = clearNE.summary.assumptions.beta
  out.notes.push(`congestion primary=${cg.primary} coef=${prim.coef} ci=${prim.ci95}; clear beta=${b.beta} ci=${b.ci95} (beta = -coef?)`)
  // backtest
  const bt = st.model?.backtest
  if (bt) {
    contains('model', 'bt cutoff', m, `Fit on trials before ${bt.cutoff} (${int(bt.train_trials)} trials), scored on ${int(bt.test_trials)} later trials`)
    const t = g.tables.find((x) => (x.head[1] || [])[0] === 'predictor')
    const models = ['model', 'raw', 'naive'].filter((k) => bt.by_model?.[k])
    models.forEach((mk, i) => {
      ;['industry_p23', 'industry_p3', 'all'].forEach((sl, j) => {
        const c = bt.by_model[mk][sl]
        const e = c ? `${num(c.median_abs_log_error, 2)} (×${num(Math.exp(c.median_abs_log_error), 1)})` : '—'
        const sgn = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${num(Math.abs(x), 2)}`
        eq('model', `bt ${mk} ${sl} err`, norm(t.rows[i][1 + 2 * j]), e)
        eq('model', `bt ${mk} ${sl} bias`, t.rows[i][2 + 2 * j], c ? sgn(c.median_signed_log_bias) : '—')
      })
    })
    ;['industry_p23', 'industry_p3', 'all'].forEach((sl, j) => eq('model', `bt n ${sl}`, t.rows[models.length][1 + 2 * j], int(bt.by_model.model?.[sl]?.n)))
    if (bt.calibration_slope_industry_p23) contains('model', 'slope', m, `${num(bt.calibration_slope_industry_p23.slope, 2)} ± ${num(bt.calibration_slope_industry_p23.se, 2)}`)
    if (isNum(bt.level_log_bias_industry_p23)) contains('model', 'level bias', m, `log bias ${num(bt.level_log_bias_industry_p23, 3)}`)
    if (bt.low_history_rule)
      contains(
        'model',
        'low history rule',
        m,
        m.includes('sites below the prior')
          ? `${int(bt.low_history_rule.n_below)} sites below the prior’s ${num(bt.low_history_rule.prior_quantile * 100, 0)}th-percentile rate (${num(bt.low_history_rule.rate, 3)} pts/mo)` // before the label fix
          : `sites with fewer than ${int(bt.low_history_rule.n_below)} past lung trials are capped at the prior’s ${num(bt.low_history_rule.prior_quantile * 100, 0)}th-percentile rate (${num(bt.low_history_rule.rate, 3)} pts/mo)`,
      )
    contains('model', 'off by factor', m, `typically off by a factor of ${num(Math.exp(bt.by_model?.model?.industry_p23?.median_abs_log_error ?? bt.median_abs_log_error_model), 1)}`)
    out.notes.push(`backtest low_history_rule: ${JSON.stringify(bt.low_history_rule)}`)
  }
  const pr = st.model?.prior
  if (pr) {
    contains('model', 'prior alpha', m, `α (shape) ${num(pr.alpha, 3)}`)
    contains('model', 'prior beta', m, `β (rate) ${num(pr.beta, 3)}`)
    contains('model', 'prior mean', m, `Mean ${num(pr.mean, 3)}`)
    contains('model', 'prior median', m, `Median ${num(pr.median, 3)}`)
    contains('model', 'history trials', m, `Trials with history used ${int(st.model.history_trials)}`)
    contains('model', 'fitted sites', m, `Sites with fitted rates ${int(st.model.fitted_sites)}`)
    contains('model', 'f_ref', m, `Reference eligible fraction f_ref ${num(st.model.f_ref, 4)}`)
  }
  if (cp) {
    contains('model', 'compile fraction', m, `Eligible fraction ${cp.eligible_fraction === null ? '—' : pct(cp.eligible_fraction, 1)}`)
    const t = g.tables.find((x) => (x.head[0] || [])[0] === 'criterion')
    eq('model', 'compile rows', t ? t.rows.length : 0, cp.criteria.length)
    out.notes.push(`compile: ${cp.criteria.length} criteria, fraction ${cp.eligible_fraction}; labels ${cp.criteria.map((c) => c.label).join(' | ')}`)
  } else out.mismatches.push({ view: 'model', what: 'compile response', screen: null, expected: 'captured' })
}

// ---------- PORTFOLIO ----------
function checkPortfolio() {
  const g = log.views['08_portfolio_regeneron']
  const r = clearRG
  if (!g || !r) return out.mismatches.push({ view: 'portfolio', what: 'data', screen: !!g, expected: !!r })
  checkHeadline('portfolio', g, r)
  checkConsistency('portfolio', r)
  const m = norm(g.main)
  const own = r.trials.filter((t) => t.movable)
  const t = g.tables.find((x) => (x.head[0] || []).includes('realized'))
  eq('portfolio', 'own rows', t.rows.length, own.length)
  own.forEach((tr, i) => {
    const row = t.rows[i]
    contains('portfolio', `${tr.nct_id} id`, row[0], tr.nct_id)
    eq('portfolio', `${tr.nct_id} target`, row[1], num(tr.target_region))
    eq('portfolio', `${tr.nct_id} sites`, norm(row[2]), norm(`${int(tr.sites_actual)} → ${int(tr.sites_coord)}`))
    eq('portfolio', `${tr.nct_id} T_actual`, row[3], num(tr.T_actual))
    eq('portfolio', `${tr.nct_id} T_indep`, row[4], num(tr.T_indep))
    eq('portfolio', `${tr.nct_id} T_coord`, row[5], num(tr.T_coord))
    eq('portfolio', `${tr.nct_id} T_coord_free`, row[6], num(tr.T_coord_free))
    eq('portfolio', `${tr.nct_id} saved`, row[7], signedMonths(tr.T_actual - tr.T_coord))
    eq('portfolio', `${tr.nct_id} realized`, row[8], num(tr.realized_window_months))
  })
  contains('portfolio', 'background', m, `${int(r.summary.background_trials)} other trials are held fixed at their registered sites. Under the joint optimum with losers allowed, ${int(r.summary.background_worse_under_coord_free)} of them would enroll more slowly`)
  // Shared registered sites recomputed from assignments.actual
  const ownIds = new Set(own.map((x) => x.nct_id))
  const bySite = new Map()
  for (const [s, tid] of r.assignments.actual) if (ownIds.has(tid)) bySite.set(s, [...(bySite.get(s) ?? []), tid])
  const shared = [...bySite.entries()].filter(([, l]) => l.length >= 2)
  const st = g.tables.find((x) => (x.head[0] || []).join('|') === 'site|trials|which')
  eq('portfolio', 'shared site rows', st ? st.rows.length : 0, shared.length)
  // Sponsor dropdown: from /api/sponsors with the form region and as_of
  const sp = apiAll.filter((a) => a.url.includes('/api/sponsors') && a.status === 200)
  out.notes.push(`portfolio sponsors requests: ${sp.map((a) => a.url.split('?')[1]).join(' ; ')}`)
  // Regeneron as a listed sponsor option?
  out.notes.push(`portfolio: own trials ${own.length}; flagged in instance ${r.counts.flagged_trials}; background ${r.summary.background_trials}; shared sites ${shared.length}`)
  // Calibration same-trial line isn't shown in portfolio view; realized windows:
  const real = own.filter((x) => isNum(x.realized_window_months))
  out.notes.push(`portfolio realized windows for ${real.length}/${own.length} own trials`)
}

checkMap()
checkClear()
checkRobust('03_robustness_current', (u) => u.includes('region=US-Northeast'))
checkRobust('03_robustness_default', (u) => u.includes('region=US-Northeast'))
checkRobust('03_robustness_regeneron', (u) => u.includes('sponsor=Regeneron'))
checkRobust('09_robustness_current_after_portfolio', (u) => u.includes('sponsor=Regeneron'))
checkPriceTags()
checkSlots()
checkTerms()
checkModel()
checkPortfolio()

out.summary = { checks: nCheck, mismatches: out.mismatches.length, consoleErrors: log.console.length, pageErrors: log.pageerrors.length, runError: log.error ?? null }
fs.writeFileSync(`${W}/${NAME}_compare.json`, JSON.stringify(out, null, 1))
console.log(JSON.stringify(out.summary))
const byView = {}
for (const c of out.checks) {
  const v = c.view.split('/')[0]
  byView[v] = byView[v] || { checks: 0, bad: 0 }
  byView[v].checks++
  if (!c.ok) byView[v].bad++
}
console.log(JSON.stringify(byView))
for (const mm of out.mismatches.slice(0, 60)) console.log('MISMATCH', JSON.stringify(mm))
for (const n of out.notes) console.log('NOTE', n.slice(0, 600))
for (const c of log.console.slice(0, 20)) console.log('CONSOLE', c.type, c.text.slice(0, 300))
for (const e of log.pageerrors) console.log('PAGEERROR', e.slice(0, 300))
