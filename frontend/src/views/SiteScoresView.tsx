// Site scores: historical, registry-based site enrollment scores, how each one is formed (prior -> data ->
// posterior -> low-history cap -> final -> calibrated), and how the scores did against observed enrollment.
// Not forecasts for a new trial and not a list of sites to pick: the default order is history depth, and every
// score is shown with its range and its calibrated value.
//
// Calm layout. Simple: the definition, the validation callout (score differences overstated about 3x on the log
// scale), the low-history share, the site table (score + range, history depth) and the selected site's score with a
// 3-step breakdown; the full step texts, the calibration formula, the range note and the not-a-forecast note sit in
// hover/focus/tap cards, and secondary tables in "Details" disclosures. Detailed: every table, step and note inline.
// Both densities keep every control (filters, search, sorting and its note, paging, row selection, show all trials)
// and the #site-scores/<site_id> deep link.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Banner, Details, ErrorBox, Gloss, InfoTip, KeyFigure, Loading, PageHead, Qualifier, Section } from '../components'
import { useDensity } from '../density'
import { useTabSignal, whenShown } from '../tabActive'
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

/** A horizontal table scroller that shows when columns sit beyond its edge: a solid edge mark on the side with
 *  hidden columns, and a one-line hint whenever the table is wider than its box (stable, so nothing shifts on scroll). */
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
    if (e.target !== e.currentTarget) return // a control inside the row handles its own keys
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }
}

const place = (city: string | null, state: string | null) => [city, state].filter(Boolean).join(', ')
const perMonth = (x: number | null | undefined) => `${rate(x)} / mo`
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

export default function SiteScoresView() {
  const { density } = useDensity()
  const detailed = density === 'detailed'
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

  const breakdownRef = useRef<HTMLElement>(null)
  // A deep link (#site-scores/<site_id>) scrolls to that site's breakdown once it has loaded.
  const scrollOnLoad = useRef(siteFromHash() !== null)
  const loadedId = detail.status === 'ok' ? detail.data.site.site_id : null
  const ready = summary.status === 'ok' // the breakdown window exists only once the summary has loaded
  // Kept mounted behind another tab, the view waits until it is shown to scroll.
  const tab = useTabSignal()
  useEffect(() => {
    if (!scrollOnLoad.current || !ready || loadedId === null || loadedId !== selected) return
    return whenShown(tab, () => {
      const el = breakdownRef.current
      if (!el) return
      scrollOnLoad.current = false
      el.scrollIntoView({ block: 'start' })
      // The charts above size themselves after the first paint and can push the window down: scroll once more,
      // unless the reader has started scrolling.
      const id = window.setTimeout(() => {
        const top = el.getBoundingClientRect().top
        if (top < -2 || top > 160) el.scrollIntoView({ block: 'start' })
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
    })
  }, [loadedId, selected, ready, tab])
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
  const sortedByScore = ['score', 'calibrated', 'percentile'].includes(sort.replace(/^-/, ''))

  return (
    <div className={`view ss ${detailed ? 'ss-detailed' : 'ss-simple'}`}>
      <PageHead
        title="Site scores"
        lede={
          <>
            A site&rsquo;s score is its <strong>historical patients per month per trial</strong>, from completed
            lung-cancer trials on ClinicalTrials.gov. It describes how past trials enrolled at that site. It is{' '}
            <strong>not a forecast for a new trial</strong>, and the site list below is ordered by how much history a
            site has, not by score.
          </>
        }
      >
        <DevBanner v={S.validation} />
      </PageHead>

      <HowFormed S={S} />
      <ValidationSection v={S.validation} S={S} />
      <Distribution S={S} selected={d} />

      <div className="ss-md">
        <section className="win ss-list" aria-labelledby="ss-sites-h">
          <div className="win-body">
            <div className="ss-win-head">
              <h2 id="ss-sites-h">Sites</h2>
              <span className="small muted">
                {list.status === 'ok' ? `${int(list.data.total)} U.S. sites` : 'U.S. sites'} with at least one fitted trial
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
            {sortedByScore && <SortNote S={S} />}
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
                detailed={detailed}
              />
            ) : (
              <Loading label="Loading sites…" />
            )}
          </div>
        </section>

        <section className="win ss-breakdown" ref={breakdownRef} aria-live="polite" aria-label="Selected site's score">
          <div className="win-body">
            {detail.status === 'error' ? (
              <ErrorBox error={detail.error} onRetry={retryDetail} />
            ) : d ? (
              <Breakdown d={d} S={S} stale={d.site.site_id !== siteId} isPreset={!selected} detailed={detailed} />
            ) : (
              <Loading label="Loading the breakdown…" />
            )}
          </div>
        </section>
      </div>

      {d && <Contributing key={d.site.site_id} d={d} stale={d.site.site_id !== siteId} detailed={detailed} />}
    </div>
  )
}

/** Copy deck B8, with the overstatement factors read from the validation file (about 3x for industry Phase II/III,
 *  about 6x across all later trials). */
function DevBanner({ v }: { v: Validation | null }) {
  const ind = v?.industry_phase2_3
  const facs = [ind?.overstatement, v?.all_trials?.overstatement].filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).map(Math.round)
  const lo = Math.min(...facs)
  const hi = Math.max(...facs)
  const signal = !!ind && ind.ci95[0] > 0
  return (
    <Banner title="Historical evidence, not a forecast.">
      Scores come from public registry history.
      {facs.length > 0 ? (
        <>
          {' '}
          On later trials they {signal ? 'carried real signal' : 'showed no clear signal'}, but predicted differences between site lists were about{' '}
          {lo === hi ? lo : `${lo} to ${hi}`} times larger than observed, on the log scale.
        </>
      ) : (
        <> The check against later trials is not available.</>
      )}
    </Banner>
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
          Differences in <em>log</em> score between sites are overstated about {over.toFixed(0)}x (see the check
          above). On the log scale, not as a division of ratios: a 10x ratio between two raw scores is about{' '}
          {(10 ** b).toFixed(1)}x between their calibrated scores (10^{fixed(b)}).
        </>
      ) : null}
    </p>
  )
}

/* ---------- how a score is formed ---------- */

