// Regenerates the GENERATED block of src/competitorData.ts from docs/competitive-landscape.md (the sourced, fact-checked
// competitor landscape). Everything between the BEGIN/END GENERATED markers is copied from the document: the matrix
// rows and their cell marks, every cell's evidence text and links, the pain-evidence table, the section-3 lists, the
// method notes and the sources list. Text is kept verbatim; only trailing URLs are split off into links and trailing
// "link above" references are resolved to the URL they point at.
// usage (from frontend/): node scripts/gen-competitor-data.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const DOC = new URL('../../docs/competitive-landscape.md', import.meta.url)
const OUT = new URL('../src/competitorData.ts', import.meta.url)
const md = readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n')
const lines = md.split('\n')

const fail = (msg) => {
  throw new Error(`gen-competitor-data: ${msg}`)
}
const between = (start, end) => {
  const a = lines.findIndex((l) => l.startsWith(start))
  if (a < 0) fail(`missing "${start}"`)
  const b = lines.findIndex((l, i) => i > a && l.startsWith(end))
  if (b < 0) fail(`missing "${end}" after "${start}"`)
  return lines.slice(a + 1, b)
}

// Stable ids for the matrix rows (by the row's bold name).
const IDS = {
  'IQVIA CTFS GrantPlan': 'iqvia',
  'Medidata Grants Manager': 'medidata',
  'Suvoda (Greenphire) Budgeting & Benchmarking': 'suvoda',
  'Evinova Study Designer – Cost': 'evinova',
  Faro: 'faro',
  'Veeva Payments': 'veeva-payments',
  'Ledger Run ClinRun': 'ledger-run',
  'UpSite Clinical TrialPro': 'upsite',
  'Advarra OnCore CTMS': 'oncore',
  'Veeva SiteVault CTMS': 'sitevault',
  'WCG eResearch (Velos) CTMS': 'velos',
  'Other site CTMSs: Advarra Clinical Conductor, CRIO Site CTMS, RealTime-CTMS': 'other-ctms',
  'Advarra Strategic Enablement Services': 'advarra-services',
  'WCG site services': 'wcg-services',
  'Huron managed services': 'huron',
  'Citeline Sitetrove': 'citeline',
  'Dataiku Clinical Site Intelligence': 'dataiku',
  TriNetX: 'trinetx',
  Concord: 'concord',
}

// ---------------------------------------------------------------- capabilities
const capabilities = between('**Capabilities (columns)**', '**Cell values.**')
  .map((l) => l.match(/^(\d+)\. (.+)$/))
  .filter(Boolean)
  .map((m) => ({ n: Number(m[1]), label: m[2] }))
if (capabilities.length !== 13) fail(`expected 13 capabilities, got ${capabilities.length}`)

