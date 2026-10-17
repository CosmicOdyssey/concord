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
  /** Compact window for the grid header and timeline (e.g. "q9w"). */
  short_window?: string
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
  /** How registry excerpts are quoted (verbatim; ellipsis marks omissions). */
  quote_note: string
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
  standard_label?: string
  standard_unit?: string
  edited?: boolean
  /** Anchoring of a sponsor-paid line (null for routine care billed to insurance). */
  anchor?: AnchorId | null
  anchor_reason?: string
  /** Coded sponsor lines priced at Medicare x the band; others keep their point value. */
  banded?: boolean
  low?: number | null
  high?: number | null
}

export type AnchorId = 'public' | 'standard' | 'open'

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
  visit_low?: number
  visit_high?: number
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
  /** Set on the overhead rate: a proposed default, not a public rate. */
  assumption?: boolean
  assumption_note?: string
}

export interface Totals {
  per_participant: number
  per_participant_scope: string
  per_participant_research_items: number
  per_participant_coordinator: number
  per_participant_overhead: number
  per_participant_insurance_medicare: number
  per_participant_placeholder: number
  per_occurrence: { visit_id: string; label: string; repeat: string; amount: number; low?: number; high?: number }[]
  screen_failure: number
  per_participant_low?: number
  per_participant_high?: number
  screen_failure_low?: number
  screen_failure_high?: number
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
  band?: Band
  anchoring?: Anchoring
  breakdowns?: Breakdowns
  pricing_basis?: PricingBasis
}

/** The negotiation band on coded lines: an assumption the user sets (fractions of Medicare). */
export interface Band {
  lo: number
  hi: number
  label: string
  note: string
  n_banded_lines: number
  point_multiplier: number
}

export interface AnchorShare {
  id: AnchorId
  label: string
  definition: string
  amount: number
  pct: number
  low: number
  high: number
  n_lines: number
  components: { label: string; amount: number; low: number; high: number; n: number }[]
}

export interface Anchoring {
  total: number
  scope: string
  shares: AnchorShare[]
  rounding_to_open: number
  note: string
}

export interface BreakdownRow {
  id: string
  label: string
  amount: number
  low: number
  high: number
  n_lines: number
  not_sponsor?: boolean
}

export interface Breakdowns {
  scope: string
  payer: BreakdownRow[]
  cost_type: BreakdownRow[]
  visit: BreakdownRow[]
  anchoring: BreakdownRow[]
  outside: {
    one_time_fees: { label: string; amount: number; n_items: number }
    per_occurrence: { label: string; amount: number; low: number; high: number }[]
  }
  note: string
}

export interface PricingBasis {
  pfs: string
  pfs_column: string
  opps_included: boolean
  lab: string
  lab_varies_by_site: boolean
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
  band?: Band
  pricing_basis?: PricingBasis
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
  /** Negotiation band on coded lines, fractions of Medicare [low, high] (an assumption; API default 1.0-1.5). */
  band?: [number, number]
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
  if (p.band) {
    s.set('band_lo', String(p.band[0]))
    s.set('band_hi', String(p.band[1]))
  }
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

// Copy deck B7 (verbatim).
export const ROUTINE_LEGEND = "Routine care: billable to Medicare (NCD 310.1) or the insurer, by Concord's rules; the payer decides coverage."
export const RESEARCH_LEGEND = 'Research-only: paid by the sponsor.'
export const PROPOSED_STANDARD_TAG = 'Proposed standard: a starting point to negotiate against, not market data.'
export const PLACEHOLDER_TAG = 'Includes placeholder lab prices'

const UPPER_WORDS = new Set(['NYC', 'DC', 'II', 'III'])
const LOWER_WORDS = new Set(['of', 'and', 'the'])

/** CMS locality names come in capitals ("REST OF FLORIDA", "NYC SUBURBS/LONG ISLAND"); show them in title case. */
export function localityTitle(name: string): string {
  return name
    .toLowerCase()
    .replace(/\p{L}[\p{L}.']*/gu, (w, offset: number) => {
      if (UPPER_WORDS.has(w.toUpperCase())) return w.toUpperCase()
      if (offset > 0 && LOWER_WORDS.has(w)) return w
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
}

/** "MANHATTAN" in locality 01 -> "01 · Manhattan"; no locality -> national amounts. */
export function localityLabel(l: Locality | null): string {
  return l ? `${l.code} · ${localityTitle(l.name)}` : 'No locality: national amounts'
}

/** The API writes formulas with an ASCII "x"; show the multiplication sign. */
export function formulaText(f: string): string {
  return f.replace(/ x /g, ' × ')
}

/** A rule's id and title as the term sheet prints it ("R4: More frequent than standard care"). */
export function ruleTitle(rules: Rule[], id: RuleId): string {
  const r = rules.find((x) => x.id === id)
  return r ? `${id}: ${r.title}` : id
}
