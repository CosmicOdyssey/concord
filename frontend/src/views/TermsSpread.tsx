// Locality distribution and spread comparison (P2.5, P2.6), shown inside the Compare step of the Terms screen.
// Every number comes from the API (concord/terms_spread.py): CMS 2026 PFS RVUs and GPCIs, CMS CLFS 2026 Q4 national
// amounts, and the proposed standard schedule. The two bands are user-set assumptions and say so.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Details, ErrorBox, HoverCard, InfoTip, Loading, Qualifier } from '../components'
import { useDensity } from '../density'
import { usd } from '../format'
import { DISCLAIMER, PROPOSED_STANDARD_TAG, localityTitle, type Overrides, type StandardEdits } from '../termsFlowApi'
import { spreadApi, type Bands, type LocalityDistribution, type LocalityRow, type SiteMark, type Spreads } from '../termsSpreadApi'
import './termsSpread.css'

const DEFAULT_BANDS: Bands = { multLo: 100, multHi: 150, feeLo: 75, feeHi: 125 }
const BANDS_KEY = 'tf:spread-bands:v1'
const SITE_TAG = ['A', 'B'] as const

/** Medicare locality key -> the letters of the selected sites in it: 'A', 'B', or 'AB' when both share one. */
function siteTags(sites: SiteMark[]): Map<string | null, string> {
  const m = new Map<string | null, string>()
  sites.forEach((s, i) => m.set(s.key, (m.get(s.key) ?? '') + SITE_TAG[i]))
  return m
}

/** 'AB' -> 'A·B' for the marker; the colour follows the first letter. */
function tagText(tag: string): string {
  return tag.split('').join('·')
}

function tagLabel(tag: string): string {
  return tag.length > 1 ? `Sites ${tag.split('').join(' and ')}` : `Site ${tag}`
}

function readBands(): Bands {
  try {
    const raw = window.localStorage.getItem(BANDS_KEY)
    if (!raw) return DEFAULT_BANDS
    const v = JSON.parse(raw) as Partial<Bands>
    const ok = (x: unknown) => typeof x === 'number' && Number.isFinite(x)
    return ok(v.multLo) && ok(v.multHi) && ok(v.feeLo) && ok(v.feeHi) ? (v as Bands) : DEFAULT_BANDS
  } catch {
    return DEFAULT_BANDS
  }
}

function writeBands(b: Bands) {
  try {
    window.localStorage.setItem(BANDS_KEY, JSON.stringify(b))
  } catch {
    /* storage blocked: the bands still work for this visit */
  }
}

function bandError(b: Bands): string | null {
  if (!(b.multLo >= 10 && b.multLo <= b.multHi && b.multHi <= 500)) return 'Multiplier band: low from 10% and at most high, high up to 500%.'
  if (!(b.feeLo >= 0 && b.feeLo <= b.feeHi && b.feeHi <= 500)) return 'Fee band: low from 0% and at most high, high up to 500%.'
  return null
}

type Load<T> = { data: T | null; error: string | null; loading: boolean; stale: boolean; retry: () => void }

/** Fetch keyed by `key` (null: nothing to fetch). The last good result stays on screen, marked stale, while a new
 *  key loads. */
