// Protocol to terms: pick a trial, read its (illustrative) schedule of assessments, review who pays for each item,
// price it at a registered U.S. site from the published Medicare fee schedules, edit the proposed standard
// non-procedure schedule, compare two sites, export the term sheet.
// Calm layout: five steps (protocol, coverage, budget, compare, term sheet). Simple shows each step's key totals with
// their qualifiers, and puts rules, provenance and line items in hover cards and the full tables in a "Details"
// disclosure; Detailed shows everything inline. Every control works in both densities.
// No forecasting anywhere: no enrollment, speed or time-to-fill numbers, and no savings claims.
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Badge, Banner, Details, ErrorBox, Gloss, HoverCard, InfoTip, KeyFigure, Loading, PageHead, Qualifier } from '../components'
import { useDensity } from '../density'
import { ctgovUrl, phaseLabel, usd } from '../format'
import { calDate } from '../landingData'
import {
  DISCLAIMER,
  ILLUSTRATIVE,
  PLACEHOLDER_TAG,
  PROPOSED_STANDARD_TAG,
  termsApi,
  type Budget,
  type Compare,
  type Coverage,
  type Line,
  type Locality,
  type NodeState,
  type Overrides,
  type PriceParams,
  type Protocol,
  type ProtocolNode,
  type Rule,
  type SiteOpt,
  type SitesResp,
  type StandardEdits,
  type StandardItem,
  type TrialCard,
  type VisitBudget,
  coverageLabel,
  formulaText,
  localityLabel,
  localityTitle,
  nodeStates,
  ruleTitle,
} from '../termsFlowApi'
import { CoverageList, CoverageSplit, NodeDetail, RuleChip, RuleList, ScheduleGrid, VisitTimeline } from './ProtocolTermsSchedule'
import './protocolTerms.css'

type Async<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; data: T; pending: boolean }
type Settled<T> = { key: string; tick: number; data: T } | { key: string; tick: number; error: string }

const DEFAULT_NCT = 'NCT05800015'
const STEPS = [
  { name: 'Protocol', nav: 'Protocol' },
  { name: 'Coverage', nav: 'Coverage' },
  { name: 'Budget at a site', nav: 'Budget' },
  { name: 'Compare two sites', nav: 'Compare' },
  { name: 'Term sheet', nav: 'Term sheet' },
] as const