function HowFormed({ S }: { S: Summary }) {
  const c = S.consistency
  return (
    <div className="ss-what">
      <Section
        title="How a score is formed"
        lede={
          <>
            The registry reports enrollment per trial, not per site. So each completed trial&rsquo;s enrollment is split
            across its registered sites, and each site&rsquo;s rate is pulled toward a rate fitted to all trials: more so
            when the site has little history.
          </>
        }
        qualifiers={
          <p className="ss-q">
            Sites with fewer than {S.fit.low_history_n} fitted trials are capped at {perMonth(S.prior.p25)}, the rate also
            used for sites with no history.
          </p>
        }
        info={
          <>
            <span className="hc-title">The method in one paragraph</span>
            {S.method}
          </>
        }
        figure={
          <div className="ss-kfs">
            <KeyFigure layout="inline" value={int(S.fit.history_trials)} label="completed lung trials in the fit" sub="with actual enrollment and an actual primary completion date" />
            <KeyFigure layout="inline" value={int(S.us.sites)} label="identifiable U.S. sites" sub={`of ${int(S.fit.fitted_sites)} fitted sites worldwide`} />
            <KeyFigure layout="inline" value={perMonth(S.prior.mean)} label="where every site starts" sub="the mean of the prior fitted to all trials" />
          </div>
        }
        details={
          <>
            <ol className="ss-mini">
              <li>
                <strong>History.</strong> {int(S.fit.history_trials)} completed lung trials that report actual enrollment
                and an actual primary completion date, at {int(S.fit.fitted_sites)} sites worldwide; {int(S.us.sites)} of
                them are identifiable U.S. sites (listed below).
              </li>
              <li>
                <strong>Split.</strong> The registry reports enrollment per trial, not per site, so each trial&rsquo;s
                enrollment is split across its registered sites in proportion to the sites&rsquo; current rates (
                {S.fit.iters} rounds).
              </li>
              <li>
                <strong>Shrink.</strong> Each site&rsquo;s rate combines a prior fitted to all trials (mean{' '}
                {perMonth(S.prior.mean)}) with the patients allocated to the site over its exposure months (
                {fixed(S.fit.enroll_fraction * 100, 0)}% of each trial&rsquo;s start-to-primary-completion time). More
                exposure, less prior.
              </li>
              <li>
                <strong>Cap.</strong> Sites with fewer than {S.fit.low_history_n} fitted trials are held at or below the
                prior&rsquo;s {fixed(S.fit.low_history_q * 100, 0)}th percentile ({perMonth(S.prior.p25)}), the rate also
                used for sites with no history.
              </li>
            </ol>
            <Details summary="The method in one paragraph" className="ss-method">
              <p className="small">{S.method}</p>
            </Details>
            <p className="small muted ss-consistency">
              These numbers are recomputed from the fit and match the app&rsquo;s stored scores ({c.against}) for all{' '}
              {int(c.compared)} fitted sites; largest difference {c.max_abs_diff === 0 ? '0' : c.max_abs_diff.toExponential(1)}.
            </p>
          </>
        }
      />
    </div>
  )
}

/* ---------- validation ---------- */

function ValidationSection({ v, S }: { v: Validation | null; S: Summary }) {
  if (!v)
    return (
      <div className="ss-valid">
        <Section
          title="Checked against observed enrollment"
          lede={
            <span className="ss-missing">
              The validation file (data/findings/selection_validation.json) is missing, so calibrated scores are not
              shown. Run <code>python -m concord.analysis.selection_validation</code> to produce it.
            </span>
          }
        />
      </div>
    )
  const ind = v.industry_phase2_3
  const all = v.all_trials
  const yr = v.cutoff.slice(0, 4)
  const over = ind.overstatement
  const rows = [
    { key: 'ind', label: 'Industry Phase II/III', b: ind, primary: true },
    ...(all ? [{ key: 'all', label: 'All completed lung trials', b: all, primary: false }] : []),
  ]
  const cal = S.calibration
  return (
    <div className="ss-valid">
      <Section
        title={over !== null ? `Scores overstate differences about ${over.toFixed(0)}x on the log scale` : 'Checked against observed enrollment'}
        lede={
          <>
            Scores fit only on trials that started before {yr} were checked against how {int(ind.n)} later industry
            Phase II/III trials enrolled. Site lists with higher scores did enroll more patients per site-month, so the
            scores carry {ind.ci95[0] > 0 ? 'real' : 'little clear'} signal; but a 10x gap between raw scores went with
            about {(10 ** ind.slope).toFixed(1)}x in observed enrollment.
          </>
        }
        qualifiers={
          <ul className="ss-quals">
            <li>
              Slope <strong className="num">{fixed(ind.slope)}</strong> (<Gloss term="ci95" /> {fixed(ind.ci95[0])} to {fixed(ind.ci95[1])}),
              industry Phase II/III. 1 would mean calibrated; 0, no signal.
            </li>
            {all && (
              <li>
                Across all {int(all.n)} later lung trials: slope <strong className="num">{fixed(all.slope)}</strong> (95% CI{' '}
                {fixed(all.ci95[0])} to {fixed(all.ci95[1])}), differences overstated about{' '}
                {all.overstatement !== null ? `${all.overstatement.toFixed(0)}x` : '—'}.
              </li>
            )}
            <li>Observational check of the scores, not a test of choosing different sites.</li>
          </ul>
        }
        info={
          cal ? (
            <>
              <span className="hc-title">Calibrated score</span>
              exp(m + b &times; (log score &minus; m)), with b = {fixed(cal.b)} [{fixed(cal.b_ci[0])}, {fixed(cal.b_ci[1])}] and m = log{' '}
              {rate(cal.geo_mean)}, the mean log score of the {int(S.us.sites)} U.S. sites. It shrinks each site&rsquo;s log
              distance from the U.S. average by the slope measured here.
              <span className="hc-src">Source: {v.source}</span>
            </>
          ) : (
            <>
              {v.reading}
              <span className="hc-src">Source: {v.source}</span>
            </>
          )
        }
        figure={<SlopePlot rows={rows} />}
        caption={
          <>
            Slope of each later trial&rsquo;s actual log enrollment per site-month on its log mean site score, with phase,
            site-count and start-year controls.
          </>
        }
        details={
          <>
            <p className="small ss-valid-how">
              Scores fit only on trials that started before {yr} ({int(v.fit_trials)} trials) were applied to the
              registered site lists of completed trials that started in {yr} or later. Slope of each trial&rsquo;s actual
              log enrollment per site-month on its log mean site score, with phase, site-count and start-year controls.
            </p>
            <p className="ss-reading">{v.reading}</p>
            {cal && (
              <p className="small ss-calib-def">
                <strong>Calibrated score</strong> = exp(m + b &times; (log score &minus; m)), with b = {fixed(cal.b)} [
                {fixed(cal.b_ci[0])}, {fixed(cal.b_ci[1])}] and m = log {rate(cal.geo_mean)}, the mean log score of the{' '}
                {int(S.us.sites)} U.S. sites (geometric mean {perMonth(cal.geo_mean)}).
              </p>
            )}
            <p className="small muted">
              Source: <code>{v.source}</code> (from <code>{v.script}</code>). An observational check of the scores, not a
              test of choosing different sites.
            </p>
          </>
        }
      />
    </div>
  )
}