// ---------------------------------------------------------------- matrix
const rows = []
for (const l of between('| Product (main users)', 'In the Concord row')) {
  if (!l.startsWith('| **')) continue
  const cells = l.split('|').slice(1, -1).map((c) => c.trim())
  const head = cells[0]
  const m = head.match(/^\*\*(.+?)\*\*\s*(.*?)\s*\(([^()]*)\)$/)
  if (!m) fail(`row head ${head}`)
  const [, name, extra, users] = m
  const id = IDS[name] ?? fail(`no id for ${name}`)
  const marks = cells.slice(1).map((c) => {
    if (c === '–') return { mark: 'none' }
    if (c === '**no**') return { mark: 'no' }
    const k = c.match(/^(yes|partial)(?:, ([^[]+?))? \[([A-Z]+\d+)\]$/)
    if (!k) fail(`cell "${c}" in ${name}`)
    return k[2] ? { mark: k[1], qualifier: k[2], key: k[3] } : { mark: k[1], key: k[3] }
  })
  if (marks.length !== capabilities.length) fail(`${name}: ${marks.length} cells`)
  const colon = name.indexOf(': ')
  const members = colon > 0 ? name.slice(colon + 2).split(', ') : [name]
  rows.push({ id, name, extra, users, members, cells: marks })
}

// ---------------------------------------------------------------- evidence
const keyRow = new Map()
for (const r of rows) for (const c of r.cells) if (c.key) keyRow.set(c.key, r.id)

const URL_END = /\s*(https:\/\/\S+)$/
const evidence = []
let group = { name: '', url: null, note: '' }
let cur = null
for (const raw of between('### Cell evidence', '### Who uses')) {
  if (!raw.trim()) continue
  const g = raw.match(/^\*\*(.+?)\*\*\s*(?:\((.*)\))?$/)
  if (g) {
    group = { name: g[1], url: null, note: g[2] ?? '' }
    cur = null
    continue
  }
  const cite = raw.match(/^All \w+ keys cite (https:\/\/\S+)$/)
  if (cite) {
    group.url = cite[1]
    continue
  }
  const k = raw.match(/^- \*\*([A-Z]+\d+)\.\*\*\s*(.*)$/)
  let text
  if (k) {
    cur = { key: k[1], product: keyRow.get(k[1]) ?? fail(`evidence ${k[1]} has no cell`), groupUrl: group.url, groupNote: group.note, paras: [] }
    evidence.push(cur)
    text = k[2]
  } else if (cur && /^ {2,}/.test(raw)) {
    text = raw.trim().replace(/^- /, '')
  } else fail(`unparsed evidence line: ${raw}`)
  if (!text) continue
  const u = text.match(URL_END)
  cur.paras.push(u ? { text: text.slice(0, u.index).trim(), url: u[1] } : { text })
}
for (const key of keyRow.keys()) if (!evidence.some((e) => e.key === key)) fail(`no evidence for ${key}`)

// Trailing "see the link above" references, resolved to the URL they name. Their text is dropped from the paragraph
// (the card shows the link instead); everything before them stays verbatim.
const urlOf = (key, i = 0) => evidence.find((e) => e.key === key).paras.filter((p) => p.url)[i].url
const FACT_SHEET = urlOf('G2', 1)
const QA = urlOf('G2', 0)
const TRAILING_REFS = {
  'Fact sheet (link above).': FACT_SHEET,
  'Q&A (link above).': QA,
  'Product page (G1).': urlOf('G1'),
  'Grants Manager page (M1).': urlOf('M1'),
  'Same page as M4.': urlOf('M4'),
  'PDF (E1).': urlOf('E1'),
  'SV2 brief.': urlOf('SV2'),
  'W1 page.': urlOf('W1'),
  'H1 managed-services page.': urlOf('H1', 1),
  'U5 page.': urlOf('U5'),
}
// References in the middle of a sentence stay in the text; their URL is added to the card's links.
const INLINE_REFS = [
  ['The fact sheet adds', FACT_SHEET],
  ['(PDF above)', urlOf('E1')],
  ['(F1 page)', urlOf('F1')],
  ['(VE2 page)', urlOf('VE2')],
  ['product sheet (V1)', urlOf('V1')],
]
const out = evidence.map((e) => {
  const links = []
  const add = (u) => u && !links.includes(u) && links.push(u)
  const paras = e.paras.map((p) => {
    let text = p.text
    for (const [ref, url] of Object.entries(TRAILING_REFS))
      if (text.endsWith(ref)) {
        text = text.slice(0, -ref.length).trim()
        add(url)
      }
    for (const [ref, url] of INLINE_REFS) if (text.includes(ref)) add(url)
    add(p.url)
    return text
  })
  if (!links.length) add(e.groupUrl)
  const o = { key: e.key, product: e.product, paras: paras.filter(Boolean), links }
  if (e.groupNote) o.groupNote = e.groupNote
  return o
})
for (const e of out) {
  if (e.product !== 'concord' && !e.links.length) fail(`${e.key}: no link`)
  for (const p of e.paras) if (/https?:\/\//.test(p)) fail(`${e.key}: URL left in text: ${p}`)
}

// ---------------------------------------------------------------- column totals, notes
const columnTotals = between('| Column | Products stating it publicly |', '**Public baseline')
  .map((l) => l.match(/^\| (\d+) \(([^)]+)\) \| (.+) \|$/))
  .filter(Boolean)
  .map((m) => ({ n: Number(m[1]), label: m[2], text: m[3] }))
const para = (lead) => {
  const l = lines.find((x) => x.startsWith(`**${lead}**`)) ?? fail(`no paragraph ${lead}`)
  return l.slice(lead.length + 4).trim()
}
const sentence = (start) => lines.find((x) => x.startsWith(start)) ?? fail(`no line ${start}`)
const baselineRaw = para('Public baseline for column 4 (not a trial product).')
const baselineUrl = baselineRaw.match(/https:\/\/\S+?(?=\))/)[0]
const notes = {
  prepared: sentence('Prepared '),
  howChecked: para('How this was checked.'),
  completeness: para('Completeness pass (17 Oct).'),
  rule: para('Rule used throughout.'),
  cellValues: para('Cell values.'),
  concordNo: sentence('In the Concord row'),
  columnTotalsHead: sentence('**Column totals among').replace(/\*\*/g, ''),
  baseline: { text: baselineRaw.replace(`, ${baselineUrl}`, ''), url: baselineUrl },
  gap: para('The gap.'),
}

