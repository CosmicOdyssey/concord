import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { api, DEFAULT_SCENARIO, REGENERON_PRESET, type ClearResult, type Scenario } from './api'
import { Loading, useElapsed } from './components'
import { DENSITY_TOGGLE_ENABLED, DensityControl } from './density'
import { NEEDS_CLEAR, RESEARCH_TABS, researchTab, type ResearchTabId } from './routes'
import { skipTo } from './skip'
import { ThemeControl } from './theme'
import { useActiveTabScroll } from './useActiveTabScroll'
import FindingsView from './views/FindingsView'
import LandingView from './views/LandingView'
import './app.css'

// The research views (Leaflet map, clearing, price tags, ...) load on first use of the Research tab; the overlap
// audit and the protocol-to-terms flow load on first use too, so the landing page and Findings stay light.
const ResearchView = lazy(() => import('./views/ResearchView'))
const OverlapView = lazy(() => import('./views/OverlapView'))
const ProtocolTermsView = lazy(() => import('./views/ProtocolTermsView'))
const SiteScoresView = lazy(() => import('./views/SiteScoresView'))
const FinancialView = lazy(() => import('./views/FinancialView'))
const DevComponentsView = lazy(() => import('./views/DevComponentsView'))

// Labels, sub-labels (always visible) and tooltips: copy deck B1. Financial Coordination is a teammate's synthetic
// planning exercise; its sub-label keeps that visible in the tab bar.
const TABS = [
  { id: 'findings', label: 'Findings', hint: 'What we tested, including results that weakened the original idea.' },
  { id: 'overlap', label: 'Portfolio overlap', hint: "Where one sponsor's trials share registered sites and eligible patients." },
  { id: 'terms-flow', label: 'Protocol to terms', hint: 'A schedule of assessments, turned into a coverage grid, a budget and a term sheet.' },
  {
    id: 'site-scores',
    label: 'Site scores',
    sub: 'In development',
    hint: 'Historical per-site enrollment evidence, and how well it held up on later trials.',
  },
  {
    id: 'financial',
    label: 'Financial Coordination',
    sub: 'Synthetic scenarios',
    hint: 'A synthetic planning exercise: budgets, site resources and coverage at a fixed enrollment target.',
  },
  { id: 'research', label: 'Research', sub: 'In-sample model outputs', hint: 'The earlier site-clearing views, kept for reference. Not product claims.' },
] as const
type TabId = (typeof TABS)[number]['id']
/** A tab, the landing page (#home or no hash), or the QA page at #dev/components, which has no tab. */
type ViewId = TabId | 'home' | 'dev'

interface Route {
  tab: ViewId
  /** Research sub-tab named by the hash, if any. */
  sub: ResearchTabId | null
  /** Trailing segment: #research/prices/NCT01234567, #research/portfolio/regeneron, #findings/allocation, #home/tested. */
  arg: string | null
}

/** Hash routes: no hash or #home[/<section>] is the landing page; #findings[/<finding id>], #overlap, #terms-flow,
 *  #site-scores[/<site id>], #financial, #research/<sub>[/<arg>]. An unknown hash opens Findings. The pre-pivot flat
 *  links (#clear, #map, #prices/NCT..., #portfolio/regeneron, ...) open the same research sub-tab. #dev/components
 *  is a QA page for the shared building blocks, linked from nowhere. */
function parseHash(hash: string = window.location.hash): Route {
  const [head = '', ...rest] = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const h = head.toLowerCase()
  if (h === '' || h === 'home') return { tab: 'home', sub: null, arg: rest[0] ?? null }
  if (h === 'dev' && rest[0]?.toLowerCase() === 'components') return { tab: 'dev', sub: null, arg: null }
  if (h === 'research') {
    const sub = researchTab(rest[0])
    return { tab: 'research', sub, arg: sub ? (rest[1] ?? null) : null }
  }
  const sub = researchTab(h)
  if (sub) return { tab: 'research', sub, arg: rest[0] ?? null }
  const tab = TABS.find((t) => t.id === h)?.id ?? 'findings'
  return { tab, sub: null, arg: tab === 'findings' && tab === h ? (rest[0] ?? null) : null }
}

// Deep link #research/portfolio/regeneron (or #portfolio/regeneron) opens the Regeneron Sept 2024 portfolio demo,
// on first load or when the hash changes to it later.
function regeneronLink(r: Route): boolean {
  return r.sub === 'portfolio' && /^regeneron$/i.test(r.arg ?? '')
}

const INITIAL_ROUTE = parseHash()
const INITIAL_SCENARIO: Scenario = regeneronLink(INITIAL_ROUTE) ? REGENERON_PRESET : DEFAULT_SCENARIO

const sameScenario = (a: Scenario | null, b: Scenario | null) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b)

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

