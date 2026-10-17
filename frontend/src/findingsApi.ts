// Types and fetchers for the findings page (backend/concord/api/findings.py).
// findings.json is written by `python -m concord.findings`; the page renders it generically.

import { ApiError } from './api'

export type FindingStatus = 'final' | 'provisional' | 'missing'

export interface CiItem {
  label: string
  estimate: number
  lo: number
  hi: number
}

export interface CiChart {
  type: 'ci'
  reference: { label: string; value: number }
  items: CiItem[]
}

export interface FindingTable {
  id: string
  title: string
  columns: string[]
  rows: string[][]
  /** 0-based index into rows. */
  highlight_row?: number | null
  notes?: string[]
}

export interface FindingSource {
  label: string
  /** Repo-relative path. */
  path: string
}

export interface Finding {
  id: string
  title: string
  status: FindingStatus | string
  headline: string
  chart?: CiChart | { type: string } | null
  tables?: FindingTable[]
  caveats?: string[]
  sources?: FindingSource[]
}

export interface FindingsDoc {
  generated_at?: string
  rule?: string
  findings: Finding[]
}

/** Written by the portfolio overlap audit; only its headline is read here, so every field is optional. */
export interface SelfOverlap {
  headline?: string | { value?: number; count?: number; label?: string; text?: string }
  headline_count?: number
  headline_label?: string
  [k: string]: unknown
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body && typeof body.detail === 'string') detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, `${res.status} ${detail}`)
  }
  return (await res.json()) as T
}

export const findingsApi = {
  findings: (signal?: AbortSignal) => get<FindingsDoc>('/api/findings', signal),
  selfOverlap: (signal?: AbortSignal) => get<SelfOverlap>('/api/findings/self-overlap', signal),
}

/** Link to a cited source file, served by the backend only if findings.json lists it. */
export function sourceHref(path: string): string {
  return `/api/findings/source?path=${encodeURIComponent(path)}`
}

export function isCiChart(c: Finding['chart']): c is CiChart {
  return !!c && c.type === 'ci' && Array.isArray((c as CiChart).items) && typeof (c as CiChart).reference?.value === 'number'
}

/** The self-overlap file's headline as one line, whichever of the supported shapes it uses. */
export function overlapHeadline(d: SelfOverlap | null): string | null {
  if (!d) return null
  const h = d.headline
  if (typeof h === 'string' && h.trim()) return h.trim()
  if (h && typeof h === 'object') {
    if (typeof h.text === 'string' && h.text.trim()) return h.text.trim()
    const n = typeof h.count === 'number' ? h.count : h.value
    if (typeof n === 'number' && Number.isFinite(n)) return `${n.toLocaleString('en-US')}${h.label ? ` ${h.label}` : ''}`
  }
  if (typeof d.headline_count === 'number' && Number.isFinite(d.headline_count))
    return `${d.headline_count.toLocaleString('en-US')}${d.headline_label ? ` ${d.headline_label}` : ''}`
  return null
}
