// Findings page, in the Calm layout (mockup C-Findings, copy deck B5). Every number comes from /api/findings
// (data/findings/findings.json, written by `python -m concord.findings`) or /api/findings/self-overlap
// (data/findings/self_overlap.json). Simple mode uses the copy deck's sentences for a finding only while the file
// still holds the exact values those sentences quote (findingsApi.ts: congestionModel, allocationModel, ...);
// otherwise the finding renders generically from the file. Detailed mode (and the Simple "Details" disclosure)
// shows every table, note, caveat and source.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { ErrorBox, Gloss, KeyFigure, Loading, PageHead, Qualifier, Section } from '../components'
import { useDensity } from '../density'
import { useTabSignal, whenShown } from '../tabActive'
import { GLOSSARY } from '../glossary'
import {
  allocationModel,
  congestionModel,
  findingsApi,
  implicationModel,
  isCiChart,
  overlapCaveats,
  overlapNote,
  selfOverlapModel,
  shortDate,
  sourceHref,
  sourceRows,
  typeset,
  type AllocationLane,
  type AllocationModel,
  type CiChart,
  type CiItem,
  type Finding,
  type FindingsDoc,
  type FindingSource,
  type FindingTable,
  type ImplicationModel,
  type Ratio,
  type SelfOverlap,
  type SelfOverlapModel,
} from '../findingsApi'
import './findings.css'

type Async<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; data: T }
/** The self-overlap file is optional: 'none' when the audit has not written it (404) or it failed to load. */
type Optional<T> = { status: 'loading' } | { status: 'none' } | { status: 'ok'; data: T }

// Copy deck B5 (verbatim).
const INTRO = 'What we tested on public data, and what held up. These are research results. No product view shows a predicted speedup.'
const LEAD_ID = 'self-overlap'
const LEAD_TITLE = "Some sponsors' own trials share registered sites and eligible patients"
/** On-page index labels: the copy deck's own names for the four blocks (B5.0 to B5.3). Other findings use their title. */
const SHORT_NAME: Record<string, string> = {
  [LEAD_ID]: 'Same-sponsor overlap',
  congestion: 'Congestion',
  allocation: 'Allocation',
  implication: 'Site-level data',
}
const SIMPLE_TITLE: Record<string, string> = {
  congestion: 'Competing trials barely slow each other within a site',
  allocation: 'Coordination gains largely disappear on held-out data',
  implication: 'The missing data is enrollment per site',
}

function generatedAt(iso: string | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toLocaleString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} UTC`
}

/** "a, b, c and d" */
function listJoin(xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`
}

const pct = (x: number) => `${Math.max(0, Math.min(100, x))}%`

/** Source labels for an info card's last line ("Sources: a · b"). */
function sourceLine(sources: FindingSource[] | undefined): ReactNode {
  const s = sources ?? []
  if (s.length === 0) return null
  return (
    <span className="hc-src">
      {s.length === 1 ? 'Source' : 'Sources'}: {s.map((x) => x.label).join(' · ')}
    </span>
  )
}

/* =====================================================================================================================
   Interval chart: estimate, interval band and the reference value on one scale (mockup B5.1). HTML positioned in
   percent, so it needs no measuring and fits any width.
   ===================================================================================================================== */

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return Number(((n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag).toPrecision(6))
}

/** Estimates and interval ends: two decimals, as in the headlines (0.09, 0.00 to 0.30). */
const fmt = (v: number) => typeset(v.toFixed(2))
/** The reference value and whole ticks: one decimal (1.0); zero stays 0. */
const fmtRef = (v: number) => typeset(Number.isInteger(v) ? v.toFixed(1) : v.toFixed(2))
function fmtTick(v: number, step: number): string {
  if (v === 0) return '0'
  if (Number.isInteger(v)) return fmtRef(v)
  const d = Math.min((String(step).split('.')[1] ?? '').length, 4)
  return typeset(Number(v.toFixed(d)).toString())
}

/** Where a label sits relative to the x it describes, kept inside the plot near the edges. */
function anchorAt(x: number): CSSProperties {
  if (x < 6) return { left: pct(x) }
  if (x > 94) return { right: pct(100 - x) }
  return { left: pct(x), transform: 'translateX(-50%)' }
}

interface CiLabels {
  /** The row label over each item (default: the item's own label from the file). */
  series?: (it: CiItem) => ReactNode
  /** Words after the reference value ("assumed in our original model"); default the file's reference label. */
  reference?: string
  /** The always-visible interval text under the band; default "Interval lo to hi". */
  interval?: (it: CiItem) => ReactNode
  /** A line under the scale: left and right ends. */
  foot?: [ReactNode, ReactNode]
  /** Screen-reader summary; default built from the values. */
  sr?: string
}

