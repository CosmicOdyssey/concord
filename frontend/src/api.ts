// Types mirror the live FastAPI v0.2 responses (see ../backend/concord/api/main.py and service.py).
// Months are model-estimated enrollment durations; null means "no estimate", never zero.

export type LowHistory = 'model' | 'prior' | 'exclude'
export type Universe = 'registered' | 'history'

/** Scenario parameters shared by POST /api/clear (body) and every GET analysis endpoint (query). */
export interface Scenario {
  region: string
  as_of: string | null
  sponsor: string | null
  /** Congestion elasticity; null = the data estimate from the within-site regression. */
  beta: number | null
  low_history: LowHistory
  universe: Universe
  activation_lag: number
  overlap_scale: number
  capacity_scale: number
  max_trials?: number | null
}

export const DEFAULT_SCENARIO: Scenario = {
  region: 'US-Northeast',
  as_of: null,
  sponsor: null,
  beta: null,
  low_history: 'model',
  universe: 'registered',
  activation_lag: 0,
  overlap_scale: 1,
  capacity_scale: 1,
}

export const REGENERON_PRESET: Scenario = {
  ...DEFAULT_SCENARIO,
  region: 'US',
  sponsor: 'Regeneron',
  as_of: '2024-09-01',
}

/** Allocation keys used everywhere (assignments, trials T_* / sites_*, sites load_*). */
export type AllocKey = 'actual' | 'indep' | 'coord_free' | 'coord' | 'coord_nl_indep'

export interface Criterion {
  id: string
  kind: 'inclusion' | 'exclusion' | string
  feature: string
  op: string
  value: unknown
  label: string
  source: string
}

export interface Trial {
  nct_id: string
  title: string
  acronym: string | null
  sponsor: string | null
  phases: string[] | null
  enrollment: number | null
  n_sites_total: number | null
  n_sites_region: number | null
  target_region: number | null
  f: number | null
  f_rel: number | null
  criteria?: Criterion[]
  eligibility_source: string
  realized_window_months: number | null
  /** Implausible model time: held fixed as background, excluded from every number. */
  flagged: boolean
  /** Reassignable in this scenario (not flagged; in portfolio mode, the sponsor's own trials). */
  movable: boolean
  T_actual: number | null
  T_indep: number | null
  T_coord_free: number | null
  T_coord: number | null
  T_coord_nl_indep: number | null
  sites_actual: number
  sites_indep: number
  sites_coord_free: number
  sites_coord: number
  sites_coord_nl_indep: number
}

export interface Site {
  site_id: string
  facility: string
  city: string | null
  state: string | null
  country?: string | null
  lat: number | null
  lon: number | null
  is_amc: boolean
  anonymized: boolean
  lam_hist: number | null
  lam_raw?: number | null
  lam_flow: number | null
  lam_ci: [number, number] | null
  fitted?: boolean
  n_hist: number | null
  low_history?: boolean
  k: number
  load_actual: number
  load_indep: number
  load_coord_free: number
  load_coord: number
  load_coord_nl_indep: number
}

export interface Comparison {
  trials: number
  dividend_trial_months: number
  ratio: number | null
  median_speedup: number | null
  /** Any change, including near-ties (|ΔT| > 0). */
  share_faster: number | null
  share_slower: number | null
  /** Moved by at least material_threshold_months. Missing in robustness grids computed before the field existed. */
  share_faster_material?: number | null
  share_slower_material?: number | null
  material_threshold_months?: number | null
  worst_slowdown_months: number | null
  median_T_base: number | null
  median_T_new: number | null
}

export type ComparisonKey =
  | 'coord_vs_actual'
  | 'indep_vs_actual'
  | 'coordination_no_loser_vs_indep'
  | 'coord_free_vs_actual'
  | 'coord_free_vs_indep'

export interface SolverStats {
  greedy_objective?: number
  objective?: number
  moves_evaluated?: number
  improvements?: number
  kicks?: number
  exchanges_tried?: number
  exchanges_made?: number
  seconds?: number
  hit_time_limit?: boolean
}

export interface BetaInfo {
  beta: number
  /** Only for the data estimate; absent for a user setting ("user setting") or the fallback. */
  ci95?: [number, number]
  p?: number
  source: string
}

export interface Assumptions {
  beta: BetaInfo | number
  level_log_bias?: number
  level_factor?: number
  low_history: LowHistory
  low_history_n?: number
  universe: Universe
  rate_cap_q?: number
  candidate_sites?: number
  activation_lag_months?: number
  f_clip?: [number, number]
  plausible_T_cap_months?: number
}

