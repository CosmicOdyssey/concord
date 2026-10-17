import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

export type Density = 'simple' | 'detailed'

/** The header shows the Simple | Detailed control. */
export const DENSITY_TOGGLE_ENABLED = true

/** A visitor with no stored choice starts in Simple. index.html applies the same default before first paint. */
export const DEFAULT_DENSITY: Density = 'simple'

interface DensityState {
  density: Density
  setDensity: (d: Density) => void
}

// index.html reads the same key before first paint.
const KEY = 'concord.density'

function readDensity(): Density {
  try {
    const v = window.localStorage.getItem(KEY)
    return v === 'simple' || v === 'detailed' ? v : DEFAULT_DENSITY
  } catch {
    return DEFAULT_DENSITY
  }
}

function writeDensity(d: Density) {
  try {
    window.localStorage.setItem(KEY, d)
  } catch {
    /* storage unavailable: the choice lasts for this page load */
  }
}

const DensityContext = createContext<DensityState | null>(null)

/** The app-wide density: remembered in localStorage and mirrored to data-density on <html> (so CSS can key on
 *  [data-density='simple']). One per app, in main.tsx. */
export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setState] = useState<Density>(readDensity)

  useLayoutEffect(() => {
    document.documentElement.dataset.density = density
  }, [density])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) setState(readDensity())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setDensity = useCallback((d: Density) => {
    setState(d)
    writeDensity(d)
  }, [])

  const value = useMemo(() => ({ density, setDensity }), [density, setDensity])
  return <DensityContext value={value}>{children}</DensityContext>
}

/** A local density for a part of the page (the #dev/components QA page): its own state, never stored and never
 *  written to <html>, so trying it out cannot change the app-wide choice. Sets data-density on its own wrapper. */
export function LocalDensity({ initial = 'detailed', children }: { initial?: Density; children: ReactNode }) {
  const [density, setDensity] = useState<Density>(initial)
  const value = useMemo(() => ({ density, setDensity }), [density])
  return (
    <DensityContext value={value}>
      <div data-density={density}>{children}</div>
    </DensityContext>
  )
}

// The hook lives with its provider; this file is not a fast-refresh boundary, which costs a full reload on edit.
// oxlint-disable-next-line react/only-export-components
export function useDensity(): DensityState {
  const v = useContext(DensityContext)
  if (!v) throw new Error('useDensity() needs a <DensityProvider> above it')
  return v
}

/** Renders its children only in the Detailed density. */
export function Detailed({ children }: { children: ReactNode }) {
  return useDensity().density === 'detailed' ? children : null
}

/** Renders its children only in the Simple density. */
export function SimpleOnly({ children }: { children: ReactNode }) {
  return useDensity().density === 'simple' ? children : null
}

// Copy deck B2.
const OPTIONS: { id: Density; label: string; hint: string }[] = [
  { id: 'simple', label: 'Simple', hint: 'One headline and one number per section. Hover or focus for details. Key caveats stay visible.' },
  { id: 'detailed', label: 'Detailed', hint: 'Every table, note and source, at full density.' },
]

/** Simple | Detailed segmented control, for the nearest density (app-wide in the header, local under <LocalDensity>). */
export function DensityControl() {
  const { density, setDensity } = useDensity()
  return (
    <div className="seg seg-inline density-seg" role="group" aria-label="Display density">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" className="seg-btn" aria-pressed={density === o.id} title={o.hint} onClick={() => setDensity(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