// ---------------------------------------------------------------- section 3 lists
function tree(block) {
  const items = []
  const stack = [{ depth: -1, subs: items }]
  for (const l of block) {
    const m = l.match(/^( *)- (.*)$/)
    if (!m) continue
    const depth = m[1].length / 2
    const b = m[2].match(/^\*\*(.+?)\*\*\s*(.*)$/)
    const node = b ? { lead: b[1], text: b[2], subs: [] } : { text: m[2], subs: [] }
    while (stack.at(-1).depth >= depth) stack.pop()
    stack.at(-1).subs.push(node)
    stack.push({ depth, subs: node.subs })
  }
  const strip = (n) => {
    if (n.subs.length) return n
    const o = { ...n }
    delete o.subs
    return o
  }
  const clean = (ns) => ns.map((n) => strip({ ...n, subs: clean(n.subs) }))
  return clean(items)
}
const differentiators = tree(between('**Concord does; the 20 others do not state publicly:**', '**Not unique; do not claim these:**'))
const notUnique = tree(between('**Not unique; do not claim these:**', 'The defensible combination'))
const defensible = sentence('The defensible combination')
const theyDo = tree(between('**They do; Concord does not:**', '---'))

// ---------------------------------------------------------------- pain evidence
const pain = []
let lastUrl = null
for (const l of between('| Finding | Number | Year | Source |', '**Dropped as unverified:**')) {
  if (!l.startsWith('| ') || l.startsWith('|---')) continue
  const [finding, number, year, source] = l.split(' | ').map((c) => c.replace(/^\| ?| ?\|$/g, '').trim())
  const u = source.match(URL_END)
  const url = u ? u[1] : /^Same /.test(source) ? lastUrl : null
  if (!url) fail(`pain row without source URL: ${finding}`)
  lastUrl = url
  pain.push({ finding, number, year, source: u ? source.slice(0, u.index).trim() : source, url })
}
const dropped = tree(between('**Dropped as unverified:**', '---')).map((n) => n.text)

// ---------------------------------------------------------------- sources
const sources = []
let top = null
let sub = null
{
  const start = lines.findIndex((l) => l.startsWith('## 6. Sources'))
  for (const l of lines.slice(start + 1)) {
    if (!l.trim() || l.startsWith('---')) continue
    const t = l.match(/^\*\*(.+)\*\*$/)
    if (t) {
      top = { title: t[1], groups: [] }
      sources.push(top)
      sub = null
      continue
    }
    const item = l.match(/^- (?:(https:\/\/\S+)|`([^`]+)`)(?: \((.+)\))?$/)
    if (item) {
      if (!sub) {
        sub = { title: '', items: [] }
        top.groups.push(sub)
      }
      sub.items.push(item[1] ? { url: item[1], ...(item[3] ? { note: item[3] } : {}) } : { path: item[2] })
      continue
    }
    sub = { title: l.trim(), items: [] }
    top.groups.push(sub)
  }
}

// ---------------------------------------------------------------- write
const J = (x) => JSON.stringify(x, null, 2)
const block = `// BEGIN GENERATED by scripts/gen-competitor-data.mjs from docs/competitive-landscape.md. Do not edit by hand.
export const DOC_NOTES = ${J(notes)} as const

export const CAPABILITIES_DOC: readonly { n: number; label: string }[] = ${J(capabilities)}

export const ROWS: readonly Row[] = ${J(rows)}

export const EVIDENCE: readonly Evidence[] = ${J(out)}

export const COLUMN_TOTALS_DOC: readonly { n: number; label: string; text: string }[] = ${J(columnTotals)}

export const DIFFERENTIATORS: readonly ListItem[] = ${J(differentiators)}

export const NOT_UNIQUE: readonly ListItem[] = ${J(notUnique)}

export const DEFENSIBLE = ${J(defensible)}

export const THEY_DO: readonly ListItem[] = ${J(theyDo)}

export const PAIN: readonly PainRow[] = ${J(pain)}

export const DROPPED: readonly string[] = ${J(dropped)}

export const SOURCES: readonly SourceSection[] = ${J(sources)}
// END GENERATED`

const prev = readFileSync(OUT, 'utf8')
const a = prev.indexOf('// BEGIN GENERATED')
const b = prev.indexOf('// END GENERATED')
if (a < 0 || b < 0) fail('markers missing in src/competitorData.ts')
writeFileSync(OUT, prev.slice(0, a) + block + prev.slice(b + '// END GENERATED'.length))
console.log(`competitorData.ts: ${rows.length} rows, ${capabilities.length} capabilities, ${out.length} evidence keys, ${pain.length} pain rows`)
