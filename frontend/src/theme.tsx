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
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
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

const OPTIONS: { id: ThemePref; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
]

/** Header control: Light / Dark / System as toggle buttons. */
export function ThemeControl() {
  const { pref, setPref } = useTheme()
  return (
    <div className="hdr-seg" role="group" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" className="hdr-seg-btn" aria-pressed={pref === o.id} onClick={() => setPref(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
