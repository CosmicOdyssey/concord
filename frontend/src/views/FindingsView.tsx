// Findings page (landing). Renders /api/findings (data/findings/findings.json, written by
// `python -m concord.findings`) generically: every sentence and number on this page comes from that file.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Badge, ErrorBox, Loading } from '../components'
import {
  findingsApi,
  isCiChart,
  overlapHeadline,
  sourceHref,
  type CiChart,
  type Finding,
  type FindingsDoc,
  type FindingTable,
  type SelfOverlap,
} from '../findingsApi'
import './findings.css'

type Async<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; data: T }

const STATUS: Record<string, { tone: 'warn' | 'ok' | 'neutral'; label: string }> = {
  provisional: { tone: 'warn', label: 'Provisional' },
  final: { tone: 'ok', label: 'Final' },
  missing: { tone: 'neutral', label: 'Not computed' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: 'neutral' as const, label: status }
  return (
    <Badge tone={s.tone} title={`Status in findings.json: ${status}`}>
      {s.label}
    </Badge>
  )
}

function generatedAt(iso: string | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toLocaleString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} UTC`
}

/* ---------- CI plot ---------- */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(Math.round(el.getBoundingClientRect().width))
    const ro = new ResizeObserver((es) => setW(Math.round(es[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return Number(((n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag).toPrecision(6))
}

/** Estimates and interval ends: two decimals, as in the headlines (0.09, 0.00 to 0.21). */
function fmt(v: number): string {
  return v.toFixed(2)
}

/** The reference value: one decimal when whole (1.0), else two. */
function fmtRef(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : v.toFixed(2)
}

/** Tick labels: as many decimals as the step has, trailing zeros dropped (0, 0.25, 0.5, ...). */
function fmtTick(v: number, step: number): string {
  const d = Math.min((String(step).split('.')[1] ?? '').length, 4)
  return Number(v.toFixed(d)).toString()
}

const CHAR_W = 7 // px per character at the 12px label size; used only to choose a label side
const ROW = 50
const TOP = 26
const AXIS = 30
const PAD = 18

function CiPlot({ chart }: { chart: CiChart }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const titleId = useId()
  const descId = useId()
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
  const step = niceStep(max - min, width < 420 ? 3 : 5)
  min = Math.floor(min / step + 1e-9) * step
  max = Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(10)))
  const W = Math.max(width, 240)
  const x = (v: number) => PAD + ((v - min) / (max - min)) * (W - 2 * PAD)
  const H = TOP + items.length * ROW + AXIS
  const axisY = TOP + items.length * ROW + 4
  const xr = x(ref0)
  const refText = `${chart.reference.label}: ${fmtRef(ref0)}`
  const refAnchor = xr > W * 0.7 ? 'end' : xr < W * 0.3 ? 'start' : 'middle'
  const refX = refAnchor === 'end' ? Math.min(xr, W - 2) : refAnchor === 'start' ? Math.max(xr, 2) : xr

  return (
    <figure className="ci">
      <div ref={ref} className="ci-box">
        {width > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${titleId} ${descId}`}>
            <title id={titleId}>Estimate with interval, against the reference value</title>
            <desc id={descId}>
              {items.map((it) => `${it.label}: estimate ${fmt(it.estimate)}, interval ${fmt(it.lo)} to ${fmt(it.hi)}. `).join('')}
              {`Reference line: ${chart.reference.label}, ${fmtRef(ref0)}.`}
            </desc>
            {ticks.map((t) => (
              <g key={t}>
                <line className="ci-grid" x1={x(t)} x2={x(t)} y1={TOP} y2={axisY} />
                <text className="ci-tick" x={x(t)} y={axisY + 18} textAnchor="middle">
                  {fmtTick(t, step)}
                </text>
              </g>
            ))}
            <line className="ci-axis" x1={PAD} x2={W - PAD} y1={axisY} y2={axisY} />
            <line className="ci-ref" x1={xr} x2={xr} y1={TOP - 6} y2={axisY} />
            <text className="ci-ref-label" x={refX} y={TOP - 11} textAnchor={refAnchor}>
              {refText}
            </text>
            {items.map((it, i) => {
              const y0 = TOP + i * ROW
              const cy = y0 + 32
              const lo = x(it.lo)
              const hi = x(it.hi)
              const est = x(it.estimate)
              const label = `${fmt(it.estimate)}  [${fmt(it.lo)}, ${fmt(it.hi)}]`
              const right = hi + 10 + label.length * CHAR_W <= W - 2
              return (
                <g key={i} className="ci-item">
                  <title>{`${it.label}: ${fmt(it.estimate)} (interval ${fmt(it.lo)} to ${fmt(it.hi)})`}</title>
                  <rect className="ci-hit" x={0} y={y0 + 4} width={W} height={ROW - 4} />
                  <text className="ci-item-label" x={PAD} y={y0 + 14}>
                    {it.label}
                  </text>
                  <rect className="ci-band" x={lo} y={cy - 7} width={Math.max(hi - lo, 1)} height={14} rx={3} />
                  <line className="ci-whisker" x1={lo} x2={hi} y1={cy} y2={cy} />
                  <line className="ci-whisker" x1={lo} x2={lo} y1={cy - 6} y2={cy + 6} />
                  <line className="ci-whisker" x1={hi} x2={hi} y1={cy - 6} y2={cy + 6} />
                  <circle className="ci-est" cx={est} cy={cy} r={5.5} />
                  <text className="ci-val" x={right ? hi + 10 : lo - 10} y={cy + 4} textAnchor={right ? 'start' : 'end'}>
                    {label}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
      <figcaption className="ci-key small muted">
        <span className="ci-key-item">
          <svg width="26" height="12" aria-hidden="true">
            <line className="ci-whisker" x1="2" x2="24" y1="6" y2="6" />
            <circle className="ci-est" cx="13" cy="6" r="4" />
          </svg>
          estimate and interval
        </span>
        <span className="ci-key-item">
          <svg width="12" height="14" aria-hidden="true">
            <line className="ci-ref" x1="6" x2="6" y1="0" y2="14" />
          </svg>
          {chart.reference.label}
        </span>
      </figcaption>
    </figure>
  )
}

/* ---------- tables ---------- */

const NUMERIC = /^[\s+\-−–\d.,%x×[\]()/]*$/

function isNumericCell(s: string): boolean {
  const t = s.replace(/(\d)e[-+]?\d+/gi, '$1')
  return /\d/.test(t) && NUMERIC.test(t)
}

function FTable({ table }: { table: FindingTable }) {
  const numericCol = table.columns.map(
    (_, j) => j > 0 && table.rows.some((r) => (r[j] ?? '').trim() !== '') && table.rows.every((r) => !(r[j] ?? '').trim() || isNumericCell(r[j])),
  )
  const hl = table.highlight_row
  return (
    <div className="fd-table-block">
      <h3 className="fd-table-title">{table.title}</h3>
      <div className="table-scroll">
        <table className="tbl fd-table">
          <thead>
            <tr>
              {table.columns.map((c, j) => (
                <th key={j} scope="col" className={numericCol[j] ? 'num' : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className={i === hl ? 'fd-row-hl' : undefined}>
                {row.map((cell, j) =>
                  j === 0 ? (
                    <th key={j} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={j} className={numericCol[j] ? 'num' : undefined}>
                      {cell.trim() ? cell : <span className="muted" aria-label="none">—</span>}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.notes && table.notes.length > 0 && (
        <ul className="fd-notes small muted">
          {table.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------- finding card ---------- */

function FindingCard({ f, n }: { f: Finding; n: number }) {
  const missing = f.status === 'missing'
  return (
    <article className={`card fd-card${missing ? ' fd-missing' : ''}`} id={`finding-${f.id}`} aria-labelledby={`finding-${f.id}-title`}>
      <header className="fd-head">
        <span className="fd-num" aria-hidden="true">
          {n}
        </span>
        <h2 id={`finding-${f.id}-title`} className="fd-title">
          {f.title}
        </h2>
        <StatusBadge status={f.status} />
      </header>
      <p className="fd-headline">{f.headline}</p>
      {!missing && (
        <>
          {isCiChart(f.chart) && <CiPlot chart={f.chart} />}
          {(f.tables ?? []).map((t) => (
            <FTable key={t.id} table={t} />
          ))}
          {((f.caveats ?? []).length > 0 || (f.sources ?? []).length > 0) && (
            <div className="fd-foot">
              {(f.caveats ?? []).length > 0 && (
                <div>
                  <h3 className="fd-foot-title">Caveats</h3>
                  <ul className="fd-list">
                    {f.caveats!.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(f.sources ?? []).length > 0 && (
                <div>
                  <h3 className="fd-foot-title">Sources</h3>
                  <ul className="fd-list fd-sources">
                    {f.sources!.map((s) => (
                      <li key={s.path}>
                        <a href={sourceHref(s.path)} target="_blank" rel="noreferrer">
                          {s.label}
                        </a>
                        <code className="fd-path">{s.path}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </article>
  )
}

function RelatedOverlap({ data }: { data: SelfOverlap }) {
  const line = overlapHeadline(data)
  return (
    <aside className="fd-related" aria-label="Related: portfolio overlap">
      <span className="fd-related-label">Related: portfolio overlap</span>
      {line && <span className="fd-related-text">{line}</span>}
      <a href="#overlap" className="fd-related-link">
        Open the overlap audit →
      </a>
    </aside>
  )
}

/* ---------- page ---------- */

export default function FindingsView() {
  const [state, setState] = useState<Async<FindingsDoc>>({ status: 'loading' })
  const [overlap, setOverlap] = useState<SelfOverlap | null>(null)
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
      .then(setOverlap)
      .catch(() => {
        /* not produced yet (404): no related note */
      })
    return () => ctl.abort()
  }, [tick])

  const doc = state.status === 'ok' ? state.data : null
  const findings = doc?.findings ?? []
  const when = generatedAt(doc?.generated_at)

  return (
    <section className="view fd">
      <div className="view-head">
        <h1>Findings</h1>
        <p className="lede">
          Research on public ClinicalTrials.gov data for non-small cell lung cancer (NSCLC) trials. Each finding lists
          the analysis outputs it comes from.
        </p>
        {doc && (
          <p className="fd-meta small muted">
            {when && <span>Generated {when}.</span>} {doc.rule && <span>{doc.rule}</span>}
          </p>
        )}
      </div>

      {state.status === 'loading' && <Loading label="Loading findings…" />}
      {state.status === 'error' && (
        <ErrorBox
          error={state.error}
          onRetry={() => {
            setState({ status: 'loading' })
            setTick((x) => x + 1)
          }}
        />
      )}

      {findings.length > 0 && (
        <nav className="fd-index" aria-label="Findings on this page">
          {findings.map((f, i) => (
            <button
              key={f.id}
              className="fd-index-item"
              onClick={() => document.getElementById(`finding-${f.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <span className="fd-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="fd-index-title">{f.title}</span>
              <StatusBadge status={f.status} />
            </button>
          ))}
        </nav>
      )}

      {findings.map((f, i) => (
        <FindingCard key={f.id} f={f} n={i + 1} />
      ))}

      {overlap && doc && <RelatedOverlap data={overlap} />}
    </section>
  )
}