function nctFromHash(): string | null {
  return window.location.hash.match(/^#terms-flow\/(NCT\d{8})/i)?.[1]?.toUpperCase() ?? null
}

/** The trial to open: the deep link if there is one, else the last trial picked here, else the default. */
function initialNct(): string {
  const stored = readStore<unknown>('tf:nct', null)
  return nctFromHash() ?? (typeof stored === 'string' && /^NCT\d{8}$/.test(stored) ? stored : DEFAULT_NCT)
}

/** Keep the address bar on #terms-flow/<nct> so a reload or a shared link reopens the same trial. */
function writeHash(nct: string) {
  try {
    if (/^#terms-flow(\/|$)/i.test(window.location.hash) && nctFromHash() !== nct) window.history.replaceState(null, '', `#terms-flow/${nct}`)
  } catch {
    /* ignore */
  }
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeStore(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: per-viewer convenience only */
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

/** Fetch keyed by `key` (null: nothing to fetch). While a new key loads, the last good result stays on screen with
 *  `pending` set, so the page does not jump; an error replaces it. */
function useFetch<T>(key: string | null, fn: (signal: AbortSignal) => Promise<T>): [Async<T>, () => void] {
  const [res, setRes] = useState<Settled<T> | null>(null)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  useEffect(() => {
    if (key === null) return
    const ctl = new AbortController()
    fnRef.current(ctl.signal).then(
      (data) => {
        if (!ctl.signal.aborted) setRes({ key, tick, data })
      },
      (e: unknown) => {
        if (!ctl.signal.aborted) setRes({ key, tick, error: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => ctl.abort()
  }, [key, tick])
  const retry = useCallback(() => setTick((t) => t + 1), [])
  const current = !!res && res.key === key && res.tick === tick
  const state: Async<T> =
    key === null
      ? { status: 'idle' }
      : !res
        ? { status: 'loading' }
        : 'data' in res
          ? { status: 'ok', data: res.data, pending: !current }
          : current
            ? { status: 'error', error: res.error }
            : { status: 'loading' }
  return [state, retry]
}

function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }
}

function signedUsd(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  if (Math.abs(x) < 0.005) return '$0.00'
  const s = usd(Math.abs(x))
  return x > 0 ? `+${s}` : `−${s}`
}

function signedNum(x: number): string {
  return `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n)
}

function pctText(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

function statusLabel(s: string | undefined): string {
  if (!s) return 'status not reported'
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')
}

function locName(l: Locality | null): string {
  return l ? `${localityTitle(l.name)} (${l.state} ${l.code})` : 'national (no locality)'
}

/** "2026-10-17" -> "October 17, 2026"; anything else as given. */
function dateText(s: string, short = false): string {
  const d = calDate(s, short)
  return d === '—' ? s : d
}

/** Visits inside the per-participant amount (screening through cycle 8, end of treatment, safety follow-up); the
 *  repeating visits are priced per occurrence. */
function fixedVisits(b: Budget): VisitBudget[] {
  return b.visits.filter((v) => v.kind !== 'repeat')
}

const reduceMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export default function ProtocolTermsView() {
  const { density } = useDensity()
  const detailed = density === 'detailed'
  const [nct, setNct] = useState<string>(initialNct)
  const [overrides, setOverrides] = useState<Overrides>(() => readStore(`tf:overrides:${initialNct()}`, {}))
  const [standard, setStandard] = useState<StandardEdits>(() => readStore('tf:standard:v1', {}))
  const [multPct, setMultPct] = useState<number>(() => {
    const v = readStore<unknown>('tf:multiplier', 100)
    return typeof v === 'number' && v >= 10 && v <= 500 ? v : 100
  })
  // The sites the viewer picked; empty (or a site of another trial) falls back to the trial's default pair.
  const [pickA, setSiteA] = useState('')
  const [pickB, setSiteB] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [withCompare, setWithCompare] = useState(true)

  const selectTrial = useCallback((id: string) => {
    setNct(id)
    setOverrides(readStore(`tf:overrides:${id}`, {}))
    setSelected(null)
    setSiteA('')
    setSiteB('')
    writeHash(id)
  }, [])

  // Remember the trial across tab switches (App.go() resets the hash to plain #terms-flow) and reflect it in the
  // address bar.
  useEffect(() => {
    writeStore('tf:nct', nct)
    writeHash(nct)
  }, [nct])

  // Deep link #terms-flow/<nct>; other tabs own the rest of the hash.
  useEffect(() => {
    const on = () => {
      const h = nctFromHash()
      if (h && h !== nct) selectTrial(h)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [nct, selectTrial])

  useEffect(() => writeStore(`tf:overrides:${nct}`, overrides), [nct, overrides])
  useEffect(() => writeStore('tf:standard:v1', standard), [standard])
  useEffect(() => writeStore('tf:multiplier', multPct), [multPct])

  const [trials, retryTrials] = useFetch<TrialCard[]>('trials', (s) => termsApi.trials(s))
  const [protocol, retryProtocol] = useFetch<Protocol>(nct, (s) => termsApi.protocol(nct, s))
  const [sites, retrySites] = useFetch<SitesResp>(`sites:${nct}`, (s) => termsApi.sites(nct, s))

  const sitesData = sites.status === 'ok' && sites.data.nct_id === nct ? sites.data : null
  const siteIds = useMemo(() => new Set(sitesData?.sites.map((s) => s.site_id) ?? []), [sitesData])
  const resolveSite = (pick: string, fallback: string | null | undefined, i: number) =>
    !sitesData ? '' : siteIds.has(pick) ? pick : fallback && siteIds.has(fallback) ? fallback : (sitesData.sites[i]?.site_id ?? '')
  const siteA = resolveSite(pickA, sitesData?.default_pair[0], 0)
  const siteB = resolveSite(pickB, sitesData?.default_pair[1], 1)

  const proto = protocol.status === 'ok' && protocol.data.nct_id === nct ? protocol.data : null
  // Stored overrides may name items of an older protocol file: send only the ones that exist.
  const validOverrides = useMemo(() => {
    if (!proto) return {}
    const ids = new Set(proto.nodes.map((n) => n.id))
    return Object.fromEntries(Object.entries(overrides).filter(([k, v]) => ids.has(k) && (v === 'routine' || v === 'research'))) as Overrides
  }, [proto, overrides])
  const multiplier = Math.min(500, Math.max(10, Number.isFinite(multPct) ? multPct : 100)) / 100
  const params: PriceParams = useMemo(() => ({ multiplier, overrides: validOverrides, standard }), [multiplier, validOverrides, standard])
  const dparams = useDebounced(params, 250)
  const pkey = JSON.stringify(dparams)
  const siteOk = !!proto && !!siteA
  const [budget, retryBudget] = useFetch<Budget>(siteOk ? `b:${nct}:${siteA}:${pkey}` : null, (s) => termsApi.budget(nct, siteA, dparams, s))
  const cmpOk = siteOk && !!siteB && siteB !== siteA
  const [cmp, retryCmp] = useFetch<Compare>(cmpOk ? `c:${nct}:${siteA}:${siteB}:${pkey}` : null, (s) =>
    termsApi.compare(nct, siteA, siteB, dparams, s),
  )

  const states = useMemo(() => (proto ? nodeStates(proto, overrides) : new Map<string, NodeState>()), [proto, overrides])
  const bud = budget.status === 'ok' && budget.data.nct_id === nct ? budget.data : null
  const budStale = !!bud && budget.status === 'ok' && (budget.pending || pkey !== JSON.stringify(params))
  const cmpData = cmp.status === 'ok' && cmpOk && cmp.data.nct_id === nct ? cmp.data : null
  const cmpStale = !!cmpData && cmp.status === 'ok' && (cmp.pending || pkey !== JSON.stringify(params))
  const lineById = useMemo(() => new Map(bud?.visits.flatMap((v) => v.lines.map((l) => [l.node_id, l] as const)) ?? []), [bud])

  const setNode = useCallback((id: string, c: Coverage | null) => {
    setOverrides((o) => {
      const next = { ...o }
      if (c === null) delete next[id]
      else next[id] = c
      return next
    })
  }, [])
  const toggleNode = useCallback(
    (n: ProtocolNode) => {
      const cur = (overrides[n.id] ?? n.coverage) as Coverage
      const flip: Coverage = cur === 'routine' ? 'research' : 'routine'
      setNode(n.id, flip === n.coverage ? null : flip)
      setSelected(n.id)
    },
    [overrides, setNode],
  )
  const nOverrides = proto ? proto.nodes.filter((n) => states.get(n.id)?.override).length : 0
  const nResearch = proto ? proto.nodes.filter((n) => states.get(n.id)?.coverage === 'research').length : 0
  const nRoutine = proto ? proto.nodes.length - nResearch : 0

  const go = (i: number) => {
    const el = document.getElementById(`tf-step-${i + 1}`)
    if (!el) return
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' })
    el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
  }

  const selNode = proto && selected ? (proto.nodes.find((n) => n.id === selected) ?? null) : null
  const trialList = trials.status === 'ok' ? trials.data : null
  const picked = trialList?.find((t) => t.nct_id === nct) ?? null

  return (
    <section className="view tf" aria-label="Protocol to terms">
      <PageHead
        title="Protocol to terms"
        lede="A protocol's schedule of assessments, sorted into routine care and research, priced from CMS 2026 fee schedules and a proposed standard schedule for non-procedure fees, with a source on every line."
      >
        <Banner title={DISCLAIMER}>
          Prices come from CMS 2026 fee schedules and Concord’s proposed standard schedule, a starting point to negotiate against, not market data.
          Schedules are {ILLUSTRATIVE.toLowerCase()}, not the sponsors’ protocols.
        </Banner>
      </PageHead>

      <nav className="tf-flow" aria-label="Steps">
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.name}>
              <button type="button" className="tf-flow-btn" onClick={() => go(i)}>
                <span className="tf-flow-n num" aria-hidden="true">
                  {i + 1}
                </span>
                <span>
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.nav}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span className="tf-flow-arrow" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      {/* 1. Protocol */}
      <Step
        n={1}
        title="Protocol"
        info={
          <>
            <span className="hc-title">How a schedule is authored</span>
            Concord authors each schedule from the trial’s ClinicalTrials.gov record. Where the registry is silent, it uses standard practice for the
            condition and lists the assumption. The sponsors’ own protocols are not public.
          </>
        }
        lede={
          <>
            Pick a trial{trialList ? `: ${trialPickerText(trialList)}` : ''}.
            Concord reads its schedule of assessments: which visits happen when, and what is done at each.
          </>
        }
        quals={
          proto && (
            <Qualifier tone="muted">
              Authored {dateText(proto.authored, true)} from the registry record: {proto.sources.length} registry facts, {proto.assumptions.length} assumptions
            </Qualifier>
          )
        }
        figure={
          proto && (
            <div className="tf-kfs">
              <KeyFigure value={proto.visits.length} label="visits" size="lg" />
              <KeyFigure value={proto.procedures.length} label="procedures" size="lg" />
              <KeyFigure value={proto.nodes.length} label="scheduled items" size="lg" sub="each gets a coverage rule" />
            </div>
          )
        }
        details={proto && <AuthoredNotes proto={proto} />}
        detailsLabel={proto ? `How this schedule was authored (${proto.sources.length} registry facts, ${proto.assumptions.length} assumptions)` : 'Details'}
      >
        {trials.status === 'loading' && <Loading label="Loading trials…" />}
        {trials.status === 'error' && <ErrorBox error={trials.error} onRetry={retryTrials} />}
        {trialList && (
          <div className="tf-trials" role="group" aria-label="Trial">
            {trialList.map((t) => (
              <TrialCardView key={t.nct_id} t={t} on={t.nct_id === nct} detailed={detailed} onPick={() => selectTrial(t.nct_id)} />
            ))}
          </div>
        )}
        {protocol.status === 'error' && <ErrorBox error={protocol.error} onRetry={retryProtocol} />}
        {!proto && protocol.status !== 'error' && <Loading label="Loading the schedule of assessments…" />}
        {proto && <VisitTimeline protocol={proto} />}
      </Step>

      {proto && (
        <>
          {/* 2. Coverage */}
          <Step
            n={2}
            title="Coverage: routine care or research"
            info={
              <>
                <span className="hc-title">Who pays for what</span>
                Under {bud?.ncd ?? 'Medicare NCD 310.1 (routine costs in clinical trials)'}, care a patient would get anyway is billable to Medicare or
                the insurer; items that exist only because of the protocol are paid by the sponsor. Concord labels each item with one of five rules.
                The payer decides coverage.
              </>
            }
            lede={
              <>
                <span className="tnum strong">{nResearch}</span> of <span className="tnum">{proto.nodes.length}</span> scheduled items are{' '}
                <Gloss term="research-only">research-only</Gloss>, paid by the sponsor. The other <span className="tnum">{nRoutine}</span> are{' '}
                <Gloss term="routine-care">routine care</Gloss>, billable to insurance. Every label names its rule, and a reviewer can override any of them.
              </>
            }
            quals={
              <span className="tf-ovcount">
                {nOverrides > 0 ? (
                  <>
                    <Qualifier mark="✎">
                      {nOverrides} reviewer override{nOverrides === 1 ? '' : 's'}, printed on the term sheet
                    </Qualifier>
                    <button type="button" className="btn btn-small" onClick={() => setOverrides({})}>
                      Clear overrides
                    </button>
                  </>
                ) : (
                  <Qualifier tone="muted">No reviewer overrides</Qualifier>
                )}
              </span>
            }
            figure={
              <>
                <CoverageSplit nRoutine={nRoutine} nResearch={nResearch} />
                <RuleList rules={proto.rules} detailed={detailed} />
              </>
            }
            details={
              <CoverageDetails
                proto={proto}
                states={states}
                selected={selected}
                setSelected={setSelected}
                selNode={selNode}
                lineById={lineById}
                setNode={setNode}
                toggleNode={toggleNode}
              />
            }
            detailsLabel="Schedule grid and reviewer overrides"
          />

          {/* 3. Budget */}
          <Step
            n={3}
            title="Budget at a site"
            info={<PricingInfo />}
            lede={
              bud ? (
                <>
                  At {bud.site.label}, the sponsor pays <span className="tnum strong">{usd(bud.totals.per_participant)}</span> per participant:
                  research-only items <span className="tnum">{usd(bud.totals.per_participant_research_items)}</span>, coordinator time{' '}
                  <span className="tnum">{usd(bud.totals.per_participant_coordinator)}</span> and overhead{' '}
                  <span className="tnum">{usd(bud.totals.per_participant_overhead)}</span>.
                </>
              ) : (
                'Pick a registered U.S. site. Coded items are priced from the Medicare fee schedules at its locality.'
              )
            }
            quals={
              bud && (
                <ul className="tf-quals">
                  <li>
                    <Qualifier tone="muted" info={<OtherPayments b={bud} />}>
                      Per participant: {bud.totals.per_participant_scope}
                    </Qualifier>
                  </li>
                  <li>
                    <Qualifier tone="muted">Coded items at {pctText(bud.multiplier)} of Medicare</Qualifier>
                  </li>
                  {bud.totals.per_participant_placeholder > 0 && (
                    <li>
                      <Qualifier>{PLACEHOLDER_TAG}</Qualifier>
                    </li>
                  )}
                  <li>
                    <Qualifier>{DISCLAIMER}</Qualifier>
                  </li>
                </ul>
              )
            }
            controls={
              <>
                {sites.status === 'loading' && <Loading label="Loading sites…" />}
                {sites.status === 'error' && <ErrorBox error={sites.error} onRetry={retrySites} />}
                {sitesData && (
                  <div className="tf-controls">
                    <label className="field tf-field-site">
                      <span className="field-label">
                        Site ({sitesData.sites.length} registered U.S. sites
                        {sitesData.n_withdrawn_hidden ? `; ${sitesData.n_withdrawn_hidden} withdrawn hidden` : ''})
                      </span>
                      <SiteSelect sites={sitesData.sites} value={siteA} onChange={setSiteA} />
                    </label>
                    <label className="field tf-mult">
                      <span className="field-label">% of Medicare</span>
                      <span className="tf-mult-input">
                        <NumField
                          value={multPct}
                          min={10}
                          max={500}
                          step={5}
                          onCommit={(v) => setMultPct(v ?? 100)}
                          label="Percent of Medicare applied to coded items"
                        />
                        <span aria-hidden="true">%</span>
                      </span>
                    </label>
                  </div>
                )}
                {bud && <LocalityLine b={bud} />}
              </>
            }
            figure={
              <>
                {budget.status === 'error' && <ErrorBox error={budget.error} onRetry={retryBudget} />}
                {!bud && budget.status === 'loading' && <Loading label="Pricing…" />}
                {bud && <PayerFigure b={bud} stale={budStale} />}
              </>
            }
            details={
              bud && (
                <div className={budStale ? 'tf-stale' : undefined}>
                  <BudgetDetails b={bud} rules={proto.rules} standard={standard} setStandard={setStandard} />
                </div>
              )
            }
            detailsLabel="Visit lines, other payments and the proposed standard schedule"
          />

          {/* 4. Compare */}
          <Step
            n={4}
            title="Compare two sites"
            info={<CompareInfo />}
            lede={
              cmpData ? (
                <CompareSentence c={cmpData} />
              ) : (
                'Same protocol, same coverage labels, same multiplier at two sites. Every price difference traces to the published locality factors (GPCIs).'
              )
            }
            quals={
              <ul className="tf-quals">
                <li>
                  <Qualifier tone="muted">Same protocol, coverage labels and multiplier at both sites</Qualifier>
                </li>
                {cmpData && (cmpData.a.totals.per_participant_placeholder > 0 || cmpData.b.totals.per_participant_placeholder > 0) && (
                  <li>
                    <Qualifier>{PLACEHOLDER_TAG}</Qualifier>
                  </li>
                )}
                <li>
                  <Qualifier>{DISCLAIMER}</Qualifier>
                </li>
              </ul>
            }
            controls={
              sitesData && (
                <>
                  {sitesData.presets.length > 0 && (
                    <div className="tf-presets" role="group" aria-label="Example site pairs">
                      {sitesData.presets.map((p) => {
                        const on = p.site_ids[0] === siteA && p.site_ids[1] === siteB
                        return (
                          <button
                            key={p.label}
                            type="button"
                            className={`tf-preset${on ? ' tf-preset-on' : ''}`}
                            aria-pressed={on}
                            onClick={() => {
                              setSiteA(p.site_ids[0])
                              setSiteB(p.site_ids[1])
                            }}
                          >
                            {p.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="tf-controls tf-controls-stack">
                    <label className="field tf-field-site">
                      <span className="field-label">Site A (also priced in step 3)</span>
                      <SiteSelect sites={sitesData.sites} value={siteA} onChange={setSiteA} />
                    </label>
                    <label className="field tf-field-site">
                      <span className="field-label">Site B</span>
                      <SiteSelect sites={sitesData.sites} value={siteB} onChange={setSiteB} />
                    </label>
                  </div>
                  {siteA && siteA === siteB && <p className="small note">Pick two different sites.</p>}
                </>
              )
            }
            figure={
              <>
                {cmp.status === 'error' && <ErrorBox error={cmp.error} onRetry={retryCmp} />}
                {!cmpData && cmp.status === 'loading' && <Loading label="Comparing…" />}
                {cmpData && <CompareFigure c={cmpData} stale={cmpStale} />}
              </>
            }
            details={cmpData && <CompareDetails c={cmpData} />}
            detailsLabel="Locality factors and every sponsor-paid item, site by site"
          />

          {/* 5. Term sheet */}
          <Step
            n={5}
            title="Term sheet"
            lede="Every line carries its provenance: code, our short label, schedule, source file, locality and GPCI values, conversion factor, multiplier, and the coverage rule or reviewer override."
            quals={
              <ul className="tf-quals">
                <li>
                  <Qualifier>{DISCLAIMER}</Qualifier>
                </li>
                <li>
                  <Qualifier tone="muted">Codes carry Concord’s own short labels, not AMA CPT descriptors</Qualifier>
                </li>
              </ul>
            }
            controls={
              bud && siteOk ? (
                <SheetActions
                  b={bud}
                  nct={nct}
                  siteA={siteA}
                  siteB={cmpOk ? siteB : null}
                  params={params}
                  withCompare={withCompare}
                  setWithCompare={setWithCompare}
                  cmp={cmpData}
                />
              ) : (
                <Loading label="Preparing…" />
              )
            }
            figure={bud && <FeaturedLine b={bud} rules={proto.rules} selected={selected} lineById={lineById} cmp={cmpData} siteA={siteA} siteB={siteB} />}
            details={bud && <SheetContents b={bud} picked={picked} />}
            detailsLabel="What the term sheet contains"
          />
        </>
      )}
    </section>
  )
}

// ====================================================================== step frame

/** One step: a Calm window laid out like the shared Section (claim, sentence, qualifiers and controls on the left;
 *  the key figure on the right; secondary content inline in Detailed and in a "Details" disclosure in Simple). The
 *  strip carries the step number and the illustrative label, so a cropped screenshot keeps it. */
function Step({
  n,
  title,
  info,
  lede,
  quals,
  controls,
  figure,
  details,
  detailsLabel = 'Details',
  children,
}: {
  n: number
  title: string
  info?: ReactNode
  lede?: ReactNode
  quals?: ReactNode
  controls?: ReactNode
  figure?: ReactNode
  details?: ReactNode
  detailsLabel?: string
  children?: ReactNode
}) {
  const { density } = useDensity()
  const hid = useId()
  return (
    <section id={`tf-step-${n}`} className="win section tf-step" aria-labelledby={hid}>
      <div className="win-strip">
        <span>
          <span className="win-title">
            Step {n} of {STEPS.length}
          </span>
        </span>
        <span className="win-aside tf-strip-label">{ILLUSTRATIVE}</span>
      </div>
      <div className="win-body">
        <div className={`section-row${figure ? '' : ' section-row-single'}`}>
          <div className="section-text">
            <div className="section-title">
              <h2 id={hid} tabIndex={-1}>
                {title}
              </h2>
              {info && <InfoTip size="lg" label={`Details: ${title}`} content={info} />}
            </div>
            {lede && <p className="section-lede">{lede}</p>}
            {quals && <div className="section-quals">{quals}</div>}
            {controls && <div className="tf-step-controls">{controls}</div>}
          </div>
          {figure && <div className="section-figure tf-figure">{figure}</div>}
        </div>
        {children && <div className="tf-step-body">{children}</div>}
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

// ====================================================================== 1. protocol

/** "two first-line NSCLC chemo-immunotherapy trials …, and one outside lung cancer, for geographic atrophy (eye)". */
function trialPickerText(list: TrialCard[]): string {
  const lung = list.filter((t) => !t.area)
  const other = list.filter((t) => !!t.area)
  const parts: string[] = []
  if (lung.length) parts.push(`${countWord(lung.length)} first-line NSCLC chemo-immunotherapy trials with every-3-week dosing in the registry`)
  if (other.length) {
    const conds = other.map((t) => (t.condition ?? '').toLowerCase()).filter(Boolean)
    parts.push(`${countWord(other.length)} outside lung cancer${conds.length ? `, for ${conds.join(', ')}` : ''}`)
  }
  return parts.join(', and ')
}

function TrialCardView({ t, on, detailed, onPick }: { t: TrialCard; on: boolean; detailed: boolean; onPick: () => void }) {
  const f = t.trial
  const facts = (
    <>
      {f.source && <p className="tf-fact muted">Trial facts and sites: {f.source}. This trial is not in Concord’s lung-trial database.</p>}
      <ul className="tf-arms">
        {t.arms.map((a) => (
          <li key={a.label}>
            <span className="muted">{a.label}:</span> {a.text}
          </li>
        ))}
      </ul>
      <p className="tf-fact">
        <span className="muted">Dosing:</span> {t.dosing}
      </p>
      <p className="tf-fact">
        <span className="muted">Masking:</span> {t.masking}
      </p>
      {t.registry_notes.map((n) => (
        <p key={n} className="tf-fact tf-regnote">
          {n}
        </p>
      ))}
      <p className="tf-fact muted">{t.why_chosen}</p>
    </>
  )
  return (
    <div className={`tf-trial lift${on ? ' tf-trial-on' : ''}`} onClick={onPick}>
      <button
        type="button"
        className="tf-trial-pick"
        aria-pressed={on}
        onClick={(e) => {
          e.stopPropagation()
          onPick()
        }}
      >
        <span className="tf-radio" aria-hidden="true" />
        <span className="tf-trial-text">
          <span className="tf-trial-sponsor">
            {f.sponsor ?? 'Sponsor'}
            {t.area && (
              <span className="badge badge-info tf-trial-area">
                {t.area}
                {t.condition ? ` · ${t.condition}` : ''}
              </span>
            )}
          </span>
          <span className="tf-trial-title">{t.short_title}</span>
        </span>
      </button>
      <div className="tf-trial-meta">
        <a href={ctgovUrl(t.nct_id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {t.nct_id}
        </a>
        <span>{statusLabel(f.status)}</span>
        <span>{phaseLabel(f.phases)}</span>
        <span>
          <span className="tnum">{f.n_us_sites ?? '—'}</span> registered U.S. sites
          {!!f.n_us_sites_withdrawn && <span className="muted"> ({f.n_us_sites_withdrawn} withdrawn)</span>}
        </span>
        {!detailed && (
          <span className="tf-trial-info" onClick={(e) => e.stopPropagation()}>
            <InfoTip label={`About ${t.nct_id}`} content={<div className="tf-hc-trial">{facts}</div>} />
          </span>
        )}
      </div>
      {detailed && <div className="tf-trial-facts">{facts}</div>}
    </div>
  )
}

function AuthoredNotes({ proto }: { proto: Protocol }) {
  // In Simple the disclosure's summary names this block; in Detailed it needs a heading of its own.
  const detailed = useDensity().density === 'detailed'
  return (
    <div className="tf-notes">
      {detailed && <h3>How this schedule was authored</h3>}
      <p className="small">
        Authored {dateText(proto.authored)} from the ClinicalTrials.gov record of {proto.nct_id}. Where the registry is silent we used {proto.practice_basis ?? 'standard NSCLC practice'}.{' '}
        {proto.quote_note}
      </p>
      <h3>Registry facts used</h3>
      <ul className="tf-src-list small">
        {proto.sources.map((s, i) => (
          <li key={i}>
            <span className="tf-src-field">{s.field}</span> “{s.quote}” <span className="muted">→ {s.used_for}</span>
          </li>
        ))}
      </ul>
      <h3>Assumptions</h3>
      <ul className="tf-src-list small">
        {proto.assumptions.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>
    </div>
  )
}

// ====================================================================== 2. coverage

function CoverageDetails({
  proto,
  states,
  selected,
  setSelected,
  selNode,
  lineById,
  setNode,
  toggleNode,
}: {
  proto: Protocol
  states: Map<string, NodeState>
  selected: string | null
  setSelected: (id: string) => void
  selNode: ProtocolNode | null
  lineById: Map<string, Line>
  setNode: (id: string, c: Coverage | null) => void
  toggleNode: (n: ProtocolNode) => void
}) {
  return (
    <div className="tf-cov-details">
      <h3>Schedule of assessments</h3>
      <p className="small muted tf-sub">
        <span className="tnum">{proto.visits.length}</span> visits × <span className="tnum">{proto.procedures.length}</span> procedures,{' '}
        <span className="tnum">{proto.nodes.length}</span> scheduled items. Each cell is one item with its coverage rule; select one to see its rule,
        reason and price, and to override its label.
      </p>
      <div className="tf-legend small">
        <span>
          <span className="tf-cell tf-cell-routine tf-cell-demo" aria-hidden="true">
            R3
          </span>{' '}
          Routine: billed to insurance
        </span>
        <span>
          <span className="tf-cell tf-cell-research tf-cell-demo" aria-hidden="true">
            R2
          </span>{' '}
          Research: sponsor pays
        </span>
        <span>
          <span className="tf-cell tf-cell-research tf-cell-ov tf-cell-demo" aria-hidden="true">
            R4✎
          </span>{' '}
          Reviewer override
        </span>
        <span className="tf-legend-rep">Hatched columns repeat and are priced per occurrence</span>
      </div>
      <ScheduleGrid protocol={proto} states={states} selected={selected} onSelect={setSelected} />
      {selNode ? (
        <NodeDetail protocol={proto} node={selNode} state={states.get(selNode.id) as NodeState} line={lineById.get(selNode.id) ?? null} onSet={setNode} />
      ) : (
        <p className="small muted tf-hint">Select a cell to see its rule, reason and price, and to override its label.</p>
      )}
      <Details summary="Standard-care reference used by R3 and R4">
        <ul className="small tf-src-list">
          {proto.standard_care_reference.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="small muted">{proto.standard_care_source}</p>
      </Details>
      <h3>Every item, by procedure</h3>
      <p className="small muted tf-sub">Select a visit to flip its label. Overrides are tracked and printed as “reviewer override”.</p>
      <CoverageList protocol={proto} states={states} onToggle={toggleNode} />
    </div>
  )
}

// ====================================================================== 3. budget

function PricingInfo() {
  return (
    <>
      <span className="hc-title">How each line is priced</span>
      <p>
        Physician services: the CMS 2026 physician fee schedule at the site’s Medicare locality, (work RVU × work GPCI + PE RVU × PE GPCI + MP RVU ×
        MP GPCI) × conversion factor, times the % of Medicare.
      </p>
      <p>Lab tests: the CMS 2026 clinical lab fee schedule, national amounts.</p>
      <p>Non-procedure fees, coordinator time and overhead: Concord’s proposed standard schedule, the same at every site.</p>
      <span className="hc-src">{PROPOSED_STANDARD_TAG}</span>
    </>
  )
}

function LocalityLine({ b }: { b: Budget }) {
  const l = b.locality
  return (
    <p className="tf-locline">
      <span className="muted">Medicare locality</span> <span className="strong">{localityLabel(l)}</span>{' '}
      <InfoTip
        label="Locality factors and source"
        content={
          l ? (
            <>
              <span className="hc-title">
                Locality {l.code} · {localityTitle(l.name)} ({l.state})
              </span>
              <span className="tf-hc-kv">
                <span>Work GPCI</span> <span className="num">{l.gpci_work.toFixed(3)}</span>
              </span>
              <span className="tf-hc-kv">
                <span>Practice expense GPCI</span> <span className="num">{l.gpci_pe.toFixed(3)}</span>
              </span>
              <span className="tf-hc-kv">
                <span>Malpractice GPCI</span> <span className="num">{l.gpci_mp.toFixed(3)}</span>
              </span>
              <span className="tf-hc-kv">
                <span>Conversion factor</span> <span className="num">{b.conversion_factor?.toFixed(4) ?? '—'}</span>
              </span>
              <span className="hc-src">
                {l.method}. {b.pfs_source ?? 'CMS PFS file not loaded'}
              </span>
            </>
          ) : (
            (b.site.locality_note ?? 'No Medicare locality resolved for this site: national amounts are used.')
          )
        }
      />
    </p>
  )
}

/** Payments outside the per-participant amount (per occurrence, screen failure, per site). */
function OtherPayments({ b }: { b: Budget }) {
  const t = b.totals
  return (
    <>
      <span className="hc-title">Paid outside the per-participant amount</span>
      {t.per_occurrence.map((x) => (
        <span key={x.visit_id} className="tf-hc-kv">
          <span>
            {x.label} <span className="muted">({x.repeat})</span>
          </span>{' '}
          <span className="num">{usd(x.amount)}</span>
        </span>
      ))}
      <span className="tf-hc-kv">
        <span>Screen failure, as incurred</span> <span className="num">{usd(t.screen_failure)}</span>
      </span>
      <span className="tf-hc-kv">
        <span>Per site, one time</span> <span className="num">{usd(t.per_site_one_time)}</span>
      </span>
    </>
  )
}

/** The sponsor's per-participant amount and, beside it and clearly apart, the routine care billed to insurance. */
function PayerFigure({ b, stale }: { b: Budget; stale: boolean }) {
  const t = b.totals
  const fixed = fixedVisits(b)
  const coord = b.standard_schedule.find((i) => i.id === 'coordinator')
  const over = b.standard_schedule.find((i) => i.id === 'overhead')
  const nCoord = fixed.filter((v) => v.coordinator > 0).length
  // Research items by price source, shown only when they add up to the API's total.
  const sources = new Map<string, { n: number; amount: number }>()
  for (const v of fixed)
    for (const l of v.lines)
      if (l.payer === 'Sponsor' && l.amount !== null) {
        const k = l.schedule ?? 'None'
        const cur = sources.get(k) ?? { n: 0, amount: 0 }
        sources.set(k, { n: cur.n + 1, amount: cur.amount + l.amount })
      }
  const sourcesSum = [...sources.values()].reduce((s, x) => s + x.amount, 0)
  const bySource = Math.abs(sourcesSum - t.per_participant_research_items) < 0.01 ? sources : null
  const srcName: Record<string, string> = {
    PFS: 'Physician fee schedule, at this locality',
    CLFS: 'Clinical lab fee schedule, national',
    Standard: 'Proposed standard per-visit fees',
    None: 'No site charge',
  }
  return (
    <div className={`tf-payers${stale ? ' tf-stale' : ''}`}>
      <div className="tf-payer tf-payer-sponsor">
        <p className="tf-payer-label">Paid by the sponsor, per participant</p>
        <p className="tf-payer-value num">{usd(t.per_participant)}</p>
        <dl className="tf-compose">
          <div>
            <dt>
              <HoverCard
                content={
                  <>
                    <span className="hc-title">Research-only items, by price source</span>
                    {bySource
                      ? [...bySource.entries()].map(([k, x]) => (
                          <span key={k} className="tf-hc-kv">
                            <span>
                              {srcName[k] ?? k} <span className="muted">({x.n} lines)</span>
                            </span>{' '}
                            <span className="num">{usd(x.amount)}</span>
                          </span>
                        ))
                      : 'Each research line is priced from its own source; see the visit lines.'}
                    <span className="hc-src">{b.pfs_source}</span>
                  </>
                }
              >
                Research-only items
              </HoverCard>
            </dt>
            <dd className="num">{usd(t.per_participant_research_items)}</dd>
          </div>
          <div>
            <dt>
              <HoverCard
                content={
                  <>
                    <span className="hc-title">Coordinator time and data entry</span>
                    {coord?.amount != null && nCoord > 0 ? `${usd(coord.amount)} ${coord.unit_label}, ${nCoord} visits.` : coord?.unit_label}
                    <span className="hc-src">{PROPOSED_STANDARD_TAG}</span>
                  </>
                }
              >
                Coordinator time
              </HoverCard>
            </dt>
            <dd className="num">{usd(t.per_participant_coordinator)}</dd>
          </div>
          <div>
            <dt>
              <HoverCard
                content={
                  <>
                    <span className="hc-title">Institutional overhead</span>
                    {over?.amount != null ? `${pctText(over.amount)} ${over.unit_label}.` : over?.unit_label}
                    <span className="hc-src">{PROPOSED_STANDARD_TAG}</span>
                  </>
                }
              >
                Overhead
              </HoverCard>
            </dt>
            <dd className="num">{usd(t.per_participant_overhead)}</dd>
          </div>
        </dl>
      </div>
      <div className="tf-payer tf-payer-ins">
        <p className="tf-payer-label">Billable to insurance, per participant (Medicare rates)</p>
        <p className="tf-payer-value tf-payer-value-sm num">{usd(t.per_participant_insurance_medicare)}</p>
        <p className="tf-payer-sub">
          Routine care over the same visits, <span className="tnum">{t.n_insurance_lines}</span> lines under {b.ncd}. Not paid by the sponsor.
        </p>
      </div>
      <p className="tf-payer-note">
        <strong>Different payers, different items.</strong> The sponsor pays for research-only items, coordinator time and overhead. Routine care the
        participant would get anyway is billed to their insurance, shown here at Medicare rates for reference. Neither amount includes the other.
      </p>
      <VisitChart visits={fixed} />
    </div>
  )
}

/** Sponsor payment per visit inside the per-participant amount; each column opens its line items. */
function VisitChart({ visits }: { visits: VisitBudget[] }) {
  const max = Math.max(...visits.map((v) => v.visit_total), 1)
  return (
    <figure className="tf-vchart">
      <div className="tf-vchart-cols">
        {visits.map((v) => {
          const lines = v.lines.filter((l) => l.payer === 'Sponsor')
          return (
            <HoverCard
              key={v.visit_id}
              className="tf-vcol"
              content={
                <>
                  <span className="hc-title">
                    {v.label}: <span className="num">{usd(v.visit_total)}</span>
                  </span>
                  {lines.map((l) => (
                    <span key={l.node_id} className="tf-hc-kv">
                      <span>
                        {l.code && <span className="num">{l.code} </span>}
                        {l.label} <span className="muted">· {l.override ? 'override' : l.rule}</span>
                      </span>{' '}
                      <span className="num">{usd(l.amount)}</span>
                    </span>
                  ))}
                  {v.coordinator > 0 && (
                    <span className="tf-hc-kv">
                      <span>Coordinator time</span> <span className="num">{usd(v.coordinator)}</span>
                    </span>
                  )}
                  <span className="tf-hc-kv">
                    <span>Overhead</span> <span className="num">{usd(v.overhead)}</span>
                  </span>
                  <span className="hc-src">
                    Billed to insurance at this visit (Medicare rates, not the sponsor’s): <span className="num">{usd(v.insurance_medicare)}</span>
                  </span>
                </>
              }
            >
              <span className="tf-vcol-track" aria-hidden="true">
                <span className="tf-vcol-bar" style={{ height: `${Math.max(2, (v.visit_total / max) * 100)}%` }} />
              </span>
              <span className="tf-vcol-label" aria-hidden="true">
                {v.short}
              </span>
              <span className="sr-only">
                {v.label}: {usd(v.visit_total)}
              </span>
            </HoverCard>
          )
        })}
      </div>
      <figcaption>Sponsor payment per visit, highest {usd(max)}. Hover, focus or tap a visit for its lines.</figcaption>
    </figure>
  )
}

function BudgetDetails({
  b,
  rules,
  standard,
  setStandard,
}: {
  b: Budget
  rules: Rule[]
  standard: StandardEdits
  setStandard: (e: StandardEdits) => void
}) {
  const t = b.totals
  return (
    <div className="tf-bud-details">
      <LocalityCard l={b.locality} cf={b.conversion_factor} source={b.pfs_source} note={b.site.locality_note} />
      <h3>Paid outside the per-participant amount</h3>
      <div className="table-scroll">
        <table className="tbl tbl-compact tf-other">
          <thead>
            <tr>
              <th scope="col">Payment</th>
              <th scope="col">When</th>
              <th scope="col" className="num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {t.per_occurrence.map((x) => (
              <tr key={x.visit_id}>
                <th scope="row">{x.label}</th>
                <td>{x.repeat}</td>
                <td className="num">{usd(x.amount)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Screen failure</th>
              <td>as incurred (the screening visit payment)</td>
              <td className="num">{usd(t.screen_failure)}</td>
            </tr>
            <tr>
              <th scope="row">Per site, one time</th>
              <td>start-up, IRB, pharmacy, close-out, archiving</td>
              <td className="num">{usd(t.per_site_one_time)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>Visit by visit</h3>
      <p className="small tf-compose-line">
        Per participant = research items <strong className="tnum">{usd(t.per_participant_research_items)}</strong> + coordinator time{' '}
        <strong className="tnum">{usd(t.per_participant_coordinator)}</strong> + overhead <strong className="tnum">{usd(t.per_participant_overhead)}</strong>.
        Lab placeholders inside it: <span className="tnum">{usd(t.per_participant_placeholder)}</span>. Routine care billed to insurance over the same
        visits (Medicare amounts, for reference): <span className="tnum">{usd(t.per_participant_insurance_medicare)}</span>. Select a visit for its lines.
      </p>
      <BudgetTable b={b} rules={rules} />
      <h3>Non-procedure fees: proposed standard schedule</h3>
      <p className="small muted tf-sub">Itemized and editable. Applies at every site; it is not geographically adjusted. {PROPOSED_STANDARD_TAG}</p>
      <StandardEditor items={b.standard_schedule} screenFail={t.screen_failure} edits={standard} onChange={setStandard} />
    </div>
  )
}

function LocalityCard({ l, cf, source, note }: { l: Locality | null; cf: number | null; source: string | null; note?: string }) {
  if (!l) return <p className="small note">{note ?? 'No Medicare locality resolved for this site: national amounts are used.'}</p>
  return (
    <div className="tf-loc">
      <div>
        <div className="field-label">Medicare locality</div>
        <div className="strong">{locName(l)}</div>
        <div className="small muted">{l.method}</div>
      </div>
      <dl className="tf-gpci">
        <div>
          <dt>Work GPCI</dt>
          <dd className="num">{l.gpci_work.toFixed(3)}</dd>
        </div>
        <div>
          <dt>PE GPCI</dt>
          <dd className="num">{l.gpci_pe.toFixed(3)}</dd>
        </div>
        <div>
          <dt>MP GPCI</dt>
          <dd className="num">{l.gpci_mp.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Conversion factor</dt>
          <dd className="num">{cf?.toFixed(4) ?? '—'}</dd>
        </div>
      </dl>
      <div className="small muted tf-loc-src">{source ?? 'CMS PFS file not loaded'}</div>
    </div>
  )
}

function BudgetTable({ b, rules }: { b: Budget; rules: Rule[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(['SCR']))
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  return (
    <div className="table-scroll">
      <table className="tbl tbl-compact tf-budget">
        <thead>
          <tr>
            <th scope="col">Visit</th>
            <th scope="col" className="num">
              Sponsor items
            </th>
            <th scope="col" className="num tf-hide-sm">
              Coordinator
            </th>
            <th scope="col" className="num tf-hide-sm">
              Overhead
            </th>
            <th scope="col" className="num">
              Visit payment
            </th>
            <th scope="col" className="num">
              Billed to insurance
            </th>
          </tr>
        </thead>
        <tbody>
          {b.visits.map((v) => {
            const isOpen = open.has(v.visit_id)
            return (
              <Fragment key={v.visit_id}>
                <tr
                  className={`clickable${v.kind === 'repeat' ? ' tf-row-rep' : ''}`}
                  onClick={() => toggle(v.visit_id)}
                  tabIndex={0}
                  onKeyDown={onActivate(() => toggle(v.visit_id))}
                  aria-expanded={isOpen}
                >
                  <th scope="row">
                    <span className="tf-caret" aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </span>
                    {v.label}
                    <span className="tf-vwin"> {v.kind === 'repeat' ? `· per occurrence, ${v.repeat}` : `· ${v.window}`}</span>
                  </th>
                  <td className="num">{usd(v.research_subtotal)}</td>
                  <td className="num tf-hide-sm">{usd(v.coordinator)}</td>
                  <td className="num tf-hide-sm">{usd(v.overhead)}</td>
                  <td className="num strong">{usd(v.visit_total)}</td>
                  <td className="num muted">{usd(v.insurance_medicare)}</td>
                </tr>
                {isOpen && (
                  <tr className="tf-lines-row">
                    <td colSpan={6}>
                      <div className="tf-lines-wrap">
                        <table className="tf-lines">
                          <thead>
                            <tr>
                              <th scope="col">Code</th>
                              <th scope="col">Item</th>
                              <th scope="col">Basis</th>
                              <th scope="col">Payer</th>
                              <th scope="col" className="num">
                                Medicare
                              </th>
                              <th scope="col" className="num">
                                Sponsor
                              </th>
                              <th scope="col">Provenance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {v.lines.map((l) => (
                              <tr key={l.node_id} className={l.payer === 'Insurance' ? 'tf-line-ins' : undefined}>
                                <td>{l.code ? <code className="tf-code">{l.code}</code> : <span className="muted">—</span>}</td>
                                <td>
                                  <HoverCard content={<LineFields line={l} rules={rules} mult={b.multiplier} visit={v.label} />}>{l.label}</HoverCard>
                                </td>
                                <td>
                                  {l.override ? (
                                    <Badge tone="warn">reviewer override</Badge>
                                  ) : (
                                    <RuleChip rule={l.rule} coverage={l.coverage} title={l.reason} />
                                  )}
                                </td>
                                <td>{l.payer === 'Sponsor' ? 'Sponsor' : 'Insurance'}</td>
                                <td className="num">{usd(l.medicare_amount)}</td>
                                <td className="num">{l.amount === null ? '—' : usd(l.amount)}</td>
                                <td className="tf-prov">
                                  <Provenance l={l} mult={b.multiplier} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Provenance({ l, mult }: { l: Line; mult: number }) {
  const m = l.payer === 'Sponsor' && l.schedule && ['PFS', 'CLFS'].includes(l.schedule) ? ` × ${(mult * 100).toFixed(0)}%` : ''
  if (l.schedule === 'PFS' && l.formula)
    return (
      <span>
        <span className="tf-src-tag">PFS</span> <span className="tf-mono">{formulaText(l.formula)}</span>
        {m}
      </span>
    )
  if (l.schedule === 'CLFS')
    return (
      <span title={l.source ?? undefined}>
        <span className="tf-src-tag tf-src-ph">CLFS</span> national {usd(l.medicare_amount)}
        {l.placeholder && <span className="tf-ph"> placeholder until the CLFS file is loaded</span>}
        {m}
      </span>
    )
  if (l.schedule === 'Standard')
    return (
      <span>
        <span className="tf-src-tag tf-src-std">Proposed standard</span> {l.payer === 'Sponsor' ? (l.standard_label ?? 'itemized fee') : 'not billed (routine)'}
        {l.edited && ' (edited)'}
      </span>
    )
  return <span className="muted">{l.note ?? 'no site charge'}</span>
}

/** One term-sheet line, field by field (copy deck B7: Code · Coverage · Rule · Why · Price · Formula · Source). */
function LineFields({
  line,
  rules,
  mult,
  visit,
  priceB,
}: {
  line: Line
  rules: Rule[]
  mult: number
  visit?: string
  priceB?: { a: number; b: number } | null
}) {
  const sponsor = line.payer === 'Sponsor'
  const multText = sponsor && mult !== 1 && (line.schedule === 'PFS' || line.schedule === 'CLFS') ? ` × ${pctText(mult)} = ${usd(line.amount)}` : ''
  const price: ReactNode = sponsor ? (
    priceB ? (
      <>
        <span className="num strong">{usd(priceB.a)}</span> at Site A · <span className="num strong">{usd(priceB.b)}</span> at Site B
      </>
    ) : (
      <>
        <span className="num strong">{usd(line.amount)}</span> paid by the sponsor
      </>
    )
  ) : line.medicare_amount !== null ? (
    <>
      <span className="num">{usd(line.medicare_amount)}</span> at Medicare rates, billed to insurance
    </>
  ) : (
    (line.note ?? 'No site charge')
  )
  const formula: ReactNode =
    line.schedule === 'PFS' && line.formula ? (
      <span className="num tf-formula-text">
        {formulaText(line.formula)}
        {multText}
      </span>
    ) : line.schedule === 'CLFS' ? (
      `National lab fee ${usd(line.medicare_amount)}${multText}${line.placeholder ? ' (placeholder until the CLFS file is loaded)' : ''}`
    ) : line.schedule === 'Standard' && sponsor ? (
      `${line.standard_label ?? 'Itemized fee'}, ${line.standard_unit ?? 'each time performed'}${line.edited ? ' (edited)' : ''}`
    ) : null
  return (
    <dl className="tf-line-dl">
      {visit && <Field k="Visit">{visit}</Field>}
      <Field k="Item">{line.label}</Field>
      <Field k="Code">{line.code ? <span className="num">{line.code}</span> : 'None (proposed standard fee)'}</Field>
      <Field k="Coverage">
        {coverageLabel(line.coverage)}
        {line.override ? ' (reviewer override)' : ''}
      </Field>
      <Field k="Rule">{line.override ? `${ruleTitle(rules, line.rule)}; overridden by a reviewer` : ruleTitle(rules, line.rule)}</Field>
      <Field k="Why">{line.reason}</Field>
      <Field k="Price">{price}</Field>
      {formula !== null && <Field k="Formula">{formula}</Field>}
      <Field k="Source">{line.source ?? '—'}</Field>
    </dl>
  )
}

function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** Number input that keeps what the user is typing (including an empty box) and commits only valid values; an
 *  empty box commits null (back to the default) when it loses focus. */
function NumField({
  value,
  min,
  max,
  step,
  label,
  onCommit,
}: {
  value: number | null
  min: number
  max?: number
  step: number
  label: string
  onCommit: (v: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value === null ? '' : String(value))
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={shown}
      aria-label={label}
      onChange={(e) => {
        const s = e.target.value
        setDraft(s)
        const n = Number(s)
        if (s !== '' && Number.isFinite(n) && n >= min && (max === undefined || n <= max)) onCommit(n)
      }}
      onBlur={() => {
        if (draft === '') onCommit(null)
        setDraft(null)
      }}
    />
  )
}

function StandardEditor({
  items,
  screenFail,
  edits,
  onChange,
}: {
  items: StandardItem[]
  screenFail: number
  edits: StandardEdits
  onChange: (e: StandardEdits) => void
}) {
  const set = (id: string, v: number | null, def: number | null) => {
    const next = { ...edits }
    if (v === null || v === def) delete next[id]
    else next[id] = v
    onChange(next)
  }
  const nEdited = Object.keys(edits).length
  return (
    <>
      <div className="table-scroll">
        <table className="tbl tbl-compact tf-std">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Applies</th>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col" className="num">
                Proposed
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const isRate = it.unit === 'rate'
              const val = edits[it.id] ?? it.default
              return (
                <tr key={it.id} className={it.id in edits ? 'tf-std-edited' : undefined}>
                  <th scope="row">
                    {it.label} {it.id in edits && <Badge tone="warn">edited</Badge>}
                  </th>
                  <td className="small muted">{it.unit_label}</td>
                  <td className="num">
                    {it.unit === 'as_incurred' ? (
                      <span>{usd(screenFail)}</span>
                    ) : (
                      <span className="tf-num-input">
                        {!isRate && <span aria-hidden="true">$</span>}
                        <NumField
                          value={val === null ? null : isRate ? Math.round(val * 1000) / 10 : val}
                          min={0}
                          max={isRate ? 100 : undefined}
                          step={isRate ? 1 : 5}
                          label={`${it.label} amount${isRate ? ', percent' : ', dollars'}`}
                          onCommit={(raw) => set(it.id, raw === null ? null : isRate ? raw / 100 : raw, it.default)}
                        />
                        {isRate && <span aria-hidden="true">%</span>}
                      </span>
                    )}
                  </td>
                  <td className="num small muted">
                    {it.unit === 'as_incurred' ? 'computed' : isRate ? `${((it.default ?? 0) * 100).toFixed(0)}%` : usd(it.default)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="tf-std-foot small">
        <span className="muted">{items[0]?.source}.</span>
        {nEdited > 0 && (
          <button type="button" className="btn btn-small" onClick={() => onChange({})}>
            Reset {nEdited} edit{nEdited === 1 ? '' : 's'} to the proposed standard
          </button>
        )}
      </div>
    </>
  )
}

// ====================================================================== 4. compare

function CompareInfo() {
  return (
    <>
      <span className="hc-title">Why two sites price differently</span>
      <p>
        Each physician-service line is (work RVU × work GPCI + PE RVU × PE GPCI + MP RVU × MP GPCI) × conversion factor × the % of Medicare. RVUs and
        the conversion factor are national, so the difference between two sites is CF × m × Σ RVU × ΔGPCI.
      </p>
      <p>Lab fees (national) and the proposed standard schedule are the same at every site. Overhead is charged on the difference.</p>
    </>
  )
}

const PART_NAME = { work: 'physician work', pe: 'practice expense', mp: 'malpractice' } as const

/** The copy deck's difference line (A4), built from the API's decomposition. */
function CompareSentence({ c }: { c: Compare }) {
  const sm = c.summary
  const d = sm.delta_per_participant
  const where = c.b.locality ? `in ${localityTitle(c.b.locality.name)}` : 'at the national rate'
  if (Math.abs(d) < 0.005) {
    const same = !!c.a.locality && !!c.b.locality && c.a.locality.code === c.b.locality.code && c.a.locality.state === c.b.locality.state
    return (
      <>
        Site A and Site B have the same sponsor total per participant
        {same ? `: both are in Medicare locality ${localityLabel(c.a.locality)}, so every fee-schedule price is the same.` : '.'}
      </>
    )
  }
  const dir = d < 0 ? 'lower' : 'higher'
  const parts = (['work', 'pe', 'mp'] as const)
    .map((k) => ({ k, v: k === 'work' ? sm.from_work : k === 'pe' ? sm.from_pe : sm.from_mp }))
    .filter((p) => Math.sign(p.v) === Math.sign(sm.delta_research_items))
    .sort((x, y) => Math.abs(y.v) - Math.abs(x.v))
  const top = parts[0]
  const lead = top && Math.abs(top.v) > Math.abs(sm.delta_research_items) / 2 ? 'mostly' : 'the largest part from'
  return (
    <>
      Site B’s sponsor total is <span className="tnum strong">{usd(Math.abs(d))}</span> {dir} per participant because Medicare’s fee schedule prices the
      same physician services {dir} {where}: <span className="tnum">{usd(Math.abs(sm.delta_research_items))}</span> through CMS’s geographic cost
      indexes{' '}
      <span className="nowrap">
        (<Gloss term="gpci">GPCIs</Gloss>)
      </span>
      {top && (
        <>
          , {lead} {PART_NAME[top.k]} (<span className="tnum">{usd(Math.abs(top.v))}</span>)
        </>
      )}
      , plus <span className="tnum">{usd(Math.abs(sm.delta_overhead))}</span> of {pctText(sm.overhead_rate)} overhead on that. It reflects the fee
      schedule, not a saving.
    </>
  )
}

function CompareFigure({ c, stale }: { c: Compare; stale: boolean }) {
  const sm = c.summary
  const parts: [string, number][] = [
    ['Work GPCI', sm.from_work],
    ['Practice expense GPCI', sm.from_pe],
    ['Malpractice GPCI', sm.from_mp],
    [`Overhead (${pctText(sm.overhead_rate)}) on those`, sm.delta_overhead],
    ['Cent rounding', sm.rounding],
  ]
  const max = Math.max(...parts.map(([, v]) => Math.abs(v)), 0.01)
  return (
    <div className={`tf-cmp-fig${stale ? ' tf-stale' : ''}`}>
      <div className="table-scroll">
        <table className="tf-two">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Measure</span>
              </th>
              <th scope="col">Site A</th>
              <th scope="col">Site B</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Site</th>
              <td>{c.a.site.label}</td>
              <td>{c.b.site.label}</td>
            </tr>
            <tr>
              <th scope="row">Medicare locality</th>
              <td>{localityLabel(c.a.locality)}</td>
              <td>{localityLabel(c.b.locality)}</td>
            </tr>
            <tr className="tf-two-money">
              <th scope="row">Paid by sponsor, per participant</th>
              <td className="num">{usd(c.a.totals.per_participant)}</td>
              <td className="num">{usd(c.b.totals.per_participant)}</td>
            </tr>
            <tr className="tf-two-ins">
              <th scope="row">Billable to insurance, per participant (Medicare rates)</th>
              <td className="num">{usd(c.a.totals.per_participant_insurance_medicare)}</td>
              <td className="num">{usd(c.b.totals.per_participant_insurance_medicare)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="tf-payer-note">
        <strong>The insurance row is a different payer.</strong> It is routine care billed to the participant’s insurance, at Medicare rates for
        reference, and is not part of the sponsor’s total. Routine care is priced entirely from Medicare fee schedules; the sponsor’s total also
        includes coordinator time and per-visit fees that are the same at every site.
      </p>
      <div className="tf-decomp">
        <div className="tf-decomp-head">
          <span className="tf-decomp-label">Sponsor difference per participant, Site B − Site A</span>
          <span className="tf-decomp-total num">{signedUsd(sm.delta_per_participant)}</span>
        </div>
        <ul className="tf-decomp-parts">
          {parts.map(([label, v]) => (
            <li key={label}>
              <span className="tf-decomp-name">{label}</span>
              <span className="tf-decomp-track" aria-hidden="true">
                <span className="tf-decomp-bar" style={{ width: `${(Math.abs(v) / max) * 100}%` }} />
              </span>
              <span className="tf-decomp-v num">{signedUsd(v)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function CompareDetails({ c }: { c: Compare }) {
  const [openRow, setOpenRow] = useState<string | null>(null)
  const a = c.a.locality
  const b = c.b.locality
  const sm = c.summary
  const g = (l: Locality | null, k: 'gpci_work' | 'gpci_pe' | 'gpci_mp') => (l ? l[k] : 1)
  const m = pctText(c.multiplier)
  return (
    <div className="tf-cmp">
      <h3>Published locality factors</h3>
      <div className="table-scroll">
        <table className="tbl tbl-compact tf-gpci-tbl">
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col" className="num">
                Site A
              </th>
              <th scope="col" className="num">
                Site B
              </th>
              <th scope="col" className="num">
                B − A
              </th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['Work GPCI', 'gpci_work', 'work'],
                ['Practice expense GPCI', 'gpci_pe', 'pe'],
                ['Malpractice GPCI', 'gpci_mp', 'mp'],
              ] as const
            ).map(([label, k, dk]) => (
              <tr key={k}>
                <th scope="row">{label}</th>
                <td className="num">{g(a, k).toFixed(3)}</td>
                <td className="num">{g(b, k).toFixed(3)}</td>
                <td className="num strong">{signedNum(c.gpci_delta[dk])}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Conversion factor (national)</th>
              <td className="num">{c.conversion_factor.toFixed(4)}</td>
              <td className="num">{c.conversion_factor.toFixed(4)}</td>
              <td className="num">0</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {locName(a)}: {a?.method ?? 'national amounts'}. {locName(b)}: {b?.method ?? 'national amounts'}.
      </p>
      <h3>Every sponsor-paid item</h3>
      <p className="small muted tf-sub">
        Per line: amount = (work RVU × work GPCI + PE RVU × PE GPCI + MP RVU × MP GPCI) × conversion factor × {m}. RVUs and the conversion factor are
        national, so the difference is CF × m × Σ RVU × ΔGPCI. Select a row for both formulas.
      </p>
      <div className="table-scroll">
        <table className="tbl tbl-compact tf-cmp-tbl">
          <thead>
            <tr>
              <th scope="col">Sponsor-paid item</th>
              <th scope="col" className="num">
                Times*
              </th>
              <th scope="col" className="num">
                A each
              </th>
              <th scope="col" className="num">
                B each
              </th>
              <th scope="col" className="num">
                Δ each
              </th>
              <th scope="col" className="num">
                from work
              </th>
              <th scope="col" className="num">
                from PE
              </th>
              <th scope="col" className="num">
                from MP
              </th>
              <th scope="col" className="num">
                Δ per participant
              </th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => {
              const isOpen = openRow === r.procedure_id
              return (
                <Fragment key={r.procedure_id}>
                  <tr
                    className="clickable"
                    onClick={() => setOpenRow(isOpen ? null : r.procedure_id)}
                    tabIndex={0}
                    onKeyDown={onActivate(() => setOpenRow(isOpen ? null : r.procedure_id))}
                    aria-expanded={isOpen}
                  >
                    <th scope="row">
                      {r.code ? <code className="tf-code">{r.code}</code> : null} {r.label}
                      {!r.rvu && <span className="tf-why"> · {r.why}</span>}
                    </th>
                    <td className="num">
                      {r.n_fixed}
                      {r.visits_repeat.length ? '+' : ''}
                    </td>
                    <td className="num">{usd(r.unit_a)}</td>
                    <td className="num">{usd(r.unit_b)}</td>
                    <td className="num strong">{signedUsd(r.delta_unit)}</td>
                    <td className="num">{r.rvu ? signedUsd(r.delta_work) : '—'}</td>
                    <td className="num">{r.rvu ? signedUsd(r.delta_pe) : '—'}</td>
                    <td className="num">{r.rvu ? signedUsd(r.delta_mp) : '—'}</td>
                    <td className="num">{signedUsd(r.delta_fixed)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="tf-lines-row">
                      <td colSpan={9} className="small">
                        {r.formula_a ? (
                          <>
                            <div>
                              A: <span className="tf-mono">{formulaText(r.formula_a)}</span> × {m} = {usd(r.unit_a)}
                            </div>
                            <div>
                              B: <span className="tf-mono">{formulaText(r.formula_b ?? '')}</span> × {m} = {usd(r.unit_b)}
                            </div>
                            <div className="muted">
                              Δ = {c.conversion_factor.toFixed(4)} × {m} × ({r.rvu?.work.toFixed(2)} × {signedNum(c.gpci_delta.work)} +{' '}
                              {r.rvu?.pe.toFixed(2)} × {signedNum(c.gpci_delta.pe)} + {r.rvu?.mp.toFixed(2)} × {signedNum(c.gpci_delta.mp)}) ={' '}
                              {signedUsd(r.delta_work + r.delta_pe + r.delta_mp)}; cent rounding {signedUsd(r.rounding)}
                            </div>
                          </>
                        ) : (
                          <div>
                            {r.why}: {usd(r.unit_a)} at both sites.
                          </div>
                        )}
                        <div className="muted">Visits: {[...r.visits_fixed, ...r.visits_repeat.map((v) => `${v} (each occurrence)`)].join(', ')}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        * Times per participant over the fixed schedule; “+” means the item also recurs in a per-occurrence visit. Routine items billed to insurance
        differ by the same factors but are not the sponsor’s to pay.
      </p>
      <h3>Paid per occurrence and on screen failure</h3>
      <ul className="tf-occ small">
        {sm.per_occurrence.map((x) => (
          <li key={x.visit_id}>
            {x.label}: <span className="tnum">{usd(x.a)}</span> vs <span className="tnum">{usd(x.b)}</span> ({signedUsd(x.delta)})
          </li>
        ))}
        <li>
          Screen failure: <span className="tnum">{usd(sm.screen_failure.a)}</span> vs <span className="tnum">{usd(sm.screen_failure.b)}</span> (
          {signedUsd(sm.screen_failure.delta)})
        </li>
      </ul>
    </div>
  )
}

// ====================================================================== 5. term sheet

function SheetActions({
  b,
  nct,
  siteA,
  siteB,
  params,
  withCompare,
  setWithCompare,
  cmp,
}: {
  b: Budget
  nct: string
  siteA: string
  siteB: string | null
  params: PriceParams
  withCompare: boolean
  setWithCompare: (v: boolean) => void
  cmp: Compare | null
}) {
  const other = withCompare ? siteB : null
  const md = termsApi.markdownUrl(nct, siteA, params, other)
  const pr = termsApi.printUrl(nct, siteA, params, other)
  return (
    <div className="tf-sheet">
      <p className="tf-sheet-site">
        <span className="muted">Site</span> <span className="strong">{b.site.label}</span> · {localityLabel(b.locality)}
      </p>
      {siteB && (
        <label className="check tf-check">
          <input type="checkbox" checked={withCompare} onChange={(e) => setWithCompare(e.target.checked)} />
          Include the two-site comparison{cmp ? ` with ${cmp.b.site.label}` : ''}
        </label>
      )}
      <div className="tf-sheet-actions">
        <a className="btn btn-primary" href={md} download>
          Download markdown
        </a>
        <a className="btn" href={pr} target="_blank" rel="noreferrer">
          Open print view (save as PDF)
        </a>
      </div>
    </div>
  )
}

/** One line of the term sheet, expanded: the selected grid item's line, or else a research scan from the fixed schedule. */
function FeaturedLine({
  b,
  rules,
  selected,
  lineById,
  cmp,
  siteA,
  siteB,
}: {
  b: Budget
  rules: Rule[]
  selected: string | null
  lineById: Map<string, Line>
  cmp: Compare | null
  siteA: string
  siteB: string
}) {
  const fixed = fixedVisits(b).flatMap((v) => v.lines)
  const sponsorPfs = fixed.filter((l) => l.payer === 'Sponsor' && l.schedule === 'PFS')
  const chosen = selected ? lineById.get(selected) : undefined
  const line = chosen ?? sponsorPfs.find((l) => l.rule === 'R4') ?? sponsorPfs[0] ?? fixed.find((l) => l.payer === 'Sponsor') ?? fixed[0]
  if (!line) return null
  const visit = b.visits.find((v) => v.visit_id === line.visit_id)
  const pair = cmp && cmp.a.site.site_id === siteA && cmp.b.site.site_id === siteB ? cmp : null
  const row = pair && line.payer === 'Sponsor' ? pair.rows.find((r) => r.procedure_id === line.procedure_id) : undefined
  return (
    <div className="tf-featured">
      <p className="tf-featured-h">
        Term sheet line · {visit?.label ?? line.visit_id}
        {chosen ? ' (selected in the grid)' : ''}
      </p>
      <LineFields line={line} rules={rules} mult={b.multiplier} visit={visit?.label} priceB={row ? { a: row.unit_a, b: row.unit_b } : null} />
      {!chosen && <p className="tf-featured-hint">Select any cell in the step 2 schedule grid to show its line here.</p>}
    </div>
  )
}

function SheetContents({ b, picked }: { b: Budget; picked: TrialCard | null }) {
  const detailed = useDensity().density === 'detailed'
  const nStd = b.standard_schedule.filter((i) => i.edited).length
  return (
    <>
      {detailed && <h3>What the term sheet contains</h3>}
      <ul className="tf-sheet-list small">
        {picked && (
          <li>
            Trial: {picked.nct_id} · {picked.short_title}
          </li>
        )}
        <li>
          Per-visit payments: <span className="tnum">{b.totals.n_sponsor_lines}</span> sponsor lines, each with its provenance
        </li>
        <li>
          Billed to insurance: <span className="tnum">{b.totals.n_insurance_lines}</span> routine lines under {b.ncd}
        </li>
        <li>
          Reviewer overrides: <span className="tnum">{b.totals.n_overrides}</span>
          {b.totals.n_overrides > 0 && ' (printed as “reviewer override”)'}
        </li>
        <li>
          Proposed standard items edited: <span className="tnum">{nStd}</span>
        </li>
        <li>
          Multiplier: <span className="tnum">{pctText(b.multiplier)}</span> of Medicare on coded items
        </li>
        <li>Coverage rules R1–R5, registry sources, assumptions and proposed agreement terms</li>
        <li>{DISCLAIMER}</li>
      </ul>
    </>
  )
}

// ====================================================================== shared bits

function SiteSelect({ sites, value, onChange }: { sites: SiteOpt[]; value: string; onChange: (id: string) => void }) {
  const byState = useMemo(() => {
    const m = new Map<string, SiteOpt[]>()
    for (const s of sites) m.set(s.state, [...(m.get(s.state) ?? []), s])
    return [...m.entries()]
  }, [sites])
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {byState.map(([st, list]) => (
        <optgroup key={st} label={st}>
          {list.map((s) => (
            <option key={s.site_id} value={s.site_id}>
              {s.city}, {s.state_abbr} · {s.anonymized ? 'site name withheld' : s.facility} · {s.locality ? localityTitle(s.locality.name) : 'no locality'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