export interface CalibrationCheck {
  same_trials_model_vs_realized: {
    n: number
    median_model?: number
    median_realized?: number
    median_log_ratio?: number
    median_abs_log_ratio?: number
  }
  model_median_T_actual_phase3: number | null
  model_median_T_actual_all: number | null
  phase3_trials_in_instance: number
  real_completed_phase3_median_enrollment_window: number | null
  real_completed_phase3_median_start_to_primary_completion: number | null
  real_n: number
}

export type ClearSummary = Record<ComparisonKey, Comparison> & {
  headline: string
  background_trials: number
  background_worse_under_coord_free: number
  site_counts: Record<string, { max_excess_over_registered: number; total_sites: number }>
  calibration_check: CalibrationCheck
  assumptions: Assumptions
  dividend_days: number
  dollars_direct: number
  dollars_lost_sales: number
  dollars_note: string
  solver: Record<string, SolverStats>
}

export interface ClearResult {
  params: Scenario & { rate_cap_q?: number; time_limit?: number; calibrate?: boolean; level?: boolean; f_clip?: [number, number] }
  counts: {
    trials: number
    movable_trials: number
    flagged_trials: number
    sites: number
  } & Partial<Record<`sites_used_${AllocKey}`, number>>
  summary: ClearSummary
  trials: Trial[]
  sites: Site[]
  assignments: Record<AllocKey, [string, string][]>
}

export interface PriceTag extends Criterion {
  pool_multiplier: number
  months_saved_trial: number
  months_saved_portfolio: number
}

export interface PriceTags {
  nct_id: string
  /** Trial's time in the reference re-solve of the joint optimum (coord_free), not the headline allocation. */
  T_coord: number | null
  criteria: PriceTag[]
  alternatives_not_priced?: string[]
  eligibility_source?: string
  note: string
}

export interface SlotValue extends Site {
  months_saved: number
}

export interface RobustnessRow {
  beta_label: string
  beta: number
  low_history: LowHistory
  universe: Universe
  coord_vs_actual: Comparison
  coordination_no_loser_vs_indep: Comparison
  coord_free_vs_actual: Comparison
  coord_free_vs_indep: Comparison
  indep_vs_actual: Comparison
}

export interface Robustness {
  params?: Partial<Scenario>
  rows: RobustnessRow[]
}

export interface RegressionResult {
  coef: number
  se?: number
  p: number
  ci95: [number, number]
  /** Trial-clustered values, kept next to the two-way clustered ones once the backend reports both. */
  se_trial_only?: number
  ci95_trial_only?: [number, number]
  p_trial_only?: number
  pct_per_competitor?: number
  n_rows: number
  clusters?: number
  sites?: number
  exposure_mean?: number
  exposure_p90?: number
}

export interface CongestionTest {
  n_trials: number
  n_trial_sites: number
  results: Record<string, RegressionResult>
  primary: string
  model_implied_coef_overlap: number
  verdict?: string
  // Optional fields added by the two-way-clustering / subset / parser-sensitivity revision of the
  // congestion test. Rendered only when present.
  /** Method behind the primary se / ci95 / p, e.g. "two-way clustered (trial, site)". */
  se_method?: string
  subsets?: Record<string, CongestionSubset>
  multiple_comparisons?: {
    method: string
    k: number
    alpha: number
    note: string
    bonferroni_ci95: Record<string, [number, number]>
  }
  parser_sensitivity?: ParserSensitivity[]
  default_beta?: { value: number; source: string; ci95: [number, number]; note?: string }
}

export interface SubsetFit {
  coef: number
  se?: number
  ci95: [number, number]
  p: number
  clusters?: number
  n_rows?: number
}

export interface CongestionSubset {
  label: string
  definition: string
  within?: SubsetFit
  site_fe?: SubsetFit
  pooled?: SubsetFit
  is_default?: boolean
}

export interface ParserSensitivity {
  parser_version: string
  commit: string
  description: string
  within_overlap: { coef: number; ci95: [number, number]; p: number; clusters?: number }
  empty_masks?: number
}

export interface SponsorCount {
  sponsor: string
  trials: number
}

export interface TermSheet {
  protocol: { id: string; title: string }
  site: {
    site_id: string
    facility: string
    city: string | null
    state: string | null
    zip?: string | null
    is_amc: number | boolean
    anonymized: number | boolean
  }
  capability_check: { capability: string; met: boolean }[]
  capabilities_source: string
  capability_ok: boolean
  coverage_grid: {
    node: string
    visit: string
    procedure: string
    code: string
    coverage: 'routine' | 'research' | string
    payer: string
    rationale: string
    medicare_amount: number | null
    schedule?: string
    locality?: string | null
    verified: boolean
    source?: string
  }[]
  budget: {
    multiplier: number
    locality?: string | null
    locality_source: string
    conversion_factor?: number
    procedure_lines: {
      node: string
      code: string
      procedure: string
      schedule?: string
      amount: number | null
      national?: number | null
      source: string
      verified: boolean
    }[]
    procedures_total: number
    per_patient_items: { id: string; label: string; amount: number; unit: string }[]
    per_patient_total: number
    per_site_items: { id: string; label: string; amount: number; unit: string }[]
    as_incurred_items?: { id: string; label: string; amount: number; unit: string }[]
    schedule_source: string
    unpriced_codes: string[]
  }
  expected_patients: number
  expected_site_total: number
  expected_source?: string
  agreement: string[]
  disclaimer: string
}

