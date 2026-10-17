import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { api, DEFAULT_SCENARIO, REGENERON_PRESET, type ClearResult, type Scenario } from './api'
import { Loading, useElapsed } from './components'
import { NEEDS_CLEAR, RESEARCH_TABS, researchTab, type ResearchTabId } from './routes'
import { useActiveTabScroll } from './useActiveTabScroll'
import FindingsView from './views/FindingsView'
import './app.css'

// The research views (Leaflet map, clearing, price tags, ...) load on first use of the Research tab.
const ResearchView = lazy(() => import('./views/ResearchView'))

const TABS = [
  { id: 'findings', label: 'Findings' },
  { id: 'overlap', label: 'Portfolio overlap' },
  { id: 'terms-flow', label: 'Protocol to terms' },
  { id: 'research', label: 'Research' },
] as const
type TabId = (typeof TABS)[number]['id']

interface Route {
  tab: TabId
  /** Research sub-tab named by the hash, if any. */
  sub: ResearchTabId | null
  /** Trailing segment: #research/prices/NCT01234567, #research/portfolio/regeneron. */
  arg: string | null
}

/** Hash routes: #findings (default), #overlap, #terms-flow, #research/<sub>[/<arg>]. The pre-pivot
 *  flat links (#clear, #map, #prices/NCT..., #portfolio/regeneron, ...) open the same research sub-tab. */
function parseHash(hash: string = window.location.hash): Route {
  const [head = '', ...rest] = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const h = head.toLowerCase()
  if (h === 'research') {
    const sub = researchTab(rest[0])
    return { tab: 'research', sub, arg: sub ? (rest[1] ?? null) : null }
  }
  const sub = researchTab(h)
  if (sub) return { tab: 'research', sub, arg: rest[0] ?? null }
  return { tab: TABS.find((t) => t.id === h)?.id ?? 'findings', sub: null, arg: null }
}

const INITIAL_ROUTE = parseHash()
// Deep link #research/portfolio/regeneron (or #portfolio/regeneron) opens the Regeneron Sept 2024 portfolio demo.
const REGENERON_LINK = INITIAL_ROUTE.sub === 'portfolio' && /^regeneron$/i.test(INITIAL_ROUTE.arg ?? '')
const INITIAL_SCENARIO: Scenario = REGENERON_LINK ? REGENERON_PRESET : DEFAULT_SCENARIO

function trialArg(r: Route): string | null {
  return r.sub === 'prices' && /^NCT\d+$/i.test(r.arg ?? '') ? r.arg!.toUpperCase() : null
}

export interface ClearState {
  result: ClearResult | null
  /** Params the cached result was solved with. */
  solvedParams: Scenario | null
  loading: boolean
  pendingParams: Scenario | null
  error: string | null
  elapsed: number
  run: (p: Scenario) => void
}

function Integrating({ title }: { title: string }) {
  return (
    <section className="view">
      <div className="view-head">
        <h1>{title}</h1>
      </div>
      <div className="empty">
        <p>This view is being integrated.</p>
      </div>
    </section>
  )
}