function CiStrip({ chart, labels = {} }: { chart: CiChart; labels?: CiLabels }) {
  const ref0 = chart.reference.value
  const items = chart.items.filter((it) => [it.lo, it.hi, it.estimate].every(Number.isFinite))
  if (items.length === 0 || !Number.isFinite(ref0)) return null
  const values = items.flatMap((it) => [it.lo, it.hi, it.estimate]).concat(ref0)
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (max - min < 1e-9) {
    min -= 0.5
    max += 0.5
  }
  const step = niceStep(max - min, 4)
  min = Math.floor(min / step + 1e-9) * step
  max = Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(10)))
  const x = (v: number) => ((v - min) / (max - min)) * 100
  const xr = x(ref0)
  const refWords = labels.reference ?? chart.reference.label
  const sr =
    labels.sr ??
    `${items.map((it) => `${it.label}: estimate ${fmt(it.estimate)}, interval ${fmt(it.lo)} to ${fmt(it.hi)}`).join('. ')}. Reference: ${fmtRef(ref0)}, ${refWords}.`

  return (
    <div className="ci">
      {items.map((it, i) => {
        const lo = x(it.lo)
        const hi = x(it.hi)
        const est = x(it.estimate)
        return (
          <div className="ci-item" key={i}>
            <p className="ci-series">{labels.series ? labels.series(it) : it.label}</p>
            <div className={`ci-plot${i === 0 ? ' ci-plot-first' : ''}`}>
              <span className="ci-ref" style={{ left: pct(xr) }} aria-hidden="true" />
              {i === 0 && (
                <span
                  className="ci-ref-label"
                  style={xr > 50 ? { left: 0, right: `calc(${pct(100 - xr)} + 0.625rem)`, textAlign: 'right' } : { left: `calc(${pct(xr)} + 0.625rem)`, right: 0 }}
                  aria-hidden="true"
                >
                  <span className="num">{fmtRef(ref0)}</span> · {refWords}
                </span>
              )}
              <span className="ci-axis" aria-hidden="true" />
              {ticks.slice(1, -1).map((t) => (
                <span key={t} className="ci-tick-mark" style={{ left: pct(x(t)) }} aria-hidden="true" />
              ))}
              <span className="ci-band" style={{ left: pct(lo), width: pct(Math.max(hi - lo, 0.5)) }} aria-hidden="true" />
              <span className="ci-dot" style={{ left: pct(est) }} aria-hidden="true" />
              <span className="ci-val num" style={anchorAt(est)} aria-hidden="true">
                {fmt(it.estimate)}
              </span>
              <span className="ci-int" style={lo < 50 ? { left: pct(lo), right: 0 } : { left: 0, right: pct(100 - hi), textAlign: 'right' }}>
                {labels.interval ? (
                  labels.interval(it)
                ) : (
                  <>
                    Interval <span className="num">{fmt(it.lo)}</span> to <span className="num">{fmt(it.hi)}</span>
                  </>
                )}
              </span>
            </div>
          </div>
        )
      })}
      <div className="ci-ticks num" aria-hidden="true">
        {ticks.map((t, i) => (
          <span key={t} style={i === 0 ? { left: 0 } : i === ticks.length - 1 ? { right: 0 } : { left: pct(x(t)), transform: 'translateX(-50%)' }}>
            {fmtTick(t, step)}
          </span>
        ))}
      </div>
      {labels.foot && (
        <div className="ci-foot">
          <span>{labels.foot[0]}</span>
          <span>{labels.foot[1]}</span>
        </div>
      )}
      <p className="sr-only">{sr}</p>
    </div>
  )
}

/* =====================================================================================================================
   Allocation dot strip (mockup B5.2): in-sample (ring), held-out (dots, two splits) and calibrated held-out
   (diamonds) on one ratio scale, coordination and site selection with equal weight.
   ===================================================================================================================== */

type Mark = { kind: 'ring' | 'dot' | 'dia'; v: number }

function Lane({ label, marks, text, range, x }: { label: ReactNode; marks: Mark[]; text: string; range?: [number, number]; x: (v: number) => number }) {
  const ps = marks.map((m) => x(m.v))
  const right = Math.max(...ps, ...(range ? [x(range[1])] : []))
  const left = Math.min(...ps)
  // Label beside the marks: to their right unless they sit near the right end.
  const place: CSSProperties = right > 62 ? { right: `calc(${pct(100 - left)} + 0.875rem)` } : { left: `calc(${pct(right)} + 0.875rem)` }
  return (
    <div className="al-lane">
      <span className="al-label">{label}</span>
      <span className="al-trk">
        <span className="al-ref" aria-hidden="true" />
        {range && (
          <span className="al-range" style={{ left: pct(x(range[0])), width: pct(x(range[1]) - x(range[0])) }} aria-hidden="true" />
        )}
        {marks.map((m, i) => (
          <span key={i} className={`al-${m.kind}`} style={{ left: pct(x(m.v)) }} aria-hidden="true" />
        ))}
        <span className="al-vlab num" style={place}>
          {text}
        </span>
      </span>
    </div>
  )
}

const and2 = (r: [Ratio, Ratio]) => `${r[0].text} and ${r[1].text}`

