// Types and fetchers for the protocol-to-terms flow (backend: concord/api/terms.py, concord/terms.py).
// Nothing here is a forecast: schedules, coverage labels and prices from published fee schedules only.

export type Coverage = 'routine' | 'research'
export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
export type Overrides = Record<string, Coverage>
export type StandardEdits = Record<string, number>

export interface TrialFacts {
  nct_id?: string
  title?: string
  acronym?: string | null
  status?: string
  phases?: string[]
  sponsor?: string
  sponsor_class?: string
  start_date?: string
  n_sites?: number
  n_us_sites?: number
  n_us_sites_withdrawn?: number
}

export interface TrialCard {
  nct_id: string
  short_title: string
  why_chosen: string
  arms: { label: string; text: string }[]
  dosing: string
  masking: string
  registry_notes: string[]
  label: string
  trial: TrialFacts
  design: { design: string; confidence: string | null } | null
}

export interface Visit {
  id: string
  label: string
  short: string
  kind: 'screening' | 'treatment' | 'repeat' | 'follow_up'
  day?: number
  day_end?: number
  minus?: number
  plus?: number
  window: string
  repeat?: string
  anchor?: string
  coordinator?: boolean
}

export interface Procedure {
  id: string
  label: string
  code?: string
  pricing: string
  category: string
  note?: string
}

export interface ProtocolNode {
  id: string
  visit: string
  procedure: string
  rule: RuleId
  coverage: Coverage
  reason: string
  window: string | null
}

export interface Rule {
  id: RuleId
  coverage: Coverage
  title: string
  text: string
  nodes?: number
}

export interface Protocol {
  nct_id: string
  label: string
  authored: string
  short_title: string
  why_chosen: string
  arms: { label: string; text: string }[]
  dosing: string
  masking: string
  registry_notes: string[]
  sources: { field: string; quote: string; used_for: string }[]
  assumptions: string[]
  visits: Visit[]
  procedures: Procedure[]
  nodes: ProtocolNode[]
  edges: { src: string; dst: string; nominal_days: number; window_min_days: number; window_max_days: number }[]
  rules: Rule[]
  standard_care_reference: string[]
  standard_care_source: string
  trial: TrialFacts
  design: { design: string; confidence: string | null } | null
  disclaimer: string
}

export interface Locality {
  state: string
  code: string
  name: string
  gpci_work: number
  gpci_pe: number
  gpci_mp: number
  county: string | null
  method: string
  verified: boolean
  source: string
}

export interface SiteOpt {
  site_id: string
  facility: string
  city: string
  state: string
  state_abbr: string
  zip: string | null
  anonymized: boolean
  status: string | null
  locality: Locality | null
  label: string
}

export interface SitesResp {
  nct_id: string
  sites: SiteOpt[]
  n_withdrawn_hidden: number
  default_pair: (string | null)[]
  presets: { label: string; site_ids: string[] }[]
  county_source: string
}

export interface Line {
  node_id: string
  visit_id: string
  procedure_id: string
  label: string
  category: string
  code: string | null
  rule: RuleId
  reason: string
  coverage: Coverage
  override: boolean
  basis: string
  payer: 'Sponsor' | 'Insurance'
  window: string | null
  count: number
  medicare_amount: number | null
  unit_amount: number | null
  amount: number | null
  schedule: 'PFS' | 'CLFS' | 'Standard' | 'None' | null
  verified: boolean
  placeholder: boolean
  source: string | null
  formula: string | null
  rvu: { work: number; pe: number; mp: number } | null
  gpci: { work: number; pe: number; mp: number } | null
  cf: number | null
  note: string | null
  multiplier: number | null
  standard_item?: string
  edited?: boolean
}

export interface VisitBudget {
  visit_id: string
  label: string
  short: string
  kind: Visit['kind']
  window: string
  repeat: string | null
  lines: Line[]
  research_subtotal: number
  coordinator: number
  overhead: number
  visit_total: number
  insurance_medicare: number
  placeholder_amount: number
}

export interface StandardItem {
  id: string
  label: string
  amount: number | null
  default: number | null
  unit: 'per_site' | 'per_visit' | 'per_occurrence' | 'rate' | 'as_incurred'
  unit_label: string
  edited: boolean
  label_tag: string
  source: string
}

export interface Totals {
  per_participant: number
  per_participant_scope: string
  per_participant_research_items: number
  per_participant_coordinator: number
  per_participant_overhead: number
  per_participant_insurance_medicare: number
  per_participant_placeholder: number
  per_occurrence: { visit_id: string; label: string; repeat: string; amount: number }[]
  screen_failure: number
  per_site_one_time: number
  n_sponsor_lines: number
  n_insurance_lines: number
  n_overrides: number
  n_placeholder_lines: number
}

