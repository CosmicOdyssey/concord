// How Concord compares (competitorData.ts) against its source of truth, docs/competitive-landscape.md. The matrix is
// re-read from the document here, independently of scripts/gen-competitor-data.mjs, so a hand edit to the data module
// or a change to the document without regenerating fails.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CAPABILITIES,
  CHECKED,
  COLUMN_TOTALS_DOC,
  COMPETITOR_ROWS,
  CONCORD_ROW,
  DIFFERENTIATORS,
  DOC_NOTES,
  EVIDENCE,
  EVIDENCE_BY_KEY,
  NOT_UNIQUE,
  PAIN,
  PRODUCT_COUNT,
  ROWS,
  ROW_BY_ID,
  SIMPLE_COLUMNS,
  SIMPLE_PAIN,
  SIMPLE_PRODUCTS,
  SIMPLE_THEY_DO,
  SOURCES,
  THEY_DO,
  columnCount,
  evidenceLinks,
  quotesOf,
} from '../src/competitorData.ts'

const doc = readFileSync(new URL('../../docs/competitive-landscape.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const view = readFileSync(new URL('../src/views/LandingCompare.tsx', import.meta.url), 'utf8')

/** The document's matrix: [name, users, cells as "yes [G1]" / "–" / "**no**"]. */
const docRows = doc
  .split('\n')
  .filter((l) => /^\| \*\*/.test(l) && l.split('|').length === 16)
  .map((l) => {
    const c = l.split('|').slice(1, -1).map((x) => x.trim())
    const m = c[0].match(/^\*\*(.+?)\*\*.*\(([^()]*)\)$/)
    return { name: m[1], users: m[2], cells: c.slice(1) }
  })

const cellText = (c) => {
  if (c.mark === 'none') return '–'
  if (c.mark === 'no') return '**no**'
  return `${c.mark}${c.qualifier ? `, ${c.qualifier}` : ''} [${c.key}]`
}

const markedCells = (rows) => rows.flatMap((r) => r.cells.filter((c) => c.mark === 'yes' || c.mark === 'partial').map((c) => ({ row: r, cell: c })))

/** Our own wording about a competitor, with the vendors' verbatim quotes ("...") taken out. */
const ownWords = (s) => s.replace(/"[^"]*"/g, '""')

test('product and capability counts match the document', () => {
  const caps = doc.match(/\*\*Capabilities \(columns\)\*\*\n\n((?:\d+\. .+\n)+)/)[1].trim().split('\n')
  assert.equal(caps.length, 13)
  assert.equal(CAPABILITIES.length, 13)
  assert.deepEqual(
    CAPABILITIES.map((c) => c.label),
    caps.map((l) => l.replace(/^\d+\. /, '')),
  )
  // "Column totals among the 20 other products (18 rows; the "Other site CTMSs" row covers three products)"
  const t = doc.match(/Column totals among the (\d+) other products\*\* \((\d+) rows;/)
  assert.equal(PRODUCT_COUNT, Number(t[1]))
  assert.equal(PRODUCT_COUNT, 20)
  assert.equal(COMPETITOR_ROWS.length, Number(t[2]))
  assert.equal(docRows.length, ROWS.length)
  assert.equal(ROWS.length, 19)
})

test('every row and cell matches the document matrix', () => {
  for (const [i, d] of docRows.entries()) {
    const r = ROWS[i]
    assert.equal(r.name, d.name)
    assert.equal(r.users, d.users)
    assert.deepEqual(r.cells.map(cellText), d.cells, r.name)
  }
})

test('the Concord row matches the document, including no for site payments and CTA redlining and lung only for overlap', () => {
  const d = docRows.find((x) => x.name === 'Concord')
  assert.deepEqual(CONCORD_ROW.cells.map(cellText), d.cells)
  assert.deepEqual(d.cells, [
    'partial [K1]',
    'partial [K2]',
    'yes, draft [K3]',
    'yes [K4]',
    'yes [K5]',
    'yes [K6]',
    'yes [K7]',
    'yes, lung only [K8]',
    'partial [K9]',
    '**no**',
    '**no**',
    'yes [K10]',
    'partial [K11]',
  ])
  assert.equal(CONCORD_ROW.cells[9].mark, 'no')
  assert.equal(CONCORD_ROW.cells[10].mark, 'no')
  assert.equal(CONCORD_ROW.cells[7].qualifier, 'lung only')
  // "no" is Concord's own mark only; competitors are "–" (not stated publicly), never "no".
  for (const r of COMPETITOR_ROWS) assert.ok(!r.cells.some((c) => c.mark === 'no'), r.name)
})

test('every yes/partial cell has evidence with an https URL and a non-empty quote', () => {
  const cells = markedCells(ROWS)
  assert.ok(cells.length > 60)
  for (const { row, cell } of cells) {
    const e = EVIDENCE_BY_KEY.get(cell.key)
    assert.ok(e, `${row.name}: no evidence for ${cell.key}`)
    assert.equal(e.product, row.id, cell.key)
    const links = evidenceLinks(e)
    assert.ok(links.length > 0 && links.every((u) => /^https:\/\/\S+$/.test(u)), `${cell.key}: ${links}`)
    if (row.id === 'concord') {
      // Concord's own keys state what this repository does; they link to the document on GitHub.
      assert.ok(e.paras.join(' ').trim().length > 20, cell.key)
    } else {
      const q = quotesOf(e)
      assert.ok(q.length > 0 && q.every((x) => x.length > 2), `${cell.key}: no vendor quote`)
    }
  }
})

test('evidence text, quotes and URLs are verbatim from the document', () => {
  for (const e of EVIDENCE) {
    for (const p of e.paras) assert.ok(doc.includes(p), `${e.key}: not verbatim: ${p}`)
    for (const q of quotesOf(e)) assert.ok(doc.includes(q), `${e.key}: quote not in the document: ${q}`)
    for (const u of e.links) assert.ok(doc.includes(u), `${e.key}: URL not in the document: ${u}`)
  }
  for (const p of PAIN) {
    assert.ok(doc.includes(p.finding) && doc.includes(p.number), p.finding)
    assert.ok(/^https:\/\//.test(p.url) && doc.includes(p.url), p.url)
  }
  for (const s of SIMPLE_PAIN) {
    assert.ok(doc.includes(s.text.replace(/’/g, "'")), s.text)
    const row = PAIN.find(s.row)
    assert.ok(row && row.number.includes(s.number), s.number)
  }
  for (const s of SOURCES) for (const g of s.groups) for (const it of g.items) if (it.url) assert.ok(doc.includes(it.url), it.url)
  for (const items of [DIFFERENTIATORS, NOT_UNIQUE, THEY_DO]) {
    const walk = (xs) => {
      for (const x of xs) {
        assert.ok(doc.includes(x.text), x.text)
        if (x.lead) assert.ok(doc.includes(`**${x.lead}**`), x.lead)
        if (x.subs) walk(x.subs)
      }
    }
    walk(items)
  }
  assert.equal(DIFFERENTIATORS.length, 5)
  assert.equal(NOT_UNIQUE.length, 4)
  for (const lead of SIMPLE_THEY_DO) assert.ok(THEY_DO.some((x) => x.lead === lead), lead)
})

test("no competitor text says 'cannot' or 'does not have'", () => {
  const bad = /\bcannot\b|does not have|doesn['’]t have|can['’]t/i
  for (const r of COMPETITOR_ROWS) assert.ok(!bad.test(`${r.name} ${r.extra} ${r.users}`), r.name)
  for (const e of EVIDENCE.filter((x) => x.product !== 'concord'))
    for (const p of [...e.paras, e.groupNote ?? '']) assert.ok(!bad.test(ownWords(p)), `${e.key}: ${p}`)
  // The section's own copy (vendor quotes are only ever rendered from the data module).
  assert.ok(!bad.test(view.replace(/\/\/.*$/gm, '')), 'LandingCompare.tsx')
  // The legend keeps the document's rule.
  assert.match(view, /not stated publicly, not that the product lacks it/)
  assert.match(DOC_NOTES.rule, /It does not mean the product lacks the capability\./)
})

test('the column totals computed from the matrix match the document', () => {
  const want = {
    4: { yes: 0, partial: 0 },
    6: { yes: 0, partial: 0 },
    7: { yes: 0, partial: 5 },
    8: { yes: 0, partial: 3 },
  }
  assert.deepEqual(
    COLUMN_TOTALS_DOC.map((c) => c.n),
    [4, 6, 7, 8],
  )
  for (const [n, w] of Object.entries(want)) assert.deepEqual(columnCount(Number(n)), w, `column ${n}`)
})

test('Simple shows the 8 representative products and 6 columns; date and completeness note', () => {
  assert.deepEqual(
    SIMPLE_PRODUCTS.map((id) => ROW_BY_ID.get(id)?.name),
    [
      'IQVIA CTFS GrantPlan',
      'Medidata Grants Manager',
      'Suvoda (Greenphire) Budgeting & Benchmarking',
      'UpSite Clinical TrialPro',
      'Advarra OnCore CTMS',
      'Veeva SiteVault CTMS',
      'WCG site services',
      'Evinova Study Designer – Cost',
    ],
  )
  assert.deepEqual([...SIMPLE_COLUMNS], [1, 2, 3, 4, 6, 7])
  assert.equal(CHECKED, '17 Oct 2026')
  assert.match(doc, /Prepared 17 Oct 2026/)
  assert.match(DOC_NOTES.completeness, /Epic's research billing, Oracle's CTMS and site payments, Lokavant and Phesi/)
})
