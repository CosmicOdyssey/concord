// Types mirror the live FastAPI responses (see ../backend/concord/api/main.py).
// Months are model-estimated enrollment durations; null means "no estimate", never zero.

export type Region = string

export interface ClearParams {
  region: Region
  activation_lag: number
  overlap_scale: number
  capacity_scale: number
  max_trials?: number | null
}

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
  criteria: Criterion[]
  T_actual: number | null
  T_indep: number | null
  T_coord: number | null
  flagged: boolean
  sites_indep: number
  sites_coord: number
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
  lam_flow: number | null
  lam_ci: [number, number] | null
  fitted?: boolean
  n_hist: number | null
  k: number
  load_actual: number
  load_indep: number
  load_coord: number
}

export type AllocKey = 'actual' | 'indep' | 'coord'

export interface Robust {
  median_T_indep: number
  median_T_coord: number
  median_T_actual: number
  median_speedup: number
  share_trials_faster: number
  share_trials_slower: number
  trimmed_trials: number
  flagged_trials: number
  trimmed_dividend_trial_months: number
  trimmed_poa: number
  plausible_T_cap_months: number
}

export interface SolverStats {
  greedy_objective?: number
  objective?: number
  moves_evaluated?: number
  improvements?: number
  kicks?: number
  seconds?: number
  hit_time_limit?: boolean
}

export interface ClearSummary {
  poa: number
  dividend_trial_months: number
  objective_indep?: number
  objective_coord?: number
  trials_unfillable_indep?: number
  trials_unfillable_coord?: number
  poa_vs_actual: number
  dividend_vs_actual_trial_months?: number
  robust: Robust
  dividend_days: number
  dollars_direct: number
  dollars_lost_sales: number
  dollars_note: string
  solver: SolverStats
}

export interface ClearResult {
  params: ClearParams & { time_limit?: number; calibrate?: boolean; f_clip?: [number, number] }
  counts: {
    trials: number
    sites: number
    sites_used_actual: number
    sites_used_indep: number
    sites_used_coord: number
  }
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
  T_coord: number | null
  criteria: PriceTag[]
  note: string
}

export interface SlotValue extends Site {
  months_saved: number
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
    verified: boolean
  }[]
  budget: {
    multiplier: number
    locality_factor: number
    locality_source: string
    procedure_lines: {
      node: string
      code: string
      procedure: string
      amount: number | null
      source: string
      verified: boolean
    }[]
    procedures_total: number
    per_patient_items: { id: string; label: string; amount: number; unit: string }[]
    per_patient_total: number
    per_site_items: { id: string; label: string; amount: number; unit: string }[]
    schedule_source: string
    unpriced_codes: string[]
  }
  expected_patients: number
  expected_site_total: number
  agreement: string[]
  disclaimer: string
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
      note?: string
    }
  } | null
}

export interface CompileResult {
  criteria: Criterion[]
  eligible_fraction: number
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
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) s.set(k, String(v))
  return s.toString()
}

function solveParams(p: ClearParams) {
  return {
    region: p.region,
    activation_lag: p.activation_lag,
    overlap_scale: p.overlap_scale,
    capacity_scale: p.capacity_scale,
    max_trials: p.max_trials ?? undefined,
  }
}

export const api = {
  status: (signal?: AbortSignal) => request<Status>('/api/status', { signal }),
  regions: (signal?: AbortSignal) => request<string[]>('/api/regions', { signal }),
  clear: (p: ClearParams, signal?: AbortSignal) =>
    request<ClearResult>('/api/clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
      signal,
    }),
  priceTags: (nct: string, p: ClearParams, signal?: AbortSignal) =>
    request<PriceTags>(`/api/trials/${encodeURIComponent(nct)}/price-tags?${q(solveParams(p))}`, { signal }),
  slotValues: (p: ClearParams, signal?: AbortSignal) =>
    request<SlotValue[]>(`/api/slot-values?${q(solveParams(p))}`, { signal }),
  termsheet: (site_id: string, nct_id: string, region: string, signal?: AbortSignal) =>
    request<TermSheet>(`/api/termsheet?${q({ site_id, nct_id, region })}`, { signal }),
  compileEligibility: (text: string, signal?: AbortSignal) =>
    request<CompileResult>('/api/compile/eligibility', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    }),
}

export const DEFAULT_PARAMS: ClearParams = {
  region: 'US-Northeast',
  activation_lag: 6,
  overlap_scale: 1,
  capacity_scale: 1,
}

export function isDefaultSolve(p: ClearParams): boolean {
  return (
    p.activation_lag === DEFAULT_PARAMS.activation_lag &&
    p.overlap_scale === DEFAULT_PARAMS.overlap_scale &&
    p.capacity_scale === DEFAULT_PARAMS.capacity_scale &&
    (p.max_trials ?? null) === null
  )
}