export interface Budget {
  nct_id: string
  short_title: string
  label: string
  disclaimer: string
  site: SiteOpt
  locality: Locality | null
  multiplier: number
  conversion_factor: number | null
  pfs_source: string | null
  clfs_loaded: boolean
  visits: VisitBudget[]
  totals: Totals
  standard_schedule: StandardItem[]
  overrides: { node_id: string; visit: string; procedure: string; rule: RuleId; coverage: Coverage; basis: string }[]
  rules: Rule[]
  ncd: string
}

export interface CompareRow {
  procedure_id: string
  label: string
  code: string | null
  schedule: Line['schedule']
  placeholder: boolean
  unit_a: number
  unit_b: number
  formula_a: string | null
  formula_b: string | null
  rvu: { work: number; pe: number; mp: number } | null
  visits_fixed: string[]
  visits_repeat: string[]
  n_fixed: number
  delta_unit: number
  delta_fixed: number
  delta_work: number
  delta_pe: number
  delta_mp: number
  rounding: number
  why: string
}

export interface CompareSide {
  site: SiteOpt
  locality: Locality | null
  totals: Totals
}

export interface Compare {
  nct_id: string
  multiplier: number
  conversion_factor: number
  pfs_source: string | null
  disclaimer: string
  label: string
  a: CompareSide
  b: CompareSide
  gpci_delta: { work: number; pe: number; mp: number }
  rows: CompareRow[]
  summary: {
    delta_per_participant: number
    delta_research_items: number
    delta_overhead: number
    from_work: number
    from_pe: number
    from_mp: number
    overhead_rate: number
    rounding: number
    per_occurrence: { visit_id: string; label: string; a: number; b: number; delta: number }[]
    screen_failure: { a: number; b: number; delta: number }
  }
}

export interface PriceParams {
  multiplier: number
  overrides: Overrides
  standard: StandardEdits
}

const BASE = '/api/terms-flow'

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
    throw new Error(`${res.status} ${detail}`)
  }
  return (await res.json()) as T
}

function priceQuery(p: PriceParams, extra: Record<string, string>): string {
  const s = new URLSearchParams(extra)
  s.set('multiplier', String(p.multiplier))
  if (Object.keys(p.overrides).length) s.set('overrides', JSON.stringify(p.overrides))
  if (Object.keys(p.standard).length) s.set('standard', JSON.stringify(p.standard))
  return s.toString()
}

const enc = encodeURIComponent

export const termsApi = {
  trials: (signal?: AbortSignal) => get<TrialCard[]>(`${BASE}/trials`, signal),
  protocol: (nct: string, signal?: AbortSignal) => get<Protocol>(`${BASE}/${enc(nct)}/protocol`, signal),
  sites: (nct: string, signal?: AbortSignal) => get<SitesResp>(`${BASE}/${enc(nct)}/sites`, signal),
  budget: (nct: string, siteId: string, p: PriceParams, signal?: AbortSignal) =>
    get<Budget>(`${BASE}/${enc(nct)}/budget?${priceQuery(p, { site_id: siteId })}`, signal),
  compare: (nct: string, a: string, b: string, p: PriceParams, signal?: AbortSignal) =>
    get<Compare>(`${BASE}/${enc(nct)}/compare?${priceQuery(p, { site_a: a, site_b: b })}`, signal),
  /** Download URL for the markdown term sheet. */
  markdownUrl: (nct: string, siteId: string, p: PriceParams, compareSite?: string | null) =>
    `${BASE}/${enc(nct)}/termsheet.md?${priceQuery(p, compareSite ? { site_id: siteId, compare_site: compareSite } : { site_id: siteId })}`,
  /** Print-friendly page (browser print to PDF). */
  printUrl: (nct: string, siteId: string, p: PriceParams, compareSite?: string | null) =>
    `${BASE}/${enc(nct)}/termsheet.html?${priceQuery(p, compareSite ? { site_id: siteId, compare_site: compareSite } : { site_id: siteId })}`,
}

export interface NodeState {
  coverage: Coverage
  override: boolean
}

export function coverageLabel(c: Coverage): string {
  return c === 'research' ? 'Research: sponsor pays' : 'Routine: billed to insurance'
}

/** Effective coverage per node after reviewer overrides. */
export function nodeStates(p: Protocol, overrides: Overrides): Map<string, NodeState> {
  const m = new Map<string, NodeState>()
  for (const n of p.nodes) {
    const ov = overrides[n.id]
    m.set(n.id, ov && ov !== n.coverage ? { coverage: ov, override: true } : { coverage: n.coverage, override: false })
  }
  return m
}

export const ILLUSTRATIVE = 'Illustrative, authored from public trial information'
export const DISCLAIMER = 'Decision support. Not a fair-market-value legal opinion.'
