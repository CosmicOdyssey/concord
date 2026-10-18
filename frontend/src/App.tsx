import { Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, DEFAULT_SCENARIO, REGENERON_PRESET, type ClearResult, type Scenario } from './api'
import { Loading, useElapsed } from './components'
import { DENSITY_TOGGLE_ENABLED, DensityControl } from './density'
import { preloadable } from './lazyView'
import { NEEDS_CLEAR, RESEARCH_TABS, researchTab, type ResearchTabId } from './routes'
import { skipTo } from './skip'
import { createTabSignal, TabSignalContext, type TabSignalControl } from './tabActive'
import { ThemeControl } from './theme'
import { useActiveTabScroll } from './useActiveTabScroll'
import FindingsView from './views/FindingsView'
import LandingView from './views/LandingView'
import './app.css'

// The research views (Leaflet map, clearing, price tags, ...), the overlap audit and the protocol-to-terms flow are
// separate chunks, so the landing page and Findings stay light. Once the first page has painted, the main tabs'
// chunks are fetched while the browser is idle (and a tab's on hover or focus), so a first visit never waits for code.
const Research = preloadable(() => import('./views/ResearchView'))
const Overlap = preloadable(() => import('./views/OverlapView'))
const Terms = preloadable(() => import('./views/ProtocolTermsView'))
const SiteScores = preloadable(() => import('./views/SiteScoresView'))
const Financial = preloadable(() => import('./views/FinancialView'))
const DevComponents = preloadable(() => import('./views/DevComponentsView'))
const PortfolioCommand = preloadable(() => import('./views/PortfolioCommandView'))
const Demo = preloadable(() => import('./views/HackHarvardDemo'))
const SponsorAgents = preloadable(() => import('./views/SponsorAgentsView'))

// Labels, sub-labels (always visible) and tooltips: copy deck B1. Protocol to terms is the product, so it leads; Portfolio
// overlap is the second tool. Sponsor budget is a worksheet on synthetic inputs with no time model (decisions.md #24); it
// stays out of the main navigation (navHidden) and opens at #financial.
const TABS = [

  { id: 'terms-flow', label: 'Protocol to terms', hint: 'A schedule of assessments, turned into a coverage grid, a budget and a term sheet.' },
  { id: 'overlap', label: 'Portfolio overlap', hint: "Where one sponsor's trials share registered sites and eligible patients." },
  { id: 'findings', label: 'Findings', hint: 'What we tested, including results that weakened the original idea.' },
  // Preserve the presentation's primary navigation; these bounded labs remain direct routes.
  { id: 'demo', label: 'HackHarvard Demo', sub: 'Synthetic planning', hint: 'Three-minute deterministic planning demonstration; not a recruitment forecast.', navHidden: true },
  { id: 'sponsor-agents', label: 'Sponsor Agents', sub: 'Photon · Chalk · Droid', hint: 'Local messaging, acceptance checks and proposal evaluation; external execution unavailable.', navHidden: true },
  {
    id: 'site-scores',
    label: 'Site scores',
    sub: 'Historical, not a forecast',
    hint: 'Historical per-site enrollment evidence, and how well it held up on later trials.',
  },
  {
    id: 'financial',
    label: 'Sponsor budget',
    sub: 'Synthetic worksheet',
    hint: "A sponsor-budget worksheet on synthetic site inputs: who pays for each protocol item, and what changes the sponsor's commitment.",
    // Kept out of the main navigation (mentor feedback: Protocol to terms is the product); reachable at #financial.
    navHidden: true,
  },
  {
    id: 'portfolio-command',
    label: 'Portfolio Command',
    sub: 'Assumption-based planning',
    hint: 'Budget-constrained synthetic allocation; no validated recruitment forecast.',
    // Integrated exploratory planner. Its synthetic modeled durations are separate from the primary evidence tools
    // and are not product performance claims. Preserve the Terms-first navigation; direct route: #portfolio-command.
    navHidden: true,
  },
  { id: 'research', label: 'Research', sub: 'In-sample model outputs', hint: 'The earlier site-clearing views, kept for reference. Not product claims.' },
] as const
type TabId = (typeof TABS)[number]['id']
/** A tab, the landing page (#home or no hash), or the QA page at #dev/components, which has no tab. */
type ViewId = TabId | 'home' | 'dev'
/** A view inside the app shell (everything but the landing page). */
type PaneId = Exclude<ViewId, 'home'>
const PANES: readonly PaneId[] = [...TABS.map((t) => t.id), 'dev']