function AllocationStrip({ m }: { m: AllocationModel }) {
  const { density } = useDensity()
  const detailed = density === 'detailed'
  const all = [m.coordination, m.selection].flatMap((l) => [l.inSample, ...l.heldOut, ...l.calibrated]).map((r) => r.v)
  const lo = Math.min(1, ...all, m.selectionRange[0]) - 0.1
  const hi = Math.ceil(Math.max(...all, m.selectionRange[1]) * 10 - 1e-9) / 10 + 0.1
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100
  const step = hi - lo <= 1.2 ? 0.2 : 0.5
  const ticks: number[] = []
  for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + 1e-9; t += step) ticks.push(Number(t.toFixed(6)))
  const refX = x(1)
  const calLabel = `Calibrated held-out (post hoc, b = ${m.b})`

  const group = (l: AllocationLane, simple: string, full: string, first: boolean, note: ReactNode, range?: [number, number]) => (
    <div className={`al-group${first ? '' : ' al-group-rule'}`} style={{ '--al-ref': pct(refX) } as CSSProperties}>
      <div className="al-lane al-head">
        <span className="al-name">{detailed ? full : simple}</span>
        <span className="al-trk" aria-hidden="true">
          <span className="al-ref" />
          {first && (
            <span className="al-ref-label">
              <span className="num">1.00×</span> = no gain
            </span>
          )}
        </span>
      </div>
      <Lane label="In-sample" marks={[{ kind: 'ring', v: l.inSample.v }]} text={l.inSample.text} x={x} />
      <Lane label="Held-out, alternating split · time split" marks={l.heldOut.map((r) => ({ kind: 'dot' as const, v: r.v }))} text={and2(l.heldOut)} x={x} />
      <Lane label={calLabel} marks={l.calibrated.map((r) => ({ kind: 'dia' as const, v: r.v }))} text={and2(l.calibrated)} range={range} x={x} />
      <p className="al-note">{note}</p>
    </div>
  )

  return (
    <div className="al">
      <div className="al-legend">
        <span>
          <span className="al-key" aria-hidden="true">
            <span className="al-ring" />
          </span>
          <Gloss term="in-sample">In-sample</Gloss>
        </span>
        <span>
          <span className="al-key" aria-hidden="true">
            <span className="al-dot" />
          </span>
          <Gloss term="held-out">Held-out</Gloss>
        </span>
        <span>
          <span className="al-key" aria-hidden="true">
            <span className="al-dia" />
          </span>
          Calibrated held-out (<Gloss term="post-hoc">post hoc</Gloss>, <Gloss term="calibrated">b = {m.b}</Gloss>)
        </span>
      </div>
      {group(
        m.coordination,
        'Coordination across trials',
        "Coordination (joint optimum vs each trial's best response)",
        true,
        <>
          <span className="num strong">{m.coordination.slower}</span> of trials slower (held-out, time split)
        </>,
      )}
      {group(
        m.selection,
        'Site selection, trial by trial',
        "Site selection alone (each trial's best response vs its registered sites)",
        false,
        <>
          Roughly <span className="num">{m.selectionRange[0].toFixed(2)}×</span> to <span className="num">{m.selectionRange[1].toFixed(1)}×</span> across the
          calibration slope's 95% CI · <span className="num strong">{m.selection.slower}</span> of trials slower (held-out, time split)
        </>,
        m.selectionRange,
      )}
      <div className="al-lane al-axis" aria-hidden="true">
        <span />
        <span className="al-ticks num">
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(x(t)) }}>
              {t.toFixed(1)}×
            </span>
          ))}
        </span>
      </div>
      <p className="sr-only">
        {`Coordination across trials: ${m.coordination.inSample.text} in-sample; ${and2(m.coordination.heldOut)} held-out; ${and2(m.coordination.calibrated)} calibrated held-out, post hoc. ` +
          `Site selection, trial by trial: ${m.selection.inSample.text} in-sample; ${and2(m.selection.heldOut)} held-out; ${and2(m.selection.calibrated)} calibrated held-out, post hoc. 1.00× means no gain.`}
      </p>
    </div>
  )
}

/* ---------- implication: three measures on hairline rules (mockup B5.3) ---------- */

function ImplicationList({ m }: { m: ImplicationModel }) {
  const share = Number.parseFloat(m.sparseShare)
  return (
    <ul className="fd-rows">
      <li>
        <span className="fd-rows-label">Typical miss, predicting a held-out trial's enrollment time</span>
        <span>
          <span className="num fd-fig">{m.miss}</span>
          <span className="fd-rows-sub">
            <span className="num">{m.naive}</span> for a naive estimate
          </span>
        </span>
      </li>
      <li>
        <span className="fd-rows-label">U.S. sites with fewer than 3 lung trials of history</span>
        <span>
          <span className="num fd-fig">{m.sparse}</span>
          <span className="fd-rows-bar">
            {Number.isFinite(share) && (
              <span className="fd-bar" aria-hidden="true">
                <span style={{ width: pct(share) }} />
              </span>
            )}
            <span className="num">{m.sparseShare}</span>
          </span>
        </span>
      </li>
      <li>
        <span className="fd-rows-label">Site-level enrollment counts in the public registry</span>
        <span>
          <span className="num fd-fig">{m.siteCounts}</span>
          <span className="fd-rows-sub">Enrollment is reported per trial only</span>
        </span>
      </li>
    </ul>
  )
}

/* =====================================================================================================================
   Tables, caveats and sources (Detailed mode, and the Simple "Details" disclosure).
   ===================================================================================================================== */

const NUMERIC = /^[\s+\-−–\d.,%x×[\]()/]*$/

