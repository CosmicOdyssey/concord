// One term-sheet line's price, step by step (backend: concord/line_detail.py, GET /api/terms-flow/{nct}/line-detail).
// CMS units x each site's regional adjustments x the conversion factor = Medicare rate; then x multiplier + overhead
// (assumptions the user sets) = sponsor price, reconciled with Budget. Every number comes from the API.
import { createContext, useContext, useEffect, useState } from 'react'
import type { PriceParams } from './termsFlowApi'

export type ComponentId = 'work' | 'pe' | 'mp'

export interface Source {
  label: string
  detail: string | null
  assumption?: boolean
}

export interface LineSide {
  site: { site_id: string; label: string }
  locality: { state: string; code: string; name: string; title: string; method: string; verified: boolean } | null
  adjustment_source: Source
  adjustment: Record<ComponentId, number>
  adjusted_units?: Record<ComponentId, number>
  total_units?: number
  medicare_exact?: number
  medicare_rate?: number | null
  sponsor: { multiplier: number; line_price: number; overhead_rate: number; overhead: number; sponsor_price: number } | null
  reconcile: {
    visit_label: string
    count: number
    count_text: string
    visit_research_items: number
    visit_coordinator: number
    visit_overhead: number
    visit_total: number
    in_research_items: number
    in_overhead: number
    per_participant_research_items: number
    per_participant_coordinator: number
    per_participant_overhead: number
    per_participant: number
    adds_up: boolean
    scope: string
  }
}

export interface LineDetail {
  nct_id: string
  node_id: string
  visit_id: string
  procedure_id: string
  label: string
  code: string | null
  payer: 'Sponsor' | 'Insurance'
  coverage: 'routine' | 'research'
  override: boolean
  rule: string
  schedule: string | null
  applicable: boolean
  reason: string | null
  multiplier: number
  disclaimer: string
  label_tag: string
  components?: { id: ComponentId; label: string; term: string; units: number }[]
  units_source?: { label: string; detail: string; file: string | null; zip: string | null; row: string }
  conversion_factor?: number
  conversion_factor_source?: { label: string; detail: string }
  same_note?: string
  setting_note?: string
  rounding_note?: string
  glossary?: { rvu: string; gpci: string; nonqpp: string; non_facility: string }
  cms_lookup?: { url: string; label: string }
  pfs_source?: string
  sites: { a: LineSide; b?: LineSide }
}

/** What a breakdown on the Terms screen prices against: the trial, the two sites and the budget's own parameters,
 *  plus (where the page has them) the existing multiplier and overhead controls, which the table edits in place. */
export interface LineDetailScope {
  nct: string
  siteA: string
  siteB: string | null
  params: PriceParams
  /** The budget's "% of Medicare" control (percent, 10 to 500). */
  mult?: { pct: number; set: (pct: number) => void }
  /** The budget's overhead control (a fraction; null resets to the proposed default). */
  overhead?: { value: number; def: number; set: (v: number | null) => void }
  /** The schedule version (an added trial's import.updated): part of every request, so a new schedule never reuses a
   *  cached answer for the old one. */
  ver?: string
  /** The node ids of the protocol on screen: a breakdown asks only for these (a line of an older schedule, still on
   *  screen while the new budget loads, is "no line selected", not a request that would 404). */
  nodeIds?: ReadonlySet<string>
}

/** Whether `nodeId` is a line of the schedule the scope prices (always, when the scope does not list its nodes). */
export function scopeHasNode(s: LineDetailScope, nodeId: string): boolean {
  return !s.nodeIds || s.nodeIds.has(nodeId)
}

export const LineDetailContext = createContext<LineDetailScope | null>(null)

export function useLineDetailScope(): LineDetailScope | null {
  return useContext(LineDetailContext)
}

export function lineDetailUrl(s: LineDetailScope, nodeId: string): string {
  const q = new URLSearchParams({ node_id: nodeId, site_a: s.siteA, multiplier: String(s.params.multiplier) })
  if (s.siteB && s.siteB !== s.siteA) q.set('site_b', s.siteB)
  if (Object.keys(s.params.overrides).length) q.set('overrides', JSON.stringify(s.params.overrides))
  if (Object.keys(s.params.standard).length) q.set('standard', JSON.stringify(s.params.standard))
  // ignored by the API; keys the request (and the cache below) on the schedule version
  if (s.ver) q.set('ver', s.ver)
  return `/api/terms-flow/${encodeURIComponent(s.nct)}/line-detail?${q.toString()}`
}

// Responses by URL, so a hover card and the term-sheet table showing the same line share one request.
const cache = new Map<string, Promise<LineDetail>>()

/** A failed request, with its HTTP status (404: the node is not a line of the schedule the API now has). */
class DetailError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function fetchDetail(url: string): Promise<LineDetail> {
  const hit = cache.get(url)
  if (hit) return hit
  const p = fetch(url).then(async (res) => {
    if (!res.ok) {
      let detail = res.statusText
      try {
        const body = await res.json()
        if (body && typeof body.detail === 'string') detail = body.detail
      } catch {
        /* non-JSON error body */
      }
      throw new DetailError(`${res.status} ${detail}`, res.status)
    }
    return (await res.json()) as LineDetail
  })
  p.catch(() => cache.delete(url))
  if (cache.size > 60) cache.delete(cache.keys().next().value as string)
  cache.set(url, p)
  return p
}

/** `missing`: the API answered 404, the node is not a line of the current schedule (shown as no line selected). */
export type DetailState = { data: LineDetail | null; error: string | null; missing: boolean; pending: boolean }

/** The line's breakdown; the last response stays on screen (marked pending) while a new one loads. */
export function useLineDetail(url: string | null, retry = 0): DetailState {
  const [st, setSt] = useState<{ url: string | null; data: LineDetail | null; error: string | null; missing: boolean }>({
    url: null,
    data: null,
    error: null,
    missing: false,
  })
  useEffect(() => {
    if (!url) return
    let live = true
    fetchDetail(url).then(
      (data) => live && setSt({ url, data, error: null, missing: false }),
      (e: unknown) =>
        live &&
        setSt((s) => ({ url, data: s.data, error: e instanceof Error ? e.message : String(e), missing: e instanceof DetailError && e.status === 404 })),
    )
    return () => {
      live = false
    }
  }, [url, retry])
  const here = st.url === url
  return { data: st.data, error: here ? st.error : null, missing: here && st.missing, pending: !!url && !here }
}
