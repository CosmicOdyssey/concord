// Protocol to terms: pick a trial, read its (illustrative) schedule of assessments, review who pays for
// each node, price it at a registered U.S. site from the published Medicare fee schedule, edit the
// proposed standard non-procedure schedule, compare two sites, export the term sheet.
// No forecasting anywhere: no enrollment, speed or time-to-fill numbers.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Badge, ErrorBox, Loading } from '../components'
import { ctgovUrl, phaseLabel, usd } from '../format'
import {
  DISCLAIMER,
  ILLUSTRATIVE,
  termsApi,
  type Budget,
  type Compare,
  type Coverage,
  type Locality,
  type Overrides,
  type PriceParams,
  type Protocol,
  type ProtocolNode,
  type SiteOpt,
  type SitesResp,
  type StandardEdits,
  type StandardItem,
  type Line,
  type NodeState,
  type TrialCard,
  coverageLabel,
  nodeStates,
} from '../termsFlowApi'
import { CoverageList, NodeDetail, RuleChip, ScheduleGrid, VisitTimeline } from './ProtocolTermsSchedule'
import './protocolTerms.css'

type Async<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; data: T }

const DEFAULT_NCT = 'NCT05800015'
const STEPS = [
  'Trial',
  'Schedule of assessments',
  'Coverage',
  'Budget at a site',
  'Non-procedure schedule',
  'Compare two sites',
  'Term sheet',
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
    if (/^#terms-flow(\/|$)/i.test(window.location.hash) && nctFromHash() !== nct)
      window.history.replaceState(null, '', `#terms-flow/${nct}`)
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

function statusLabel(s: string | undefined): string {
  if (!s) return 'status not reported'
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')
}

function locName(l: Locality | null): string {
  return l ? `${l.name} (${l.state} ${l.code})` : 'national (no locality)'
}

export default function ProtocolTermsView() {
  const [nct, setNct] = useState<string>(initialNct)
  const [overrides, setOverrides] = useState<Overrides>(() => readStore(`tf:overrides:${initialNct()}`, {}))
  const [standard, setStandard] = useState<StandardEdits>(() => readStore('tf:standard:v1', {}))
  const [multPct, setMultPct] = useState<number>(() => {
    const v = readStore<unknown>('tf:multiplier', 100)
    return typeof v === 'number' && v >= 10 && v <= 500 ? v : 100
  })
  const [siteA, setSiteA] = useState('')
  const [siteB, setSiteB] = useState('')
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

  // Remember the trial across tab switches (App.go() resets the hash to plain #terms-flow) and
  // reflect it in the address bar.
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
  useEffect(() => {
    if (!sitesData) return
    const ids = new Set(sitesData.sites.map((s) => s.site_id))
    const [a, b] = sitesData.default_pair
    if (!siteA || !ids.has(siteA)) setSiteA(a ?? sitesData.sites[0]?.site_id ?? '')
    if (!siteB || !ids.has(siteB)) setSiteB(b ?? sitesData.sites[1]?.site_id ?? '')
  }, [sitesData, siteA, siteB])

  const proto = protocol.status === 'ok' && protocol.data.nct_id === nct ? protocol.data : null
  // Stored overrides may name nodes of an older protocol file: send only the ones that exist.
  const validOverrides = useMemo(() => {
    if (!proto) return {}
    const ids = new Set(proto.nodes.map((n) => n.id))
    return Object.fromEntries(Object.entries(overrides).filter(([k, v]) => ids.has(k) && (v === 'routine' || v === 'research'))) as Overrides
  }, [proto, overrides])
  const multiplier = Math.min(500, Math.max(10, Number.isFinite(multPct) ? multPct : 100)) / 100
  const params: PriceParams = useMemo(() => ({ multiplier, overrides: validOverrides, standard }), [multiplier, validOverrides, standard])
  const dparams = useDebounced(params, 250)
  const pkey = JSON.stringify(dparams)
  const siteOk = !!proto && !!sitesData && sitesData.sites.some((s) => s.site_id === siteA)
  const [budget, retryBudget] = useFetch<Budget>(siteOk ? `b:${nct}:${siteA}:${pkey}` : null, (s) =>
    termsApi.budget(nct, siteA, dparams, s),
  )
  const cmpOk = siteOk && !!siteB && siteB !== siteA && !!sitesData?.sites.some((s) => s.site_id === siteB)
  const [cmp, retryCmp] = useFetch<Compare>(cmpOk ? `c:${nct}:${siteA}:${siteB}:${pkey}` : null, (s) =>
    termsApi.compare(nct, siteA, siteB, dparams, s),
  )

  const states = useMemo(() => (proto ? nodeStates(proto, overrides) : new Map<string, NodeState>()), [proto, overrides])
  const bud = budget.status === 'ok' && budget.data.nct_id === nct ? budget.data : null
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

  const go = (i: number) => document.getElementById(`tf-step-${i + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const selNode = proto && selected ? proto.nodes.find((n) => n.id === selected) ?? null : null

  return (
    <section className="view tf">
      <div className="view-head">
        <div>
          <h1>Protocol to terms</h1>
          <p className="lede tagline">A protocol in, transparent pre-priced terms out.</p>
          <p className="lede">
            Contracting stalls on budgets nobody can trace. Here every payment line names its source: a code priced
            from the published Medicare fee schedule at the site’s locality, or an itemized proposed standard. Every
            coverage call names its rule, and a reviewer can override any of them on the record.
          </p>
        </div>
        <div className="tf-banner" role="note">
          <strong>{DISCLAIMER}</strong> Schedules are <em>{ILLUSTRATIVE.toLowerCase()}</em>, not the sponsors’
          protocols.
        </div>
        <nav className="tf-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button key={s} type="button" className="tf-step-btn" onClick={() => go(i)}>
              <span className="tf-step-num">{i + 1}</span>
              {s}
            </button>
          ))}
        </nav>
      </div>

      {/* 1. Trial */}
      <section id="tf-step-1" className="card tf-step">
        <StepHead n={1} title="Pick a trial" sub="Two first-line NSCLC chemo-immunotherapy trials with every-3-week dosing in the registry." />
        {trials.status === 'loading' && <Loading label="Loading trials…" />}
        {trials.status === 'error' && <ErrorBox error={trials.error} onRetry={retryTrials} />}
        {trials.status === 'ok' && (
          <div className="tf-trials">
            {trials.data.map((t) => (
              <TrialCardView key={t.nct_id} t={t} on={t.nct_id === nct} onPick={() => selectTrial(t.nct_id)} />
            ))}
          </div>
        )}
      </section>

      {protocol.status === 'error' && <ErrorBox error={protocol.error} onRetry={retryProtocol} />}
      {!proto && protocol.status !== 'error' && <Loading label="Loading the schedule of assessments…" />}

      {proto && (
        <>
          {/* 2. Schedule */}
          <section id="tf-step-2" className="card tf-step">
            <StepHead
              n={2}
              title="Schedule of assessments"
              sub={`${proto.visits.length} visits × ${proto.procedures.length} procedures, ${proto.nodes.length} scheduled items. Each cell is one node with its coverage rule.`}
              badge={<Badge tone="warn">{ILLUSTRATIVE}</Badge>}
            />
            <VisitTimeline protocol={proto} />
            <div className="tf-legend small">
              <span>
                <span className="tf-cell tf-cell-routine tf-cell-demo">R3</span> Routine: billed to insurance
              </span>
              <span>
                <span className="tf-cell tf-cell-research tf-cell-demo">R2</span> Research: sponsor pays
              </span>
              <span>
                <span className="tf-cell tf-cell-research tf-cell-ov tf-cell-demo">R4✎</span> Reviewer override
              </span>
              <span className="tf-legend-rep">Shaded columns are priced per occurrence (they happen only while the participant stays on study)</span>
            </div>
            <ScheduleGrid protocol={proto} states={states} selected={selected} onSelect={setSelected} />
            {selNode ? (
              <NodeDetail
                protocol={proto}
                node={selNode}
                state={states.get(selNode.id) as NodeState}
                line={lineById.get(selNode.id) ?? null}
                onSet={setNode}
              />
            ) : (
              <p className="small muted tf-hint">Select a cell to see its rule, reason and price, and to override its label.</p>
            )}
            <details className="tf-sources">
              <summary>How this schedule was authored ({proto.sources.length} registry facts, {proto.assumptions.length} assumptions)</summary>
              <p className="small muted">
                Authored {proto.authored} from the ClinicalTrials.gov record of {proto.nct_id}. Where the registry is
                silent we used standard NSCLC practice. {proto.quote_note}
              </p>
              <ul className="tf-src-list small">
                {proto.sources.map((s, i) => (
                  <li key={i}>
                    <span className="tf-src-field">{s.field}</span> “{s.quote}” <span className="muted">→ {s.used_for}</span>
                  </li>
                ))}
              </ul>
              <ul className="tf-src-list small">
                {proto.assumptions.map((a, i) => (
                  <li key={i}>
                    <Badge tone="neutral">assumption</Badge> {a}
                  </li>
                ))}
              </ul>
            </details>
          </section>

          {/* 3. Coverage */}
          <section id="tf-step-3" className="card tf-step">
            <StepHead
              n={3}
              title="Coverage: routine care or research"
              sub="Every node gets a label from an explicit rule. Click any visit chip to flip it; overrides are tracked and printed as “reviewer override”."
              badge={
                nOverrides > 0 ? (
                  <span className="tf-ovcount">
                    <Badge tone="warn">
                      {nOverrides} reviewer override{nOverrides === 1 ? '' : 's'}
                    </Badge>{' '}
                    <button type="button" className="btn btn-small" onClick={() => setOverrides({})}>
                      Clear overrides
                    </button>
                  </span>
                ) : (
                  <Badge tone="neutral">no overrides</Badge>
                )
              }
            />
            <div className="tf-rules">
              {proto.rules.map((r) => (
                <div key={r.id} className={`tf-rulecard tf-rulecard-${r.coverage}`}>
                  <div className="tf-rulecard-head">
                    <RuleChip rule={r.id} coverage={r.coverage} />
                    <span className={`tf-pay tf-pay-${r.coverage}`}>{coverageLabel(r.coverage)}</span>
                  </div>
                  <div className="strong small">{r.title}</div>
                  <div className="small muted">{r.text}</div>
                  <div className="small tnum">{r.nodes} nodes</div>
                </div>
              ))}
            </div>
            <details className="tf-sources">
              <summary>Standard-care reference used by R3 and R4</summary>
              <ul className="small">
                {proto.standard_care_reference.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p className="small muted">{proto.standard_care_source}</p>
            </details>
            <CoverageList protocol={proto} states={states} onToggle={toggleNode} />
          </section>

          {/* 4. Budget */}
          <section id="tf-step-4" className="card tf-step">
            <StepHead
              n={4}
              title="Budget at a registered site"
              sub="Only research items bill the sponsor. Routine items are shown at the Medicare amount billed to insurance."
              badge={<FlowLabels />}
            />
            {sites.status === 'error' && <ErrorBox error={sites.error} onRetry={retrySites} />}
            {sitesData && (
              <div className="controls-row tf-controls">
                <label className="field field-wide">
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
                    <span>%</span>
                  </span>
                </label>
              </div>
            )}
            {budget.status === 'error' && <ErrorBox error={budget.error} onRetry={retryBudget} />}
            {!bud && budget.status === 'loading' && <Loading label="Pricing…" />}
            {bud && <BudgetView b={bud} stale={budget.status === 'ok' && JSON.stringify(dparams) !== JSON.stringify(params)} />}
          </section>

          {/* 5. Standard schedule */}
          <section id="tf-step-5" className="card tf-step">
            <StepHead
              n={5}
              title="Non-procedure schedule"
              sub="Itemized and editable. Applies at every site; it is not geographically adjusted."
              badge={<Badge tone="info">Proposed standard</Badge>}
            />
            {bud ? (
              <StandardEditor items={bud.standard_schedule} screenFail={bud.totals.screen_failure} edits={standard} onChange={setStandard} />
            ) : (
              <Loading label="Loading the schedule…" />
            )}
          </section>

          {/* 6. Compare */}
          <section id="tf-step-6" className="card tf-step">
            <StepHead
              n={6}
              title="Compare two sites"
              sub="Same protocol, same coverage labels, same multiplier. Every price difference traces to the published locality factors (GPCI)."
              badge={<FlowLabels />}
            />
            {sitesData && (
              <>
                {sitesData.presets.length > 0 && (
                  <div className="tf-presets">
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
                <div className="controls-row tf-controls">
                  <label className="field field-wide">
                    <span className="field-label">Site A (also priced in step 4)</span>
                    <SiteSelect sites={sitesData.sites} value={siteA} onChange={setSiteA} />
                  </label>
                  <label className="field field-wide">
                    <span className="field-label">Site B</span>
                    <SiteSelect sites={sitesData.sites} value={siteB} onChange={setSiteB} />
                  </label>
                </div>
              </>
            )}
            {siteA && siteA === siteB && <p className="small note">Pick two different sites.</p>}
            {cmp.status === 'error' && <ErrorBox error={cmp.error} onRetry={retryCmp} />}
            {cmp.status === 'loading' && <Loading label="Comparing…" />}
            {cmp.status === 'ok' && cmpOk && cmp.data.nct_id === nct && <CompareView c={cmp.data} />}
          </section>

          {/* 7. Term sheet */}
          <section id="tf-step-7" className="card tf-step">
            <StepHead n={7} title="Term sheet" sub="Every line carries its provenance: code, our short label, schedule, source file, locality and GPCI values, conversion factor, multiplier, and the coverage rule or reviewer override." />
            {bud && siteOk ? (
              <TermSheetPanel b={bud} nct={nct} siteA={siteA} siteB={cmpOk ? siteB : null} params={params} withCompare={withCompare} setWithCompare={setWithCompare} cmp={cmp.status === 'ok' ? cmp.data : null} />
            ) : (
              <Loading label="Preparing…" />
            )}
          </section>
        </>
      )}
    </section>
  )
}

function StepHead({ n, title, sub, badge }: { n: number; title: string; sub?: string; badge?: ReactNode }) {
  return (
    <div className="tf-step-head">
      <div className="tf-step-title">
        <span className="tf-step-num tf-step-num-lg">{n}</span>
        <div>
          <h2>{title}</h2>
          {sub && <p className="small muted tf-step-sub">{sub}</p>}
        </div>
      </div>
      {badge && <div className="tf-step-badge">{badge}</div>}
    </div>
  )
}

/** The two labels every price-bearing step carries, so a cropped screenshot keeps them. */
function FlowLabels() {
  return (
    <span className="tf-flowlabels">
      <Badge tone="warn">{ILLUSTRATIVE}</Badge>
      <span className="tf-flowlabel-dis">{DISCLAIMER}</span>
    </span>
  )
}

function TrialCardView({ t, on, onPick }: { t: TrialCard; on: boolean; onPick: () => void }) {
  const f = t.trial
  return (
    <div className={`tf-trial${on ? ' tf-trial-on' : ''}`} onClick={onPick}>
      <div className="tf-trial-top">
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
          <span className="strong">{f.sponsor ?? 'Sponsor'}</span>
        </button>
        <span className="tf-trial-badges">
          <Badge tone={f.status === 'RECRUITING' ? 'ok' : 'neutral'}>{statusLabel(f.status)}</Badge>
          <Badge tone="neutral">{phaseLabel(f.phases)}</Badge>
        </span>
      </div>
      <div className="tf-trial-title">{t.short_title}</div>
      <div className="small">
        <a href={ctgovUrl(t.nct_id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {t.nct_id}
        </a>
        {t.design && <span className="muted"> · design: {t.design.design.replace('_', ' ')}</span>}
      </div>
      <ul className="tf-arms small">
        {t.arms.map((a) => (
          <li key={a.label}>
            <span className="muted">{a.label}:</span> {a.text}
          </li>
        ))}
      </ul>
      <div className="small">
        <span className="muted">Dosing:</span> {t.dosing}
      </div>
      <div className="small">
        <span className="muted">Masking:</span> {t.masking}
      </div>
      <div className="small">
        <span className="muted">Registered U.S. sites:</span> <span className="tnum">{f.n_us_sites ?? '—'}</span>
        {!!f.n_us_sites_withdrawn && <span className="muted"> ({f.n_us_sites_withdrawn} withdrawn)</span>}
      </div>
      {t.registry_notes.map((n) => (
        <div key={n} className="small tf-regnote">
          {n}
        </div>
      ))}
      <div className="small muted tf-why">{t.why_chosen}</div>
    </div>
  )
}

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
              {s.city}, {s.state_abbr} · {s.anonymized ? 'site name withheld' : s.facility} · {s.locality ? s.locality.name : 'no locality'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function LocalityCard({ l, cf, source }: { l: Locality | null; cf: number | null; source: string | null }) {
  if (!l) return <p className="small note">No Medicare locality resolved for this site: national amounts are used.</p>
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
          <dd className="tnum">{l.gpci_work.toFixed(3)}</dd>
        </div>
        <div>
          <dt>PE GPCI</dt>
          <dd className="tnum">{l.gpci_pe.toFixed(3)}</dd>
        </div>
        <div>
          <dt>MP GPCI</dt>
          <dd className="tnum">{l.gpci_mp.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Conversion factor</dt>
          <dd className="tnum">{cf?.toFixed(4) ?? '—'}</dd>
        </div>
      </dl>
      <div className="small muted tf-loc-src">{source ?? 'CMS PFS file not loaded'}</div>
    </div>
  )
}

function BudgetView({ b, stale }: { b: Budget; stale: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(['SCR']))
  const t = b.totals
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const occ = (id: string) => t.per_occurrence.find((x) => x.visit_id === id)
  return (
    <div className={stale ? 'tf-stale' : undefined}>
      <LocalityCard l={b.locality} cf={b.conversion_factor} source={b.pfs_source} />
      <div className="stats tf-stats">
        <div className="stat stat-emph">
          <div className="stat-label">Per participant</div>
          <div className="stat-value tnum">{usd(t.per_participant)}</div>
          <div className="stat-sub">{t.per_participant_scope}</div>
          {t.per_participant_placeholder > 0 && (
            <div className="stat-sub tf-placeholder-note">includes placeholder lab prices until CLFS is loaded</div>
          )}
        </div>
        <div className="stat">
          <div className="stat-label">Each later cycle</div>
          <div className="stat-value tnum">{usd(occ('CX')?.amount)}</div>
          <div className="stat-sub">per occurrence, C9 on</div>
        </div>
        {occ('TA36') && (
          <div className="stat">
            <div className="stat-label">{occ('TA36')?.label}</div>
            <div className="stat-value tnum">{usd(occ('TA36')?.amount)}</div>
            <div className="stat-sub">per occurrence; the extra scan (rule R4)</div>
          </div>
        )}
        <div className="stat">
          <div className="stat-label">Screen failure</div>
          <div className="stat-value tnum">{usd(t.screen_failure)}</div>
          <div className="stat-sub">as incurred (screening visit payment)</div>
        </div>
        <div className="stat">
          <div className="stat-label">Per site, one time</div>
          <div className="stat-value tnum">{usd(t.per_site_one_time)}</div>
          <div className="stat-sub">start-up, IRB, pharmacy, close-out, archiving</div>
        </div>
      </div>
      <p className="small tf-compose">
        Per participant = research items <strong className="tnum">{usd(t.per_participant_research_items)}</strong> + coordinator time{' '}
        <strong className="tnum">{usd(t.per_participant_coordinator)}</strong> + overhead{' '}
        <strong className="tnum">{usd(t.per_participant_overhead)}</strong>. Lab placeholders inside it:{' '}
        <span className="tnum">{usd(t.per_participant_placeholder)}</span>.{' '}
        {t.per_occurrence
          .filter((x) => !['CX', 'TA36'].includes(x.visit_id))
          .map((x) => (
            <Fragment key={x.visit_id}>
              {x.label}: <span className="tnum">{usd(x.amount)}</span> each.{' '}
            </Fragment>
          ))}
        Routine care billed to insurance over the same visits (Medicare amounts, for reference):{' '}
        <span className="tnum">{usd(t.per_participant_insurance_medicare)}</span>.
      </p>
      <div className="table-scroll">
        <table className="tbl tbl-compact tf-budget">
          <thead>
            <tr>
              <th>Visit</th>
              <th className="num">Sponsor items</th>
              <th className="num tf-hide-sm">Coordinator</th>
              <th className="num tf-hide-sm">Overhead</th>
              <th className="num">Visit payment</th>
              <th className="num">Billed to insurance</th>
            </tr>
          </thead>
          <tbody>
            {b.visits.map((v) => {
              const isOpen = open.has(v.visit_id)
              return (
                <Fragment key={v.visit_id}>
                  <tr className={`clickable${v.kind === 'repeat' ? ' tf-row-rep' : ''}`} onClick={() => toggle(v.visit_id)} tabIndex={0} onKeyDown={onActivate(() => toggle(v.visit_id))} aria-expanded={isOpen}>
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
                              <th>Code</th>
                              <th>Item</th>
                              <th>Basis</th>
                              <th>Payer</th>
                              <th className="num">Medicare</th>
                              <th className="num">Sponsor</th>
                              <th>Provenance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {v.lines.map((l) => (
                              <tr key={l.node_id} className={l.payer === 'Insurance' ? 'tf-line-ins' : undefined}>
                                <td>{l.code ? <code className="tf-code">{l.code}</code> : <span className="muted">—</span>}</td>
                                <td>{l.label}</td>
                                <td>
                                  {l.override ? <Badge tone="warn">reviewer override</Badge> : <RuleChip rule={l.rule} coverage={l.coverage} title={l.reason} />}
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
    </div>
  )
}

function Provenance({ l, mult }: { l: Line; mult: number }) {
  const m = l.payer === 'Sponsor' && l.schedule && ['PFS', 'CLFS'].includes(l.schedule) ? ` × ${(mult * 100).toFixed(0)}%` : ''
  if (l.schedule === 'PFS' && l.formula)
    return (
      <span>
        <span className="tf-src-tag">PFS</span> <span className="tf-mono">{l.formula}</span>
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
        <span className="tf-src-tag tf-src-std">Proposed standard</span>{' '}
        {l.payer === 'Sponsor' ? (l.standard_label ?? 'itemized fee') : 'not billed (routine)'}
        {l.edited && ' (edited)'}
      </span>
    )
  return <span className="muted">{l.note ?? 'no site charge'}</span>
}

/** Number input that keeps what the user is typing (including an empty box) and commits only valid
 * values; an empty box commits null (back to the default) when it loses focus. */
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
              <th>Item</th>
              <th>Applies</th>
              <th className="num">Amount</th>
              <th className="num">Proposed</th>
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
                      <span className="tnum">{usd(screenFail)}</span>
                    ) : (
                      <span className="tf-num-input">
                        {!isRate && <span>$</span>}
                        <NumField
                          value={val === null ? null : isRate ? Math.round(val * 1000) / 10 : val}
                          min={0}
                          max={isRate ? 100 : undefined}
                          step={isRate ? 1 : 5}
                          label={`${it.label} amount`}
                          onCommit={(raw) => set(it.id, raw === null ? null : isRate ? raw / 100 : raw, it.default)}
                        />
                        {isRate && <span>%</span>}
                      </span>
                    )}
                  </td>
                  <td className="num small muted tnum">
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

function CompareView({ c }: { c: Compare }) {
  const [openRow, setOpenRow] = useState<string | null>(null)
  const a = c.a.locality
  const b = c.b.locality
  const sm = c.summary
  const g = (l: Locality | null, k: 'gpci_work' | 'gpci_pe' | 'gpci_mp') => (l ? l[k] : 1)
  return (
    <div className="tf-cmp">
      <div className="tf-cmp-sites">
        {(['a', 'b'] as const).map((k) => (
          <div key={k} className="tf-cmp-site">
            <div className="field-label">Site {k.toUpperCase()}</div>
            <div className="strong">{c[k].site.label}</div>
            <div className="small">{locName(c[k].locality)}</div>
            <div className="small muted">{c[k].locality?.method}</div>
            <div className="tf-cmp-total tnum">{usd(c[k].totals.per_participant)}</div>
            <div className="small muted">per participant ({c[k].totals.per_participant_scope})</div>
            {c[k].totals.per_participant_placeholder > 0 && (
              <div className="small muted">includes placeholder lab prices until CLFS is loaded</div>
            )}
          </div>
        ))}
      </div>
      <div className="table-scroll">
        <table className="tbl tbl-compact tf-gpci-tbl">
          <thead>
            <tr>
              <th>Published locality factor</th>
              <th className="num">Site A</th>
              <th className="num">Site B</th>
              <th className="num">B − A</th>
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
                <td className="num strong">{c.gpci_delta[dk] >= 0 ? '+' : '−'}{Math.abs(c.gpci_delta[dk]).toFixed(3)}</td>
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
      <div className="tf-decomp">
        <div className="tf-decomp-head">
          <span className="field-label">
            Difference per participant (B − A
            {c.a.totals.per_participant_placeholder > 0 || c.b.totals.per_participant_placeholder > 0
              ? '; includes placeholder lab prices until CLFS is loaded'
              : ''}
            )
          </span>
          <span className="tf-decomp-total tnum">{signedUsd(sm.delta_per_participant)}</span>
        </div>
        <div className="tf-decomp-parts small">
          <span>
            work GPCI <strong className="tnum">{signedUsd(sm.from_work)}</strong>
          </span>
          <span>+ practice-expense GPCI <strong className="tnum">{signedUsd(sm.from_pe)}</strong></span>
          <span>+ malpractice GPCI <strong className="tnum">{signedUsd(sm.from_mp)}</strong></span>
          <span>
            + overhead ({(sm.overhead_rate * 100).toFixed(0)}%) on those <strong className="tnum">{signedUsd(sm.delta_overhead)}</strong>
          </span>
          <span>+ cent rounding <strong className="tnum">{signedUsd(sm.rounding)}</strong></span>
        </div>
        <div className="tf-decomp-parts small muted">
          {sm.per_occurrence.map((x) => (
            <span key={x.visit_id}>
              {x.label}: {usd(x.a)} vs {usd(x.b)} ({signedUsd(x.delta)})
            </span>
          ))}
          <span>
            Screen failure: {usd(sm.screen_failure.a)} vs {usd(sm.screen_failure.b)} ({signedUsd(sm.screen_failure.delta)})
          </span>
        </div>
      </div>
      <p className="small muted">
        Per line: amount = (work RVU × work GPCI + PE RVU × PE GPCI + MP RVU × MP GPCI) × conversion factor ×{' '}
        {(c.multiplier * 100).toFixed(0)}%. RVUs and the conversion factor are national, so the difference is CF × m × Σ RVU × ΔGPCI.
        Click a row for both formulas.
      </p>
      <div className="table-scroll">
        <table className="tbl tbl-compact tf-cmp-tbl">
          <thead>
            <tr>
              <th>Sponsor-paid item</th>
              <th className="num">Times*</th>
              <th className="num">A each</th>
              <th className="num">B each</th>
              <th className="num">Δ each</th>
              <th className="num">from work</th>
              <th className="num">from PE</th>
              <th className="num">from MP</th>
              <th className="num">Δ per participant</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => {
              const isOpen = openRow === r.procedure_id
              return (
                <Fragment key={r.procedure_id}>
                  <tr className="clickable" onClick={() => setOpenRow(isOpen ? null : r.procedure_id)} tabIndex={0} onKeyDown={onActivate(() => setOpenRow(isOpen ? null : r.procedure_id))} aria-expanded={isOpen}>
                    <th scope="row">
                      {r.code ? <code className="tf-code">{r.code}</code> : null} {r.label}
                      {!r.rvu && <span className="tf-why"> · {r.why}</span>}
                    </th>
                    <td className="num">{r.n_fixed}{r.visits_repeat.length ? '+' : ''}</td>
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
                              A: <span className="tf-mono">{r.formula_a}</span> × {(c.multiplier * 100).toFixed(0)}% = {usd(r.unit_a)}
                            </div>
                            <div>
                              B: <span className="tf-mono">{r.formula_b}</span> × {(c.multiplier * 100).toFixed(0)}% = {usd(r.unit_b)}
                            </div>
                            <div className="muted">
                              Δ = {c.conversion_factor.toFixed(4)} × {(c.multiplier * 100).toFixed(0)}% × ({r.rvu?.work.toFixed(2)} × {signedNum(c.gpci_delta.work)} +{' '}
                              {r.rvu?.pe.toFixed(2)} × {signedNum(c.gpci_delta.pe)} + {r.rvu?.mp.toFixed(2)} × {signedNum(c.gpci_delta.mp)}) ={' '}
                              {signedUsd(r.delta_work + r.delta_pe + r.delta_mp)}; cent rounding {signedUsd(r.rounding)}
                            </div>
                          </>
                        ) : (
                          <div>{r.why}: {usd(r.unit_a)} at both sites.</div>
                        )}
                        <div className="muted">
                          Visits: {[...r.visits_fixed, ...r.visits_repeat.map((v) => `${v} (each occurrence)`)].join(', ')}
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
      <p className="small muted">
        * Times per participant over the fixed schedule; “+” means the item also recurs in a per-occurrence visit. Routine items billed to
        insurance differ by the same factors but are not the sponsor’s to pay.
      </p>
    </div>
  )
}

function signedNum(x: number): string {
  return `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`
}

function TermSheetPanel({
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
  const sample = b.visits.flatMap((v) => v.lines).find((l) => l.payer === 'Sponsor' && l.schedule === 'PFS')
  const nStd = b.standard_schedule.filter((i) => i.edited).length
  return (
    <div className="tf-sheet">
      <div className="tf-sheet-summary">
        <div>
          <div className="field-label">Site</div>
          <div className="strong">{b.site.label}</div>
          <div className="small muted">{locName(b.locality)}</div>
        </div>
        <ul className="small tf-sheet-list">
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
            Multiplier: <span className="tnum">{(b.multiplier * 100).toFixed(0)}%</span> of Medicare on coded items
          </li>
          <li>Coverage rules R1–R5, registry sources, assumptions and proposed agreement terms</li>
        </ul>
      </div>
      {siteB && (
        <label className="check small">
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
      {sample && (
        <div className="tf-sheet-sample small">
          <div className="field-label">Example line</div>
          <code className="tf-code">{sample.code}</code> {sample.label} · {sample.schedule} · {sample.override ? sample.basis : `rule ${sample.rule}`} · {usd(sample.amount)}
          <div className="tf-mono muted">
            {(b.pfs_source ?? '').split(', ').pop()}, {locName(b.locality)}: {sample.formula} × {(b.multiplier * 100).toFixed(0)}%
          </div>
        </div>
      )}
      <p className="small muted">{DISCLAIMER} Codes are shown with Concord’s own short labels, not AMA CPT descriptors.</p>
    </div>
  )
}