export default function App() {
  const [tab, setTab] = useState<TabId>(INITIAL_ROUTE.tab)
  const [sub, setSub] = useState<ResearchTabId>(INITIAL_ROUTE.sub ?? RESEARCH_TABS[0].id)
  const [regions, setRegions] = useState<string[]>(['US-Northeast', 'US-Midwest', 'US-South', 'US-West', 'US'])
  const [form, setForm] = useState<Scenario>(INITIAL_SCENARIO)
  const [result, setResult] = useState<ClearResult | null>(null)
  const [solvedParams, setSolvedParams] = useState<Scenario | null>(null)
  const [pendingParams, setPendingParams] = useState<Scenario | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Deep link: #research/prices/NCT01234567 preselects a trial for the price-tag view.
  const [selectedTrial, setSelectedTrial] = useState<string | null>(() => trialArg(INITIAL_ROUTE))
  const abortRef = useRef<AbortController | null>(null)
  const loading = pendingParams !== null
  const elapsed = useElapsed(loading)
  const tabBar = useActiveTabScroll<HTMLElement>(tab)

  useEffect(() => {
    const onHash = () => {
      const r = parseHash()
      setTab(r.tab)
      if (r.sub) setSub(r.sub)
      const nct = trialArg(r)
      if (nct) setSelectedTrial(nct)
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = useCallback(
    (t: TabId) => {
      window.location.hash = t === 'research' ? `research/${sub}` : t
      setTab(t)
      window.scrollTo({ top: 0 })
    },
    [sub],
  )

  const goSub = useCallback((s: ResearchTabId) => {
    window.location.hash = `research/${s}`
    setTab('research')
    setSub(s)
    window.scrollTo({ top: 0 })
  }, [])

  const run = useCallback((p: Scenario) => {
    abortRef.current?.abort()
    const ctl = new AbortController()
    abortRef.current = ctl
    setPendingParams(p)
    setError(null)
    api
      .clear(p, ctl.signal)
      .then((r) => {
        if (ctl.signal.aborted) return
        setResult(r)
        setSolvedParams(p)
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (abortRef.current === ctl) {
          setPendingParams(null)
          abortRef.current = null
        }
      })
  }, [])

  // Nothing heavy runs on the landing page. The region list loads when Research is first opened, and the
  // default clear (15-25 s) runs once, the first time a Research sub-tab that needs it is opened.
  const regionsLoaded = useRef(false)
  const autoCleared = useRef(false)
  useEffect(() => {
    if (tab !== 'research') return
    if (!regionsLoaded.current) {
      regionsLoaded.current = true
      api.regions().then(setRegions, () => {
        /* keep the built-in list */
      })
    }
    const needs = NEEDS_CLEAR.has(sub) || (sub === 'portfolio' && REGENERON_LINK)
    if (!needs || autoCleared.current) return
    autoCleared.current = true
    if (!result && !pendingParams) run(INITIAL_SCENARIO)
  }, [tab, sub, result, pendingParams, run])

  const clear: ClearState = { result, solvedParams, loading, pendingParams, error, elapsed, run }

  const openTrial = (nct: string) => {
    setSelectedTrial(nct)
    goSub('prices')
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--accent)" />
            <circle cx="11" cy="16" r="6" fill="none" stroke="#fff" strokeWidth="2.5" />
            <circle cx="21" cy="16" r="6" fill="none" stroke="#fff" strokeWidth="2.5" />
          </svg>
          <span className="brand-name">Concord</span>
          <span className="brand-tag">NSCLC trial portfolios on public ClinicalTrials.gov data</span>
        </div>
        <div className="run-status small" aria-live="polite">
          {loading ? (
            <span>
              <span className="dot dot-busy" /> Clearing {pendingParams?.region}… <span className="tnum">{elapsed.toFixed(0)} s</span>
            </span>
          ) : solvedParams ? (
            <span>
              <span className="dot dot-ok" /> Cleared {solvedParams.region}
              {solvedParams.sponsor ? ` · ${solvedParams.sponsor}` : ''}
              {solvedParams.as_of ? ` · ${solvedParams.as_of}` : ''}
            </span>
          ) : error ? (
            <span>
              <span className="dot dot-bad" /> Clear failed
            </span>
          ) : null}
        </div>
      </header>
      <nav className="tabs" role="tablist" aria-label="Views" ref={tabBar}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? ' tab-active' : ''}`}
            onClick={() => go(t.id)}
          >
            <span className="tab-num">{i + 1}</span>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="main">
        {tab === 'findings' && <FindingsView />}
        {tab === 'overlap' && <Integrating title="Portfolio overlap" />}
        {tab === 'terms-flow' && <Integrating title="Protocol to terms" />}
        {tab === 'research' && (
          <Suspense fallback={<Loading label="Loading research views…" />}>
            <ResearchView
              sub={sub}
              onSub={goSub}
              clear={clear}
              regions={regions}
              form={form}
              setForm={setForm}
              selectedTrial={selectedTrial}
              setSelectedTrial={setSelectedTrial}
              onOpenTrial={openTrial}
            />
          </Suspense>
        )}
      </main>
      <footer className="footer small muted">
        Concord · HackHarvard 2026 · Trial and site data from ClinicalTrials.gov. Enrollment times appear only in the
        Research views and are model estimates. Decision support only, not clinical, legal or coverage advice.
      </footer>
    </div>
  )
}
