// Calm building blocks used only by the Research tab's sub-views: the in-sample label line every sub-view leads with,
// the compact ratio chart, and the page head. Shared candidates are described in the view pass's report
// (shared_change_requests); until the integrator promotes them, they live here so no shared file changes.
import type { ReactNode } from 'react'
import { Gloss, PageHead, Qualifier } from '../components'
import { GLOSSARY } from '../glossary'
import { times } from '../format'

const IN_SAMPLE_CARD = (
  <>
    <span className="hc-title">{GLOSSARY['in-sample'].term}</span>
    {GLOSSARY['in-sample'].gloss}
  </>
)

/** A " · " between parts of a line; screen readers hear a comma instead. */
function Sep() {
  return (
    <>
      <span aria-hidden="true"> · </span>
      <span className="sr-only">, </span>
    </>
  )
}

/** "In-sample" as an always-visible caution mark with its glossary card. */
export function InSampleMark({ children = 'In-sample' }: { children?: ReactNode }) {
  return <Qualifier info={IN_SAMPLE_CARD}>{children}</Qualifier>
}

/** The line every Research sub-view leads with (both densities): what kind of number this page shows.
 *  `kind` replaces the default "In-sample model output" mark for pages whose numbers are not allocation outputs
 *  (Model & data); `children` adds a sentence after it. */
export function InSampleLine({ kind, children }: { kind?: ReactNode; children?: ReactNode }) {
  return (
    <p className="rs-label">
      {kind ?? (
        <>
          <InSampleMark>In-sample model output</InSampleMark>
          <Sep />
          <span>
            <Gloss term="scored-by-model">scored by our enrollment model</Gloss>
          </span>
          <Sep />
          <strong>not a product claim</strong>.
        </>
      )}
      {children && <span className="rs-label-more"> {children}</span>}
    </p>
  )
}

/** The sub-view's page head: the h1, a plain lede, then the in-sample line and anything else (the run line). */
export function RsHead({ title, lede, children }: { title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <PageHead title={title} lede={lede}>
      <div className="rs-head-extra">{children}</div>
    </PageHead>
  )
}

export interface Lane {
  /** Row label (what is compared). */
  label: ReactNode
  /** A muted second line under the label (the baseline, e.g. "vs registered"). */
  sub?: ReactNode
  /** A point, or a [low, high] range across scenarios. */
  value: number | null | readonly [number, number] | null
  /** Always-visible text after the value (e.g. "in-sample", "assumed"). */
  note?: ReactNode
  /** 'assumed': drawn with the second series (a diamond) and caution text, for values that were assumed, not estimated. */
  tone?: 'default' | 'assumed'
}

/** A compact ratio chart: one lane per comparison on a shared axis, a dashed reference line at 1.00× ("no gain"),
 *  the value as text at the end of its lane. Rows carry equal weight, so a result that weakens the pitch is drawn the
 *  same size as one that supports it. The values are text, so screen readers read label and value in order. */
export function RatioLanes({ lanes, label }: { lanes: Lane[]; label: string }) {
  const vals = lanes.flatMap((l) => (l.value === null ? [] : typeof l.value === 'number' ? [l.value] : [...l.value]))
  const lo = Math.min(0.9, Math.floor((Math.min(1, ...vals) - 0.1) * 10) / 10)
  const hi = Math.max(1.5, Math.ceil((Math.max(1, ...vals) + 0.1) * 10) / 10)
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100
  const ref = x(1)
  return (
    <div className="rs-lanes" role="group" aria-label={label}>
      <ul>
        {lanes.map((l, i) => {
          const v = l.value
          const pts = v === null ? [] : typeof v === 'number' ? [v] : [v[0], v[1]]
          const text =
            v === null ? (
              <span className="num">—</span>
            ) : typeof v === 'number' || Math.abs(v[1] - v[0]) < 0.005 ? (
              <span className="num">{times(typeof v === 'number' ? v : v[0])}</span>
            ) : (
              <>
                <span className="num">{times(v[0])}</span> <span className="rs-lane-to">to</span> <span className="num">{times(v[1])}</span>
              </>
            )
          return (
            <li key={i} className={`rs-lane${l.tone === 'assumed' ? ' rs-lane-assumed' : ''}`}>
              <span className="rs-lane-label">
                {l.label}
                {l.sub && <span className="rs-lane-sub">{l.sub}</span>}
              </span>
              <span className="rs-lane-track" aria-hidden="true">
                <span className="rs-lane-ref" style={{ left: `${ref}%` }} />
                {pts.length === 2 && <span className="rs-lane-range" style={{ left: `${x(pts[0])}%`, width: `${x(pts[1]) - x(pts[0])}%` }} />}
                {pts.map((p, j) => (
                  <span key={j} className="rs-lane-mark" style={{ left: `${x(p)}%` }} />
                ))}
              </span>
              <span className="rs-lane-value">
                <span className="rs-lane-num">{text}</span>
                {l.note && <span className="rs-lane-note">{l.note}</span>}
              </span>
            </li>
          )
        })}
        <li className="rs-lanes-axis" aria-hidden="true">
          <span className="rs-lanes-axis-track">
            <span className="rs-lanes-axis-ref" style={{ left: `${ref}%` }}>
              1.00× = no gain
            </span>
          </span>
        </li>
      </ul>
    </div>
  )
}