const SLOPE_TICKS = [0, 0.25, 0.5, 0.75, 1]

function SlopePlot({ rows }: { rows: { key: string; label: string; b: ValidationBlock; primary: boolean }[] }) {
  const MAX = 1.08
  const x = (v: number) => `${(Math.max(0, Math.min(MAX, v)) / MAX) * 100}%`
  return (
    <div
      className="ss-slope"
      role="img"
      aria-label={rows.map((r) => `${r.label}: slope ${fixed(r.b.slope)}, 95% CI ${fixed(r.b.ci95[0])} to ${fixed(r.b.ci95[1])}, ${r.b.n} trials`).join('; ')}
    >
      {rows.map((r) => (
        <div key={r.key} className={`ss-slope-row ss-slope-${r.primary ? 'primary' : 'second'}`}>
          <div className="ss-slope-head">
            <span>
              {r.label} <span className="muted">· {int(r.b.n)} trials</span>
            </span>
            <span className="ss-slope-val num">
              {fixed(r.b.slope)} <span className="ss-slope-ci-text">[{fixed(r.b.ci95[0])}, {fixed(r.b.ci95[1])}]</span>
            </span>
          </div>
          <div className="ss-slope-track" aria-hidden="true">
            <span className="ss-slope-ref" style={{ left: x(0) }} />
            <span className="ss-slope-one" style={{ left: x(1) }} />
            <span className="ss-slope-ci" style={{ left: x(r.b.ci95[0]), width: `calc(${x(r.b.ci95[1])} - ${x(r.b.ci95[0])})` }} />
            <span className="ss-slope-dot" style={{ left: x(r.b.slope) }} />
          </div>
        </div>
      ))}
      <div className="ss-slope-axis num" aria-hidden="true">
        {SLOPE_TICKS.map((t) => (
          <span key={t} style={{ left: x(t) }}>
            {String(t)}
          </span>
        ))}
      </div>
      <div className="ss-slope-anchors small" aria-hidden="true">
        <span>
          <span className="num">0</span> = no signal
        </span>
        <span>
          <span className="num">1</span> = calibrated
        </span>
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
  const n = S.fit.low_history_n
  return (
    <div className="ss-dist">
      <Section
        title={lowShare > 0.5 ? `Most U.S. sites have fewer than ${n} fitted trials` : 'How scores are distributed'}
        lede={
          <>
            {int(S.us.low_history)} of {int(S.us.sites)} U.S. sites ({fixed(lowShare * 100, 0)}%) have fewer than {n} fitted
            trials. Their scores rest on the split of one or two trials, which is noisy, so they are held at or below the
            cap of {perMonth(S.prior.p25)}.
          </>
        }
        qualifiers={
          <p className="ss-q">
            The cap is a ceiling, not a floor. It lowered {int(S.us.capped)} scores, the spike in the histogram; capped
            sites get no percentile.
          </p>
        }
        figure={<Histogram bins={S.histogram.bins} cap={S.prior.p25} site={selected?.site.in_us_list ? selected : null} />}
        caption={<>{int(S.us.sites)} U.S. sites with at least one fitted trial. Log scale, patients per month per trial.</>}
        detailsLabel="Details: by history depth"
        details={
          <>
            <BucketTable buckets={S.buckets} lowN={n} />
            <p className="caveat">
              {int(S.us.low_history)} of {int(S.us.sites)} sites ({fixed(lowShare * 100, 0)}%) have fewer than {n} fitted
              trials. Their scores rest on the split of one or two trials, which is noisy, and on the model&rsquo;s
              backtest the uncapped model&rsquo;s optimism came from sites it barely knew. So the cap holds them at or
              below {perMonth(S.prior.p25)}; it lowered {int(S.us.capped)} of them, which is the spike in the histogram.
              The cap is a ceiling, not a floor.{depth ? ` ${depth}` : ''}
            </p>
            <HistTable bins={S.histogram.bins} />
          </>
        }
      />
    </div>
  )
}

const LOG_TICKS = [-3, -2, -1, 0, 1, 2]
/** Decade tick labels: 0.001, 0.01, 0.1, 1, 10. */
const decade = (t: number) => (t >= 0 ? String(10 ** t) : (10 ** t).toFixed(-t))

function Histogram({ bins, cap, site }: { bins: HistBin[]; cap: number; site: SiteDetail | null }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const H = 220
  const M = { l: 40, r: 10, t: 24, b: 30 }
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
  // The selected site's label goes on the side of its line with more room, shortened to fit inside the chart.
  const siteLabel = (() => {
    if (siteX === null || !site) return null
    const right = W - M.r - siteX - 5
    const left = siteX - M.l - 5
    const end = left > right
    return { end, text: shortName(site.site.facility, Math.floor(Math.max(left, right) / CHAR_W)) }
  })()
  const hb = hover !== null ? bins[hover] : null
  return (
    <div className="ss-hist" ref={ref}>
      <div className="ss-legend small">
        <span>
          <i className="sw ss-sw-rich" /> 3 or more fitted trials
        </span>
        <span>
          <i className="sw ss-sw-low" /> 1&ndash;2 fitted trials (low history)
        </span>
      </div>
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
                  onPointerDown={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            )
          })}
          <line className="ss-axis" x1={M.l} x2={W - M.r} y1={ys(0)} y2={ys(0)} />
          <line className="ss-mark-cap" x1={capX} x2={capX} y1={M.t - 8} y2={ys(0)} />
          <text className="ss-mark-text ss-mark-cap-text" x={capX + 5} y={M.t - 10}>
            cap {rate(cap)}
          </text>
          {siteX !== null && siteLabel && (
            <>
              <line className="ss-mark-site" x1={siteX} x2={siteX} y1={M.t + 8} y2={ys(0)} />
              <text className="ss-mark-text ss-mark-site-text" x={siteX + (siteLabel.end ? -5 : 5)} y={M.t + 14} textAnchor={siteLabel.end ? 'end' : 'start'}>
                {siteLabel.text}
              </text>
            </>
          )}
        </svg>
      )}
      {hb && hover !== null && (
        <div className="ss-tip" style={{ left: Math.min(Math.max(M.l + (hover + 0.5) * bw, 90), W - 90) }}>
          <div className="ss-tip-title">
            <span className="num">{rate(10 ** hb.lo)}</span> to <span className="num">{rate(10 ** hb.hi)}</span> / mo
          </div>
          <div>
            <i className="ss-key ss-key-rich" /> <strong className="num">{int(hb.history_3plus)}</strong> sites, 3+ fitted trials
          </div>
          <div>
            <i className="ss-key ss-key-low" /> <strong className="num">{int(hb.low_history)}</strong> sites, low history
          </div>
        </div>
      )}
    </div>
  )
}