function useLoad<T>(key: string | null, fn: (signal: AbortSignal) => Promise<T>): Load<T> {
  const [res, setRes] = useState<{ key: string; data?: T; error?: string } | null>(null)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  useEffect(() => {
    if (key === null) return
    const ctl = new AbortController()
    fnRef.current(ctl.signal).then(
      (data) => !ctl.signal.aborted && setRes({ key, data }),
      (e: unknown) => !ctl.signal.aborted && setRes({ key, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => ctl.abort()
  }, [key, tick])
  const current = !!res && res.key === key
  return {
    data: res?.data ?? null,
    error: current && res?.error ? res.error : null,
    loading: !current,
    stale: !!res?.data && !current,
    retry: () => setTick((t) => t + 1),
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

function ordinal(p: number): string {
  const n = Math.max(1, Math.min(100, Math.round(p)))
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${s}`
}

function wholeUsd(x: number): string {
  return `$${Math.round(x).toLocaleString('en-US')}`
}

function niceStep(raw: number, steps: number[]): number {
  return steps.find((s) => s >= raw) ?? steps[steps.length - 1]
}

/** Axis labels are centred on their tick, except at the ends, where they align inward so they stay in the box. */
function tickClass(p: number): string {
  return p < 4 ? 'tsp-tick tsp-tick-first' : p > 96 ? 'tsp-tick tsp-tick-last' : 'tsp-tick'
}

function locName(r: { name: string; state: string; code: string }): string {
  return `${localityTitle(r.name)} (${r.state} ${r.code})`
}

function Src({ children }: { children: ReactNode }) {
  return <span className="hc-src">{children}</span>
}

// ====================================================================== component

export default function TermsSpread({
  nct,
  siteA,
  siteB,
  overrides,
  standard,
}: {
  nct: string
  siteA: string
  siteB: string | null
  overrides: Overrides
  standard: StandardEdits
}) {
  const detailed = useDensity().density === 'detailed'
  const [bands, setBandsState] = useState<Bands>(readBands)
  const setBands = (b: Bands) => {
    setBandsState(b)
    writeBands(b)
  }
  const dbands = useDebounced(bands, 300)
  const bandErr = bandError(dbands)
  const ov = JSON.stringify(overrides)
  const dist = useLoad<LocalityDistribution>(siteA ? `d:${nct}:${siteA}:${siteB}:${ov}` : null, (s) =>
    spreadApi.distribution(nct, siteA, siteB, overrides, s),
  )
  const spr = useLoad<Spreads>(siteA && !bandErr ? `s:${nct}:${siteA}:${siteB}:${ov}:${JSON.stringify(standard)}:${JSON.stringify(dbands)}` : null, (s) =>
    spreadApi.spreads(nct, siteA, siteB, dbands, overrides, standard, s),
  )
  const d = dist.data && dist.data.nct_id === nct ? dist.data : null
  const sp = spr.data && spr.data.nct_id === nct ? spr.data : null
  const h1 = useId()
  const h2 = useId()

  return (
    <div className="tsp">
      <section className="tsp-block" aria-labelledby={h1}>
        <div className="tsp-head">
          <h3 id={h1}>The same procedures in every Medicare locality</h3>
          <InfoTip label="Details: the same procedures in every Medicare locality" content={<DistInfo d={d} />} />
        </div>
        {dist.error && <ErrorBox error={dist.error} onRetry={dist.retry} />}
        {!d && !dist.error && <Loading label="Pricing every locality…" />}
        {d && (
          <div className={dist.stale ? 'tf-stale' : undefined}>
            <DistSentence d={d} />
            <ul className="tf-quals tsp-quals">
              <li>
                <Qualifier tone="muted" info={<WeightInfo d={d} />}>
                  At 100% of Medicare; each locality counts once
                </Qualifier>
              </li>
              <li>
                <Qualifier tone="muted" info={<LabInfo d={d} />}>
                  Lab lines add the same {usd(d.lab_constant)} everywhere
                </Qualifier>
              </li>
              {d.n_placeholder_lines > 0 && (
                <li>
                  <Qualifier>Includes placeholder lab prices</Qualifier>
                </li>
              )}
              {d.n_unadjusted_lines > 0 && (
                <li>
                  <Qualifier
                    info={
                      <>
                        <span className="hc-title">Placeholder fee-schedule prices</span>
                        <p>
                          {d.n_unadjusted_lines} lines, {usd(d.unadjusted_constant)} per participant. {d.unadjusted_note}.
                        </p>
                      </>
                    }
                  >
                    Includes placeholder fee-schedule prices, not adjusted by locality
                  </Qualifier>
                </li>
              )}
            </ul>
            <DistFigures d={d} />
            <StripPlot d={d} />
            {detailed ? (
              <LocalityTable d={d} />
            ) : (
              <Details summary={`All ${d.stats.n} localities, sortable`} className="section-disclosure">
                <LocalityTable d={d} />
              </Details>
            )}
          </div>
        )}
      </section>

      <section className="tsp-block" aria-labelledby={h2}>
        <div className="tsp-head">
          <h3 id={h2}>What widens the range, in dollars per participant</h3>
          <InfoTip label="Details: what widens the range" content={<SpreadInfo />} />
        </div>
        {sp && <SpreadSentence sp={sp} />}
        {detailed ? (
          <BandControls bands={bands} setBands={setBands} />
        ) : (
          <Details summary="Change the two bands (assumptions)" className="section-disclosure">
            <BandControls bands={bands} setBands={setBands} />
          </Details>
        )}
        {bandErr && <p className="small note" role="alert">{bandErr}</p>}
        {spr.error && <ErrorBox error={spr.error} onRetry={spr.retry} />}
        {!sp && !spr.error && !bandErr && <Loading label="Computing the ranges…" />}
        {sp && (
          <div className={spr.stale ? 'tf-stale' : undefined}>
            <RangeBars sp={sp} />
            {detailed && <SpreadDetails sp={sp} />}
          </div>
        )}
        <p className="small muted tsp-disclaimer">
          <Qualifier>{DISCLAIMER}</Qualifier> Fee-schedule amounts are public benchmarks for the fair-value discussion; they do not change what the
          sponsor owes or when.
        </p>
      </section>
    </div>
  )
}

// ====================================================================== P2.5 locality distribution

function DistInfo({ d }: { d: LocalityDistribution | null }) {
  return (
    <>
      <span className="hc-title">How each locality is priced</span>
      <p>
        The sponsor-paid procedure lines with a billing code (screening through cycle 8, end of treatment and safety follow-up) are priced in every
        Medicare payment locality with the budget’s own formula: per physician-fee-schedule line, (work RVU × work GPCI + PE RVU × PE GPCI + MP RVU ×
        MP GPCI) × conversion factor, rounded to the cent, at 100% of Medicare.
      </p>
      <p>
        Lab lines are national amounts. Per-visit fees and coordinator time are left out: they are the same at every site. Overhead is left out too;
        it is a rate on these lines plus coordinator time, so it moves with them.
      </p>
      {d && (
        <>
          <Src>{d.sources.gpci}</Src>
          <Src>
            {d.sources.pfs}; conversion factor {d.sources.conversion_factor}
          </Src>
          {d.sources.clfs && <Src>{d.sources.clfs}</Src>}
        </>
      )}
    </>
  )
}

function WeightInfo({ d }: { d: LocalityDistribution }) {
  return (
    <>
      <span className="hc-title">What the distribution counts</span>
      <p>
        {d.stats.n} Medicare payment localities in the {d.sources.gpci_short}, each counted once, whatever its number of sites or beneficiaries. It is
        the fee schedule’s geography, not a survey of what sites charge.
      </p>
      <p>{d.percentile_method}.</p>
      <p>{d.quantile_method}.</p>
      <Src>{d.sources.gpci}</Src>
    </>
  )
}

function LabInfo({ d }: { d: LocalityDistribution }) {
  return (
    <>
      <span className="hc-title">Lab lines</span>
      <p>
        {d.n_lab_lines} lab lines, {usd(d.lab_constant)} per participant. {d.lab_note}.
      </p>
      <Src>{d.sources.clfs ?? 'CMS CLFS file not loaded: placeholder amounts'}</Src>
    </>
  )
}

function DistSentence({ d }: { d: LocalityDistribution }) {
  const st = d.stats
  const marked = d.sites.filter((s) => s.percentile !== null)
  return (
    <p className="tsp-lede">
      At 100% of Medicare, this protocol’s sponsor-paid procedures cost <span className="tnum strong">{usd(st.min)}</span> to{' '}
      <span className="tnum strong">{usd(st.max)}</span> per participant across the {st.n} Medicare localities (median{' '}
      <span className="tnum">{usd(st.median)}</span>)
      {marked.length > 0 && (
        <>
          ;{' '}
          {marked.map((s, i) => (
            <span key={s.site_id}>
              {i > 0 && ' and '}Site {SITE_TAG[d.sites.indexOf(s)]} sits at the <span className="tnum strong">{ordinal(s.percentile as number)}</span>{' '}
              percentile
            </span>
          ))}
        </>
      )}
      .
    </p>
  )
}

function SiteCard({ s, tag, d }: { s: SiteMark; tag: string; d: LocalityDistribution }) {
  return (
    <div className={`tsp-fig tsp-fig-${tag.toLowerCase()}`}>
      <p className="tsp-fig-label">
        <span className={`tsp-key tsp-key-${tag.toLowerCase()}`} aria-hidden="true">
          {tag}
        </span>
        Site {tag} percentile
      </p>
      <p className="tsp-fig-value num">{s.percentile === null ? 'n/a' : ordinal(s.percentile)}</p>
      <p className="tsp-fig-sub">
        <HoverCard
          content={
            <>
              <span className="hc-title">{s.label}</span>
              {s.locality ? (
                <>
                  <span className="tf-hc-kv">
                    <span>Medicare locality</span> <span>{locName(s.locality)}</span>
                  </span>
                  <span className="tf-hc-kv">
                    <span>GPCI work · PE · MP</span>{' '}
                    <span className="num">
                      {s.locality.gpci_work.toFixed(3)} · {s.locality.gpci_pe.toFixed(3)} · {s.locality.gpci_mp.toFixed(3)}
                    </span>
                  </span>
                </>
              ) : (
                <span>{s.note}</span>
              )}
              <span className="tf-hc-kv">
                <span>Physician fee schedule lines</span> <span className="num">{usd(s.pfs)}</span>
              </span>
              <span className="tf-hc-kv">
                <span>Lab lines (national)</span> <span className="num">{usd(s.lab)}</span>
              </span>
              {s.unadjusted > 0 && (
                <span className="tf-hc-kv">
                  <span>Placeholder fee-schedule lines (national)</span> <span className="num">{usd(s.unadjusted)}</span>
                </span>
              )}
              {s.n_below !== null && (
                <span>
                  {s.n_below} of {d.stats.n} localities price these procedures lower{s.n_same && s.n_same > 1 ? `, ${s.n_same - 1} the same` : ''}.
                </span>
              )}
              <span>Equals this site’s procedure lines in the budget at 100%: {usd(s.budget_procedure_total)}.</span>
              <Src>{d.sources.gpci}</Src>
            </>
          }
        >
          <span className="num">{usd(s.total)}</span> {s.locality ? `in ${localityTitle(s.locality.name)}` : 'at national amounts'}
        </HoverCard>
      </p>
    </div>
  )
}

function DistFigures({ d }: { d: LocalityDistribution }) {
  const st = d.stats
  const byKey = new Map(d.localities.map((r) => [r.key, r]))
  const names = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((r): r is LocalityRow => !!r)
  return (
    <div className="tsp-figs">
      {d.sites.map((s, i) => (
        <SiteCard key={s.site_id} s={s} tag={SITE_TAG[i]} d={d} />
      ))}
      <dl className="tsp-mmm">
        <div>
          <dt>Lowest</dt>
          <dd>
            <HoverCard
              content={
                <>
                  <span className="hc-title">Lowest-priced locality</span>
                  {names(st.min_localities).map((r) => (
                    <span key={r.key}>{locName(r)}</span>
                  ))}
                  <Src>{d.sources.gpci}</Src>
                </>
              }
            >
              <span className="num">{usd(st.min)}</span>
            </HoverCard>
            <span className="tsp-mmm-where">{names(st.min_localities).map((r) => localityTitle(r.name)).join(', ')}</span>
          </dd>
        </div>
        <div>
          <dt>Median</dt>
          <dd>
            <HoverCard
              content={
                <>
                  <span className="hc-title">Median and p10–p90 of localities</span>
                  <span className="tf-hc-kv">
                    <span>Median</span> <span className="num">{usd(st.median)}</span>
                  </span>
                  <span className="tf-hc-kv">
                    <span>p10</span> <span className="num">{usd(st.p10)}</span>
                  </span>
                  <span className="tf-hc-kv">
                    <span>p90</span> <span className="num">{usd(st.p90)}</span>
                  </span>
                  <span>{d.quantile_method}; each locality counts once.</span>
                  <Src>{d.sources.gpci}</Src>
                </>
              }
            >
              <span className="num">{usd(st.median)}</span>
            </HoverCard>
            <span className="tsp-mmm-where">
              p10–p90 {wholeUsd(st.p10)}–{wholeUsd(st.p90)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Highest</dt>
          <dd>
            <HoverCard
              content={
                <>
                  <span className="hc-title">Highest-priced locality</span>
                  {names(st.max_localities).map((r) => (
                    <span key={r.key}>{locName(r)}</span>
                  ))}
                  <Src>{d.sources.gpci}</Src>
                </>
              }
            >
              <span className="num">{usd(st.max)}</span>
            </HoverCard>
            <span className="tsp-mmm-where">{names(st.max_localities).map((r) => localityTitle(r.name)).join(', ')}</span>
          </dd>
        </div>
      </dl>
    </div>
  )
}

const DOT_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
const TICK_STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000]

/** Dot plot: one dot per locality, stacked in equal-width dollar bins; the two sites' localities are filled and
 *  tagged. Hover a dot for its locality; the table below has every value for keyboard and screen readers. */
function StripPlot({ d }: { d: LocalityDistribution }) {
  const [hover, setHover] = useState<string | null>(null)
  const st = d.stats
  const siteKeys = useMemo(() => new Set(d.sites.map((s) => s.key)), [d.sites])
  const layout = useMemo(() => {
    const bin = niceStep((st.max - st.min) / 24 || 1, DOT_STEPS)
    const lo = Math.floor(st.min / bin) * bin
    const nb = Math.floor((st.max - lo) / bin) + 1
    const hi = lo + nb * bin
    const cols = new Map<number, LocalityRow[]>()
    // Within a bin, the sites' localities go on top so their tags never cover another dot.
    const top = (r: LocalityRow) => (siteKeys.has(r.key) ? 1 : 0)
    for (const r of [...d.localities].sort((a, b) => top(a) - top(b) || a.total - b.total)) {
      const i = Math.min(nb - 1, Math.floor((r.total - lo) / bin))
      cols.set(i, [...(cols.get(i) ?? []), r])
    }
    const dots: { r: LocalityRow; x: number; y: number }[] = []
    let maxStack = 1
    for (const [i, rs] of cols) {
      maxStack = Math.max(maxStack, rs.length)
      rs.forEach((r, j) => dots.push({ r, x: ((i + 0.5) / nb) * 100, y: j }))
    }
    const tick = niceStep((hi - lo) / 4, TICK_STEPS)
    const ticks: number[] = []
    for (let t = Math.ceil(lo / tick) * tick; t <= hi + 1e-9; t += tick) ticks.push(t)
    return { bin, lo, hi, dots, maxStack, ticks }
  }, [d.localities, st.max, st.min, siteKeys])
  const siteKey = siteTags(d.sites)
  const shared = [...siteKey.values()].some((t) => t.length > 1)
  const pos = (v: number) => ((v - layout.lo) / (layout.hi - layout.lo)) * 100
  const hov = hover ? layout.dots.find((x) => x.r.key === hover) : null
  const STEP = 11
  const plotH = layout.maxStack * STEP + 30
  return (
    <figure className="tsp-strip">
      <div className="tsp-strip-plot" style={{ height: `${plotH}px` }} onPointerLeave={() => setHover(null)}>
        <span
          className="tsp-band"
          style={{ left: `${pos(st.p10)}%`, width: `${pos(st.p90) - pos(st.p10)}%` }}
          aria-hidden="true"
          title="p10 to p90 of localities"
        />
        <span className="tsp-median" style={{ left: `${pos(st.median)}%` }} aria-hidden="true" />
        {layout.dots.map(({ r, x, y }) => {
          const tag = siteKey.get(r.key)
          return (
            <span
              key={r.key}
              className={`tsp-dot${tag ? ` tsp-dot-${tag[0].toLowerCase()}` : ''}${hover === r.key ? ' tsp-dot-on' : ''}`}
              style={{ left: `${x}%`, bottom: `${y * STEP + 4}px` }}
              onPointerEnter={() => setHover(r.key)}
              aria-hidden="true"
            >
              {tag && <span className={`tsp-tag tsp-key tsp-key-${tag[0].toLowerCase()}`}>{tagText(tag)}</span>}
            </span>
          )
        })}
        {hov && (
          <span className={`tsp-tip${hov.x > 60 ? ' tsp-tip-left' : ''}`} style={{ left: `${hov.x}%`, bottom: `${hov.y * STEP + 18}px` }} role="presentation">
            <strong>{locName(hov.r)}</strong>
            <span className="num">{usd(hov.r.total)}</span> · {ordinal(hov.r.percentile)} percentile
          </span>
        )}
      </div>
      <div className="tsp-axis" aria-hidden="true">
        {layout.ticks.map((t) => (
          <span key={t} className={tickClass(pos(t))} style={{ left: `${pos(t)}%` }}>
            {wholeUsd(t)}
          </span>
        ))}
      </div>
      <figcaption>
        One dot per Medicare locality ({d.stats.n}), in {wholeUsd(layout.bin)} bins of the per-participant procedure cost at 100% of Medicare. The
        shaded band is p10–p90 and the line the median. Filled dots tagged A and B are the two sites’ localities
        {shared ? '; A·B marks the one locality both sites share' : ''}.
        <span className="sr-only">
          {' '}
          Range {usd(st.min)} to {usd(st.max)}, median {usd(st.median)}.
          {d.sites.map((s, i) => ` Site ${SITE_TAG[i]}: ${usd(s.total)}, ${s.percentile === null ? 'not placed' : `${ordinal(s.percentile)} percentile`}.`)}
        </span>
      </figcaption>
    </figure>
  )
}

type SortKey = 'name' | 'state' | 'gpci_work' | 'gpci_pe' | 'gpci_mp' | 'pfs' | 'total'
type Sort = { k: SortKey; desc: boolean }

/** A sortable column heading: a real button; numbers sort high-to-low first, text A-to-Z. */
function SortTh({ k, label, num, sort, setSort }: { k: SortKey; label: string; num?: boolean; sort: Sort; setSort: (s: Sort) => void }) {
  const on = sort.k === k
  return (
    <th scope="col" className={`sortable${num ? ' num' : ''}`} aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => setSort({ k, desc: on ? !sort.desc : !!num })}>
        {label}
        <span className="sort-ind" aria-hidden="true">
          {on ? (sort.desc ? '▼' : '▲') : ''}
        </span>
      </button>
    </th>
  )
}

function LocalityTable({ d }: { d: LocalityDistribution }) {
  const [sort, setSort] = useState<Sort>({ k: 'total', desc: true })
  const siteKey = siteTags(d.sites)
  const rows = useMemo(() => {
    const out = [...d.localities]
    out.sort((a, b) => {
      const va = a[sort.k]
      const vb = b[sort.k]
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return sort.desc ? -c : c
    })
    return out
  }, [d.localities, sort])
  const th = (k: SortKey, label: string, num?: boolean) => <SortTh k={k} label={label} num={num} sort={sort} setSort={setSort} />
  return (
    <div className="tsp-table">
      <p className="small muted">
        Every locality in the {d.sources.gpci_short}, priced with the budget’s formula at 100% of Medicare. Lab lines ({usd(d.lab_constant)}) are in each
        total. Select a column heading to sort.
      </p>
      <div className="table-scroll tsp-table-scroll" tabIndex={0} role="region" aria-label={`All ${d.stats.n} Medicare localities, scrollable table`}>
        <table className="tbl tbl-compact">
          <caption className="sr-only">Per-participant procedure cost in every Medicare locality</caption>
          <thead>
            <tr>
              {th('name', 'Locality')}
              {th('state', 'State')}
              {th('gpci_work', 'Work GPCI', true)}
              {th('gpci_pe', 'PE GPCI', true)}
              {th('gpci_mp', 'MP GPCI', true)}
              {th('pfs', 'Fee-schedule lines', true)}
              {th('total', 'With labs', true)}
              <th scope="col" className="num">
                Percentile
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tag = siteKey.get(r.key)
              return (
                <tr key={r.key} className={tag ? 'tsp-row-site' : undefined}>
                  <th scope="row">
                    {tag && (
                      <span className={`tsp-key tsp-key-${tag[0].toLowerCase()}`} aria-label={tagLabel(tag)}>
                        {tagText(tag)}
                      </span>
                    )}{' '}
                    {localityTitle(r.name)} <span className="muted small">{r.code}</span>
                  </th>
                  <td>{r.state}</td>
                  <td className="num">{r.gpci_work.toFixed(3)}</td>
                  <td className="num">{r.gpci_pe.toFixed(3)}</td>
                  <td className="num">{r.gpci_mp.toFixed(3)}</td>
                  <td className="num">{usd(r.pfs)}</td>
                  <td className="num strong">{usd(r.total)}</td>
                  <td className="num">{ordinal(r.percentile)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Source: {d.sources.gpci}; {d.sources.pfs}, conversion factor {d.sources.conversion_factor}; {d.sources.clfs ?? 'CLFS not loaded'}.
      </p>
    </div>
  )
}

// ====================================================================== P2.6 spread comparison

function SpreadInfo() {
  return (
    <>
      <span className="hc-title">Three ranges, one dollar axis</span>
      <p>
        Geography: the procedure lines across all Medicare localities at 100% of Medicare (CMS GPCIs). Multiplier band: the same lines at one site, at
        the low and high % of Medicare you set. Non-procedure fees: coordinator time and per-visit research fees on the fixed schedule, from the
        proposed standard schedule, times the band you set.
      </p>
      <p>Both bands are assumptions, not benchmarks. Overhead, per-site one-time fees and per-occurrence visits are outside these ranges.</p>
    </>
  )
}

function SpreadSentence({ sp }: { sp: Spreads }) {
  const g = sp.geography
  const f = sp.fees
  return (
    <p className="tsp-lede">
      Geography moves the procedure lines by <span className="tnum strong">{usd(g.width)}</span> per participant across localities (
      <span className="tnum">{usd(g.width_p10_p90)}</span> from p10 to p90)
      {sp.multiplier.map((m, i) => (
        <span key={m.id}>
          ; a {Math.round(m.m_low * 100)}%–{Math.round(m.m_high * 100)}% multiplier moves them by <span className="tnum strong">{usd(m.width)}</span>{' '}
          at Site {SITE_TAG[i]}
        </span>
      ))}
      ; a {Math.round(f.f_low * 100)}%–{Math.round(f.f_high * 100)}% band on non-procedure fees moves those by{' '}
      <span className="tnum strong">{usd(f.width)}</span>.
    </p>
  )
}

function PctField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="tf-num-input">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={5}
          value={draft ?? String(value)}
          onChange={(e) => {
            const s = e.target.value
            setDraft(s)
            const n = Number(s)
            if (s !== '' && Number.isFinite(n)) onChange(n)
          }}
          onBlur={() => setDraft(null)}
        />
        <span aria-hidden="true">%</span>
      </span>
    </label>
  )
}

function BandControls({ bands, setBands }: { bands: Bands; setBands: (b: Bands) => void }) {
  const isDefault = JSON.stringify(bands) === JSON.stringify(DEFAULT_BANDS)
  return (
    <div className="tsp-bands">
      <fieldset className="tsp-band-set">
        <legend>
          Multiplier band at the site <Qualifier>Assumption</Qualifier>
        </legend>
        <div className="tf-controls">
          <PctField label="Low, % of Medicare" value={bands.multLo} min={10} max={500} onChange={(v) => setBands({ ...bands, multLo: v })} />
          <PctField label="High, % of Medicare" value={bands.multHi} min={10} max={500} onChange={(v) => setBands({ ...bands, multHi: v })} />
        </div>
      </fieldset>
      <fieldset className="tsp-band-set">
        <legend>
          Non-procedure fee band <Qualifier>Assumption: no public benchmark for these fees</Qualifier>
        </legend>
        <div className="tf-controls">
          <PctField label="Low, % of proposed standard" value={bands.feeLo} min={0} max={500} onChange={(v) => setBands({ ...bands, feeLo: v })} />
          <PctField label="High, % of proposed standard" value={bands.feeHi} min={0} max={500} onChange={(v) => setBands({ ...bands, feeHi: v })} />
        </div>
      </fieldset>
      <button type="button" className="btn btn-ghost tsp-reset" onClick={() => setBands(DEFAULT_BANDS)} disabled={isDefault}>
        Reset to 100%–150% and 75%–125%
      </button>
    </div>
  )
}

interface BarRow {
  id: string
  name: string
  quantity: string
  low: number
  high: number
  width: number
  inner?: [number, number]
  tone: 'geo' | 'a' | 'b' | 'fees'
  qual: ReactNode
  card: ReactNode
}

function RangeBars({ sp }: { sp: Spreads }) {
  const g = sp.geography
  const f = sp.fees
  const rows: BarRow[] = [
    {
      id: g.id,
      name: 'Geography',
      quantity: `Procedure lines, ${g.n} localities at 100%`,
      low: g.low,
      high: g.high,
      width: g.width,
      inner: [g.p10, g.p90],
      tone: 'geo',
      qual: <Qualifier tone="muted">CMS GPCIs</Qualifier>,
      card: (
        <>
          <span className="hc-title">Geography (a)</span>
          <span className="tf-hc-kv">
            <span>Min–max</span>{' '}
            <span className="num">
              {usd(g.low)}–{usd(g.high)}
            </span>
          </span>
          <span className="tf-hc-kv">
            <span>p10–p90</span>{' '}
            <span className="num">
              {usd(g.p10)}–{usd(g.p90)}
            </span>
          </span>
          <span className="tf-hc-kv">
            <span>Median</span> <span className="num">{usd(g.median)}</span>
          </span>
          <span>{g.assumption}.</span>
          <Src>{g.source}</Src>
        </>
      ),
    },
    ...sp.multiplier.map((m, i): BarRow => {
      const tag = SITE_TAG[i]
      return {
        id: m.id,
        name: `Multiplier band, Site ${tag}`,
        quantity: `Procedure lines at ${m.locality ? localityTitle(m.locality.name) : 'national amounts'}, ${Math.round(m.m_low * 100)}%–${Math.round(m.m_high * 100)}%`,
        low: m.low,
        high: m.high,
        width: m.width,
        tone: tag === 'A' ? 'a' : 'b',
        qual: <Qualifier>Assumption</Qualifier>,
        card: (
          <>
            <span className="hc-title">
              Multiplier band at Site {tag} (b): {m.label}
            </span>
            <span className="tf-hc-kv">
              <span>At {Math.round(m.m_low * 100)}%</span> <span className="num">{usd(m.low)}</span>
            </span>
            <span className="tf-hc-kv">
              <span>At 100%</span> <span className="num">{usd(m.at_100)}</span>
            </span>
            <span className="tf-hc-kv">
              <span>At {Math.round(m.m_high * 100)}%</span> <span className="num">{usd(m.high)}</span>
            </span>
            <span>{m.assumption}. Each line is its locality amount × the multiplier, rounded to the cent, as in the budget.</span>
            <Src>{m.source}</Src>
          </>
        ),
      }
    }),
    {
      id: f.id,
      name: 'Non-procedure fees',
      quantity: `Coordinator time and per-visit research fees on the fixed schedule, ${Math.round(f.f_low * 100)}%–${Math.round(f.f_high * 100)}%`,
      low: f.low,
      high: f.high,
      width: f.width,
      tone: 'fees',
      qual: <Qualifier>Assumption: no public benchmark</Qualifier>,
      card: (
        <>
          <span className="hc-title">Non-procedure fees (c)</span>
          <span className="tf-hc-kv">
            <span>Proposed standard, per participant</span> <span className="num">{usd(f.base)}</span>
          </span>
          {f.items.map((it) => (
            <span key={it.id} className="tf-hc-kv">
              <span>
                {it.label} <span className="muted">× {it.count}</span>
              </span>{' '}
              <span className="num">{usd(it.amount)}</span>
            </span>
          ))}
          <span>{f.assumption}.</span>
          <Src>{PROPOSED_STANDARD_TAG}</Src>
        </>
      ),
    },
  ]
  const top = Math.max(...rows.map((r) => r.high), 1)
  const tick = niceStep(top / 4, TICK_STEPS)
  const axisMax = Math.ceil(top / tick) * tick
  const ticks: number[] = []
  for (let t = 0; t <= axisMax + 1e-9; t += tick) ticks.push(t)
  const pos = (v: number) => (v / axisMax) * 100
  return (
    <figure className="tsp-ranges">
      <ul className="tsp-range-list">
        {rows.map((r) => (
          <li key={r.id} className={`tsp-range tsp-range-${r.tone}`}>
            <div className="tsp-range-name">
              <HoverCard content={r.card}>
                <span className="strong">{r.name}</span>
              </HoverCard>{' '}
              {r.qual}
              <span className="tsp-range-q">{r.quantity}</span>
            </div>
            <div className="tsp-range-track" aria-hidden="true">
              <span className="tsp-range-bar" style={{ left: `${pos(r.low)}%`, width: `max(3px, ${pos(r.high) - pos(r.low)}%)` }} />
              {r.inner && <span className="tsp-range-inner" style={{ left: `${pos(r.inner[0])}%`, width: `max(3px, ${pos(r.inner[1]) - pos(r.inner[0])}%)` }} />}
            </div>
            <div className="tsp-range-v">
              <span className="num">
                {usd(r.low)}–{usd(r.high)}
              </span>
              <span className="tsp-range-w">
                range <span className="num strong">{usd(r.width)}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="tsp-range-axis" aria-hidden="true">
        <span className="tsp-range-axis-pad" />
        <span className="tsp-range-axis-track">
          {ticks.map((t) => (
            <span key={t} className={tickClass(pos(t))} style={{ left: `${pos(t)}%` }}>
              {wholeUsd(t)}
            </span>
          ))}
        </span>
      </div>
      <figcaption>
        Each bar runs from the low to the high per-participant amount on one dollar axis; the darker segment of the geography bar is p10–p90. Hover
        or focus a name for its numbers and source.
      </figcaption>
    </figure>
  )
}

function SpreadDetails({ sp }: { sp: Spreads }) {
  const f = sp.fees
  return (
    <div className="tsp-details">
      <h4>Non-procedure fees per participant, at the band</h4>
      <div className="table-scroll">
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              <th scope="col">Item (proposed standard)</th>
              <th scope="col" className="num">
                Unit
              </th>
              <th scope="col" className="num">
                Times
              </th>
              <th scope="col" className="num">
                Per participant
              </th>
              <th scope="col" className="num">
                At {Math.round(f.f_low * 100)}%
              </th>
              <th scope="col" className="num">
                At {Math.round(f.f_high * 100)}%
              </th>
            </tr>
          </thead>
          <tbody>
            {f.items.map((it) => (
              <tr key={it.id}>
                <th scope="row">
                  {it.label}
                  {it.edited && <span className="muted small"> (edited)</span>}
                </th>
                <td className="num">{usd(it.unit_amount)}</td>
                <td className="num">{it.count}</td>
                <td className="num">{usd(it.amount)}</td>
                <td className="num">{usd(it.low)}</td>
                <td className="num">{usd(it.high)}</td>
              </tr>
            ))}
            <tr className="tsp-total-row">
              <th scope="row">Total</th>
              <td />
              <td />
              <td className="num strong">{usd(f.base)}</td>
              <td className="num strong">{usd(f.low)}</td>
              <td className="num strong">{usd(f.high)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="tsp-notes small muted">
        <li>{sp.overhead_note}</li>
        <li>Lab lines add {usd(sp.lab_constant)} per participant at every site (national CLFS amounts) and are inside the procedure ranges.</li>
        {sp.unpriced_codes.length > 0 && <li>Unpriced codes, not counted as zero: {sp.unpriced_codes.join(', ')}.</li>}
        <li>Geography: {sp.sources.gpci}; {sp.sources.pfs}.</li>
        <li>Lab lines: {sp.sources.clfs ?? 'CMS CLFS file not loaded'}.</li>
        <li>Non-procedure fees: {sp.sources.standard}.</li>
      </ul>
    </div>
  )
}
