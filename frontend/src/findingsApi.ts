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
  /** Added by the API: false when this checkout lacks the cited file (shown as plain text, not a link). */
  available?: boolean
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

/** data/findings/self_overlap.json, written by the portfolio overlap audit (python -m concord.overlap).
 *  Its shape: `headline` {count, upper_bound_count, sponsors, variant, text} (the count to lead with: pairs whose
 *  eligibility was hand-encoded and reviewed), the broad top-level `count`, `upper_bound_count` and
 *  `sponsors_with_pairs`, plus `definition` and `parameters`. Every field is optional here. */
export interface SelfOverlapHeadline {
  count?: number
  value?: number
  upper_bound_count?: number
  sponsors?: number
  variant?: string
  /** A short noun phrase for the count ("same-sponsor pairs where ..."), if the audit provides one. */
  label?: string
  text?: string
}

export interface SelfOverlap {
  headline?: string | SelfOverlapHeadline
  headline_count?: number
  headline_label?: string
  count?: number
  sponsors_with_pairs?: number
  upper_bound_count?: number
  definition?: string
  parameters?: { min_shared_sites?: number; min_overlap_one_direction?: number; since?: string; [k: string]: unknown }
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

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0

export interface OverlapNote {
  /** The headline count, shown emphasised; null when the file only has a headline sentence. */
  count: number | null
  /** The rest of the sentence after the count (or the whole headline sentence when count is null). */
  text: string
  /** The audit's own definition, shown on request. */
  definition: string | null
}

/** The noun phrase a headline sentence starts with: "21 same-sponsor pairs where ...; in 19 of them ..." gives
 *  "same-sponsor pairs where ...". Null unless the sentence starts with the count itself. */
function leadPhrase(text: string | undefined, count: number): string | null {
  const m = typeof text === 'string' ? text.trim().match(/^([\d,]+)\s+([^;.]+)/) : null
  if (!m || Number(m[1].replace(/,/g, '')) !== count) return null
  return m[2].trim() || null
}

/** The self-overlap file's headline count, described with the file's own thresholds (shared sites, eligibility
 *  overlap) and labels. Lead with `headline.count` (the audit's reviewed subset); fall back to the broad `count`.
 *  A plain `headline` string is shown as written. */
export function overlapNote(d: SelfOverlap | null): OverlapNote | null {
  if (!d) return null
  const definition = typeof d.definition === 'string' && d.definition.trim() ? d.definition.trim() : null
  const h = d.headline
  if (typeof h === 'string') return h.trim() ? { count: null, text: h.trim(), definition } : null

  let count: number | null = null
  let label: string | null = null
  let sponsors: number | null = null
  let upper: number | null = null
  if (h && typeof h === 'object') {
    const n = isCount(h.count) ? h.count : isCount(h.value) ? h.value : null
    if (n === null) {
      if (typeof h.text === 'string' && h.text.trim()) return { count: null, text: h.text.trim(), definition }
    } else {
      count = n
      label = (typeof h.label === 'string' && h.label.trim()) || leadPhrase(h.text, n)
      sponsors = isCount(h.sponsors) ? h.sponsors : null
      upper = isCount(h.upper_bound_count) ? h.upper_bound_count : null
    }
  }
  if (count === null && isCount(d.headline_count)) {
    count = d.headline_count
    label = d.headline_label ?? null
  }
  if (count === null && isCount(d.count)) {
    count = d.count
    sponsors = isCount(d.sponsors_with_pairs) ? d.sponsors_with_pairs : null
    upper = isCount(d.upper_bound_count) ? d.upper_bound_count : null
  }
  if (count === null) return null

  const p = d.parameters ?? {}
  const sites = isCount(p.min_shared_sites) ? p.min_shared_sites : null
  const share = isCount(p.min_overlap_one_direction) && p.min_overlap_one_direction <= 1 ? p.min_overlap_one_direction : null
  const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`
  const clause = [
    'concurrent',
    sites !== null ? `sharing at least ${plural(sites, 'registered site')}` : null,
    share !== null ? `with at least ${Math.round(share * 100)}% of one trial’s eligible patients also eligible for the other` : null,
  ].filter(Boolean)
  let text = label ?? `same-sponsor trial pair${count === 1 ? '' : 's'}`
  if (sponsors !== null) text += `, across ${plural(sponsors, 'sponsor')}`
  text += clause.length > 1 ? `: ${clause.join(', ')}.` : ' overlap.'
  if (upper !== null && upper > 0)
    text += ` For ${upper.toLocaleString('en-US')} of them the eligibility overlap is an upper bound (criteria the synthetic population does not model).`
  return { count, text, definition }
}
