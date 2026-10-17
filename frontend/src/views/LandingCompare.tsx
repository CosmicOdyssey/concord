// Landing section "How Concord compares" (#home/compare), above What we tested. Every claim comes from
// docs/competitive-landscape.md through competitorData.ts. Simple: 8 representative products and 6 columns, the
// differentiators, what they have that we don't, three pain numbers. Detailed: the full matrix (18 rows covering 20
// products, 13 capabilities), every list of the document's section 3, all verified pain numbers, the method and
// completeness notes and the sources. Each Yes / Partial mark opens a card with the document's quote and its source.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDensity } from '../density'
import { HoverCard, InfoTip } from '../hovercard'
import {
  CAPABILITIES,
  CHECKED,
  COLUMN_TOTALS_DOC,
  COMPETITOR_ROWS,
  CONCORD_ROW,
  DEFENSIBLE,
  DIFFERENTIATORS,
  DOC_NOTES,
  DROPPED,
  EVIDENCE,
  EVIDENCE_BY_KEY,
  NOT_UNIQUE,
  PAIN,
  PRODUCT_COUNT,
  ROW_BY_ID,
  SHORT_NAME,
  SIMPLE_CAVEAT,
  SIMPLE_COLUMNS,
  SIMPLE_PAIN,
  SIMPLE_PRODUCTS,
  SIMPLE_THEY_DO,
  SOURCES,
  THEY_DO,
  columnCount,
  evidenceLinks,
  linkLabel,
  markWord,
  type Cell,
  type ListItem,
  type Row,
} from '../competitorData'
import './landingCompare.css'

/** The document's inline markdown: `code` and **bold**. */
function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((s, i) => {
    if (s.startsWith('`') && s.endsWith('`') && s.length > 1) return <code key={i}>{s.slice(1, -1)}</code>
    if (s.startsWith('**') && s.endsWith('**') && s.length > 3) return <strong key={i}>{s.slice(2, -2)}</strong>
    return <Fragment key={i}>{s}</Fragment>
  })
}

function Src({ url, children }: { url: string; children?: ReactNode }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="cmp-link">
      {children ?? linkLabel(url)}
    </a>
  )
}

const capOf = (n: number) => CAPABILITIES[n - 1]

/** The card behind a Yes / Partial mark: the document's text for that key (vendor quotes in quotation marks) and its
 *  source links. */
function EvidenceCard({ row, n, cell }: { row: Row; n: number; cell: Cell }) {
  const e = EVIDENCE_BY_KEY.get(cell.key!)!
  const concord = row.id === 'concord'
  return (
    <span className="cmp-card">
      <span className="hc-title">
        {row.name} · {capOf(n).label}
      </span>
      <span className="cmp-card-mark">
        {markWord(cell)} · evidence {e.key}
      </span>
      {e.paras.map((p, i) => (
        <span key={i} className="cmp-card-p">
          {inline(p)}
        </span>
      ))}
      <span className="hc-src">
        {concord ? 'Source: this repository, as documented in ' : `Source${evidenceLinks(e).length > 1 ? 's' : ''}, checked ${CHECKED}: `}
        {evidenceLinks(e).map((u, i) => (
          <Fragment key={u}>
            {i > 0 && ' · '}
            <Src url={u}>{concord ? 'docs/competitive-landscape.md' : undefined}</Src>
          </Fragment>
        ))}
      </span>
    </span>
  )
}

function Mark({ row, n, detailed }: { row: Row; n: number; detailed: boolean }) {
  const cell = row.cells[n - 1]
  const name = SHORT_NAME[row.id] ?? row.name
  if (cell.mark === 'none')
    return (
      <span className="cmp-mark cmp-none">
        <span aria-hidden="true">–</span>
        <span className="sr-only">Not stated publicly</span>
      </span>
    )
  if (cell.mark === 'no')
    return (
      <span className="cmp-mark cmp-no">
        No<span className="sr-only">: not built</span>
      </span>
    )
  const word = cell.mark === 'yes' ? (cell.qualifier ? `Yes, ${cell.qualifier}` : 'Yes') : 'Partial'
  return (
    <HoverCard
      className={`cmp-mark cmp-btn cmp-${cell.mark}`}
      label={`${word}: ${name}, ${capOf(n).short}. Evidence ${cell.key}`}
      content={<EvidenceCard row={row} n={n} cell={cell} />}
    >
      <span className="cmp-face">
        <span className="cmp-dot" aria-hidden="true" />
        <span className="cmp-word">{word}</span>
      </span>
      {detailed && <span className="cmp-key">{cell.key}</span>}
    </HoverCard>
  )
}

/** True while the box's content is wider than the box (it scrolls sideways). ResizeObserver reports once on observe,
 *  then on every size change of the box or of the table inside it (density switch, window resize). */
