import { useCallback, useEffect, useRef, useState } from 'react'
import { api, DEFAULT_SCENARIO, REGENERON_PRESET, type ClearResult, type Scenario } from './api'
import { useElapsed } from './components'
import MapView from './views/MapView'
import ClearView from './views/ClearView'
import PriceTagsView from './views/PriceTagsView'
import TermsView from './views/TermsView'
import ModelView from './views/ModelView'
import RobustnessView from './views/RobustnessView'
import PortfolioView from './views/PortfolioView'

const TABS = [
  { id: 'map', label: 'Congestion map' },
  { id: 'clear', label: 'Clear it' },
  { id: 'robustness', label: 'Robustness' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'prices', label: 'Price tags' },
  { id: 'terms', label: 'Pre-cleared terms' },
  { id: 'model', label: 'Model & data' },
] as const
type TabId = (typeof TABS)[number]['id']

// Deep link #portfolio/regeneron opens the Regeneron Sept 2024 portfolio demo instead of the default market.
const INITIAL_SCENARIO: Scenario = /^#portfolio\/regeneron/i.test(window.location.hash) ? REGENERON_PRESET : DEFAULT_SCENARIO

function tabFromHash(): TabId {
  const h = window.location.hash.replace('#', '').split('/')[0]
  return (TABS.find((t) => t.id === h)?.id ?? 'map') as TabId
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
  const [tab, setTab] = useState<TabId>(tabFromHash)
  const [regions, setRegions] = useState<string[]>(['US-Northeast', 'US-Midwest', 'US-South', 'US-West', 'US'])
  const [form, setForm] = useState<Scenario>(INITIAL_SCENARIO)
  const [result, setResult] = useState<ClearResult | null>(null)
  const [solvedParams, setSolvedParams] = useState<Scenario | null>(null)
  const [pendingParams, setPendingParams] = useState<Scenario | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Deep link: #prices/NCT01234567 preselects a trial for the price-tag view.
  const [selectedTrial, setSelectedTrial] = useState<string | null>(
    () => window.location.hash.match(/^#prices\/(NCT\d+)/i)?.[1]?.toUpperCase() ?? null,
  )
  const abortRef = useRef<AbortController | null>(null)
  const loading = pendingParams !== null
  const elapsed = useElapsed(loading)

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = useCallback((t: TabId) => {
    window.location.hash = t
    setTab(t)
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

  // Auto-clear the default region once so every tab has data on first load.
  useEffect(() => {
    const ctl = new AbortController()
    api
      .regions(ctl.signal)
      .then(setRegions)
      .catch(() => {
        /* keep the built-in list */
      })
    run(INITIAL_SCENARIO)
    return () => ctl.abort()
  }, [run])

  const clear: ClearState = { result, solvedParams, loading, pendingParams, error, elapsed, run }

  const openTrial = (nct: string) => {
    setSelectedTrial(nct)
    go('prices')
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
          <span className="brand-tag">clearing clinical-trial site capacity</span>
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
      <nav className="tabs" role="tablist" aria-label="Views">
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
        {tab === 'map' && <MapView clear={clear} />}
        {tab === 'clear' && (
          <ClearView clear={clear} regions={regions} form={form} setForm={setForm} onOpenTrial={openTrial} />
        )}
        {tab === 'robustness' && <RobustnessView clear={clear} />}
        {tab === 'portfolio' && (
          <PortfolioView clear={clear} regions={regions} form={form} setForm={setForm} onOpenTrial={openTrial} />
        )}
        {tab === 'prices' && <PriceTagsView clear={clear} selected={selectedTrial} setSelected={setSelectedTrial} />}
        {tab === 'terms' && <TermsView clear={clear} />}
        {tab === 'model' && <ModelView />}
      </main>
      <footer className="footer small muted">
        Concord · HackHarvard 2026 · Trial and site data from ClinicalTrials.gov; enrollment times are model estimates.
        Decision support only, not clinical, legal or coverage advice.
      </footer>
    </div>
  )
}
