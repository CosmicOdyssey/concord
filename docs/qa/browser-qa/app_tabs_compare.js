// Side by side: two runs of app_tabs_measure.js (before = main, after = a branch), one row per switch, and a summary.
// A heading not shown within the 1.5 s window counts as 1500 ms for the median and max.
// Usage: node app_tabs_compare.js <before.json> <after.json> <out.md>
const fs = require('fs')

const [, , beforeFile, afterFile, outFile] = process.argv
const B = JSON.parse(fs.readFileSync(beforeFile, 'utf8'))
const A = JSON.parse(fs.readFileSync(afterFile, 'utf8'))
const key = (r) => `${r.from}>${r.to}>${r.visit}`
const bIdx = new Map(B.rows.map((r) => [key(r), r]))
const fmt = (v) => (v === null || v === undefined ? '>1500' : String(v))
const fb = (r) => (r.fallback ? `${r.fallback_ms}` : '-')
const db = (r) => (r.data_loading ? `${r.data_loading_ms}` : '-')
const sc = (r) => (r.left_at !== undefined ? `${r.scroll_end} (${r.left_at})` : `${r.scroll_end}`)
const lines = [
  '| from -> to | visit | heading ms before / after | code fallback ms before / after | data Loading box ms before / after | CLS 1.5 s before / after | scroll at end (left at) before / after | fade done ms after |',
  '|---|---|---|---|---|---|---|---|',
]
for (const a of A.rows) {
  const b = bIdx.get(key(a))
  if (!b) continue
  lines.push(
    `| ${a.from} -> ${a.to} | ${a.visit} | ${fmt(b.heading_ms)} / ${fmt(a.heading_ms)} | ${fb(b)} / ${fb(a)} | ${db(b)} / ${db(a)} | ${b.cls} / ${a.cls} | ${sc(b)} / ${sc(a)} | ${fmt(a.opaque_ms)} |`,
  )
}
const med = (xs) => {
  const s = xs.slice().sort((p, q) => p - q)
  return s.length ? s[Math.floor(s.length / 2)] : null
}
const agg = (rows, vis) => {
  const rs = rows.filter((r) => r.visit === vis && r.from !== 'landing')
  const h = rs.map((r) => r.heading_ms ?? 1500)
  return {
    pairs: rs.length,
    heading_median_ms: med(h),
    heading_max_ms: Math.max(...h),
    heading_over_200ms: h.filter((x) => x > 200).length,
    heading_not_within_1500ms: rs.filter((r) => r.heading_ms === null).length,
    code_fallback_shown: rs.filter((r) => r.fallback).length,
    code_fallback_max_ms: Math.max(0, ...rs.map((r) => r.fallback_ms)),
    data_loading_box_shown: rs.filter((r) => r.data_loading).length,
    cls_median: med(rs.map((r) => r.cls)),
    cls_max: Math.max(...rs.map((r) => r.cls)),
    cls_over_0_1: rs.filter((r) => r.cls > 0.1).length,
    scroll_restored: vis === 'revisit' ? rs.filter((r) => r.left_at !== undefined && Math.abs((r.scroll_end ?? -1) - r.left_at) <= 1).length : null,
    scroll_moved_after_paint: rs.filter((r) => r.scroll_jump_after_paint > 0).length,
    tabbar_moved: rs.filter((r) => (r.tabbar_move ?? 0) > 0.5).length,
  }
}
const side = (R) => ({
  base: R.base,
  reduced: R.reduced,
  first: agg(R.rows, 'first'),
  revisit: agg(R.rows, 'revisit'),
  landing: R.rows.filter((r) => r.from === 'landing').map((r) => ({ visit: r.visit, heading_ms: r.heading_ms, fallback_ms: r.fallback_ms, cls: r.cls })),
  pageerrors: R.log.pageerrors.length,
  console: R.log.console.length,
})
const summary = { before: side(B), after: side(A) }
const md = [
  `# App tab switching: ${B.label} (before) vs ${A.label} (after)`,
  '',
  `before ${B.when} ${B.base}; after ${A.when} ${A.base}`,
  '',
  ...lines,
  '',
  '```',
  JSON.stringify(summary, null, 1),
  '```',
  '',
]
fs.writeFileSync(outFile, md.join('\n'))
console.log(JSON.stringify(summary, null, 1))
