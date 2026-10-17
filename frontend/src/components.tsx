import { useEffect, useState, type ReactNode } from 'react'

export function useElapsed(running: boolean): number {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!running) return
    const start = performance.now()
    setSecs(0)
    const id = window.setInterval(() => setSecs((performance.now() - start) / 1000), 250)
    return () => window.clearInterval(id)
  }, [running])
  return secs
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}

export function Loading({ label, hint }: { label: string; hint?: string }) {
  const secs = useElapsed(true)
  return (
    <div className="loading" role="status" aria-live="polite">
      <Spinner />
      <div>
        <div>
          {label} <span className="muted tnum">{secs.toFixed(0)} s</span>
        </div>
        {hint && <div className="muted small">{hint}</div>}
      </div>
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="error" role="alert">
      <strong>Request failed.</strong> <span>{error}</span>
      {onRetry && (
        <button className="btn btn-small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function Caveat({ children }: { children: ReactNode }) {
  return <p className="caveat">{children}</p>
}

export function Badge({ tone, children, title }: { tone: 'warn' | 'ok' | 'bad' | 'neutral' | 'info'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  )
}

export function Stat({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  emphasis?: boolean
}) {
  return (
    <div className={`stat${emphasis ? ' stat-emph' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value tnum">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function NeedsClear({ onRun, busy }: { onRun: () => void; busy: boolean }) {
  return (
    <div className="empty">
      <p>This view uses the cleared allocation. Run the clearing first.</p>
      <button className="btn btn-primary" onClick={onRun} disabled={busy}>
        {busy ? 'Clearing…' : 'Clear the market (default region)'}
      </button>
    </div>
  )
}

export function useDarkMode(): boolean {
  const query = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

export function RunLine({
  params,
  stale,
  extra,
}: {
  params: { region: string; activation_lag: number; overlap_scale: number; capacity_scale: number }
  stale?: boolean
  extra?: ReactNode
}) {
  return (
    <div className="runline small">
      <span>
        Region <strong>{params.region}</strong>
      </span>
      <span className="muted">
        activation lag {params.activation_lag} mo · overlap ×{params.overlap_scale} · capacity ×{params.capacity_scale}
      </span>
      {stale && <Badge tone="info">re-clearing…</Badge>}
      {extra}
    </div>
  )
}