// The views without inputs from the app shell: one element each, made once.
const TERMS_EL = <Terms.View />
const SCORES_EL = <SiteScores.View />
const FINANCIAL_EL = <Financial.View />
const COMMAND_EL = <PortfolioCommand.View />
const AGENTS_EL = <SponsorAgents.View />
const DEV_EL = <DevComponents.View />

const LOADING_LABEL: Record<PaneId, string> = {
  'terms-flow': 'Loading protocol to terms…',
  overlap: 'Loading portfolio overlap…',
  findings: 'Loading findings…',
  'site-scores': 'Loading site scores…',
  financial: 'Loading the sponsor budget…',
  'portfolio-command': 'Loading Portfolio Command…',
  'sponsor-agents': 'Loading Sponsor Agents…',
  demo: 'Loading HackHarvard Demo…',
  research: 'Loading research views…',
  dev: 'Loading component check…',
}

/** Each tab's chunk (Findings ships with the app shell). */
const PRELOAD: Partial<Record<TabId, () => Promise<unknown>>> = {
  'terms-flow': Terms.preload,
  overlap: Overlap.preload,
  'site-scores': SiteScores.preload,
  research: Research.preload,
}

/** A view whose code is still loading after this long shows the Loading box; a faster switch never flashes it. */
const SLOW_MS = 200
/** How long the fade-in takes (app.css: 180 ms), plus a frame: a view's own entrance fades stay off for that long. */
const ENTER_MS = 240

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

const hashOf = (url: string | undefined): string => {
  try {
    return url ? new URL(url).hash : window.location.hash
  } catch {
    return window.location.hash
  }
}