function HistTable({ bins }: { bins: HistBin[] }) {
  return (
    <Details summary="Histogram as a table" className="ss-hist-table">
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
                <td className="num ss-left">
                  {rate(10 ** b.lo)} to {rate(10 ** b.hi)}
                </td>
                <td className="num">{int(b.history_3plus)}</td>
                <td className="num">{int(b.low_history)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
    </Details>
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

/** Rough width of one character of the 12 px semibold chart label, for fitting it inside the chart. */
const CHAR_W = 7

function shortName(s: string | null, max = 28): string {
  const t = s ?? 'this site'
  const n = Math.max(6, Math.min(28, max))
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
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
                  <span className="num">{b.label}</span> {b.low_history && <span className="ss-mark">low history</span>}
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
      <p className="small muted">Medians in patients per month per trial. The cap applies only below {lowN} fitted trials.</p>
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

function SortTh({
  k,
  label,
  sort,
  onSort,
  num,
  title,
  className,
  info,
  infoLabel,
}: {
  k: string
  label: ReactNode
  sort: string
  onSort: (s: string) => void
  num?: boolean
  title?: string
  className?: string
  info?: ReactNode
  infoLabel?: string
}) {
  const active = sort.replace(/^-/, '') === k
  const desc = sort.startsWith('-')
  const next = active ? (desc ? k : `-${k}`) : num ? `-${k}` : k
  return (
    <th className={`sortable${num ? ' num' : ''}${className ? ` ${className}` : ''}`} aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'} title={title}>
      <span className="ss-th">
        <button type="button" onClick={() => onSort(next)}>
          {label}
          <span className="sort-ind">{active ? (desc ? '▼' : '▲') : ''}</span>
        </button>
        {info && <InfoTip label={infoLabel ?? 'About this column'} content={info} />}
      </span>
    </th>
  )
}

function SiteTable({
  data,
  S,
  sort,
  onSort,
  selected,
  onPick,
  onPage,
  detailed,
}: {
  data: SiteList
  S: Summary
  sort: string
  onSort: (s: string) => void
  selected: string | null
  onPick: (id: string) => void
  onPage: (o: number) => void
  detailed: boolean
}) {
  const cal = data.calibration
  const from = data.total ? data.offset + 1 : 0
  const to = Math.min(data.offset + data.limit, data.total)
  const atCapTitle =
    `All ${int(S.us.at_cap)} capped sites share the cap value ${rate(S.prior.p25)}; as a percentile that would be the ` +
    `${ordinal(S.us.cap_percentile)}, above most sites with 3 or more fitted trials, so capped sites get none`
  // The ranges include trial-to-trial variation unless 1/k could not be estimated (then they are Poisson-only).
  const het = !!S.heterogeneity && !S.heterogeneity.fallback && S.heterogeneity.inv_k !== null
  return (
    <>
      <ScrollX label="U.S. sites with fitted trials">
        <table className="tbl ss-sites">
          <thead>
            <tr>
              <SortTh k="facility" label="Site" sort={sort} onSort={onSort} />
              <SortTh k="n_fit" label={<ShortLabel long="Fitted trials" short="Trials" />} sort={sort} onSort={onSort} num title="Completed trials in the fit (of lifetime lung trials)" />
              <SortTh
                k="score"
                label="Score / mo"
                sort={sort}
                onSort={onSort}
                num
                infoLabel="About the score and its range"
                info={
                  <>
                    <span className="hc-title">Score and range</span>
                    Historical patients per month per trial, with its 10th&ndash;90th percentile range. <IntervalNote S={S} />
                    <span className="hc-src">Historical, not a forecast for a new trial.</span>
                  </>
                }
              />
              {cal && (
                <SortTh
                  k="calibrated"
                  label="Calibrated"
                  sort={sort}
                  onSort={onSort}
                  num
                  className="ss-col-wide"
                  infoLabel="About the calibrated score"
                  info={
                    <>
                      <span className="hc-title">Calibrated score</span>
                      exp(m + b &times; (log score &minus; m)), b = {fixed(cal.b)} [{fixed(cal.b_ci[0])}, {fixed(cal.b_ci[1])}], {cal.b_label}, n{' '}
                      {int(cal.b_n)}. It shrinks each site&rsquo;s log distance from the U.S. average by the slope measured on later
                      trials.
                    </>
                  }
                />
              )}
              <SortTh
                k="percentile"
                label="Pctile"
                sort={sort}
                onSort={onSort}
                num
                className="ss-col-wide"
                infoLabel="About percentiles"
                info={
                  <>
                    <span className="hc-title">Percentile</span>
                    Percentile of the score among U.S. fitted sites. {atCapTitle}.
                  </>
                }
              />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <SiteTr key={r.site_id} r={r} on={r.site_id === selected} onPick={onPick} showCal={!!cal} atCapTitle={atCapTitle} het={het} />
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
        <span className="muted num">
          {int(from)}&ndash;{int(to)} of {int(data.total)}
        </span>
        <button className="btn btn-small" disabled={data.offset === 0} onClick={() => onPage(Math.max(0, data.offset - data.limit))}>
          Previous
        </button>
        <button className="btn btn-small" disabled={to >= data.total} onClick={() => onPage(data.offset + data.limit)}>
          Next
        </button>
      </div>
      {detailed ? (
        <p className="small muted ss-calnote">
          {cal && (
            <>
              Calibrated: b = {fixed(cal.b)} [{fixed(cal.b_ci[0])}, {fixed(cal.b_ci[1])}], {cal.b_label}, n {int(cal.b_n)}.{' '}
            </>
          )}
          <IntervalNote S={S} /> Capped sites (<em>at cap</em>) all share one value, {rate(S.prior.p25)}, so they get no
          percentile.
        </p>
      ) : (
        <p className="small muted ss-legend-s">
          Under each score: its 10th&ndash;90th percentile range. <span className="ss-mark">Low history</span>: fewer than{' '}
          {S.fit.low_history_n} fitted trials. Capped sites (<em>at cap</em>) all share one value, {rate(S.prior.p25)}, so they
          get no percentile.
        </p>
      )}
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
  const c = h.concentration
  return (
    <>
      Score ranges are 10th&ndash;90th percentiles that include how much a site&rsquo;s rate typically varies from one
      trial to the next. That amount is one value for all sites, estimated from sites with {h.min_trials} or more fitted
      trials
      {c && h.sites_used > 100 && c.top50_weight >= 0.5 ? (
        <>
          {' '}
          and set mostly by the high-volume ones (50 of them carry {Math.round(c.top50_weight * 100)}% of its weight)
        </>
      ) : null}
      . The ranges still take each trial&rsquo;s split across its sites as given, so systematic error in that split is
      not in them.
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

function SiteTr({ r, on, onPick, showCal, atCapTitle, het }: { r: SiteRow; on: boolean; onPick: (id: string) => void; showCal: boolean; atCapTitle: string; het: boolean }) {
  const pick = () => onPick(r.site_id)
  const what = het ? 'including trial-to-trial variation' : 'treating the allocated patients as exact counts'
  return (
    <tr className={`clickable${on ? ' row-on' : ''}`} tabIndex={0} onClick={pick} onKeyDown={onActivate(pick)} aria-selected={on}>
      <td className="ss-site-cell">
        <div className="ss-site-name">{r.facility}</div>
        <div className="small muted">
          {place(r.city, r.state)}
          {r.is_amc ? ' · Academic' : ''}
        </div>
        <SiteMarks low={r.low_history} capped={r.capped} />
      </td>
      <td className="num">
        <div>{int(r.n_fit)}</div>
        <div className="small muted">of {int(r.n_hist)}</div>
      </td>
      <td className="num">
        <div className="ss-score">{rate(r.score)}</div>
        <div
          className={`small muted${r.capped ? ' ss-iv-capped' : ''}`}
          title={
            r.capped
              ? `Range around the posterior mean before the cap (10th to 90th percentile, ${what}); the capped score is set by the cap, not by this range`
              : het
                ? '10th to 90th percentile, including how much a site’s rate typically varies from trial to trial'
                : '10th to 90th percentile, treating the allocated patients as exact counts'
          }
        >
          {rate(r.interval[0])}&ndash;{rate(r.interval[1])}
        </div>
        {/* Below 700 px the Calibrated and Pctile columns fold in here, so nothing sits off-screen on a phone. */}
        <div className="ss-stack small">
          {showCal && <div>cal. {rate(r.calibrated)}</div>}
          <div>{r.percentile_status === 'tied_at_cap' ? <Pct r={r} atCapTitle={atCapTitle} /> : <>{ordinal(r.percentile)} pctile</>}</div>
        </div>
      </td>
      {showCal && <td className="num ss-col-wide">{rate(r.calibrated)}</td>}
      <td className="num ss-col-wide">
        <Pct r={r} atCapTitle={atCapTitle} />
      </td>
    </tr>
  )
}

/** The low-history marks: they change what a score means, so they stay next to it in both densities. */
function SiteMarks({ low, capped }: { low: boolean; capped: boolean }) {
  if (!low) return null
  return (
    <div className="ss-marks">
      {capped ? (
        <span title="Fewer than 3 fitted trials: score capped at the prior's 25th percentile">
          <Qualifier>Low history, capped</Qualifier>
        </span>
      ) : (
        <span title="Fewer than 3 fitted trials; the posterior mean is already below the cap">
          <Qualifier>Low history</Qualifier>
        </span>
      )}
    </div>
  )
}

/* ---------- breakdown ---------- */

/** The six steps' texts. Detailed shows them as the step list; Simple puts them in the 3-step breakdown's cards. */
function stepTexts(d: SiteDetail) {
  const { prior, data, posterior: post, cap, calibrated: cal, history: h } = d
  const w = data.data_weight
  const nUS = int(d.us_fitted_sites)
  const unseen = h.n_fit === 0
  return {
    prior: (
      <>
        Gamma(&alpha; {fixed(prior.alpha, 3)}, &beta; {fixed(prior.beta, 3)}), fitted to the per-site rates of {int(prior.trials_used)}{' '}
        trials (5&ndash;95% trimmed). Every site starts here; its 25th percentile is {perMonth(prior.p25)}.
      </>
    ),
    data:
      h.n_fit > 0 ? (
        <>
          {int(h.n_fit)} fitted {plural(h.n_fit, 'trial')}: {fixed(data.sum_n_hat, 1)} patients allocated here over{' '}
          {fixed(data.sum_exposure, 1)} exposure months. Data weight {fixed(w, 3)} = {fixed(data.sum_exposure, 1)} / (&beta;{' '}
          {fixed(prior.beta, 3)} + {fixed(data.sum_exposure, 1)}).
        </>
      ) : (
        <>No fitted trials: the score is the unseen-site rate.</>
      ),
    post: (
      <>
        Shape {fixed(post.shape, 2)} = &alpha; + allocated patients; rate {fixed(post.rate, 2)} = &beta; + exposure months. Mean ={' '}
        {fixed(w, 3)} &times; {rate(data.data_rate ?? 0)} + {fixed(1 - w, 3)} &times; {rate(prior.mean)}.{' '}
        {unseen ? (
          <>
            With no fitted trial, the 10th&ndash;90th range is the prior&rsquo;s, {rate(post.p10)}&ndash;{rate(post.p90)}.
          </>
        ) : post.interval_method === 'poisson_fallback' ? (
          <>
            10th&ndash;90th range {rate(post.p10)}&ndash;{rate(post.p90)}. Trial-to-trial variation could not be measured,
            so this range treats the allocated patients as exact counts.
          </>
        ) : (
          <>
            The 10th&ndash;90th range, {rate(post.p10)}&ndash;{rate(post.p90)}, also includes how much a site&rsquo;s rate
            typically varies from trial to trial (one amount for all sites). Once that is counted, its{' '}
            {fixed(data.sum_n_hat, 1)} allocated patients are worth about {fixed(data.N_eff, data.N_eff < 10 ? 2 : 1)}{' '}
            effective patients.
            <span className="ss-step-aside">
              Counting only Poisson noise (allocated patients as exact counts): {rate(post.p10_poisson)}&ndash;
              {rate(post.p90_poisson)}.
            </span>
          </>
        )}
      </>
    ),
    cap: cap.low_history ? (
      cap.applied ? (
        <>
          {int(h.n_fit)} fitted {plural(h.n_fit, 'trial')} (fewer than {cap.threshold}), so the score is min(posterior mean{' '}
          {rate(post.mean)}, prior {fixed(cap.quantile * 100, 0)}th percentile {rate(cap.cap_value)}) = {rate(cap.value)}.
        </>
      ) : (
        <>
          {int(h.n_fit)} fitted {plural(h.n_fit, 'trial')} (fewer than {cap.threshold}), but the posterior mean {rate(post.mean)} is
          already below the cap {rate(cap.cap_value)}, so it stands.
        </>
      )
    ) : (
      <>
        {int(h.n_fit)} fitted trials (the cap applies below {cap.threshold}), so the posterior mean stands.
      </>
    ),
    final: (
      <>
        {unseen ? (
          <>
            No completed trial at this site is in the fit, so this is the unseen-site rate (the prior&rsquo;s{' '}
            {fixed(cap.quantile * 100, 0)}th percentile, stored as site_model.lam_eff), not a measurement of this site.
            {d.site.country === 'United States' && <> It is not among the {nUS} U.S. fitted sites and gets no percentile.</>}
          </>
        ) : (
          <>Historical patients per month per trial at this site (the app&rsquo;s stored site_model.lam_eff).</>
        )}
        {d.percentile_status === 'ok' && (
          <>
            {' '}
            {ordinal(d.percentile)} percentile among {nUS} U.S. fitted sites.
          </>
        )}
        {d.percentile_status === 'tied_at_cap' && (
          <>
            {' '}
            This is the cap, shared by {int(d.us_at_cap)} capped U.S. sites. It sits above most sites with {cap.threshold} or
            more fitted trials, so it gets no percentile.
          </>
        )}
        {d.percentile_status === 'outside_us' && <> The site is outside the U.S., so it has no percentile among U.S. sites.</>}
      </>
    ),
    cal: cal ? (
      <>
        exp(m + b &times; (log {rate(d.score)} &minus; m)) with m = log {rate(cal.geo_mean)} (U.S. geometric mean
        {cal.relative_to_us_mean ? '; this site is outside the U.S., so the value is relative to the U.S. average' : ''}) and b ={' '}
        {fixed(cal.b)} [{fixed(cal.b_ci[0])}, {fixed(cal.b_ci[1])}]; {rate(cal.range_over_b_ci[0])}&ndash;
        {rate(cal.range_over_b_ci[1])} across b&rsquo;s interval. Shrinks the log distance from the U.S. average by the slope
        measured on observed enrollment.
      </>
    ) : (
      <>Omitted: the validation file is missing, and the slope b is never assumed.</>
    ),
  }
}

/** What the range includes and leaves out, and that it is not a forecast (the breakdown's caveat). */
function rangeNote(d: SiteDetail): ReactNode {
  const cal = d.calibrated
  return d.posterior.interval_method === 'poisson_fallback' ? (
    <>
      The 10th&ndash;90th range treats the allocated patients as exact counts: trial-to-trial variation could not be
      measured, so it is narrower than the real uncertainty. It also takes each trial&rsquo;s split across its sites as
      given, and it describes past trials, not a forecast for a new trial.
    </>
  ) : (
    <>
      The 10th&ndash;90th range includes the count noise in the allocated patients and how much a site&rsquo;s rate varies
      from trial to trial (one amount for all sites). It still takes each trial&rsquo;s split across its sites as given, so
      systematic error in that split is not in it
      {cal && cal.b < 1 ? <>, and the validation above shows score differences are still overstated on later trials</> : null}
      . It is a range for this historical score, not a forecast for a new trial.
    </>
  )
}

function Breakdown({ d, S, stale, isPreset, detailed }: { d: SiteDetail; S: Summary; stale: boolean; isPreset: boolean; detailed: boolean }) {
  const { posterior: post, cap, calibrated: cal, history: h } = d
  const nUS = int(d.us_fitted_sites)
  const pct: Record<SiteDetail['percentile_status'], { value: string; sub: string }> = {
    ok: { value: ordinal(d.percentile), sub: `among ${nUS} U.S. fitted sites` },
    tied_at_cap: { value: 'at cap', sub: `tied with ${int(d.us_at_cap)} capped U.S. sites: no percentile` },
    no_fitted_trials: { value: '—', sub: `no fitted trials: not among the ${nUS} U.S. fitted sites` },
    outside_us: { value: '—', sub: 'outside the U.S.: percentiles cover U.S. sites only' },
  }
  const fig = pct[d.percentile_status]
  const unseen = h.n_fit === 0
  const t = stepTexts(d)
  // The 10th-90th range is around the posterior mean: the prior's for an unseen site, and before the cap for a capped one.
  const range = `${unseen ? "the prior's range" : 'range'}${cap.applied ? ' before the cap' : ''}`
  return (
    <div className={stale ? 'ss-stale' : undefined}>
      <div className="ss-bd-head">
        <div className="small muted">{isPreset ? `Example site (${S.preset?.basis ?? 'chosen by fitted trials'})` : 'Selected site'}</div>
        <h2 className="ss-bd-title">{d.site.facility}</h2>
        <div className="small muted ss-bd-place">
          {place(d.site.city, d.site.state)}
          {d.site.country && d.site.country !== 'United States' ? `, ${d.site.country}` : ''}
          {d.site.is_amc ? ' · Academic' : ''}
        </div>
        <SiteMarks low={cap.low_history} capped={cap.applied} />
      </div>

      <div className="ss-figs">
        <div className="ss-fig ss-fig-score">
          <KeyFigure
            label="Score"
            size="lg"
            value={rate(d.score)}
            qualifier={cap.applied ? <Qualifier>capped</Qualifier> : undefined}
            sub={
              <>
                <span className="ss-fig-line">{unseen ? 'unseen-site rate (no fitted trials)' : 'patients / month / trial, historical'}</span>
                <span className="ss-fig-line">
                  {range} <span className="ss-fig-range">{rate(post.p10)}&ndash;{rate(post.p90)}</span>
                </span>
              </>
            }
          />
        </div>
        {cal && (
          <div className="ss-fig">
            <KeyFigure
              label="Calibrated"
              size="lg"
              value={rate(cal.value)}
              sub={
                <>
                  b = {fixed(cal.b)} [{fixed(cal.b_ci[0])}, {fixed(cal.b_ci[1])}]
                  {cal.relative_to_us_mean && <>; relative to the U.S. mean</>}
                </>
              }
            />
          </div>
        )}
        <div className="ss-fig">
          <KeyFigure label="Percentile" size="lg" value={fig.value} sub={fig.sub} />
        </div>
        <div className="ss-fig">
          <KeyFigure label="History" size="lg" value={int(h.n_fit)} sub={`fitted of ${int(h.n_hist)} lung trials`} />
        </div>
      </div>

      {detailed ? (
        <>
          <IntervalStrip d={d} />
          <h3>How this score is formed</h3>
          <ol className="ss-steps">
            <Step n={1} title="Prior" value={perMonth(d.prior.mean)}>
              {t.prior}
            </Step>
            <Step n={2} title="Data" value={d.data.data_rate === null ? 'none' : perMonth(d.data.data_rate)}>
              {t.data}
            </Step>
            <Step n={3} title="Posterior" value={perMonth(post.mean)}>
              {t.post}
            </Step>
            <Step n={4} title="Low-history cap" value={cap.applied ? `capped to ${rate(cap.value)}` : 'not applied'} warn={cap.applied}>
              {t.cap}
            </Step>
            <Step n={5} title="Final score" value={perMonth(d.score)} emph>
              {t.final}
            </Step>
            <Step n={6} title="Calibrated" value={cal ? perMonth(cal.value) : 'not shown'}>
              {t.cal}
            </Step>
          </ol>
          <p className="caveat">{rangeNote(d)}</p>
        </>
      ) : (
        <>
          <h3>How this score is formed</h3>
          <Brief d={d} t={t} />
          <p className="ss-bd-note small">
            <span>Historical, not a forecast for a new trial.</span>{' '}
            <InfoTip label="About this range" content={<>{rangeNote(d)}</>} />
          </p>
        </>
      )}
    </div>
  )
}

function Step({ n, title, value, children, warn, emph }: { n: number; title: string; value: ReactNode; children: ReactNode; warn?: boolean; emph?: boolean }) {
  return (
    <li className={`ss-step${warn ? ' ss-step-warn' : ''}${emph ? ' ss-step-emph' : ''}`}>
      <span className="ss-step-num num">{n}</span>
      <div className="ss-step-body">
        <div className="ss-step-head">
          <span className="ss-step-title">{title}</span>
          <span className="ss-step-value num">{value}</span>
        </div>
        <div className="small ss-step-text">{children}</div>
      </div>
    </li>
  )
}

/** Simple: three steps (history, score, calibrated) with the full step texts in their cards. */
function Brief({ d, t }: { d: SiteDetail; t: ReturnType<typeof stepTexts> }) {
  const { data, cap, calibrated: cal, history: h } = d
  const unseen = h.n_fit === 0
  const w = data.data_weight
  return (
    <ol className="ss-brief">
      <BriefStep
        n={1}
        title="History"
        value={data.data_rate === null ? 'none' : perMonth(data.data_rate)}
        info={
          <>
            <span className="hc-title">Step 1: Prior</span>
            <p>{t.prior}</p>
            <span className="hc-title">Step 2: Data</span>
            <p>{t.data}</p>
          </>
        }
      >
        {unseen ? (
          <>No completed trial at this site is in the fit.</>
        ) : (
          <>
            {int(h.n_fit)} fitted {plural(h.n_fit, 'trial')}: {fixed(data.sum_n_hat, 1)} patients allocated here over{' '}
            {fixed(data.sum_exposure, 1)} exposure months.
          </>
        )}
      </BriefStep>
      <BriefStep
        n={2}
        title="Score"
        value={perMonth(d.score)}
        emph
        info={
          <>
            <span className="hc-title">Step 3: Posterior</span>
            <p>{t.post}</p>
            <span className="hc-title">Step 4: Low-history cap</span>
            <p>{t.cap}</p>
            <span className="hc-title">Step 5: Final score</span>
            <p>{t.final}</p>
          </>
        }
      >
        {unseen ? (
          <>The unseen-site rate, the prior&rsquo;s {fixed(cap.quantile * 100, 0)}th percentile: not a measurement of this site.</>
        ) : (
          <>
            Its own data (weight {fixed(w, 3)}) combined with the all-trials prior (weight {fixed(1 - w, 3)}).
            {cap.applied ? (
              <>
                {' '}
                <Qualifier>Capped</Qualifier> at the prior&rsquo;s {fixed(cap.quantile * 100, 0)}th percentile: fewer than {cap.threshold}{' '}
                fitted trials.
              </>
            ) : cap.low_history ? (
              <>
                {' '}
                <Qualifier>Low history</Qualifier>: already below the cap, so it stands.
              </>
            ) : null}
          </>
        )}
      </BriefStep>
      <BriefStep
        n={3}
        title="Calibrated"
        value={cal ? perMonth(cal.value) : 'not shown'}
        info={
          <>
            <span className="hc-title">Step 6: Calibrated</span>
            <p>{t.cal}</p>
          </>
        }
      >
        {cal ? (
          <>
            Shrunk toward the U.S. average by the slope measured on later trials, b = {fixed(cal.b)}
            {cal.relative_to_us_mean ? '; outside the U.S., so relative to the U.S. average' : ''}.
          </>
        ) : (
          <>Omitted: the validation file is missing.</>
        )}
      </BriefStep>
    </ol>
  )
}

function BriefStep({ n, title, value, info, emph, children }: { n: number; title: string; value: ReactNode; info: ReactNode; emph?: boolean; children: ReactNode }) {
  return (
    <li className={`ss-brief-step${emph ? ' ss-brief-emph' : ''}`}>
      <span className="ss-step-num num">{n}</span>
      <div className="ss-step-body">
        <div className="ss-step-head">
          <span className="ss-step-title">
            {title} <InfoTip label={`Details: ${title}`} content={info} />
          </span>
          <span className="ss-step-value num">{value}</span>
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
          <span className="ss-strip-note small num">{r.note}</span>
        </div>
      ))}
      <div className="ss-strip-row ss-strip-axis">
        <span className="ss-strip-label" />
        <span className="ss-strip-track ss-strip-ticks small num">
          {ticks.map((t) => (
            <span key={t} style={{ left: x(10 ** t) }}>
              {decade(t)}
            </span>
          ))}
        </span>
        <span className="ss-strip-note" />
      </div>
      <p className="small muted ss-strip-legend">
        Bands: prior and posterior 10th&ndash;90th percentiles
        {post.interval_method === 'poisson_fallback' ? null : <> (the posterior&rsquo;s includes trial-to-trial variation)</>};
        calibrated across b&rsquo;s 95% interval. Vertical line: low-history cap {rate(prior.p25)}. Log scale, per month.
      </p>
    </div>
  )
}

/* ---------- contributing trials ---------- */

type TrialSort = 'start' | 'enrollment' | 'n_sites' | 'n_hat' | 'trial_rate'

function Contributing({ d, stale, detailed }: { d: SiteDetail; stale: boolean; detailed: boolean }) {
  const [sort, setSort] = useState<{ k: TrialSort; desc: boolean }>({ k: 'start', desc: true })
  const [all, setAll] = useState(false) // reset per site: the parent keys this component by site id
  const rows = useMemo(() => {
    const k = sort.k
    const cmp = (a: ContribTrial, b: ContribTrial): number => (k === 'start' ? a.start.localeCompare(b.start) : a[k] - b[k])
    return [...d.trials].sort((a, b) => {
      const c = cmp(a, b) || a.nct_id.localeCompare(b.nct_id)
      return sort.desc ? -c : c
    })
  }, [d.trials, sort])
  const n = d.trials.length
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
  const facility = d.site.facility ?? 'This site'
  const table = (
    <>
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
                <td className="small num nowrap ss-left">
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
      {rows.length > TRIALS_SHOWN && (
        <button className="btn btn-small ss-more" onClick={() => setAll((a) => !a)}>
          {all ? `Show the first ${TRIALS_SHOWN}` : `Show all ${int(rows.length)}`}
        </button>
      )}
    </>
  )
  return (
    <div className={`ss-contrib${stale ? ' ss-stale' : ''}`}>
      <Section
        title={`${int(n)} completed ${plural(n, 'trial')} behind this score`}
        lede={
          n === 0 ? (
            <span className="ss-contrib-lede">
              {facility}: no completed trial at this site is in the fit, so its score is the unseen-site rate.
            </span>
          ) : detailed ? (
            <span className="ss-contrib-lede">
              {facility}. Each trial&rsquo;s actual enrollment N is split across its registered sites in proportion to the
              sites&rsquo; rates (the final of {d.method.iters} rounds). <strong>Allocated here</strong> next to the{' '}
              <strong>equal split</strong> N / sites shows where the split moved enrollment toward or away from this site: in
              total {fixed(sumHat, 1)} patients allocated here against {fixed(sumEq, 1)} under an equal split; above the equal
              split in {int(above)} of {int(n)} trials. Window = {fixed(d.method.enroll_fraction * 100, 0)}% of start to primary
              completion; it is also the exposure.
            </span>
          ) : (
            <span className="ss-contrib-lede">
              {facility}. Each trial&rsquo;s actual enrollment is split across its registered sites in proportion to the
              sites&rsquo; rates; the table shows where the split moved enrollment toward or away from this site.
            </span>
          )
        }
        figure={
          n > 0 ? (
            <div className="ss-kfs">
              <KeyFigure layout="inline" value={fixed(sumHat, 1)} label="patients allocated here" sub={`against ${fixed(sumEq, 1)} under an equal split`} />
              <KeyFigure layout="inline" value={`${int(above)} of ${int(n)}`} label="trials above the equal split" />
            </div>
          ) : undefined
        }
        detailsLabel={`Details: the ${int(n)} ${plural(n, 'trial')} and the split`}
        details={
          n > 0 ? (
            <>
              {table}
              <NotFit d={d} />
            </>
          ) : undefined
        }
      >
        {n === 0 && <NotFit d={d} />}
      </Section>
    </div>
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
    <span className="ss-split" title={`Allocated ${fixed(nhat, 2)} vs equal split ${fixed(eq, 2)}${over ? ' (more than twice the equal split)' : ''}`}>
      <span className="ss-split-fill" style={{ width: `${w}%` }} />
      <span className="ss-split-tick" />
    </span>
  )
}

function NotFit({ d }: { d: SiteDetail }) {
  const h = d.history
  if (h.n_not_fit === 0) return <p className="small muted ss-notfit-none">All {int(h.n_hist)} lifetime lung trials at this site are in the fit.</p>
  return (
    <div className="ss-notfit">
      <h3>
        Not in the fit: {int(h.n_not_fit)} of {int(h.n_hist)} lifetime lung trials at this site
      </h3>
      <ul className="small">
        {h.not_fit.map((r) => (
          <li key={r.reason}>
            <strong className="num">{int(r.n)}</strong> {r.reason}
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
