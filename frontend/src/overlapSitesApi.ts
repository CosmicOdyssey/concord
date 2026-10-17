// Portfolio overlap for an extra indication (backend concord/indications/sites.py via /api/overlap?indication=...):
// shared registered sites and months both recruiting only. No eligibility field exists in these types on purpose:
// eligibility overlap is computed for lung cancer only.
import { ApiError } from './api'
import type { OverlapSponsors } from './overlapApi'

/** Exact wording required wherever an eligibility number would be. */
export const SITE_ONLY_LABEL = 'site overlap only; eligibility overlap is available for lung cancer'
export const LUNG = 'lung'

export interface IndicationInfo {
  slug: string
  label: string
  noun: string
  /** true for lung (eligibility overlap), false for site-only indications. */
  eligibility: boolean
  snapshot_date?: string
  fetched_at?: string
  source?: string
  query?: Record<string, string>
  trials?: number
}

export const LUNG_INDICATION: IndicationInfo = { slug: LUNG, label: 'Lung cancer', noun: 'lung cancer', eligibility: true }

export interface SitesSponsors extends OverlapSponsors {
  indication: string
  indication_label: string
  eligibility: false
  eligibility_note: string
}

export interface SitesTrial {
  nct_id: string
  title: string
  acronym: string | null
  status_now: string
  phases: string[]
  conditions: string[]
  start_date: string
  primary_completion_date: string | null
  primary_completion_type: string | null
  completion_date: string | null
  recruiting_at_snapshot: boolean
  enrollment_registered: number | null
  enrollment_type: string | null
  n_sites: number
  n_sites_identified: number
  n_sites_anonymized: number
  site_ids: string[]
}

export interface SitesPair {
  p: string
  q: string
  shared_sites: number
  shared_site_ids: string[]
  anonymized_same_city: number
  months_both_recruiting_estimated: number
  both_recruiting_from: string | null
  both_recruiting_to: string | null
  both_recruiting_at_snapshot: boolean
}

export interface SitesSite {
  site_id: string
  facility: string
  city: string | null
  state: string | null
  country: string | null
  anonymized: boolean
}

export interface SitesAudit {
  indication: string
  indication_label: string
  eligibility: false
  eligibility_note: string
  source: { name: string; query: Record<string, string>; fetched_at: string; trials: number }
  sponsor: string
  sponsor_known: boolean
  as_of: string
  snapshot_date: string
  basis: 'registry'
  region: string | null
  region_label: string
  trials: SitesTrial[]
  pairs: SitesPair[]
  sites: Record<string, SitesSite>
  not_yet_recruiting: { nct_id: string; start_date: string | null }[]
  n_sites: number
  n_sites_anonymized: number
  definitions: Record<string, string>
}

async function get<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== '') s.set(k, v)
  const qs = s.toString()
  const res = await fetch(qs ? `${path}?${qs}` : path, { signal })
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

export const overlapSitesApi = {
  indications: (signal?: AbortSignal) =>
    get<{ indications: IndicationInfo[]; site_only_label: string }>('/api/overlap/indications', {}, signal),
  sponsors: (indication: string, region: string, signal?: AbortSignal) =>
    get<SitesSponsors>('/api/overlap/sponsors', { indication, region }, signal),
  audit: (indication: string, sponsor: string, region: string, signal?: AbortSignal) =>
    get<SitesAudit>('/api/overlap', { indication, sponsor, region }, signal),
}
