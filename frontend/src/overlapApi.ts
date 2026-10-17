// Types and fetchers for the portfolio overlap audit (backend/concord/api/overlap.py, concord/overlap.py).
// Descriptive only: counts, dates and eligibility shares on the synthetic population. No forecasts.
import { ApiError, type Criterion } from './api'

export interface OverlapSponsor {
  sponsor: string
  trials: number
  /** Share of the sponsor's registered site rows that name a real site (null: no site rows). */
  identified_share?: number | null
}

/** Sponsors whose sites are mostly anonymized on CT.gov: no site can be matched across their trials. */
export const mostlyAnonymized = (s: OverlapSponsor) => typeof s.identified_share === 'number' && s.identified_share < 0.5

/** 'registry': as_of is the registry snapshot, so recruiting = the CT.gov status (a fact).
 *  'estimated': an earlier date, from enrollment windows bounded by the status at the snapshot. */
export type OverlapBasis = 'registry' | 'estimated'

export interface OverlapSponsors {
  as_of: string
  /** CT.gov download date; later as-of dates are refused (no projection). */
  snapshot_date: string
  basis: OverlapBasis
  region: string | null
  region_label: string
  sponsors: OverlapSponsor[]
}

export interface OverlapTrial {
  nct_id: string
  title: string
  acronym: string | null
  /** Status on ClinicalTrials.gov at the registry snapshot (not on the as-of date). */
  status_now: string
  phases: string[]
  start_date: string
  primary_completion_date: string | null
  primary_completion_type: string | null
  completion_date: string | null
  /** start + 0.65 x (primary completion - start): an estimate, labelled as such everywhere. null when no
   *  completion date is registered. */
  estimated_window_end: string | null
  window_basis: string
  open_ended: boolean
  /** CT.gov lists it as Recruiting / Enrolling by invitation at the snapshot. */
  recruiting_at_snapshot: boolean
  /** The snapshot status contradicts the estimate (still recruiting after it, or closed before it); the status wins. */
  status_overrides_estimate: boolean
  enrollment_registered: number | null
  enrollment_type: string | null
  /** Registered sites (in the region, if one is selected), including anonymized pseudo-sites. */
  n_sites: number
  n_sites_identified: number
  n_sites_anonymized: number
  site_ids: string[]
  eligibility_source: 'hand-encoded' | 'rule-based parse'
  criteria: Criterion[]
  no_criteria: boolean
  /** Two or fewer encoded criteria: most synthetic patients pass them. */
  sparse_criteria: boolean
  /** Share of the synthetic population meeting the encoded criteria. */
  eligible_share: number
  design: string | null
  design_reason: string | null
  unmodeled: string[]
  requires_unmodeled_biomarker: boolean
  design_confidence: string | null
  upper_bound: boolean
  upper_bound_reasons: string[]
  /** Distinct lung trials of other lead sponsors recruiting on the date at this trial's identifiable sites. */
  other_sponsor_trials_at_sites: number
  other_sponsor_trials_at_sites_industry: number
}

/** Both trials restrict this concept (patient attribute; driver requirements are one concept). */
export interface SharedConcept {
  concept: string
  /** Criterion ids (index trials[].criteria) of P and of Q on this concept. */
  p: string[]
  q: string[]
  /** Both select the same synthetic patients on this concept. */
  same: boolean
}

/** Matched by concept, not criterion id (the encoders name one idea differently). */
export interface CriteriaDiff {
  match: 'concept'
  only_p: string[]
  only_q: string[]
  shared: SharedConcept[]
}

export interface OverlapPair {
  p: string
  q: string
  shared_sites: number
  shared_site_ids: string[]
  /** Cities where both list an anonymized site: facility unknown, not counted as shared. */
  anonymized_same_city: number
  /** Share of P's eligible synthetic patients also eligible for Q. */
  o_pq: number
  o_qp: number
  overlap_informative: boolean
  months_both_recruiting_estimated: number
  both_recruiting_from: string | null
  /** Never later than the snapshot. */
  both_recruiting_to: string | null
  both_recruiting_at_snapshot: boolean
  open_ended: boolean
  upper_bound: boolean
  /** Either trial's criteria come from the rule-based parse (not reviewed). */
  unreviewed_criteria: boolean
  /** Trials of the pair with two or fewer encoded criteria. */
  sparse_criteria: string[]
  criteria_diff: CriteriaDiff
}

export interface OverlapSite {
  site_id: string
  facility: string
  city: string | null
  state: string | null
  country: string | null
  anonymized: boolean
  /** null for anonymized pseudo-sites (not matchable across trials). */
  other_sponsor_trials: number | null
}

export interface OverlapAudit {
  sponsor: string
  sponsor_known: boolean
  as_of: string
  snapshot_date: string
  basis: OverlapBasis
  region: string | null
  region_label: string
  trials: OverlapTrial[]
  pairs: OverlapPair[]
  sites: Record<string, OverlapSite>
  /** The sponsor's trials started by the date that register no completion date (no window): left out. */
  excluded_open_ended: string[]
  /** The sponsor's trials listed as Not yet recruiting at the snapshot: never counted as recruiting. */
  not_yet_recruiting: { nct_id: string; start_date: string | null }[]
  /** Distinct registered sites across the sponsor's trials (in region) and how many are anonymized. */
  n_sites: number
  n_sites_anonymized: number
  population: { n: number; seed: number; note: string }
  definitions: Record<string, string>
}

export interface OverlapQuery {
  sponsor: string
  /** YYYY-MM-DD, at most the snapshot; '' = the registry snapshot. */
  as_of: string
  /** service.REGIONS key, or '' for every registered site worldwide. */
  region: string
}

export const REGENERON_SPONSOR = 'Regeneron Pharmaceuticals'
export const FIANLIMAB_PAIR: [string, string] = ['NCT05785767', 'NCT05800015']
export const REGENERON_OVERLAP_PRESET: OverlapQuery = { sponsor: REGENERON_SPONSOR, as_of: '2024-09-01', region: 'US' }

async function get<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== '') s.set(k, v)
  const res = await fetch(`${path}?${s.toString()}`, { signal })
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

export const overlapApi = {
  sponsors: (as_of: string, region: string, signal?: AbortSignal) =>
    get<OverlapSponsors>('/api/overlap/sponsors', { as_of, region }, signal),
  audit: (q: OverlapQuery, signal?: AbortSignal) =>
    get<OverlapAudit>('/api/overlap', { sponsor: q.sponsor, as_of: q.as_of, region: q.region }, signal),
}
