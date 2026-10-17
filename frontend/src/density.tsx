import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

export type Density = 'simple' | 'detailed'

/** No view has a Simple layout yet, so the header control stays hidden; #dev/components shows it regardless. */
export const DENSITY_TOGGLE_ENABLED = false

interface DensityState {
  density: Density
  setDensity: (d: Density) => void
}

// index.html reads the same key before first paint.
const KEY = 'concord.density'

function readDensity(): Density {
  try {
    return window.localStorage.getItem(KEY) === 'simple' ? 'simple' : 'detailed'
  } catch {
    return 'detailed'
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

/** Simple | Detailed segmented control. The header renders it only when DENSITY_TOGGLE_ENABLED. */
export function DensityControl() {
  const { density, setDensity } = useDensity()
  return (
    <div className="hdr-seg" role="group" aria-label="Density">
      <button type="button" className="hdr-seg-btn" aria-pressed={density === 'simple'} onClick={() => setDensity('simple')}>
        Simple
      </button>
      <button type="button" className="hdr-seg-btn" aria-pressed={density === 'detailed'} onClick={() => setDensity('detailed')}>
        Detailed
      </button>
    </div>
  )
}