export default function App() {
  const [tab, setTab] = useState<ViewId>(INITIAL_ROUTE.tab)
  const [sub, setSub] = useState<ResearchTabId>(INITIAL_ROUTE.sub ?? RESEARCH_TABS[0].id)
  const [regions, setRegions] = useState<string[]>(['US-Northeast', 'US-Midwest', 'US-South', 'US-West', 'US'])
  const [form, setForm] = useState<Scenario>(INITIAL_SCENARIO)
  const [result, setResult] = useState<ClearResult | null>(null)
  const [solvedParams, setSolvedParams] = useState<Scenario | null>(null)
  const [pendingParams, setPendingParams] = useState<Scenario | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Deep link: #research/prices/NCT01234567 preselects a trial for the price-tag view.
  const [selectedTrial, setSelectedTrial] = useState<string | null>(() => trialArg(INITIAL_ROUTE))
  // #findings/<id> scrolls the Findings page to that finding (the Research views link to #findings/allocation).
  const [findingFocus, setFindingFocus] = useState<{ id: string | null; n: number }>({
    id: INITIAL_ROUTE.tab === 'findings' ? INITIAL_ROUTE.arg : null,
    n: 0,
  })
  // #home/<section> scrolls the landing page to that section (overlap, terms, tested).
  const [landingFocus, setLandingFocus] = useState<{ id: string | null; n: number }>({
    id: INITIAL_ROUTE.tab === 'home' ? INITIAL_ROUTE.arg : null,
    n: 0,
  })
  // A scenario a deep link asked for (the Regeneron preset), cleared once Research is showing.
  const presetRequest = useRef<Scenario | null>(regeneronLink(INITIAL_ROUTE) ? REGENERON_PRESET : null)
  const [presetTick, setPresetTick] = useState(0)
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
      if (regeneronLink(r)) {
        presetRequest.current = REGENERON_PRESET
        setForm(REGENERON_PRESET)
        setPresetTick((x) => x + 1)
      }
      if (r.tab === 'findings') setFindingFocus((f) => ({ id: r.arg, n: f.n + 1 }))
      if (r.tab === 'home') setLandingFocus((f) => ({ id: r.arg, n: f.n + 1 }))
      // The landing page scrolls itself to a named section.
      if (!(r.tab === 'home' && r.arg)) window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const tabLabel = TABS.find((t) => t.id === tab)?.label
  useEffect(() => {
    document.title = tabLabel ? `${tabLabel} · Concord` : 'Concord'
  }, [tabLabel])

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

  // Nothing heavy runs on the landing page or Findings. The region list loads when Research is first opened, and the
  // default clear (about 2 minutes on the rebuilt DB) runs once, the first time a Research sub-tab that needs it is opened.
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
    const preset = presetRequest.current
    if (preset) {
      presetRequest.current = null
      autoCleared.current = true
      if (!sameScenario(preset, pendingParams) && !(sameScenario(preset, solvedParams) && !pendingParams)) run(preset)
      return
    }
    if (!NEEDS_CLEAR.has(sub) || autoCleared.current) return
    autoCleared.current = true
    if (!result && !pendingParams) run(INITIAL_SCENARIO)
  }, [tab, sub, result, pendingParams, solvedParams, presetTick, run])

  const clear: ClearState = { result, solvedParams, loading, pendingParams, error, elapsed, run }

  const openTrial = (nct: string) => {
    setSelectedTrial(nct)
    goSub('prices')
  }

  // The landing page is its own page, outside the app shell.
  if (tab === 'home') return <LandingView focus={landingFocus} />

  return (
    <div className="app">
      <a className="skip" href="#main-content" onClick={(e) => skipTo(e, 'main-content')}>
        Skip to content
      </a>
      <header className="appbar">
        <div className="appbar-in">
          <div className="appbar-top">
            <a className="wordmark" href="#home" aria-label="Back to the Concord home page">
              Concord
            </a>
            <div className="appbar-ctl">
              {DENSITY_TOGGLE_ENABLED && <DensityControl />}
              <ThemeControl />
            </div>
          </div>
          <nav className="tabs" role="tablist" aria-label="Views" ref={tabBar}>
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tab${tab === t.id ? ' tab-active' : ''}`}
                title={t.hint}
                onClick={() => go(t.id)}
              >
                <span className="tab-label">{t.label}</span>
                {'sub' in t && <span className="tab-sub">{t.sub}</span>}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="main" id="main-content" tabIndex={-1}>
        {/* Clearing is a Research-only computation: its status shows only there, in the page rather than the header,
            so the header keeps one height on every tab and at every width. Always mounted, so changes are announced. */}
        <div className="run-status small" aria-live="polite">
          {tab !== 'research' ? null : loading ? (
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
        {tab === 'findings' && <FindingsView focus={findingFocus} />}
        {tab === 'overlap' && (
          <Suspense fallback={<Loading label="Loading portfolio overlap…" />}>
            <OverlapView regions={regions} />
          </Suspense>
        )}
        {tab === 'terms-flow' && (
          <Suspense fallback={<Loading label="Loading protocol to terms…" />}>
            <ProtocolTermsView />
          </Suspense>
        )}
        {tab === 'site-scores' && (
          <Suspense fallback={<Loading label="Loading site scores…" />}>
            <SiteScoresView />
          </Suspense>
        )}
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
        {tab === 'financial' && (
          <Suspense fallback={<Loading label="Loading financial coordination…" />}>
            <FinancialView />
          </Suspense>
        )}
        {tab === 'dev' && (
          <Suspense fallback={<Loading label="Loading component check…" />}>
            <DevComponentsView />
          </Suspense>
        )}
      </main>
      <footer className="footer">
        <div className="footer-in">
          Concord · HackHarvard 2026 · Trial and site data from ClinicalTrials.gov. Enrollment times in Research are model estimates; Financial
          Coordination uses explicitly synthetic scenarios. Decision support only, not clinical, legal or coverage advice.
        </div>
      </footer>
    </div>
  )
}