export interface BacktestCell {
  median_abs_log_error: number
  median_signed_log_bias: number
  n: number
}

export interface Status {
  crawls: Record<
    string,
    { name: string; cond: string; filter?: string; page?: number; studies: number; total: number; updated: string; done: boolean }
  >
  db: boolean
  counts?: { trials: number; sites: number; trial_sites: number }
  model?: {
    f_ref?: number
    prior?: { alpha: number; beta: number; mean: number; median: number }
    history_trials?: number
    fitted_sites?: number
    assumptions?: Record<string, unknown>
    backtest?: {
      cutoff: string
      train_trials: number
      test_trials: number
      median_abs_log_error_model: number
      median_abs_log_error_naive: number
      model_beats_naive_share: number
      median_share_of_test_sites_seen_in_train?: number
      by_model?: Record<string, Record<string, BacktestCell>>
      calibration_slope_industry_p23?: { slope: number; se: number; n: number; mean_log_pred?: number }
      level_log_bias_industry_p23?: number
      low_history_rule?: { n_below: number; prior_quantile: number; rate: number }
      note?: string
    }
    congestion_test?: CongestionTest
  } | null
}

export interface CompileResult {
  criteria: Criterion[]
  /** null when nothing was parsed ("unknown is never 100%"). */
  eligible_fraction: number | null
  parser: string
  review_required: boolean
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body && typeof body.detail === 'string') detail = body.detail
      else if (body?.detail) detail = JSON.stringify(body.detail)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, `${res.status} ${detail}`)
  }
  return (await res.json()) as T
}

function q(params: Record<string, string | number | null | undefined>): string {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') s.set(k, String(v))
  return s.toString()
}

/** Normalize a scenario for the wire: blank strings become null. */
export function cleanScenario(s: Scenario): Scenario {
  return {
    region: s.region,
    as_of: s.as_of?.trim() || null,
    sponsor: s.sponsor?.trim() || null,
    beta: s.beta === null || Number.isNaN(s.beta) ? null : s.beta,
    low_history: s.low_history,
    universe: s.universe,
    activation_lag: s.activation_lag,
    overlap_scale: s.overlap_scale,
    capacity_scale: s.capacity_scale,
    max_trials: s.max_trials ?? null,
  }
}

function scenarioQuery(s: Scenario): Record<string, string | number | null | undefined> {
  const c = cleanScenario(s)
  return { ...c }
}

export function scenarioKey(s: Scenario): string {
  return JSON.stringify(cleanScenario(s))
}

export const api = {
  status: (signal?: AbortSignal) => request<Status>('/api/status', { signal }),
  regions: (signal?: AbortSignal) => request<string[]>('/api/regions', { signal }),
  clear: (s: Scenario, signal?: AbortSignal) =>
    request<ClearResult>('/api/clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cleanScenario(s)),
      signal,
    }),
  robustness: (s: Scenario, signal?: AbortSignal) =>
    request<Robustness>(`/api/robustness?${q(scenarioQuery(s))}`, { signal }),
  congestion: (signal?: AbortSignal) => request<CongestionTest>('/api/congestion-test', { signal }),
  sponsors: (region: string, as_of: string | null, signal?: AbortSignal) =>
    request<SponsorCount[]>(`/api/sponsors?${q({ region, as_of })}`, { signal }),
  priceTags: (nct: string, s: Scenario, signal?: AbortSignal) =>
    request<PriceTags>(`/api/trials/${encodeURIComponent(nct)}/price-tags?${q(scenarioQuery(s))}`, { signal }),
  slotValues: (s: Scenario, signal?: AbortSignal) =>
    request<SlotValue[]>(`/api/slot-values?${q(scenarioQuery(s))}`, { signal }),
  termsheet: (site_id: string, nct_id: string, s: Scenario, signal?: AbortSignal) =>
    request<TermSheet>(`/api/termsheet?${q({ site_id, nct_id, ...scenarioQuery(s) })}`, { signal }),
  compileEligibility: (text: string, signal?: AbortSignal) =>
    request<CompileResult>('/api/compile/eligibility', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    }),
}