function isNumericCell(s: string): boolean {
  const t = s.replace(/(\d)e[-+]?\d+/gi, '$1')
  return /\d/.test(t) && NUMERIC.test(t)
}

/** Horizontal scroller for a wide table: the first column stays put (CSS) and a one-line hint says the table
 *  scrolls. The scroller is a focusable region only while it actually scrolls. */
function ScrollBox({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      if (!el.getClientRects().length) return // hidden with its tab: keep the last reading (no hint flicker on return)
      const left = el.scrollLeft > 1
      const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
      setEdge((e) => (e.left === left && e.right === right ? e : { left, right }))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])
  const scrolls = edge.left || edge.right
  return (
    <>
      <div className={`fd-scroll${edge.left ? ' fd-scroll-l' : ''}`}>
        <div
          ref={ref}
          className="table-scroll"
          role={scrolls ? 'region' : undefined}
          aria-label={scrolls ? `${label} (scrolls sideways)` : undefined}
          tabIndex={scrolls ? 0 : undefined}
        >
          {children}
        </div>
      </div>
      {scrolls && (
        <p className="fd-scroll-hint" aria-hidden="true">
          Scroll the table sideways for all columns →
        </p>
      )}
    </>
  )
}

function FTable({ table }: { table: FindingTable }) {
  const filled = (j: number) => table.rows.some((r) => (r[j] ?? '').trim() !== '')
  // A column with no value in any row says nothing: drop it (the row-header column always stays).
  const cols = table.columns.map((_, j) => j).filter((j) => j === 0 || filled(j))
  const numericCol = table.columns.map(
    (_, j) => j > 0 && filled(j) && table.rows.every((r) => !(r[j] ?? '').trim() || isNumericCell(r[j])),
  )
  const hl = table.highlight_row
  return (
    <figure className="fd-table-block">
      <figcaption className="fd-table-title">{typeset(table.title)}</figcaption>
      <ScrollBox label={table.title}>
        <table className="tbl fd-table">
          <thead>
            <tr>
              {cols.map((j) => (
                <th key={j} scope="col">
                  {table.columns[j] ? typeset(table.columns[j]) : <span className="sr-only">Note</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className={i === hl ? 'fd-row-hl' : undefined}>
                {cols.map((j) => {
                  const cell = row[j] ?? ''
                  return j === 0 ? (
                    <th key={j} scope="row">
                      {typeset(cell)}
                    </th>
                  ) : (
                    <td key={j} className={numericCol[j] ? 'num' : 'fd-text'}>
                      {cell.trim() ? typeset(cell) : <span className="muted" aria-label="none">—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
      {table.notes && table.notes.length > 0 && (
        <ul className="fd-notes">
          {table.notes.map((n, i) => (
            <li key={i}>{typeset(n)}</li>
          ))}
        </ul>
      )}
    </figure>
  )
}

function Sources({ sources }: { sources: FindingSource[] }) {
  return (
    <ul className="fd-list fd-sources">
      {sources.map((s) => (
        <li key={s.path}>
          {s.available === false ? (
            <span className="fd-src-off" title="This file is not in this checkout of the repository.">
              {s.label} <span className="muted">(not in this checkout)</span>
            </span>
          ) : (
            <a href={sourceHref(s.path)} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          )}
          <code className="fd-path">{s.path}</code>
        </li>
      ))}
    </ul>
  )
}

function Foot({ caveats, sources, lead }: { caveats?: string[]; sources?: ReactNode; lead?: ReactNode }) {
  const hasCaveats = (caveats ?? []).length > 0
  if (!hasCaveats && !sources && !lead) return null
  return (
    <div className="fd-foot">
      {lead}
      {(hasCaveats || sources) && (
        <div>
          {hasCaveats && (
            <>
              <h3 className="fd-foot-title">Caveats</h3>
              <ul className="fd-list fd-caveats">
                {caveats!.map((c, i) => (
                  <li key={i}>{typeset(c)}</li>
                ))}
              </ul>
            </>
          )}
          {sources && (
            <>
              <h3 className="fd-foot-title">Sources</h3>
              {sources}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = { final: 'Final', provisional: 'Provisional', missing: 'Not computed' }

/** Everything the file says about a finding, below its Simple summary. */
function FindingDetails({ f, withHeadline }: { f: Finding; withHeadline: boolean }) {
  return (
    <div className="fd-details">
      {withHeadline && <p className="fd-full">{typeset(f.headline)}</p>}
      <p className="fd-status">
        Status in findings.json: <span className="fd-status-v">{STATUS_LABEL[f.status] ?? f.status}</span>
      </p>
      {(f.tables ?? []).map((t) => (
        <FTable key={t.id} table={t} />
      ))}
      <Foot caveats={f.caveats} sources={(f.sources ?? []).length > 0 ? <Sources sources={f.sources!} /> : null} />
    </div>
  )
}

/** A status other than final stays visible next to the claim in both modes. */
function statusQualifier(status: string): ReactNode {
  if (status === 'final') return null
  return (
    <p className="fd-qual">
      <Qualifier tone={status === 'missing' ? 'muted' : 'caution'} info={`Status in findings.json: ${status}`}>
        {STATUS_LABEL[status] ?? status}
      </Qualifier>
    </p>
  )
}

/* =====================================================================================================================
   One finding. Known findings get the copy deck's Simple summary while their numbers match; any other finding
   (or one whose numbers moved) shows its own title, headline and chart.
   ===================================================================================================================== */

interface Summary {
  lede: ReactNode
  info: ReactNode
  figure: ReactNode
  caption?: ReactNode
}

function congestionSummary(f: Finding): Summary | null {
  const m = congestionModel(f)
  if (!m) return null
  const chart: CiChart = { type: 'ci', reference: { label: 'assumed in our original model', value: m.reference }, items: [m.item] }
  return {
    lede: "Within a site, more competing trials showed a small slowdown we can't distinguish from none, far below what our original model assumed.",
    info: (
      <>
        The estimate works out to about 6% slower enrollment per doubling of overlapping competing load, and it is not statistically significant. It uses public
        registry data: enrollment per trial and registered site lists. Standard errors are clustered by trial and by site. Across eligibility-parser versions the
        estimate ranged between −0.027 and −0.136; none was significant with two-way clustered standard errors. Across sites, busier sites are slower per trial
        (−0.107, p 0.06), but that comparison is confounded with site type. Subsets such as experienced sites are reported separately and never used as the default.
        {sourceLine(f.sources)}
      </>
    ),
    figure: (
      <CiStrip
        chart={chart}
        labels={{
          series: () => 'Within-site estimate (default)',
          interval: (it) => (
            <>
              <Gloss term="ci95">95% CI</Gloss> <span className="num">{fmt(it.lo)}</span> to <span className="num">{fmt(it.hi)}</span>, floored at 0
            </>
          ),
          foot: ['0 = no slowdown', <Gloss key="g" term="congestion-elasticity" />],
          sr: `Within-site estimate ${fmt(m.item.estimate)}, 95% CI ${fmt(m.item.lo)} to ${fmt(m.item.hi)}, floored at 0, against ${fmtRef(m.reference)} assumed in our original model.`,
        }}
      />
    ),
    caption: (
      <>
        Within-site estimate from 3,442 completed lung trials and 68k trial-site rows. The coefficient's own 95% interval, <span className="num">−0.297</span> to{' '}
        <span className="num">+0.111</span>, crosses zero.
      </>
    ),
  }
}

function allocationSummary(f: Finding): Summary | null {
  const m = allocationModel(f)
  if (!m) return null
  return {
    lede: (
      <>
        Coordinating sites across trials lost most of its modeled gain on held-out data. Choosing sites trial by trial kept its modeled gain, but a post hoc
        calibration shrinks it to about 1.2× (roughly 1.06× to 1.3×).
      </>
    ),
    info: (
      <>
        Held-out means sites were chosen with rates fit on one half of history and scored with rates fit on the other half, in two splits: alternating and by
        time. In-sample numbers are scored on the data used to choose, which flatters them. In an observed-outcome check, registered site lists that our scores
        ranked higher did enroll faster per site, but the slope was 0.33 (95% CI 0.16 to 0.50; industry Phase II/III, 390 trials). A slope of 1 would mean the
        scores are calibrated. At the low end of that interval (b = 0.16), calibrated site selection is 1.07× and 1.06× held-out. The calibrated re-score assumes
        the trial-level overstatement applies equally to each site. Regeneron, 5 trials as of September 1, 2024: coordination 1.01× in-sample, 0.99× and 1.03×
        held-out.
        {sourceLine(f.sources)}
      </>
    ),
    figure: <AllocationStrip m={m} />,
    caption: (
      <>
        US-Northeast, 46 trials. Ratio = total trial-months, baseline ÷ alternative, <Gloss term="scored-by-model">scored by our enrollment model</Gloss>, not
        observed enrollment. Final rerun of a <Gloss term="pre-registered">pre-registered</Gloss> script. The calibrated points are post hoc.
      </>
    ),
  }
}

function implicationSummary(f: Finding): Summary | null {
  const m = implicationModel(f)
  if (!m) return null
  return {
    lede: 'Choosing sites well needs enrollment counts per site, which are private today. The public registry reports enrollment only per trial.',
    info: (
      <>
        Typical miss is the median factor by which a prediction is off, in either direction, on trials the model never saw. Formally: exp(median absolute log
        error), fit before 2018 and predicted after.
        {sourceLine(f.sources)}
      </>
    ),
    figure: <ImplicationList m={m} />,
    caption: 'Industry Phase II/III trials. Model fit before 2018 and checked on later trials.',
  }
}

const SUMMARIES: Record<string, (f: Finding) => Summary | null> = {
  congestion: congestionSummary,
  allocation: allocationSummary,
  implication: implicationSummary,
}

/** Whether a finding gets its copy-deck summary (the same test the summaries apply, without building them). */
const HAS_SUMMARY: Record<string, (f: Finding) => boolean> = {
  congestion: (f) => !!congestionModel(f),
  allocation: (f) => !!allocationModel(f),
  implication: (f) => !!implicationModel(f),
}
const hasSummary = (f: Finding) => f.status !== 'missing' && !!HAS_SUMMARY[f.id]?.(f)

/** The heading a finding shows in the current density: the copy deck's short claim in Simple when its summary
 *  applies, the file's own title otherwise. */
function findingTitle(f: Finding, simple: boolean, hasSummary: boolean): string {
  return simple && hasSummary ? (SIMPLE_TITLE[f.id] ?? f.title) : f.title
}

function FindingBlock({ f }: { f: Finding }) {
  const { density } = useDensity()
  const missing = f.status === 'missing'
  const summary = missing ? null : (SUMMARIES[f.id]?.(f) ?? null)
  const title = findingTitle(f, density === 'simple', !!summary)
  const status = statusQualifier(f.status)
  return (
    <div className={`fd-card${missing ? ' fd-missing' : ''}`} id={`finding-${f.id}`} data-finding={f.id} data-summary={summary ? 'copy' : 'generic'}>
      {missing ? (
        <Section title={title} lede={<span className="fd-headline">{f.headline}</span>} qualifiers={status} />
      ) : summary ? (
        <Section
          title={title}
          lede={summary.lede}
          qualifiers={status}
          info={summary.info}
          figure={summary.figure}
          caption={summary.caption}
          details={<FindingDetails f={f} withHeadline />}
        />
      ) : (
        <Section
          title={title}
          lede={<span className="fd-headline">{typeset(f.headline)}</span>}
          qualifiers={status}
          info={(f.caveats ?? []).length > 0 || (f.sources ?? []).length > 0 ? genericInfo(f) : undefined}
          figure={isCiChart(f.chart) ? <CiStrip chart={f.chart} /> : undefined}
          details={<FindingDetails f={f} withHeadline={false} />}
        />
      )}
    </div>
  )
}

/** Info card for a finding without a copy-deck summary: its first caveat and its sources. */
function genericInfo(f: Finding): ReactNode {
  const first = (f.caveats ?? [])[0]
  return (
    <>
      {first ? typeset(first) : 'Caveats and sources are listed under Details.'}
      {sourceLine(f.sources)}
    </>
  )
}

/* =====================================================================================================================
   Lead block: same-sponsor overlap (copy deck B5.0), from self_overlap.json.
   ===================================================================================================================== */

function SquaresFigure({ m }: { m: SelfOverlapModel }) {
  const groups = m.groups
  return (
    <>
      <div className="fd-kfs">
        <KeyFigure layout="inline" value={m.count.toLocaleString('en-US')} label="same-sponsor pairs" />
        <KeyFigure layout="inline" value={m.sponsors.toLocaleString('en-US')} label="sponsors" />
        <p className="kf kf-inline">
          <Qualifier mark="†">{m.upper.toLocaleString('en-US')} upper bounds</Qualifier>
        </p>
      </div>
      {groups && (
        <>
          <div className="fd-squares" aria-hidden="true">
            {groups.map((g) => (
              <span key={g.sponsor} className="fd-sq-group">
                {g.upper.map((u, i) => (
                  <span key={i} className={`fd-sq ${u ? 'fd-sq-ub' : 'fd-sq-ok'}`} />
                ))}
              </span>
            ))}
          </div>
          <p className="sr-only">
            {(() => {
              const not = groups.filter((g) => g.upper.some((u) => !u))
              const nNot = m.count - m.upper
              return (
                `${m.count} pairs in ${groups.length} sponsor groups of ${listJoin(groups.map((g) => String(g.upper.length)))} pairs. ` +
                (nNot === 0
                  ? 'All are upper bounds.'
                  : `${m.upper} are upper bounds; the ${nNot} that are not belong to ${not.length === 1 ? 'one sponsor' : `${not.length} sponsors`}.`)
              )
            })()}
          </p>
          <p className="fd-sq-key">
            <span className="fd-sq fd-sq-ub fd-sq-sm" aria-hidden="true" /> Outlined: upper bound · <span className="fd-sq fd-sq-ok fd-sq-sm" aria-hidden="true" /> Filled:
            no upper-bound flag · One square per pair, grouped by sponsor
          </p>
        </>
      )}
    </>
  )
}

const SOURCE_ROW_LABEL: Record<string, string> = {
  'both hand-encoded': 'Both hand-encoded and reviewed (headline)',
  'one of each': 'One of each',
  'both rule-based parse': 'Both rule-based parse (unreviewed)',
  all: 'All (broad count)',
}

function SelfOverlapDetails({ d }: { d: SelfOverlap }) {
  const note = overlapNote(d)
  const rows = sourceRows(d)
  const by = d.count_by_eligibility_source ?? {}
  const oneOfEach = by['one of each']
  const parsed = by['both rule-based parse']
  const contained = d.robustness?.container_at_most_2_criteria?.count
  const minCrit = d.parameters?.robust_min_container_criteria
  const broad = d.count
  const notes: string[] = []
  if (typeof oneOfEach === 'number' && typeof parsed === 'number' && typeof broad === 'number')
    notes.push(
      `${oneOfEach + parsed} of the ${broad} (${oneOfEach} + ${parsed}) rest on the unreviewed rule-based parse for at least one trial. The parse never sets the upper-bound flag, so those pairs are unflagged, not verified.`,
    )
  if (typeof contained === 'number' && typeof broad === 'number' && typeof minCrit === 'number')
    notes.push(
      `${contained} of all ${broad} are “contained” in a trial with ${minCrit - 1} or fewer encoded criteria: most synthetic patients pass it, so containment says little.`,
    )
  const sources =
    (d.sources ?? []).length > 0 ? (
      <Sources sources={d.sources!} />
    ) : (
      <ul className="fd-list fd-sources">
        <li>
          Same-sponsor overlap statistic
          <code className="fd-path">data/findings/self_overlap.json</code>
        </li>
      </ul>
    )
  return (
    <div className="fd-details">
      {note && (
        <p className="fd-full fd-related-text">
          {note.count !== null && <strong className="num">{note.count.toLocaleString('en-US')}</strong>} {note.text}
        </p>
      )}
      {rows.length > 0 && (
        <figure className="fd-table-block">
          <figcaption className="fd-table-title">Same-sponsor pairs by eligibility source</figcaption>
          <ScrollBox label="Same-sponsor pairs by eligibility source">
            <table className="tbl fd-table">
              <thead>
                <tr>
                  <th scope="col">Eligibility source of the two trials</th>
                  <th scope="col">Pairs</th>
                  <th scope="col">Upper bounds</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={r.key === 'both hand-encoded' ? 'fd-row-hl' : undefined}>
                    <th scope="row">{SOURCE_ROW_LABEL[r.key]}</th>
                    <td className="num">{r.pairs!.toLocaleString('en-US')}</td>
                    <td className="num">
                      {r.upper === null ? (
                        <span className="muted" aria-label="not counted">
                          —
                        </span>
                      ) : (
                        <>
                          {r.upper.toLocaleString('en-US')}
                          {r.key === 'one of each' && r.upper > 0 && <span className="fd-cell-note"> (set by the hand-encoded trial)</span>}
                          {r.key === 'both rule-based parse' && r.upper === 0 && <span className="fd-cell-note"> (unflagged, not verified)</span>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollBox>
          {notes.length > 0 && (
            <ul className="fd-notes">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </figure>
      )}
      <Foot
        lead={
          note?.definition ? (
            <div>
              <h3 className="fd-foot-title">Definition</h3>
              <p className="fd-def">{typeset(note.definition)}</p>
            </div>
          ) : undefined
        }
        caveats={overlapCaveats(d.notes)}
        sources={sources}
      />
    </div>
  )
}

function SelfOverlapBlock({ d }: { d: SelfOverlap }) {
  const m = selfOverlapModel(d)
  const note = overlapNote(d)
  if (!m && !note) return null
  const open = (
    <p className="fd-open">
      <a href="#overlap">Open Portfolio overlap →</a>
    </p>
  )
  const title = m || (note?.count ?? 0) > 0 ? LEAD_TITLE : 'Same-sponsor overlap'
  return (
    <div className="fd-card fd-lead" id={`finding-${LEAD_ID}`} data-finding={LEAD_ID} data-summary={m ? 'copy' : 'generic'}>
      {m ? (
        <Section
          title={title}
          lede={
            <>
              {m.count.toLocaleString('en-US')} pairs of trials from the same sponsor, across {m.sponsors.toLocaleString('en-US')} sponsors, recruited at the same
              time, shared at least {m.minSites.toLocaleString('en-US')} <Gloss term="registered-site">registered sites</Gloss>, and, on a{' '}
              <Gloss term="synthetic-population">synthetic population</Gloss>, had at least {m.minShare}% of one trial's eligible patients also eligible for the
              other.
            </>
          }
          qualifiers={
            <>
              <p className="fd-qual">
                <span className="qual qual-caution" aria-hidden="true">
                  †{' '}
                </span>
                {m.upper.toLocaleString('en-US')} of the {m.count.toLocaleString('en-US')} are <Gloss term="upper-bound">upper bounds</Gloss>. Both trials' criteria
                were <Gloss term="hand-encoded">hand-encoded</Gloss> and reviewed.
              </p>
              {open}
            </>
          }
          info={
            <>
              Upper bound: at least one trial in the pair has a restriction the synthetic population can't represent, so the overlap is a ceiling. A broader count
              finds {m.broad.toLocaleString('en-US')} pairs, but {m.unreviewed.toLocaleString('en-US')} of those rest on our unreviewed rule-based parse for at least
              one trial. That parse never sets the upper-bound flag, so those pairs are unflagged, not verified. The count is a floor: sponsors that register sites
              anonymously can't show shared sites, and different sponsor names for one company are not merged.
              <span className="hc-src">Source: same-sponsor overlap statistic, data/findings/self_overlap.json</span>
            </>
          }
          figure={<SquaresFigure m={m} />}
          caption={`Industry-sponsored NSCLC trials whose enrollment windows were both open at some point from ${m.since} to ${m.until}. Eligibility measured on a synthetic population.`}
          details={<SelfOverlapDetails d={d} />}
        />
      ) : (
        <Section
          title={title}
          lede={
            note && (
              <span className="fd-related-text">
                {note.count !== null && <strong className="num">{note.count.toLocaleString('en-US')}</strong>} {note.text}
              </span>
            )
          }
          qualifiers={
            <>
              {note?.broad && (
                <p className="fd-qual">
                  <Qualifier mark="‡" info={GLOSSARY.unreviewed.gloss}>
                    Unreviewed
                  </Qualifier>{' '}
                  {note.unreviewed != null
                    ? `${note.unreviewed.toLocaleString('en-US')} of these pairs rest on the unreviewed rule-based parse for at least one trial. That parse never sets the upper-bound flag, so those pairs are unflagged, not verified.`
                    : 'This is the broad count: it can include pairs whose eligibility comes from the unreviewed rule-based parse, which never sets the upper-bound flag.'}
                </p>
              )}
              {open}
            </>
          }
          details={<SelfOverlapDetails d={d} />}
        />
      )}
    </div>
  )
}

/* =====================================================================================================================
   Page
   ===================================================================================================================== */

function scrollToBlock(id: string, smooth: boolean) {
  const el = document.getElementById(`finding-${id.toLowerCase()}`)
  if (!el) return false
  const motion = smooth && window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  el.scrollIntoView({ behavior: motion ? 'smooth' : 'auto', block: 'start' })
  return true
}

export default function FindingsView({ focus }: { focus?: { id: string | null; n: number } }) {
  const { density } = useDensity()
  const simple = density === 'simple'
  const [state, setState] = useState<Async<FindingsDoc>>({ status: 'loading' })
  const [overlap, setOverlap] = useState<Optional<SelfOverlap>>({ status: 'loading' })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const ctl = new AbortController()
    findingsApi
      .findings(ctl.signal)
      .then((d) => setState({ status: 'ok', data: d }))
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      })
    findingsApi
      .selfOverlap(ctl.signal)
      .then((d) => setOverlap({ status: 'ok', data: d }))
      .catch(() => {
        // Not produced yet (404) or unreadable: the page goes without the lead block.
        if (!ctl.signal.aborted) setOverlap({ status: 'none' })
      })
    return () => ctl.abort()
  }, [tick])

  const doc = state.status === 'ok' ? state.data : null
  const findings = doc?.findings ?? []
  const when = generatedAt(doc?.generated_at)
  const so = overlap.status === 'ok' ? overlap.data : null
  const lead = so && doc && (selfOverlapModel(so) || overlapNote(so)) ? so : null
  const snapshot = shortDate(so?.snapshot_date ?? so?.parameters?.until)

  // #findings/<id>: once both files have settled (the lead block sits above the findings, so it must be in place
  // first) and the fonts have loaded, bring that block into view.
  const focusId = focus?.id ?? null
  const focusN = focus?.n ?? 0
  const settled = doc !== null && overlap.status !== 'loading'
  // A deep link that arrives while this view is kept hidden (another tab on show) waits until it is shown.
  const tab = useTabSignal()
  useEffect(() => {
    if (!settled || !focusId) return
    let live = true
    const go = () => {
      if (live) scrollToBlock(focusId, false)
    }
    const cancel = whenShown(tab, () => {
      // The bundled fonts change line heights; scroll once they are in so the block lands where it should.
      const fonts = 'fonts' in document ? document.fonts : null
      if (!fonts || fonts.status === 'loaded') go()
      else fonts.ready.then(go, go)
    })
    return () => {
      live = false
      cancel()
    }
  }, [settled, focusId, focusN, tab])

  // On-page index: real links (#findings/<id>), so each one can be copied; a click scrolls without a reload.
  const onIndex = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    if (!scrollToBlock(id, true)) return
    e.preventDefault()
    if (window.location.hash !== `#findings/${id}`) window.history.pushState(null, '', `#findings/${id}`)
  }
  const index = [
    ...(lead ? [{ id: LEAD_ID, label: SHORT_NAME[LEAD_ID], title: LEAD_TITLE }] : []),
    ...findings.map((f) => {
      const title = findingTitle(f, simple, hasSummary(f))
      return { id: f.id, label: SHORT_NAME[f.id] ?? title, title }
    }),
  ]

  return (
    <section className="view fd">
      <PageHead title="Findings" lede={INTRO} meta={snapshot ? `Registry snapshot: ${snapshot}` : undefined} />

      {state.status === 'loading' && <Loading label="Loading registry data…" />}
      {state.status === 'error' && (
        <ErrorBox
          error={state.error}
          onRetry={() => {
            setState({ status: 'loading' })
            setOverlap({ status: 'loading' })
            setTick((x) => x + 1)
          }}
        />
      )}

      {doc && index.length > 0 && (
        <nav className="fd-index" aria-label="Findings on this page">
          <span className="fd-index-label">On this page</span>
          <ol>
            {index.map((it) => (
              <li key={it.id}>
                <a className="fd-index-item" href={`#findings/${it.id}`} title={it.title} onClick={(e) => onIndex(e, it.id)}>
                  {it.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {lead && <SelfOverlapBlock d={lead} />}

      {findings.map((f) => (
        <FindingBlock key={f.id} f={f} />
      ))}

      {doc && (doc.rule || when) && (
        <p className="fd-rule">
          {doc.rule}
          {when && <span className="fd-meta"> Findings file generated {when}.</span>}
        </p>
      )}
    </section>
  )
}