/** The tab bar's own link for a view (#overlap, #research/<sub>): reopening a kept view there restores where it was. */
function plainLink(view: ViewId, hash: string): boolean {
  const h = hash.replace(/^#\/?/, '').replace(/\/$/, '').toLowerCase()
  return h === view || (view === 'research' && /^research\/[a-z]+$/.test(h))
}

/** The scroll position that puts the top of the page content just under what stays stuck at the top (the one-row
 *  header, or the tab bar below 1320 px), but never further down than the page is now: the header and tab bar do
 *  not move when a view opens at its top. */
function topUnderHeader(): number {
  const main = document.getElementById('main-content')
  if (!main || !main.getClientRects().length) return 0
  let stuck = 0
  for (const el of document.querySelectorAll<HTMLElement>('.appbar, nav.tabs')) {
    const cs = getComputedStyle(el)
    if (cs.position === 'sticky' || cs.position === 'fixed') stuck = Math.max(stuck, (parseFloat(cs.top) || 0) + el.getBoundingClientRect().height)
  }
  const contentTop = main.getBoundingClientRect().top + window.scrollY - stuck
  return Math.max(0, Math.min(window.scrollY, Math.round(contentTop)))
}

/** On a switch: the view it goes to, and where that view should open (null: leave the scroll alone). */
interface SwitchIntent {
  to: ViewId
  restore: boolean
  base: number | null
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

  // `tab` is the route (the tab bar, the title); `shown` is the view on screen. It follows `tab` in a background
  // render, so the old view stays on screen, still usable, until the new one can render (its code is here).
  const shown = useDeferredValue(tab)
  // Every view of the app shell once visited stays mounted, hidden while another is on show (switching back is
  // instant and keeps its state: the selected sponsor or pair, the Terms step, fetched data).
  const [visited, setVisited] = useState<ReadonlySet<PaneId>>(() => new Set(INITIAL_ROUTE.tab === 'home' ? [] : [INITIAL_ROUTE.tab]))
  if (shown !== 'home' && !visited.has(shown)) setVisited(new Set(visited).add(shown))
  // The Loading box shows only when a view's code takes longer than SLOW_MS to arrive.
  const pending = tab !== shown && tab !== 'home'
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!pending) return
    const id = window.setTimeout(() => setSlow(true), SLOW_MS)
    return () => {
      window.clearTimeout(id)
      setSlow(false)
    }
  }, [pending, tab])
  const showSlow = pending && slow
  const onLanding = shown === 'home' && !showSlow

  // Scroll per view: a view opened for the first time (or by a new deep link) starts at its top, under the sticky
  // header; a view opened again from the tab bar (or by going back to the address it had) returns to where it was.
  const tabRef = useRef<ViewId>(INITIAL_ROUTE.tab)
  const shownRef = useRef<ViewId>(INITIAL_ROUTE.tab)
  const seenRef = useRef(new Set<ViewId>([INITIAL_ROUTE.tab]))
  const scrollMem = useRef(new Map<ViewId, number>())
  const hashMem = useRef(new Map<ViewId, string>())
  const intent = useRef<SwitchIntent | null>(null)
  const panes = useRef(new Map<PaneId, HTMLDivElement>())
  // Each view's on-show signal (tabActive.ts): a subscription, so a switch does not re-render the views.
  const [signals] = useState<ReadonlyMap<PaneId, TabSignalControl>>(() => new Map(PANES.map((id) => [id, createTabSignal(id === INITIAL_ROUTE.tab)])))

  // Route to an address: switch views (remembering where the old one was), or follow a new link inside the view on
  // show. Only refs and state setters, so it never changes.
  const routed = useRef<string | null>(null)
  const route = useCallback((hash: string, oldHash: string) => {
    const r = parseHash(hash)
    if (r.tab !== tabRef.current) {
      // Leaving the view on screen: remember where it was and the address it had.
      const from = shownRef.current
      if (from !== 'home') scrollMem.current.set(from, window.scrollY)
      hashMem.current.set(tabRef.current, oldHash)
      const back = seenRef.current.has(r.tab) && (plainLink(r.tab, hash) || hashMem.current.get(r.tab) === hash)
      // The landing page scrolls itself (to the top, or to a named section).
      const base = r.tab === 'home' ? (r.arg ? null : 0) : from === 'home' ? 0 : topUnderHeader()
      intent.current = { to: r.tab, restore: back, base }
    } else if (!(r.tab === 'home' && r.arg)) {
      // A new link inside the view on show (another trial, another finding): its top, as before.
      window.scrollTo({ top: 0 })
    }
    tabRef.current = r.tab
    setTab(r.tab)
    if (r.sub) setSub(r.sub)
    const nct = trialArg(r)
    if (nct) setSelectedTrial(nct)
    if (regeneronLink(r)) {
      presetRequest.current = REGENERON_PRESET
      setForm(REGENERON_PRESET)
      setPresetTick((x) => x + 1)
    }
    // A finding to bring into view; plain #findings keeps the same state, so the kept Findings view does not re-render.
    if (r.tab === 'findings') setFindingFocus((f) => (r.arg === null && f.id === null ? f : { id: r.arg, n: f.n + 1 }))
    if (r.tab === 'home') setLandingFocus((f) => ({ id: r.arg, n: f.n + 1 }))
  }, [])

  useEffect(() => {
    const onHash = (e: HashChangeEvent) => {
      const hash = hashOf(e.newURL)
      // The tab bar routes at once (the hashchange event can come tens of ms later); this is its echo.
      if (routed.current === hash) {
        routed.current = null
        return
      }
      routed.current = null
      route(hash, hashOf(e.oldURL))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [route])

  // The new view is in the page (same commit), before paint: put the scroll where it belongs, and keep the view's own
  // entrance fades (the Terms step panel) still while the whole view fades in.
  useLayoutEffect(() => {
    shownRef.current = shown
    seenRef.current.add(shown)
    const it = intent.current
    if (it && it.to === shown) {
      intent.current = null
      const saved = scrollMem.current.get(shown)
      const top = it.restore && saved !== undefined ? Math.max(saved, it.base ?? 0) : it.base
      if (top !== null) window.scrollTo({ top, behavior: 'instant' })
    }
    const pane = shown === 'home' ? undefined : panes.current.get(shown)
    if (!pane) return
    pane.setAttribute('data-entering', '')
    const id = window.setTimeout(() => pane.removeAttribute('data-entering'), ENTER_MS)
    return () => {
      window.clearTimeout(id)
      pane.removeAttribute('data-entering')
    }
  }, [shown])

  // After the scroll is in place: tell each view whether it is on show (a view shown again runs its pending work:
  // a deep-link scroll, a map resize).
  useLayoutEffect(() => {
    signals.forEach((sig, id) => sig.set(id === shown && !showSlow))
  }, [signals, shown, showSlow])

  // Fetch the main tabs' code once the first page has painted and the browser is idle.
  useEffect(() => {
    const all = () => Object.values(PRELOAD).forEach((f) => void f?.())
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(all, { timeout: 2000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(all, 600)
    return () => window.clearTimeout(id)
  }, [])

  const tabLabel = TABS.find((t) => t.id === tab)?.label
  useEffect(() => {
    document.title = tabLabel ? `${tabLabel} · Concord` : 'Concord'
  }, [tabLabel])

  // A tab sets its link in the address bar and switches at once. The tab already on show (same address) goes back to
  // its top.
  const go = useCallback(
    (t: TabId) => {
      const hash = t === 'research' ? `#research/${sub}` : `#${t}`
      const old = window.location.hash
      if (old === hash) {
        window.scrollTo({ top: 0 })
        return
      }
      routed.current = hash
      window.location.hash = hash
      route(hash, old)
    },
    [sub, route],
  )

  const goSub = useCallback((s: ResearchTabId) => {
    window.location.hash = `research/${s}`
    tabRef.current = 'research'
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

  const clear = useMemo<ClearState>(
    () => ({ result, solvedParams, loading, pendingParams, error, elapsed, run }),
    [result, solvedParams, loading, pendingParams, error, elapsed, run],
  )

  const openTrial = useCallback(
    (nct: string) => {
      setSelectedTrial(nct)
      goSub('prices')
    },
    [goSub],
  )

  // Each view's element changes only with its own inputs, so a switch re-renders the tab bar and the panes' hidden
  // flags, never the views kept in the background.
  const overlapEl = useMemo(() => <Overlap.View regions={regions} />, [regions])
  const findingsEl = useMemo(() => <FindingsView focus={findingFocus} />, [findingFocus])
  const researchEl = useMemo(
    () => (
      <Research.View
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
    ),
    [sub, goSub, clear, regions, form, selectedTrial, openTrial],
  )
  const view = (id: PaneId): ReactNode => {
    switch (id) {
      case 'terms-flow':
        return TERMS_EL
      case 'overlap':
        return overlapEl
      case 'findings':
        return findingsEl
      case 'site-scores':
        return SCORES_EL
      case 'research':
        return researchEl
      case 'financial':
        return FINANCIAL_EL
      case 'portfolio-command':
        return COMMAND_EL
      case 'sponsor-agents':
        return AGENTS_EL
      case 'demo':
        return null // rendered as its own page above, outside the shell
      case 'dev':
        return DEV_EL
    }
  }

  // The HackHarvard demo (teammate PR #3) is its own full page, outside the app shell, like the landing page.
  if (tab === 'demo') return <Suspense fallback={<Loading label="Loading HackHarvard Demo…" />}><Demo.View /></Suspense>

  return (
    <>
      {/* The landing page is its own page, outside the app shell. */}
      {onLanding && <LandingView focus={landingFocus} />}
      {/* The app shell stays mounted (hidden on the landing page), so its views and their state survive a visit to
          the landing page, and opening a view from there keeps the landing page on screen until the view can render. */}
      <div className="app" hidden={onLanding}>
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
              {TABS.filter((t) => !('navHidden' in t)).map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`tab${tab === t.id ? ' tab-active' : ''}`}
                  title={t.hint}
                  onClick={() => go(t.id)}
                  onPointerEnter={() => void PRELOAD[t.id]?.()}
                  onFocus={() => void PRELOAD[t.id]?.()}
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
            {shown !== 'research' || showSlow ? null : loading ? (
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
          {/* One boundary for every view: a switch to a view whose code is still loading keeps the old view on screen
              (a background render) instead of falling back; only the first view of a page load can show this. */}
          <Suspense fallback={<SlowLoading label={shown === 'home' ? LOADING_LABEL.findings : LOADING_LABEL[shown]} />}>
            {PANES.map((id) => {
              if (!visited.has(id) && id !== shown) return null
              const on = id === shown && !showSlow
              return (
                <div
                  key={id}
                  ref={(el) => {
                    if (el) panes.current.set(id, el)
                    else panes.current.delete(id)
                  }}
                  className="app-pane"
                  data-view={id}
                  hidden={!on}
                >
                  <TabSignalContext value={signals.get(id)!}>{view(id)}</TabSignalContext>
                </div>
              )
            })}
          </Suspense>
          {showSlow && <SlowLoading label={LOADING_LABEL[tab as PaneId]} />}
        </main>
        <footer className="footer">
          <div className="footer-in">
            Concord · HackHarvard 2026 · Trial and site data from ClinicalTrials.gov. Enrollment times in Research are model estimates; Sponsor
            budget is a worksheet on synthetic inputs with no time model. Decision support only, not clinical, legal or coverage advice.
          </div>
        </footer>
      </div>
    </>
  )
}

/** The Loading box in a space the height of a screen, so the footer does not jump up and back down. */
function SlowLoading({ label }: { label: string }) {
  return (
    <div className="app-loading">
      <Loading label={label} />
    </div>
  )
}
