import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

interface ThemeState {
  /** What the viewer picked. */
  pref: ThemePref
  /** What is showing: the preference, or the system setting under 'system'. Components that draw colours from JS
   *  (the map's markers) key on this so they redraw when it changes. */
  theme: Theme
  setPref: (p: ThemePref) => void
}

// index.html reads the same key and query before first paint; keep the three in step.
const KEY = 'concord.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readPref(): ThemePref {
  try {
    const v = window.localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'light'
  } catch {
    return 'light'
  }
}

function writePref(p: ThemePref) {
  try {
    window.localStorage.setItem(KEY, p)
  } catch {
    /* storage unavailable: the choice lasts for this page load */
  }
}

function subscribeSystem(onChange: () => void) {
  const mq = window.matchMedia?.(DARK_QUERY)
  mq?.addEventListener('change', onChange)
  return () => mq?.removeEventListener('change', onChange)
}

const systemIsDark = () => window.matchMedia?.(DARK_QUERY).matches ?? false

const ThemeContext = createContext<ThemeState | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref)
  const systemDark = useSyncExternalStore(subscribeSystem, systemIsDark)
  const theme: Theme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref

  // Layout effect: the CSS tokens switch in the same frame as anything that re-renders on `theme`.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme
  }, [theme])

  // A choice made in another tab applies here too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) setPrefState(readPref())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p)
    writePref(p)
  }, [])

  const value = useMemo(() => ({ pref, theme, setPref }), [pref, theme, setPref])
  return <ThemeContext value={value}>{children}</ThemeContext>
}

// The hook lives with its provider; this file is not a fast-refresh boundary, which costs a full reload on edit.
// oxlint-disable-next-line react/only-export-components
export function useTheme(): ThemeState {
  const v = useContext(ThemeContext)
  if (!v) throw new Error('useTheme() needs a <ThemeProvider> above it')
  return v
}

function ThemeIcon({ id }: { id: ThemePref }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
  if (id === 'light')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
      </svg>
    )
  if (id === 'dark')
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
    )
  // System: a screen.
  return (
    <svg {...common}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </svg>
  )
}

// Copy deck B3.
const OPTIONS: { id: ThemePref; label: string; name: string }[] = [
  { id: 'light', label: 'Light theme', name: 'Light' },
  { id: 'dark', label: 'Dark theme', name: 'Dark' },
  { id: 'system', label: 'Match system theme', name: 'System' },
]

/** Light / Dark / System. Icon toggle buttons; on narrow screens (CSS: .theme-cycle) a single button that cycles
 *  through the three, so the phone header keeps 44 px targets on one row. */
export function ThemeControl() {
  const { pref, setPref } = useTheme()
  const i = OPTIONS.findIndex((o) => o.id === pref)
  const cur = OPTIONS[i] ?? OPTIONS[2]
  const next = OPTIONS[(i + 1) % OPTIONS.length]
  return (
    <>
      <div className="seg seg-inline seg-icons theme-seg" role="group" aria-label="Color theme">
        {OPTIONS.map((o) => (
          <button key={o.id} type="button" className="seg-btn" aria-label={o.label} title={o.label} aria-pressed={pref === o.id} onClick={() => setPref(o.id)}>
            <ThemeIcon id={o.id} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn theme-cycle"
        aria-label={`Theme: ${cur.name}. Change theme`}
        title={`Theme: ${cur.name}. Next: ${next.name}`}
        onClick={() => setPref(next.id)}
      >
        <ThemeIcon id={cur.id} />
      </button>
    </>
  )
}