function useOverflowX<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [over, setOver] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setOver(el.scrollWidth > el.clientWidth + 1))
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [])
  return [ref, over] as const
}

function Matrix({ rows, cols, detailed }: { rows: readonly Row[]; cols: readonly number[]; detailed: boolean }) {
  const [box, over] = useOverflowX<HTMLDivElement>()
  return (
    <>
      <div className="table-scroll cmp-scroll" ref={box}>
        <table className={`cmp-tbl${detailed ? ' cmp-tbl-full' : ''}`}>
          <caption className="sr-only">
            What {detailed ? `${PRODUCT_COUNT} products` : `${rows.length - 1} of ${PRODUCT_COUNT} products`} state publicly, next to Concord, for{' '}
            {cols.length} capabilities. Each Yes or Partial opens the quote and its source; a dash means not stated publicly.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="cmp-corner">
                Product <span className="cmp-users">(main users)</span>
              </th>
              {cols.map((n) => (
                <th scope="col" key={n} className="cmp-colh" title={capOf(n).label}>
                  {detailed && <span className="cmp-coln">{n}</span>}
                  {capOf(n).short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.id === 'concord' ? 'cmp-us' : undefined}>
                <th scope="row" className="cmp-rowh">
                  <span className="cmp-name">{detailed ? r.name : (SHORT_NAME[r.id] ?? r.name)}</span>
                  {detailed && r.extra && <span className="cmp-extra"> {r.extra}</span>}
                  <span className="cmp-users">{r.users}</span>
                </th>
                {cols.map((n) => (
                  <td key={n}>
                    <Mark row={r} n={n} detailed={detailed} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {over && <p className="cmp-scroll-hint">Scroll the table sideways for every column.</p>}
    </>
  )
}

function Legend({ detailed, cols }: { detailed: boolean; cols: readonly number[] }) {
  return (
    <div className="cmp-legend">
      <span className="cmp-legend-item">
        <span className="cmp-dot cmp-dot-yes" aria-hidden="true" /> Yes
      </span>
      <span className="cmp-legend-item">
        <span className="cmp-dot cmp-dot-partial" aria-hidden="true" /> Partial
      </span>
      <span className="cmp-legend-item">
        <span aria-hidden="true" className="strong">
          –
        </span>{' '}
        not stated publicly, not that the product lacks it
      </span>
      <span className="cmp-legend-item">
        <span className="strong">No</span> in Concord’s row: we have not built it
      </span>
      <span className="cmp-legend-note">
        Each Yes or Partial opens the vendor’s own words and the page they come from{detailed ? '; the small code is the document’s evidence key' : ''}.
        Vendor numbers are the vendor’s own claims.
      </span>
      {detailed ? (
        <ol className="cmp-caps">
          {CAPABILITIES.map((c) => (
            <li key={c.n}>{c.label}</li>
          ))}
        </ol>
      ) : (
        // Simple's heads are short labels; the document's full names, in column order, so keyboard and touch readers
        // get them too (the heads' title tooltip is mouse only).
        <>
          <p className="cmp-caps-h">The columns in full, left to right:</p>
          <ol className="cmp-caps">
            {cols.map((n) => (
              <li key={n}>{capOf(n).label}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

function Items({ items, depth = 0 }: { items: readonly ListItem[]; depth?: number }) {
  return (
    <ul className={depth ? 'cmp-sub' : 'cmp-list'}>
      {items.map((it, i) => (
        <li key={i}>
          {it.lead && <span className="strong">{inline(it.lead)}</span>} {inline(it.text)}
          {it.subs && <Items items={it.subs} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}

const noColumn = (s: string) => s.replace(/ \(column \d+\)\.$/, '.')
/** Simple shows no evidence keys, so its differentiator text drops the document's "(K5)"-style references. */
const noKey = (s: string) => s.replace(/\s*\([A-Z]+\d+\)/g, '')

/** Simple: each "Concord does" lead, its one visible limit, and the rest in a hover card. */
function Differentiators({ detailed }: { detailed: boolean }) {
  return (
    <div className="cmp-block">
      <h3 className="cmp-h3">Concord does; the {PRODUCT_COUNT} others do not state publicly</h3>
      {detailed ? (
        <Items items={DIFFERENTIATORS} />
      ) : (
        <ul className="cmp-list">
          {DIFFERENTIATORS.map((it, i) => {
            const re = SIMPLE_CAVEAT[i]
            const caveat = re ? it.subs?.find((s) => re.test(s.text)) : undefined
            return (
              <li key={i}>
                <span className="strong">{inline(noColumn(it.lead ?? ''))}</span>{' '}
                {it.subs?.length ? (
                  <InfoTip
                    label={`More on: ${noColumn(it.lead ?? '')}`}
                    content={
                      <span className="cmp-card">
                        <span className="hc-title">{noColumn(it.lead ?? '')}</span>
                        {it.text && <span className="cmp-card-p">{inline(it.text)}</span>}
                        {it.subs.map((s, j) => (
                          <span key={j} className="cmp-card-p">
                            {inline(noKey(s.text))}
                          </span>
                        ))}
                        <span className="hc-src">From the competitor landscape, checked {CHECKED}.</span>
                      </span>
                    }
                  />
                ) : null}
                {caveat && <span className="cmp-caveat">{inline(noKey(caveat.text))}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function TheyDo({ detailed }: { detailed: boolean }) {
  if (detailed)
    return (
      <div className="cmp-block">
        <h3 className="cmp-h3">They do; Concord does not</h3>
        <Items items={THEY_DO} />
      </div>
    )
  const items = SIMPLE_THEY_DO.map((lead) => THEY_DO.find((x) => x.lead === lead)!).filter(Boolean)
  const words = items.map((x, i) => {
    const w = x.lead!.replace(/\.$/, '')
    // Lower-case the first letter of an ordinary word only ("Site payments" -> "site payments"; "SoA", "CTA" stay).
    return i === 0 || /^[A-Z][A-Z]/.test(w) || /^[A-Z][a-z]*[A-Z]/.test(w.split(' ')[0]) ? w : w.charAt(0).toLowerCase() + w.slice(1)
  })
  return (
    <div className="cmp-block">
      <h3 className="cmp-h3">What they have that we don't</h3>
      <p className="cmp-p">
        {words.slice(0, -1).join(', ')} and {words.at(-1)}.{' '}
        <InfoTip
          label="Who states each of these"
          content={
            <span className="cmp-card">
              <span className="hc-title">They do; Concord does not</span>
              {items.map((x) => (
                <span key={x.lead} className="cmp-card-p">
                  <span className="strong">{x.lead}</span> {x.text}
                  {x.subs?.map((s) => ` ${s.text}`).join('')}
                </span>
              ))}
            </span>
          }
        />
      </p>
    </div>
  )
}

function PainSimple() {
  return (
    <div className="cmp-pain">
      {SIMPLE_PAIN.map((p) => {
        const row = PAIN.find(p.row)!
        return (
          <div key={p.number} className="cmp-pain-item">
            <p className="cmp-pain-n num">{p.number}</p>
            <p className="cmp-pain-t">{p.text}.</p>
            <p className="cmp-pain-src">
              <Src url={row.url}>{`${row.source.replace(/\.$/, '')}, ${row.year}`}</Src>{' '}
              <InfoTip label={`About the ${p.number} figure`} content={`${row.finding} (${row.year}; ${row.source.replace(/\.$/, '')})`} />
            </p>
          </div>
        )
      })}
    </div>
  )
}

function PainDetailed() {
  return (
    <div className="cmp-block">
      <h3 className="cmp-h3">Evidence of the pain (verified numbers only)</h3>
      <div className="table-scroll">
        <table className="lp-tbl cmp-pain-tbl">
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Finding</th>
              <th scope="col">Year</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {PAIN.map((p) => (
              <tr key={p.finding}>
                <td className="num strong cmp-pain-num">{p.number}</td>
                <td>{inline(p.finding)}</td>
                <td className="cmp-nowrap">{p.year}</td>
                <td>
                  <Src url={p.url}>{p.source ? p.source.replace(/\.$/, '') : linkLabel(p.url)}</Src>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cmp-note">
        <span className="strong">Dropped as unverified:</span> {DROPPED.join(' · ')}
      </p>
    </div>
  )
}

function Method() {
  const counted = COLUMN_TOTALS_DOC.map((c) => ({ ...c, got: columnCount(c.n) }))
  return (
    <div className="cmp-block">
      <h3 className="cmp-h3">Method and completeness</h3>
      <p className="cmp-p">
        <span className="strong">How this was checked.</span> {DOC_NOTES.howChecked}
      </p>
      <p className="cmp-p">
        <span className="strong">Completeness pass ({CHECKED}).</span> {DOC_NOTES.completeness}
      </p>
      <p className="cmp-p">
        <span className="strong">Rule used throughout.</span> {DOC_NOTES.rule} {DOC_NOTES.concordNo}
      </p>
      <p className="cmp-p">
        <span className="strong">Public baseline for column 4 (not a trial product).</span> {DOC_NOTES.baseline.text} <Src url={DOC_NOTES.baseline.url} />
      </p>
      <p className="cmp-p strong">{DOC_NOTES.columnTotalsHead}</p>
      <div className="table-scroll">
        <table className="lp-tbl cmp-totals">
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Products stating it publicly</th>
              <th scope="col">Counted in the matrix above</th>
            </tr>
          </thead>
          <tbody>
            {counted.map((c) => (
              <tr key={c.n}>
                <th scope="row">
                  {c.n} ({c.label})
                </th>
                <td>{c.text}</td>
                <td className="num cmp-nowrap">
                  {c.got.yes} yes · {c.got.partial} partial
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Sources() {
  const n = SOURCES.reduce((a, s) => a + s.groups.reduce((b, g) => b + g.items.length, 0), 0)
  return (
    <details className="cmp-details">
      <summary>Sources ({n})</summary>
      {SOURCES.map((s) => (
        <div key={s.title} className="cmp-src-sec">
          <p className="cmp-src-h">{s.title}</p>
          {s.groups.map((g, i) => (
            <div key={i} className="cmp-src-group">
              {g.title && <p className="cmp-src-g">{g.title}</p>}
              <ul>
                {g.items.map((it, j) => (
                  <li key={j}>
                    {it.url ? <Src url={it.url}>{it.url}</Src> : <code>{it.path}</code>}
                    {it.note && <span className="cmp-muted"> ({it.note})</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </details>
  )
}

function EvidenceList() {
  return (
    <details className="cmp-details">
      <summary>All {EVIDENCE.length} evidence keys</summary>
      {[...COMPETITOR_ROWS, CONCORD_ROW].map((r) => {
        const keys = EVIDENCE.filter((e) => e.product === r.id)
        if (!keys.length) return null
        return (
          <div key={r.id} className="cmp-src-sec">
            <p className="cmp-src-h">{r.name}</p>
            {keys[0].groupNote && <p className="cmp-muted cmp-small">{inline(keys[0].groupNote)}</p>}
            <ul className="cmp-ev">
              {keys.map((e) => (
                <li key={e.key}>
                  <span className="strong">{e.key}.</span>{' '}
                  {e.paras.map((p, i) => (
                    <Fragment key={i}>{i > 0 ? ' ' : ''}{inline(p)}</Fragment>
                  ))}{' '}
                  {evidenceLinks(e).map((u) => (
                    <Fragment key={u}>
                      {' '}
                      <Src url={u} />
                    </Fragment>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </details>
  )
}

export default function LandingCompare() {
  const detailed = useDensity().density === 'detailed'
  const simpleRows = [CONCORD_ROW, ...SIMPLE_PRODUCTS.map((id) => ROW_BY_ID.get(id)!)]
  const rows = detailed ? [CONCORD_ROW, ...COMPETITOR_ROWS] : simpleRows
  const cols = detailed ? CAPABILITIES.map((c) => c.n) : SIMPLE_COLUMNS
  return (
    <section id="landing-compare" className="lp-section" aria-labelledby="lp-h-compare">
      <div className="lp-wrap">
        <div className="lp-intro">
          <p className="lp-eyebrow">How we compare · checked {CHECKED}</p>
          <h2 id="lp-h-compare">How Concord compares</h2>
          <p className="lp-body">
            As the vendors’ own pages describe it, trial budgets are mostly settled today with proprietary data and human services: sponsors benchmark
            against subscription databases built from blinded, negotiated contracts, and sites run their own Medicare coverage analysis protocol by protocol.
            Here is what{' '}
            {detailed ? `the ${PRODUCT_COUNT} products we reviewed` : `${SIMPLE_PRODUCTS.length} of the ${PRODUCT_COUNT} products we reviewed`} state
            publicly, next to Concord.
          </p>
        </div>

        <div className={`win lp-win cmp-win${detailed ? ' cmp-win-full' : ''}`}>
          <div className="win-strip">
            <span>
              <span className="win-title">What each product states publicly</span> ·{' '}
              {detailed ? `${COMPETITOR_ROWS.length} rows covering ${PRODUCT_COUNT} products` : `${SIMPLE_PRODUCTS.length} of ${PRODUCT_COUNT} products`} ·{' '}
              {cols.length} of {CAPABILITIES.length} capabilities
            </span>
            <span>Vendor pages checked {CHECKED}</span>
          </div>
          <div className="lp-win-body">
            <Matrix rows={rows} cols={cols} detailed={detailed} />
            <Legend detailed={detailed} cols={cols} />
          </div>
        </div>

        <div className="cmp-grid">
          <Differentiators detailed={detailed} />
          <div>
            <TheyDo detailed={detailed} />
            {detailed && (
              <div className="cmp-block">
                <h3 className="cmp-h3">Not unique; we do not claim these</h3>
                <Items items={NOT_UNIQUE} />
                <p className="cmp-p">{inline(DEFENSIBLE)}</p>
              </div>
            )}
          </div>
        </div>

        {detailed ? (
          <>
            <PainDetailed />
            <Method />
            <EvidenceList />
            <Sources />
          </>
        ) : (
          <>
            <h3 className="cmp-h3 cmp-pain-h">Why it matters: what sites report</h3>
            <PainSimple />
          </>
        )}
      </div>
    </section>
  )
}
