import { useEffect, useId, useState, type ReactNode } from 'react'
import type { Scenario } from './api'
import { useDensity } from './density'
import { GLOSSARY, type GlossaryKey } from './glossary'
import { HoverCard, InfoTip } from './hovercard'
import './calm.css'

export function useElapsed(running: boolean): number {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!running) return
    const start = performance.now()
    setSecs(0)
    const id = window.setInterval(() => setSecs((performance.now() - start) / 1000), 250)
    return () => window.clearInterval(id)
  }, [running])
  return secs
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}

export function Loading({ label, hint }: { label: string; hint?: string }) {
  const secs = useElapsed(true)
  return (
    <div className="loading" role="status" aria-live="polite">
      <Spinner />
      <div>
        <div>
          {label} <span className="muted tnum">{secs.toFixed(0)} s</span>
        </div>
        {hint && <div className="muted small">{hint}</div>}
      </div>
    </div>
  )
}

/** A network failure (backend down, or the dev proxy could not connect) rather than an error the API returned. */
function unreachable(error: string): boolean {
  return /failed to fetch|networkerror|load failed|econnrefused|^50[234]\b/i.test(error.trim())
}

/** The only red in the interface (copy deck B9). */
export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="error" role="alert">
      {unreachable(error) ? (
        <>
          <strong>Can't reach the Concord API.</strong> <span>Check that the backend is running.</span>{' '}
          <span className="small">({error})</span>
        </>
      ) : (
        <>
          <strong>Request failed.</strong> <span>{error}</span>
        </>
      )}
      {onRetry && (
        <button className="btn btn-small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Caveat({ children }: { children: ReactNode }) {
  return <p className="caveat">{children}</p>
}

export function Badge({ tone, children, title }: { tone: 'warn' | 'ok' | 'bad' | 'neutral' | 'info'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  )
}

export function Stat({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  emphasis?: boolean
}) {
  return (
    <div className={`stat${emphasis ? ' stat-emph' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value tnum">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function NeedsClear({ onRun, busy }: { onRun: () => void; busy: boolean }) {
  return (
    <div className="empty">
      <p>This view uses the cleared allocation. Run the clearing first.</p>
      <button className="btn btn-primary" onClick={onRun} disabled={busy}>
        {busy ? 'Clearing…' : 'Clear the market (default scenario)'}
      </button>
    </div>
  )
}

export function RunLine({
  params,
  stale,
  extra,
}: {
  params: Scenario
  stale?: boolean
  extra?: ReactNode
}) {
  return (
    <div className="runline small">
      <span>
        Region <strong>{params.region}</strong>
      </span>
      {params.sponsor && (
        <span>
          Portfolio <strong>{params.sponsor}</strong>
        </span>
      )}
      <span>{params.as_of ? <>as of <strong>{params.as_of}</strong></> : 'recruiting today'}</span>
      <span className="muted">
        β {params.beta === null ? 'default (full-sample estimate)' : params.beta} · site rates {params.low_history} · universe{' '}
        {params.universe} · activation lag {params.activation_lag} mo
        {params.overlap_scale !== 1 && <> · overlap ×{params.overlap_scale}</>}
        {params.capacity_scale !== 1 && <> · capacity ×{params.capacity_scale}</>}
      </span>
      {stale && <Badge tone="info">re-clearing…</Badge>}
      {extra}
    </div>
  )
}

/* =====================================================================================================================
   Calm building blocks for the view passes. Styles in calm.css. All of them work in both themes and both densities;
   none hides a control or a link in Simple mode (Simple moves secondary content into hover cards or a "Details"
   disclosure, never out of reach).
   ===================================================================================================================== */

/** Page title block: <h1>, an optional lede (one or two plain sentences) and an optional right-aligned meta line
 *  (e.g. "Registry snapshot: Oct 16, 2026", from the API's snapshot_date).
 *  Props: title (h1 text), lede?, meta?, children? (extra content under the lede, such as a banner). */
export function PageHead({ title, lede, meta, children }: { title: ReactNode; lede?: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-main">
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {meta && <p className="page-head-meta">{meta}</p>}
      {children && <div className="page-head-extra">{children}</div>}
    </header>
  )
}

/** A window: the white product surface (thin rule, 14 px radius) on the cool ground.
 *  Props: title? (bold, left of the optional header strip), meta? (muted text after the title, " · " separated),
 *  aside? (right side of the strip: a link such as "Open in demo ->" or a caution label), label? (aria-label for the
 *  region), flush? (no body padding, e.g. for an edge-to-edge table), as? ('section' | 'div' | 'article', default
 *  'section'), className?, id?. The strip shows only when title, meta or aside is given. */
export function Window({
  title,
  meta,
  aside,
  label,
  flush,
  as: Tag = 'section',
  className,
  id,
  children,
}: {
  title?: ReactNode
  meta?: ReactNode
  aside?: ReactNode
  label?: string
  flush?: boolean
  as?: 'section' | 'div' | 'article'
  className?: string
  id?: string
  children: ReactNode
}) {
  const strip = title || meta || aside
  return (
    <Tag className={`win${className ? ` ${className}` : ''}`} aria-label={label} id={id}>
      {strip && (
        <div className="win-strip">
          <span>
            {title && <span className="win-title">{title}</span>}
            {title && meta ? ' · ' : null}
            {meta}
          </span>
          {aside && <span className="win-aside">{aside}</span>}
        </div>
      )}
      <div className={flush ? 'win-body win-flush' : 'win-body'}>{children}</div>
    </Tag>
  )
}

/** A text mark that changes what a number means (Upper bound, Unreviewed, in-sample, held-out, post hoc, a CI).
 *  Always visible: in Simple mode it stays next to its number.
 *  Props: children (the words, e.g. "Upper bound"), mark? (a glyph before the words, e.g. "†"; decorative, the words
 *  carry the meaning), tone? ('caution' (default) for bounds and unreviewed data; 'muted' for neutral method notes
 *  such as "held-out"), info? (hover/focus card content explaining the mark; turns the words into a gloss). */
export function Qualifier({ children, mark, tone = 'caution', info }: { children: ReactNode; mark?: string; tone?: 'caution' | 'muted'; info?: ReactNode }) {
  return (
    <span className={`qual qual-${tone}`}>
      {mark && <span aria-hidden="true">{mark} </span>}
      {info ? <HoverCard content={info}>{children}</HoverCard> : children}
    </span>
  )
}

/** One key number with its label and an always-visible qualifier.
 *  Props: value (the number, already formatted; set in the mono face), label (what it counts), qualifier? (a
 *  <Qualifier> or short text shown right after it, never hidden), sub? (one muted line under it, e.g. "2.8x for a naive
 *  estimate"), layout? ('stack': label above a large value, the default; 'inline': "21 same-sponsor pairs" on one line),
 *  size? ('md' 1.125 rem, the Simple-mode figure; 'lg' 1.5 rem). */
export function KeyFigure({
  value,
  label,
  qualifier,
  sub,
  layout = 'stack',
  size = 'md',
}: {
  value: ReactNode
  label: ReactNode
  qualifier?: ReactNode
  sub?: ReactNode
  layout?: 'stack' | 'inline'
  size?: 'md' | 'lg'
}) {
  if (layout === 'inline')
    return (
      <p className={`kf kf-inline kf-${size}`}>
        <span className="kf-value num">{value}</span> <span className="kf-label">{label}</span>
        {qualifier && <> {qualifier}</>}
        {sub && <span className="kf-sub">{sub}</span>}
      </p>
    )
  return (
    <div className={`kf kf-stack kf-${size}`}>
      <div className="kf-label">{label}</div>
      <div className="kf-line">
        <span className="kf-value num">{value}</span>
        {qualifier && <span className="kf-q">{qualifier}</span>}
      </div>
      {sub && <div className="kf-sub">{sub}</div>}
    </div>
  )
}

/** The Calm "Details" disclosure (native <details>, keyboard and screen-reader ready).
 *  Props: summary? (the toggle's text, default "Details"), open? (initially open), children. */
export function Details({ summary = 'Details', open, className, children }: { summary?: ReactNode; open?: boolean; className?: string; children: ReactNode }) {
  return (
    <details className={`disclosure${className ? ` ${className}` : ''}`} open={open}>
      <summary>{summary}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  )
}

/** A Simple/Detailed-aware section in a window, laid out like the Calm mockups: the claim, one plain sentence and the
 *  visible qualifiers on the left; one compact real visual or key number on the right.
 *  Props:
 *  - title (string; the h2, also used for the info button's label "Details: {title}")
 *  - lede? (the one plain sentence)
 *  - qualifiers? (always-visible qualifier line(s) under the lede, e.g. "† 19 of the 21 are upper bounds")
 *  - info? (info card content behind the 2 rem "i" next to the title; shown in both modes)
 *  - figure? (the compact visual or KeyFigure(s), right column; full width when there is no lede)
 *  - caption? (the figure's caption; keep [always visible] qualifiers here, not in `details`)
 *  - details? (secondary tables, method notes, sources: inline under a rule in Detailed, inside a closed
 *    "Details" disclosure in Simple, so nothing is out of reach)
 *  - detailsLabel? (the disclosure's summary in Simple, default "Details")
 *  - children? (content shown in both modes, after the figure row, e.g. the view's controls)
 *  - id? (anchor id), headingLevel? (2 or 3, default 2). */
export function Section({
  id,
  title,
  lede,
  qualifiers,
  info,
  figure,
  caption,
  details,
  detailsLabel = 'Details',
  headingLevel = 2,
  children,
}: {
  id?: string
  title: string
  lede?: ReactNode
  qualifiers?: ReactNode
  info?: ReactNode
  figure?: ReactNode
  caption?: ReactNode
  details?: ReactNode
  detailsLabel?: ReactNode
  headingLevel?: 2 | 3
  children?: ReactNode
}) {
  const { density } = useDensity()
  const hid = useId()
  const H = headingLevel === 3 ? 'h3' : 'h2'
  const hasText = lede || qualifiers
  return (
    <section className="win section" id={id} aria-labelledby={hid}>
      <div className="win-body">
        <div className={`section-row${hasText && figure ? '' : ' section-row-single'}`}>
          <div className="section-text">
            <div className="section-title">
              <H id={hid}>{title}</H>
              {info && <InfoTip size="lg" label={`Details: ${title}`} content={info} />}
            </div>
            {lede && <p className="section-lede">{lede}</p>}
            {qualifiers && <div className="section-quals">{qualifiers}</div>}
          </div>
          {figure && (
            <figure className="section-figure">
              {figure}
              {caption && <figcaption>{caption}</figcaption>}
            </figure>
          )}
        </div>
        {children}
        {details &&
          (density === 'detailed' ? (
            <div className="section-details">{details}</div>
          ) : (
            <Details summary={detailsLabel} className="section-disclosure">
              {details}
            </Details>
          ))}
      </div>
    </section>
  )
}

/** A prominent note at the top of a view: the Financial tab's synthetic banner, the Site scores "In development"
 *  note, the Research "in-sample model outputs" note (copy deck B8). Shown in both densities.
 *  Props: tone? ('caution' default; 'info' for neutral notes), title? (bold lead-in), children. */
export function Banner({ tone = 'caution', title, children }: { tone?: 'caution' | 'info'; title?: ReactNode; children: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role="note">
      {title && <strong className="banner-title">{title}</strong>}
      <div className="banner-body">{children}</div>
    </div>
  )
}

/** A glossary term (copy deck B4) with its gloss in a hover/focus/tap card.
 *  Props: term (a GLOSSARY key), children? (the words shown; default the glossary's term). */
export function Gloss({ term, children }: { term: GlossaryKey; children?: ReactNode }) {
  const g = GLOSSARY[term]
  return (
    <HoverCard
      content={
        <>
          <span className="hc-title">{g.term}</span>
          {g.gloss}
        </>
      }
    >
      {children ?? g.term}
    </HoverCard>
  )
}

/** A segmented control (one choice of a few): the Calm .seg track with the selected option filled.
 *  Props: label (the group's aria-label), options ({ value, label, hint? }[]), value, onChange, className?. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string
  options: { value: T; label: ReactNode; hint?: string }[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={`seg seg-inline${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="seg-btn" aria-pressed={value === o.value} title={o.hint} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export { Detailed, SimpleOnly } from './density'
export { HoverCard, InfoTip } from './hovercard'
