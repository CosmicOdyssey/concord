// Site scores: historical, registry-based site enrollment scores, how each one is formed (prior -> data ->
// posterior -> low-history cap -> final -> calibrated), and how the scores did against observed enrollment.
// Not forecasts for a new trial and not a list of sites to pick: the default order is history depth, and every
// score is shown with its interval and its calibrated value.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Badge, ErrorBox, Loading } from '../components'
import { ctgovUrl, int, phaseLabel } from '../format'
import {
  fixed,
  listQuery,
  ordinal,
  rate,
  siteScoresApi,
  type Bucket,
  type ContribTrial,
  type HistBin,
  type ListParams,
  type SiteDetail,
  type SiteList,
  type SiteRow,
  type Summary,
  type Validation,
  type ValidationBlock,
} from '../siteScoresApi'
import './siteScores.css'

type Async<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; data: T }

const PAGE = 20
const TRIALS_SHOWN = 15
const MIN_TRIALS = [
  { v: 1, label: '1 or more' },
  { v: 2, label: '2 or more' },
  { v: 3, label: '3 or more (no cap)' },
  { v: 6, label: '6 or more' },
  { v: 21, label: '21 or more' },
]
const DEFAULT_SORT = '-n_fit'

function useFetch<T>(key: string | null, fn: (signal: AbortSignal) => Promise<T>): [Async<T>, () => void] {
  const [state, setState] = useState<Async<T>>({ status: 'idle' })
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  useEffect(() => {
    if (key === null) return
    const ctl = new AbortController()
    setState((s) => (s.status === 'ok' ? s : { status: 'loading' }))
    fnRef.current(ctl.signal)
      .then((data) => {
        if (!ctl.signal.aborted) setState({ status: 'ok', data })
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctl.abort()
  }, [key, tick])
  return [state, () => setTick((t) => t + 1)]
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

/** Width of an element, tracked with a ResizeObserver (charts draw at real pixel size so text never scales). */
function useWidth(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!el) return
    // observe() reports the initial size too.
    const ro = new ResizeObserver((entries) => setW(Math.floor(entries[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, w]
}

/** A horizontal table scroller that shows when columns sit beyond its edge: a fade on the side with hidden
 *  columns, and a one-line hint whenever the table is wider than its box (stable, so nothing shifts on scroll). */
function ScrollX({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [st, setSt] = useState({ over: false, l: false, r: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      const next = { over: max > 1, l: el.scrollLeft > 1, r: el.scrollLeft < max - 1 }
      setSt((s) => (s.over === next.over && s.l === next.l && s.r === next.r ? s : next))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    for (const c of Array.from(el.children)) ro.observe(c)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])
  return (
    <div className={`ss-scrollx${st.over && st.l ? ' ss-more-l' : ''}${st.over && st.r ? ' ss-more-r' : ''}`}>
      {st.over && (
        <div className="ss-scroll-hint small muted" aria-hidden="true">
          Scroll sideways for more columns &rarr;
        </div>
      )}
      <div className="table-scroll" ref={ref} tabIndex={st.over ? 0 : undefined} role="region" aria-label={label}>
        {children}
      </div>
    </div>
  )
}

function siteFromHash(): string | null {
  const m = window.location.hash.match(/^#site-scores\/([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]) : null
}

/** Keep the address bar on #site-scores/<site_id> so a reload or a shared link reopens the same site. */
function writeHash(id: string) {
  try {
    if (/^#site-scores(\/|$)/i.test(window.location.hash) && siteFromHash() !== id)
      window.history.replaceState(null, '', `#site-scores/${encodeURIComponent(id)}`)
  } catch {
    /* ignore */
  }
}

function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }
}

const place = (city: string | null, state: string | null) => [city, state].filter(Boolean).join(', ')
const perMonth = (x: number | null | undefined) => `${rate(x)} / mo`

export default function SiteScoresView() {
  const [summary, retrySummary] = useFetch<Summary>('summary', (s) => siteScoresApi.summary(s))
  const [selected, setSelected] = useState<string | null>(() => siteFromHash())

  const [region, setRegion] = useState('US')
  const [stateF, setStateF] = useState('')
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 250)
  const [minTrials, setMinTrials] = useState(1)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [offset, setOffset] = useState(0)
  const params: ListParams = { region, state: stateF, q: dq, min_trials: minTrials, sort, limit: PAGE, offset }
  const [list, retryList] = useFetch<SiteList>(listQuery(params), (s) => siteScoresApi.list(params, s))

  const preset = summary.status === 'ok' ? (summary.data.preset?.site_id ?? null) : null
  const siteId = selected ?? preset
  const [detail, retryDetail] = useFetch<SiteDetail>(siteId, (s) => siteScoresApi.site(siteId ?? '', s))

  const breakdownRef = useRef<HTMLDivElement>(null)
  // A deep link (#site-scores/<site_id>) scrolls to that site's breakdown once it has loaded.
  const scrollOnLoad = useRef(siteFromHash() !== null)
  const loadedId = detail.status === 'ok' ? detail.data.site.site_id : null
  const ready = summary.status === 'ok' // the breakdown card exists only once the summary has loaded
  useEffect(() => {
    if (!scrollOnLoad.current || !ready || loadedId === null || loadedId !== selected) return
    const el = breakdownRef.current
    if (!el) return
    scrollOnLoad.current = false
    el.scrollIntoView({ block: 'start' })
    // The histogram above sizes itself after the first paint and can push the card down: scroll once more, unless
    // the reader has started scrolling.
    const id = window.setTimeout(() => {
      const top = el.getBoundingClientRect().top
      if (top < -2 || top > 120) el.scrollIntoView({ block: 'start' })
    }, 300)
    const cancel = () => window.clearTimeout(id)
    const opts = { once: true, passive: true } as const
    window.addEventListener('wheel', cancel, opts)
    window.addEventListener('touchstart', cancel, opts)
    window.addEventListener('keydown', cancel, { once: true })
    return () => {
      cancel()
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchstart', cancel)
      window.removeEventListener('keydown', cancel)
    }
  }, [loadedId, selected, ready])
  useEffect(() => {
    const on = () => {
      const id = siteFromHash()
      if (id) {
        scrollOnLoad.current = true
        setSelected(id)
      }
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const pick = useCallback((id: string) => {
    setSelected(id)
    writeHash(id)
    const el = breakdownRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      if (r.top < 0 || r.top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setOffset(0)
  }

  if (summary.status === 'error') return <ErrorBox error={summary.error} onRetry={retrySummary} />
  if (summary.status !== 'ok') return <Loading label="Loading site scores…" hint="First load fits the site model once (a few seconds)." />
  const S = summary.data
  const d = detail.status === 'ok' ? detail.data : null

  return (
    <div className="view ss">
      <header className="view-head">
        <h1>Site scores</h1>
        <p className="lede">
          A site&rsquo;s score is its <strong>historical patients per month per trial</strong>, from completed lung-cancer
          trials on ClinicalTrials.gov. It describes how past trials enrolled at that site. It is{' '}
          <strong>not a forecast for a new trial</strong>, and the site list below is ordered by how much history a site
          has, not by score.
        </p>
      </header>

      <section className="ss-top">
        <WhatCard S={S} />
        <ValidationCard v={S.validation} S={S} />
      </section>

      <Distribution S={S} selected={d} />

      <section className="ss-md">
        <div className="card ss-list">
          <div className="section-head">
            <h2>Sites</h2>
            <span className="small muted">
              {list.status === 'ok' ? `${int(list.data.total)} U.S. sites` : ''} with at least one fitted trial
            </span>
          </div>
          <Filters
            S={S}
            region={region}
            setRegion={resetPage((v: string) => {
              setRegion(v)
              const states = S.region_states[v]
              if (states && stateF && !states.includes(stateF)) setStateF('')
            })}
            stateF={stateF}
            setStateF={resetPage(setStateF)}
            q={q}
            setQ={resetPage(setQ)}
            minTrials={minTrials}
            setMinTrials={resetPage(setMinTrials)}
          />
          {['score', 'calibrated', 'percentile'].includes(sort.replace(/^-/, '')) && <SortNote S={S} />}
          {list.status === 'error' ? (
            <ErrorBox error={list.error} onRetry={retryList} />
          ) : list.status === 'ok' ? (
            <SiteTable
              data={list.data}
              S={S}
              sort={sort}
              onSort={(s) => {
                setSort(s)
                setOffset(0)
              }}
              selected={siteId}
              onPick={pick}
              onPage={setOffset}
            />
          ) : (
            <Loading label="Loading sites…" />
          )}
        </div>

        <div className="card ss-breakdown" ref={breakdownRef} aria-live="polite">
          {detail.status === 'error' ? (
            <ErrorBox error={detail.error} onRetry={retryDetail} />
          ) : d ? (
            <Breakdown d={d} S={S} stale={d.site.site_id !== siteId} isPreset={!selected} />
          ) : (
            <Loading label="Loading the breakdown…" />
          )}
        </div>
      </section>

      {d && <Contributing key={d.site.site_id} d={d} stale={d.site.site_id !== siteId} />}
    </div>
  )
}

/** Shown while the table is sorted by score. The overstatement (1 / b) is on the log scale: a raw ratio R between
 *  two scores becomes R^b between calibrated scores, not R / (1 / b). */
function SortNote({ S }: { S: Summary }) {
  const b = S.calibration?.b ?? null
  const over = S.validation?.industry_phase2_3.overstatement ?? null
  return (
    <p className="ss-sortnote small">
      Sorted by historical score. Not a forecast for a new trial.
      {over !== null && b !== null ? (
        <>
          {' '}
          Differences in <em>log</em> score between sites are overstated about {over.toFixed(0)}x (see the validation
          above). On the log scale, not as a division of ratios: a 10x ratio between two raw scores is about{' '}
          {(10 ** b).toFixed(1)}x between their calibrated scores (10^{fixed(b)}).
        </>
      ) : null}
    </p>
  )
}

/* ---------- top: what a score is ---------- */

function WhatCard({ S }: { S: Summary }) {
  const c = S.consistency
  return (
    <div className="card ss-what">
      <h2>How a score is formed</h2>
      <ol className="ss-mini">
        <li>
          <strong>History.</strong> {int(S.fit.history_trials)} completed lung trials that report actual enrollment and an
          actual primary completion date, at {int(S.fit.fitted_sites)} sites worldwide; {int(S.us.sites)} of them are
          identifiable U.S. sites (listed below).
        </li>
        <li>
          <strong>Split.</strong> The registry reports enrollment per trial, not per site, so each trial&rsquo;s
          enrollment is split across its registered sites in proportion to the sites&rsquo; current rates ({S.fit.iters}{' '}
          rounds).
        </li>
        <li>
          <strong>Shrink.</strong> Each site&rsquo;s rate combines a prior fitted to all trials (mean {perMonth(S.prior.mean)})
          with the patients allocated to the site over its exposure months ({fixed(S.fit.enroll_fraction * 100, 0)}% of
          each trial&rsquo;s start-to-primary-completion time). More exposure, less prior.
        </li>
        <li>
          <strong>Cap.</strong> Sites with fewer than {S.fit.low_history_n} fitted trials are held at or below the
          prior&rsquo;s {fixed(S.fit.low_history_q * 100, 0)}th percentile ({perMonth(S.prior.p25)}), the rate also used
          for sites with no history.
        </li>
      </ol>
      <details className="ss-details">
        <summary>The method in one paragraph</summary>
        <p className="small">{S.method}</p>
      </details>
      <p className="small muted ss-consistency">
        These numbers are recomputed from the fit and match the app&rsquo;s stored scores ({c.against}) for all{' '}
        {int(c.compared)} fitted sites; largest difference {c.max_abs_diff === 0 ? '0' : c.max_abs_diff.toExponential(1)}.
      </p>
    </div>
  )
}

/* ---------- top: validation ---------- */

function ValidationCard({ v, S }: { v: Validation | null; S: Summary }) {
  if (!v)
    return (
      <div className="card ss-valid">
        <h2>Checked against observed enrollment</h2>
        <p className="note small">
          The validation file (data/findings/selection_validation.json) is missing, so calibrated scores are not shown.
          Run <code>python -m concord.analysis.selection_validation</code> to produce it.
        </p>
      </div>
    )
  const rows = [
    { key: 'ind', label: 'Industry Phase II/III', b: v.industry_phase2_3, primary: true },
    ...(v.all_trials ? [{ key: 'all', label: 'All completed lung trials', b: v.all_trials, primary: false }] : []),
  ]
  return (
    <div className="card ss-valid">
      <h2>Checked against observed enrollment</h2>
      <p className="small ss-valid-how">
        Scores fit only on trials that started before {v.cutoff.slice(0, 4)} ({int(v.fit_trials)} trials) were applied to
        the registered site lists of completed trials that started in {v.cutoff.slice(0, 4)} or later. Slope of each
        trial&rsquo;s actual log enrollment per site-month on its log mean site score, with phase, site-count and
        start-year controls.
      </p>
      <SlopePlot rows={rows} />
      <p className="ss-reading">{v.reading}</p>
      {S.calibration && (
        <p className="small ss-calib-def">
          <strong>Calibrated score</strong> = exp(m + b &times; (log score &minus; m)), with b = {fixed(S.calibration.b)}{' '}
          [{fixed(S.calibration.b_ci[0])}, {fixed(S.calibration.b_ci[1])}] and m = log {rate(S.calibration.geo_mean)}, the
          mean log score of the {int(S.us.sites)} U.S. sites (geometric mean {perMonth(S.calibration.geo_mean)}).
        </p>
      )}
      <p className="small muted">
        Source: <code>{v.source}</code> (from <code>{v.script}</code>). An observational check of the scores, not a test
        of choosing different sites.
      </p>
    </div>
  )
}

function SlopePlot({ rows }: { rows: { key: string; label: string; b: ValidationBlock; primary: boolean }[] }) {
  const MAX = 1.1
  const x = (v: number) => `${(Math.max(0, Math.min(MAX, v)) / MAX) * 100}%`
  return (
    <div className="ss-slope" role="img" aria-label={rows.map((r) => `${r.label}: slope ${fixed(r.b.slope)}, 95% CI ${fixed(r.b.ci95[0])} to ${fixed(r.b.ci95[1])}, ${r.b.n} trials`).join('; ')}>
      {rows.map((r) => (
        <div key={r.key} className={`ss-slope-row${r.primary ? ' ss-slope-primary' : ''}`}>
          <div className="ss-slope-head">
            <span>
              {r.label} <span className="muted">· {int(r.b.n)} trials</span>
            </span>
            <span className="tnum">
              <strong>{fixed(r.b.slope)}</strong> <span className="muted">[{fixed(r.b.ci95[0])}, {fixed(r.b.ci95[1])}]</span>
            </span>
          </div>
          <div className="ss-slope-track">
            <span className="ss-slope-ref" style={{ left: x(0) }} />
            <span className="ss-slope-ref ss-slope-ref-one" style={{ left: x(1) }} />
            <span className="ss-slope-ci" style={{ left: x(r.b.ci95[0]), width: `calc(${x(r.b.ci95[1])} - ${x(r.b.ci95[0])})` }} />
            <span className="ss-slope-dot" style={{ left: x(r.b.slope) }} />
          </div>
        </div>
      ))}
      <div className="ss-slope-axis small muted">
        <span style={{ left: x(0) }}>0 · no signal</span>
        <span style={{ left: x(0.5) }}>0.5</span>
        <span style={{ left: x(1) }}>1 · calibrated</span>
      </div>
    </div>
  )
}

/* ---------- distribution ---------- */

/** What the bucket medians show about depth, read off the numbers (no claim that scores fall steadily with depth:
 *  the deepest bucket's median is above the middle one's). */
function depthNote(buckets: Bucket[]): string | null {
  const med = (b: Bucket) => b.median_score
  const low = buckets.filter((b) => b.low_history && med(b) !== null)
  const deep = buckets.filter((b) => !b.low_history && med(b) !== null)
  if (!low.length || !deep.length) return null
  const lowMin = Math.min(...low.map((b) => med(b) as number))
  const deepMax = Math.max(...deep.map((b) => med(b) as number))
  if (deepMax >= lowMin) return null
  return (
    `Every bucket with 3 or more fitted trials has a lower median (${deep.map((b) => `${b.label}: ${rate(med(b))}`).join(', ')}) ` +
    `than the 1–2 trial buckets (${low.map((b) => `${b.label}: ${rate(med(b))}`).join(', ')}), which are held at or below the cap. ` +
    'Sites that took part in many large multi-site trials receive a small share of each, and the cap is still above most ' +
    'of their scores, so a capped score says little about how a little-known site compares with them. That is why capped ' +
    'sites get no percentile.'
  )
}

function Distribution({ S, selected }: { S: Summary; selected: SiteDetail | null }) {
  const lowShare = S.us.sites ? S.us.low_history / S.us.sites : 0
  const depth = depthNote(S.buckets)
  return (
    <section className="card ss-dist">
      <div className="section-head">
        <h2>How scores are distributed</h2>
        <span className="small muted">{int(S.us.sites)} U.S. sites with at least one fitted trial</span>
      </div>
      <div className="ss-dist-grid">
        <Histogram bins={S.histogram.bins} cap={S.prior.p25} site={selected?.site.in_us_list ? selected : null} />
        <BucketTable buckets={S.buckets} lowN={S.fit.low_history_n} />
      </div>
      <p className="caveat">
        {int(S.us.low_history)} of {int(S.us.sites)} sites ({fixed(lowShare * 100, 0)}%) have fewer than{' '}
        {S.fit.low_history_n} fitted trials. Their scores rest on the split of one or two trials, which is noisy, and on the
        model&rsquo;s backtest the uncapped model&rsquo;s optimism came from sites it barely knew. So the cap holds them
        at or below {perMonth(S.prior.p25)}; it lowered {int(S.us.capped)} of them, which is the spike in the histogram.
        The cap is a ceiling, not a floor.{depth ? ` ${depth}` : ''}
      </p>
    </section>
  )
}

const LOG_TICKS = [-3, -2, -1, 0, 1, 2]
/** Decade tick labels: 0.001, 0.01, 0.1, 1, 10. */
const decade = (t: number) => (t >= 0 ? String(10 ** t) : (10 ** t).toFixed(-t))

function Histogram({ bins, cap, site }: { bins: HistBin[]; cap: number; site: SiteDetail | null }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const H = 210
  const M = { l: 40, r: 10, t: 22, b: 30 }
  const lo = bins[0]?.lo ?? -3
  const hi = bins[bins.length - 1]?.hi ?? 1
  const W = Math.max(width, 260)
  const iw = W - M.l - M.r
  const ih = H - M.t - M.b
  const total = (b: HistBin) => b.low_history + b.history_3plus
  const peak = Math.max(1, ...bins.map(total))
  const step = niceStep(peak / 4)
  const ymax = Math.ceil(peak / step) * step
  const xs = (v: number) => M.l + ((v - lo) / (hi - lo)) * iw
  const ys = (n: number) => M.t + ih - (n / ymax) * ih
  const bw = iw / bins.length
  const capX = xs(Math.log10(cap))
  const siteX = site ? xs(Math.log10(site.score)) : null
  const hb = hover !== null ? bins[hover] : null
  return (
    <figure className="ss-hist" ref={ref}>
      <figcaption className="ss-legend small">
        <span>
          <i className="sw ss-sw-rich" /> 3 or more fitted trials
        </span>
        <span>
          <i className="sw ss-sw-low" /> 1&ndash;2 fitted trials (low history)
        </span>
        <span className="muted">log scale, patients per month per trial</span>
      </figcaption>
      {width > 0 && (
        <svg width={W} height={H} role="img" aria-label="Histogram of U.S. site scores on a log scale" onPointerLeave={() => setHover(null)}>
          {Array.from({ length: Math.round(ymax / step) + 1 }, (_, i) => i * step).map((v) => (
            <g key={v}>
              <line className="ss-grid" x1={M.l} x2={W - M.r} y1={ys(v)} y2={ys(v)} />
              <text className="ss-axis-text" x={M.l - 6} y={ys(v) + 4} textAnchor="end">
                {v >= 1000 ? `${v / 1000}K` : v}
              </text>
            </g>
          ))}
          {LOG_TICKS.filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9).map((t) => (
            <text key={t} className="ss-axis-text" x={xs(t)} y={H - 10} textAnchor="middle">
              {decade(t)}
            </text>
          ))}
          {bins.map((b, i) => {
            const x0 = M.l + i * bw + 1
            const w = Math.max(1, bw - 2)
            const yr = ys(b.history_3plus)
            const yl = ys(total(b))
            const on = hover === i
            return (
              <g key={i} className={on ? 'ss-bin-on' : undefined}>
                {b.history_3plus > 0 && <path className="ss-bar-rich" d={barPath(x0, yr, w, ys(0) - yr, b.low_history === 0)} />}
                {b.low_history > 0 && (
                  <path className="ss-bar-low" d={barPath(x0, yl, w, Math.max(0.5, yr - yl - (b.history_3plus > 0 ? 2 : 0)), true)} />
                )}
                <rect
                  className="ss-hit"
                  x={M.l + i * bw}
                  y={M.t}
                  width={bw}
                  height={ih}
                  tabIndex={0}
                  aria-label={`${rate(10 ** b.lo)} to ${rate(10 ** b.hi)} per month: ${b.history_3plus} sites with 3 or more fitted trials, ${b.low_history} low-history sites`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            )
          })}
          <line className="ss-axis" x1={M.l} x2={W - M.r} y1={ys(0)} y2={ys(0)} />
          <line className="ss-mark-cap" x1={capX} x2={capX} y1={M.t - 6} y2={ys(0)} />
          <text className="ss-mark-text" x={capX + 4} y={M.t - 8}>
            cap {rate(cap)}
          </text>
          {siteX !== null && site && (
            <>
              <line className="ss-mark-site" x1={siteX} x2={siteX} y1={M.t + 8} y2={ys(0)} />
              <text className="ss-mark-text ss-mark-site-text" x={siteX + (siteX > W - 120 ? -4 : 4)} y={M.t + 12} textAnchor={siteX > W - 120 ? 'end' : 'start'}>
                {shortName(site.site.facility)}
              </text>
            </>
          )}
        </svg>
      )}
      {hb && hover !== null && (
        <div className="ss-tip" style={{ left: Math.min(Math.max(M.l + (hover + 0.5) * bw, 80), W - 80) }}>
          <div className="ss-tip-title">
            {rate(10 ** hb.lo)} to {rate(10 ** hb.hi)} / mo
          </div>
          <div>
            <i className="ss-key ss-key-rich" /> <strong>{int(hb.history_3plus)}</strong> sites, 3+ fitted trials
          </div>
          <div>
            <i className="ss-key ss-key-low" /> <strong>{int(hb.low_history)}</strong> sites, low history
          </div>
        </div>
      )}
      <details className="ss-details small">
        <summary>Histogram as a table</summary>
        <ScrollX label="Histogram of U.S. site scores as a table">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>Score range / mo</th>
                <th className="num">3+ fitted trials</th>
                <th className="num">Low history</th>
              </tr>
            </thead>
            <tbody>
              {bins.map((b) => (
                <tr key={b.lo}>
                  <td className="tnum">
                    {rate(10 ** b.lo)} to {rate(10 ** b.hi)}
                  </td>
                  <td className="num">{int(b.history_3plus)}</td>
                  <td className="num">{int(b.low_history)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </details>
    </figure>
  )
}

function niceStep(x: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x) return m * p
  return 10 * p
}

/** A column with a 4px rounded data end (top) and a square baseline. */
function barPath(x: number, y: number, w: number, h: number, roundTop: boolean): string {
  const r = roundTop ? Math.min(4, w / 2, h) : 0
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function shortName(s: string | null): string {
  const t = s ?? 'this site'
  return t.length > 28 ? `${t.slice(0, 26)}…` : t
}

/** A column header with a shorter form below 560 px, so the bucket table fits a phone without scrolling. */
function ShortLabel({ long, short }: { long: string; short: string }) {
  return (
    <>
      <span className="ss-h-long">{long}</span>
      <span className="ss-h-short">{short}</span>
    </>
  )
}

function BucketTable({ buckets, lowN }: { buckets: Bucket[]; lowN: number }) {
  return (
    <div className="ss-buckets">
      <h3>By history depth</h3>
      <ScrollX label="Sites by history depth">
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              <th title="Fitted trials">
                <ShortLabel long="Fitted trials" short="Trials" />
              </th>
              <th className="num">Sites</th>
              <th className="num" title="Median final score, after the low-history cap">
                <ShortLabel long="Median score" short="Median" />
              </th>
              <th className="num" title="Median posterior mean, before the cap">
                <ShortLabel long="Before cap" short="Pre-cap" />
              </th>
              <th className="num" title="Sites whose score the cap lowered">
                <ShortLabel long="Lowered by cap" short="Capped" />
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.label}>
                <td>
                  {b.label} {b.low_history && <Badge tone="warn">low history</Badge>}
                </td>
                <td className="num">{int(b.sites)}</td>
                <td className="num">{rate(b.median_score)}</td>
                <td className="num">{rate(b.median_posterior_mean)}</td>
                <td className="num">{b.low_history ? int(b.capped) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
      <p className="small muted">
        Medians in patients per month per trial. The cap applies only below {lowN} fitted trials.
      </p>
    </div>
  )
}

/* ---------- site list ---------- */

function Filters(p: {
  S: Summary
  region: string
  setRegion: (v: string) => void
  stateF: string
  setStateF: (v: string) => void
  q: string
  setQ: (v: string) => void
  minTrials: number
  setMinTrials: (v: number) => void
}) {
  const inRegion = p.S.region_states[p.region]
  const states = p.S.states.filter((s) => !inRegion || inRegion.includes(s.state))
  return (
    <div className="ss-filters">
      <label className="field">
        <span className="field-label">Region</span>
        <select value={p.region} onChange={(e) => p.setRegion(e.target.value)}>
          {p.S.regions.map((r) => (
            <option key={r} value={r}>
              {r === 'US' ? 'All U.S.' : r.replace('US-', '')}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">State</span>
        <select value={p.stateF} onChange={(e) => p.setStateF(e.target.value)}>
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s.state} value={s.state}>
              {s.state} ({s.sites})
            </option>
          ))}
        </select>
      </label>
      <label className="field ss-search">
        <span className="field-label">Search</span>
        <input type="search" value={p.q} placeholder="Facility or city" onChange={(e) => p.setQ(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Fitted trials</span>
        <select value={p.minTrials} onChange={(e) => p.setMinTrials(Number(e.target.value))}>
          {MIN_TRIALS.map((m) => (
            <option key={m.v} value={m.v}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function SortTh({ k, label, sort, onSort, num, title, className }: { k: string; label: ReactNode; sort: string; onSort: (s: string) => void; num?: boolean; title?: string; className?: string }) {
  const active = sort.replace(/^-/, '') === k
  const desc = sort.startsWith('-')
  const next = active ? (desc ? k : `-${k}`) : num ? `-${k}` : k
  return (
    <th className={`sortable${num ? ' num' : ''}${className ? ` ${className}` : ''}`} aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'} title={title}>
      <button type="button" onClick={() => onSort(next)}>
        {label}
        <span className="sort-ind">{active ? (desc ? '▼' : '▲') : ''}</span>
      </button>
    </th>
  )
}

function SiteTable({ data, S, sort, onSort, selected, onPick, onPage }: { data: SiteList; S: Summary; sort: string; onSort: (s: string) => void; selected: string | null; onPick: (id: string) => void; onPage: (o: number) => void }) {
  const cal = data.calibration
  const from = data.total ? data.offset + 1 : 0
  const to = Math.min(data.offset + data.limit, data.total)
  const atCapTitle =
    `All ${int(S.us.at_cap)} capped sites share the cap value ${rate(S.prior.p25)}; as a percentile that would be the ` +
    `${ordinal(S.us.cap_percentile)}, above most sites with 3 or more fitted trials, so capped sites get none`
  return (
    <>
      <ScrollX label="U.S. sites with fitted trials">
        <table className="tbl ss-sites">
          <thead>
            <tr>
              <SortTh k="facility" label="Site" sort={sort} onSort={onSort} />
              <SortTh k="n_fit" label="Fitted trials" sort={sort} onSort={onSort} num title="Completed trials in the fit (of lifetime lung trials)" />
              <SortTh k="score" label="Score / mo" sort={sort} onSort={onSort} num title="Historical patients per month per trial, with a 10th to 90th percentile range that includes how much the site's rate varies from trial to trial" />
              {cal && (
                <SortTh
                  k="calibrated"
                  label={<>Calibrated</>}
                  sort={sort}
                  onSort={onSort}
                  num
                  className="ss-col-wide"
                  title={`exp(m + b(log score - m)), b = ${fixed(cal.b)} [${fixed(cal.b_ci[0])}, ${fixed(cal.b_ci[1])}]`}
                />
              )}
              <SortTh k="percentile" label="Pctile" sort={sort} onSort={onSort} num className="ss-col-wide" title="Percentile of the score among U.S. fitted sites; none for capped sites, which all tie at the cap" />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <SiteTr key={r.site_id} r={r} on={r.site_id === selected} onPick={onPick} showCal={!!cal} atCapTitle={atCapTitle} />
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={cal ? 5 : 4} className="muted">
                  No sites match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollX>
      <div className="ss-pager small">
        <span className="muted tnum">
          {int(from)}&ndash;{int(to)} of {int(data.total)}
        </span>
        <button className="btn btn-small" disabled={data.offset === 0} onClick={() => onPage(Math.max(0, data.offset - data.limit))}>
          Previous
        </button>
        <button className="btn btn-small" disabled={to >= data.total} onClick={() => onPage(data.offset + data.limit)}>
          Next
        </button>
      </div>
      <p className="small muted ss-calnote">
        {cal && (
          <>
            Calibrated: b = {fixed(cal.b)} [{fixed(cal.b_ci[0])}, {fixed(cal.b_ci[1])}], {cal.b_label}, n {int(cal.b_n)}.{' '}
          </>
        )}
        <IntervalNote S={S} /> Capped sites (<em>at cap</em>) all share one value, {rate(S.prior.p25)}, so they get no
        percentile.
      </p>
    </>
  )
}

/** What the score ranges include and what they leave out (the note under the table). */
function IntervalNote({ S }: { S: Summary }) {
  const h = S.heterogeneity
  if (!h || h.fallback || h.inv_k === null)
    return (
      <>
        Score ranges are 10th&ndash;90th percentiles that treat the allocated patients as exact counts (trial-to-trial
        variation could not be measured), so they are narrower than the real uncertainty.
      </>
    )
  return (
    <>
      Score ranges are 10th&ndash;90th percentiles that include how much a site&rsquo;s rate varies from one trial to
      the next (1/k = {fixed(h.inv_k)}
      {h.inv_k_ci95 ? ` [${fixed(h.inv_k_ci95[0])}, ${fixed(h.inv_k_ci95[1])}]` : ''}, one value for all sites, measured
      on {int(h.sites_used)} sites with {h.min_trials} or more fitted trials). They still take each trial&rsquo;s split
      across its sites as given, so systematic error in that split is not in them.
    </>
  )
}

function Pct({ r, atCapTitle }: { r: SiteRow; atCapTitle: string }) {
  if (r.percentile_status === 'tied_at_cap')
    return (
      <span className="ss-atcap" title={atCapTitle}>
        at cap
      </span>
    )
  return <>{ordinal(r.percentile)}</>
}

function SiteTr({ r, on, onPick, showCal, atCapTitle }: { r: SiteRow; on: boolean; onPick: (id: string) => void; showCal: boolean; atCapTitle: string }) {
  const pick = () => onPick(r.site_id)
  return (
    <tr className={`clickable${on ? ' row-on' : ''}`} tabIndex={0} onClick={pick} onKeyDown={onActivate(pick)} aria-selected={on}>
      <td className="ss-site-cell">
        <div className="ss-site-name">{r.facility}</div>
        <div className="small muted">{place(r.city, r.state)}</div>
        <SiteBadges amc={r.is_amc} low={r.low_history} capped={r.capped} />
      </td>
      <td className="num">
        <div>{int(r.n_fit)}</div>
        <div className="small muted">of {int(r.n_hist)}</div>
      </td>
      <td className="num">
        <div>{rate(r.score)}</div>
        <div
          className={`small muted${r.capped ? ' ss-iv-capped' : ''}`}
          title={
            r.capped
              ? 'Range around the posterior mean before the cap (10th to 90th percentile, including trial-to-trial variation); the capped score is set by the cap, not by this range'
              : '10th to 90th percentile, including how much this site’s rate varies from trial to trial'
          }
        >
          {rate(r.interval[0])}&ndash;{rate(r.interval[1])}
        </div>
        {/* Below 560 px the Calibrated and Pctile columns fold in here, so nothing sits off-screen on a phone. */}
        <div className="ss-stack small">
          {showCal && <div>cal. {rate(r.calibrated)}</div>}
          <div>
            {r.percentile_status === 'tied_at_cap' ? <Pct r={r} atCapTitle={atCapTitle} /> : <>{ordinal(r.percentile)} pctile</>}
          </div>
        </div>
      </td>
      {showCal && <td className="num ss-col-wide">{rate(r.calibrated)}</td>}
      <td className="num ss-col-wide">
        <Pct r={r} atCapTitle={atCapTitle} />
      </td>
    </tr>
  )
}

function SiteBadges({ amc, low, capped }: { amc: boolean; low: boolean; capped: boolean }) {
  if (!amc && !low) return null
  return (
    <div className="ss-badges">
      {amc && <Badge tone="info">Academic</Badge>}
      {capped ? (
        <Badge tone="warn" title="Fewer than 3 fitted trials: score capped at the prior's 25th percentile">
          Low history, capped
        </Badge>
      ) : low ? (
        <Badge tone="warn" title="Fewer than 3 fitted trials; the posterior mean is already below the cap">
          Low history
        </Badge>
      ) : null}
    </div>
  )
}

/* ---------- breakdown ---------- */

function Breakdown({ d, S, stale, isPreset }: { d: SiteDetail; S: Summary; stale: boolean; isPreset: boolean }) {
  const { prior, data, posterior: post, cap, calibrated: cal, history: h } = d
  const w = data.data_weight
  const nUS = int(d.us_fitted_sites)
  const pct: Record<SiteDetail['percentile_status'], { value: string; sub: string }> = {
    ok: { value: ordinal(d.percentile), sub: `among ${nUS} U.S. fitted sites` },
    tied_at_cap: { value: 'at cap', sub: `tied with ${int(d.us_at_cap)} capped U.S. sites: no percentile` },
    no_fitted_trials: { value: '—', sub: `no fitted trials: not among the ${nUS} U.S. fitted sites` },
    outside_us: { value: '—', sub: 'outside the U.S.: percentiles cover U.S. sites only' },
  }
  const fig = pct[d.percentile_status]
  const unseen = h.n_fit === 0
  return (
    <div className={stale ? 'ss-stale' : undefined}>
      <div className="ss-bd-head">
        <div className="small muted">{isPreset ? `Example site (${S.preset?.basis ?? 'chosen by fitted trials'})` : 'Selected site'}</div>
        <h2 className="ss-bd-title">{d.site.facility}</h2>
        <div className="small muted">
          {place(d.site.city, d.site.state)}
          {d.site.country && d.site.country !== 'United States' ? `, ${d.site.country}` : ''}
        </div>
        <SiteBadges amc={d.site.is_amc} low={cap.low_history} capped={cap.applied} />
      </div>

      <div className="ss-figs">
        <div className="ss-fig">
          <div className="stat-label">Score</div>
          <div className="ss-fig-value">{rate(d.score)}</div>
          <div className="small muted">{unseen ? 'unseen-site rate (no fitted trials)' : 'patients / month / trial, historical'}</div>
        </div>
        {cal && (
          <div className="ss-fig">
            <div className="stat-label">Calibrated</div>
            <div className="ss-fig-value">{rate(cal.value)}</div>
            <div className="small muted">
              b = {fixed(cal.b)} [{fixed(cal.b_ci[0])}, {fixed(cal.b_ci[1])}]
              {cal.relative_to_us_mean && <>; relative to the U.S. mean</>}
            </div>
          </div>
        )}
        <div className="ss-fig">
          <div className="stat-label">Percentile</div>
          <div className="ss-fig-value">{fig.value}</div>
          <div className="small muted">{fig.sub}</div>
        </div>
        <div className="ss-fig">
          <div className="stat-label">History</div>
          <div className="ss-fig-value">{int(h.n_fit)}</div>
          <div className="small muted">fitted of {int(h.n_hist)} lung trials</div>
        </div>
      </div>

      <IntervalStrip d={d} />

      <h3>How this score is formed</h3>
      <ol className="ss-steps">
        <Step n={1} title="Prior" value={perMonth(prior.mean)}>
          Gamma(&alpha; {fixed(prior.alpha, 3)}, &beta; {fixed(prior.beta, 3)}), fitted to the per-site rates of{' '}
          {int(prior.trials_used)} trials (5&ndash;95% trimmed). Every site starts here; its 25th percentile is{' '}
          {perMonth(prior.p25)}.
        </Step>
        <Step n={2} title="Data" value={data.data_rate === null ? 'none' : perMonth(data.data_rate)}>
          {h.n_fit > 0 ? (
            <>
              {int(h.n_fit)} fitted trial{h.n_fit === 1 ? '' : 's'}: {fixed(data.sum_n_hat, 1)} patients allocated here over{' '}
              {fixed(data.sum_exposure, 1)} exposure months. Data weight {fixed(w, 3)} = {fixed(data.sum_exposure, 1)} / (&beta;{' '}
              {fixed(prior.beta, 3)} + {fixed(data.sum_exposure, 1)}).
            </>
          ) : (
            <>No fitted trials: the score is the unseen-site rate.</>
          )}
        </Step>
        <Step n={3} title="Posterior" value={perMonth(post.mean)}>
          Shape {fixed(post.shape, 2)} = &alpha; + allocated patients; rate {fixed(post.rate, 2)} = &beta; + exposure months.
          Mean = {fixed(w, 3)} &times; {rate(data.data_rate ?? 0)} + {fixed(1 - w, 3)} &times; {rate(prior.mean)}.{' '}
          {unseen ? (
            <>
              With no fitted trial, the 10th&ndash;90th range is the prior&rsquo;s, {rate(post.p10)}&ndash;{rate(post.p90)}.
            </>
          ) : post.interval_method === 'poisson_fallback' ? (
            <>
              10th&ndash;90th range {rate(post.p10)}&ndash;{rate(post.p90)}. Trial-to-trial variation could not be
              measured, so this range treats the allocated patients as exact counts.
            </>
          ) : (
            <>
              The 10th&ndash;90th range, {rate(post.p10)}&ndash;{rate(post.p90)}, also includes how much this site&rsquo;s
              rate varies from trial to trial. Once that is counted, its {fixed(data.sum_n_hat, 1)} allocated patients
              are worth about {fixed(data.N_eff, data.N_eff < 10 ? 2 : 1)} effective patients.
              <div className="muted">
                Counting only Poisson noise (allocated patients as exact counts): {rate(post.p10_poisson)}&ndash;
                {rate(post.p90_poisson)}.
              </div>
            </>
          )}
        </Step>
        <Step n={4} title="Low-history cap" value={cap.applied ? `capped to ${rate(cap.value)}` : 'not applied'} warn={cap.applied}>
          {cap.low_history ? (
            cap.applied ? (
              <>
                {int(h.n_fit)} fitted trial{h.n_fit === 1 ? '' : 's'} (fewer than {cap.threshold}), so the score is min(posterior mean{' '}
                {rate(post.mean)}, prior {fixed(cap.quantile * 100, 0)}th percentile {rate(cap.cap_value)}) = {rate(cap.value)}.
              </>
            ) : (
              <>
                {int(h.n_fit)} fitted trial{h.n_fit === 1 ? '' : 's'} (fewer than {cap.threshold}), but the posterior mean{' '}
                {rate(post.mean)} is already below the cap {rate(cap.cap_value)}, so it stands.
              </>
            )
          ) : (
            <>
              {int(h.n_fit)} fitted trials (the cap applies below {cap.threshold}), so the posterior mean stands.
            </>
          )}
        </Step>
        <Step n={5} title="Final score" value={perMonth(d.score)} emph>
          {unseen ? (
            <>
              No completed trial at this site is in the fit, so this is the unseen-site rate (the prior&rsquo;s{' '}
              {fixed(cap.quantile * 100, 0)}th percentile, stored as site_model.lam_eff), not a measurement of this site.
              {d.site.country === 'United States' && <> It is not among the {nUS} U.S. fitted sites and gets no percentile.</>}
            </>
          ) : (
            <>Historical patients per month per trial at this site (the app&rsquo;s stored site_model.lam_eff).</>
          )}
          {d.percentile_status === 'ok' && <> {ordinal(d.percentile)} percentile among {nUS} U.S. fitted sites.</>}
          {d.percentile_status === 'tied_at_cap' && (
            <>
              {' '}
              This is the cap, shared by {int(d.us_at_cap)} capped U.S. sites. It sits above most sites with{' '}
              {cap.threshold} or more fitted trials, so it gets no percentile.
            </>
          )}
          {d.percentile_status === 'outside_us' && <> The site is outside the U.S., so it has no percentile among U.S. sites.</>}
        </Step>
        <Step n={6} title="Calibrated" value={cal ? perMonth(cal.value) : 'not shown'}>
          {cal ? (
            <>
              exp(m + b &times; (log {rate(d.score)} &minus; m)) with m = log {rate(cal.geo_mean)} (U.S. geometric mean
              {cal.relative_to_us_mean ? '; this site is outside the U.S., so the value is relative to the U.S. average' : ''})
              and b ={' '}
              {fixed(cal.b)} [{fixed(cal.b_ci[0])}, {fixed(cal.b_ci[1])}]; {rate(cal.range_over_b_ci[0])}&ndash;
              {rate(cal.range_over_b_ci[1])} across b&rsquo;s interval. Shrinks the log distance from the U.S. average by
              the slope measured on observed enrollment.
            </>
          ) : (
            <>Omitted: the validation file is missing, and the slope b is never assumed.</>
          )}
        </Step>
      </ol>
      {post.interval_method === 'poisson_fallback' ? (
        <p className="caveat">
          The 10th&ndash;90th range treats the allocated patients as exact counts: trial-to-trial variation could not be
          measured, so it is narrower than the real uncertainty. It also takes each trial&rsquo;s split across its sites
          as given, and it describes past trials, not a forecast for a new trial.
        </p>
      ) : (
        <p className="caveat">
          The 10th&ndash;90th range includes the count noise in the allocated patients and how much a site&rsquo;s rate
          varies from trial to trial (one amount for all sites). It still takes each trial&rsquo;s split across its sites
          as given, so systematic error in that split is not in it; the validation above suggests that error is large.
          It is a range for this historical score, not a forecast for a new trial.
        </p>
      )}
    </div>
  )
}

function Step({ n, title, value, children, warn, emph }: { n: number; title: string; value: ReactNode; children: ReactNode; warn?: boolean; emph?: boolean }) {
  return (
    <li className={`ss-step${warn ? ' ss-step-warn' : ''}${emph ? ' ss-step-emph' : ''}`}>
      <span className="ss-step-num">{n}</span>
      <div className="ss-step-body">
        <div className="ss-step-head">
          <span className="ss-step-title">{title}</span>
          <span className="ss-step-value tnum">{value}</span>
        </div>
        <div className="small ss-step-text">{children}</div>
      </div>
    </li>
  )
}

function IntervalStrip({ d }: { d: SiteDetail }) {
  const { prior, posterior: post, calibrated: cal } = d
  const vals = [prior.p10 ?? prior.p25, prior.p90 ?? prior.mean, post.p10, post.p90, d.score, prior.p25]
  if (cal) vals.push(...cal.range_over_b_ci, cal.value)
  const L = Math.log10(Math.min(...vals) / 1.8)
  const H = Math.log10(Math.max(...vals) * 1.8)
  const x = (v: number) => `${((Math.log10(v) - L) / (H - L)) * 100}%`
  const span = (a: number, b: number) => ({ left: x(a), width: `calc(${x(b)} - ${x(a)})` })
  const ticks = LOG_TICKS.filter((t) => t >= L && t <= H)
  const rows: { label: string; band?: [number, number]; dot: number; kind: string; note: string }[] = [
    { label: 'Prior', band: [prior.p10 ?? prior.p25, prior.p90 ?? prior.mean], dot: prior.mean, kind: 'prior', note: `mean ${rate(prior.mean)}` },
    { label: 'Posterior', band: [post.p10, post.p90], dot: post.mean, kind: 'post', note: `mean ${rate(post.mean)}` },
    { label: 'Score', dot: d.score, kind: 'score', note: d.cap.applied ? `${rate(d.score)} (capped)` : rate(d.score) },
  ]
  if (cal) rows.push({ label: 'Calibrated', band: cal.range_over_b_ci, dot: cal.value, kind: 'cal', note: rate(cal.value) })
  return (
    <div className="ss-strip" role="img" aria-label={rows.map((r) => `${r.label} ${r.note}${r.band ? `, ${rate(r.band[0])} to ${rate(r.band[1])}` : ''}`).join('; ')}>
      {rows.map((r) => (
        <div key={r.label} className="ss-strip-row">
          <span className="ss-strip-label small">{r.label}</span>
          <span className="ss-strip-track">
            <span className="ss-strip-cap" style={{ left: x(prior.p25) }} />
            {r.band && <span className={`ss-strip-band ss-band-${r.kind}`} style={span(r.band[0], r.band[1])} />}
            <span className={`ss-strip-dot ss-dot-${r.kind}`} style={{ left: x(r.dot) }} />
          </span>
          <span className="ss-strip-note small tnum">{r.note}</span>
        </div>
      ))}
      <div className="ss-strip-row ss-strip-axis">
        <span className="ss-strip-label" />
        <span className="ss-strip-track ss-strip-ticks small muted">
          {ticks.map((t) => (
            <span key={t} style={{ left: x(10 ** t) }}>
              {decade(t)}
            </span>
          ))}
        </span>
        <span className="ss-strip-note" />
      </div>
      <p className="small muted ss-strip-legend">
        Bands: prior and posterior 10th&ndash;90th percentiles (the posterior&rsquo;s includes trial-to-trial variation);
        calibrated across b&rsquo;s 95% interval. Vertical line: low-history cap {rate(prior.p25)}. Log scale, per month.
      </p>
    </div>
  )
}

/* ---------- contributing trials ---------- */

type TrialSort = 'start' | 'enrollment' | 'n_sites' | 'n_hat' | 'trial_rate'

function Contributing({ d, stale }: { d: SiteDetail; stale: boolean }) {
  const [sort, setSort] = useState<{ k: TrialSort; desc: boolean }>({ k: 'start', desc: true })
  const [all, setAll] = useState(false) // reset per site: the parent keys this component by site id
  const rows = useMemo(() => {
    const k = sort.k
    const cmp = (a: ContribTrial, b: ContribTrial): number =>
      k === 'start' ? a.start.localeCompare(b.start) : a[k] - b[k]
    return [...d.trials].sort((a, b) => {
      const c = cmp(a, b) || a.nct_id.localeCompare(b.nct_id)
      return sort.desc ? -c : c
    })
  }, [d.trials, sort])
  const shown = all ? rows : rows.slice(0, TRIALS_SHOWN)
  const sumHat = d.trials.reduce((s, t) => s + t.n_hat, 0)
  const sumEq = d.trials.reduce((s, t) => s + t.equal_split, 0)
  const above = d.trials.filter((t) => t.n_hat > t.equal_split).length
  const th = (k: TrialSort, label: ReactNode, title?: string) => {
    const on = sort.k === k
    return (
      <th className="sortable num" aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'} title={title}>
        <button type="button" onClick={() => setSort({ k, desc: on ? !sort.desc : true })}>
          {label}
          <span className="sort-ind">{on ? (sort.desc ? '▼' : '▲') : ''}</span>
        </button>
      </th>
    )
  }
  return (
    <section className={`card ss-contrib${stale ? ' ss-stale' : ''}`}>
      <div className="section-head">
        <h2>
          {int(d.trials.length)} completed trial{d.trials.length === 1 ? '' : 's'} behind this score
        </h2>
        <span className="small muted">{d.site.facility}</span>
      </div>
      {d.trials.length > 0 && (
        <p className="small ss-contrib-lede">
          Each trial&rsquo;s actual enrollment N is split across its registered sites in proportion to the sites&rsquo; rates
          (the final of {d.method.iters} rounds). <strong>Allocated here</strong> next to the <strong>equal split</strong> N /
          sites shows where the split moved enrollment toward or away from this site: in total {fixed(sumHat, 1)} patients
          allocated here against {fixed(sumEq, 1)} under an equal split; above the equal split in {int(above)} of{' '}
          {int(d.trials.length)} trials. Window = {fixed(d.method.enroll_fraction * 100, 0)}% of start to primary
          completion; it is also the exposure.
        </p>
      )}
      {d.trials.length > 0 && (
        <ScrollX label="Completed trials behind this score">
          <table className="tbl tbl-compact ss-trials">
            <thead>
              <tr>
                <th>Trial</th>
                <th className="sortable" aria-sort={sort.k === 'start' ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                  <button type="button" onClick={() => setSort({ k: 'start', desc: sort.k === 'start' ? !sort.desc : true })}>
                    Start &rarr; primary completion
                    <span className="sort-ind">{sort.k === 'start' ? (sort.desc ? '▼' : '▲') : ''}</span>
                  </button>
                </th>
                {th('enrollment', 'N', 'Actual enrollment')}
                {th('n_sites', 'Sites', 'Registered sites |S|')}
                <th className="num" title="Enrollment window tau = 0.65 x (primary completion - start), months; also the exposure e">
                  Window mo
                </th>
                {th('n_hat', 'Allocated here', 'This site’s share of N from the final split')}
                <th className="num" title="N / sites">
                  Equal split
                </th>
                <th title="Allocated here against the equal split (tick)">Split</th>
                {th('trial_rate', 'Trial rate', 'The trial’s own per-site rate N / (window x sites), per month')}
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.nct_id}>
                  <td className="ss-trial-cell">
                    <a href={ctgovUrl(t.nct_id)} target="_blank" rel="noreferrer">
                      {t.nct_id}
                    </a>
                    {t.acronym && <span className="small"> {t.acronym}</span>}
                    <div className="small muted ss-trunc" title={t.title ?? ''}>
                      {t.title}
                    </div>
                    <div className="small muted">
                      {phaseLabel(t.phases)} · {sponsorClass(t.sponsor_class)}
                    </div>
                  </td>
                  <td className="small tnum nowrap">
                    {t.start}
                    <br />
                    {t.primary_completion}
                  </td>
                  <td className="num">{int(t.enrollment)}</td>
                  <td className="num">{int(t.n_sites)}</td>
                  <td className="num">{fixed(t.window_months, 1)}</td>
                  <td className="num">{fixed(t.n_hat, t.n_hat < 10 ? 2 : 1)}</td>
                  <td className="num">{fixed(t.equal_split, t.equal_split < 10 ? 2 : 1)}</td>
                  <td>
                    <SplitBar nhat={t.n_hat} eq={t.equal_split} />
                  </td>
                  <td className="num">{rate(t.trial_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}
      {rows.length > TRIALS_SHOWN && (
        <button className="btn btn-small ss-more" onClick={() => setAll((a) => !a)}>
          {all ? `Show the first ${TRIALS_SHOWN}` : `Show all ${int(rows.length)}`}
        </button>
      )}
      <NotFit d={d} />
    </section>
  )
}

function sponsorClass(c: string | null): string {
  if (!c) return 'sponsor class not reported'
  return c === 'INDUSTRY' ? 'Industry' : c === 'NIH' ? 'NIH' : c === 'FED' ? 'Federal' : c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, ' ')
}

function SplitBar({ nhat, eq }: { nhat: number; eq: number }) {
  const max = 2 * eq
  const w = (Math.min(nhat, max) / max) * 100
  const over = nhat > max
  return (
    <span
      className="ss-split"
      title={`Allocated ${fixed(nhat, 2)} vs equal split ${fixed(eq, 2)}${over ? ' (more than twice the equal split)' : ''}`}
    >
      <span className="ss-split-fill" style={{ width: `${w}%` }} />
      <span className="ss-split-tick" />
    </span>
  )
}

function NotFit({ d }: { d: SiteDetail }) {
  const h = d.history
  if (h.n_not_fit === 0)
    return <p className="small muted ss-notfit-none">All {int(h.n_hist)} lifetime lung trials at this site are in the fit.</p>
  return (
    <div className="ss-notfit">
      <h3>
        Not in the fit: {int(h.n_not_fit)} of {int(h.n_hist)} lifetime lung trials at this site
      </h3>
      <ul className="small">
        {h.not_fit.map((r) => (
          <li key={r.reason}>
            <strong className="tnum">{int(r.n)}</strong> {r.reason}
            <span className="muted">
              {' '}
              (e.g.{' '}
              {r.examples.map((n, i) => (
                <span key={n}>
                  {i > 0 && ', '}
                  <a href={ctgovUrl(n)} target="_blank" rel="noreferrer">
                    {n}
                  </a>
                </span>
              ))}
              )
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
