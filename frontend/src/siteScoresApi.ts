// Types and fetchers for the Site scores tab (backend: concord/api/site_scores.py, concord/site_scores.py).
// Historical, registry-based estimates with their observed-outcome validation. Not forecasts for a new trial.

export interface Calibration {
  /** Mean log score over U.S. non-anonymized fitted sites. */
  m: number
  geo_mean: number
  /** Industry Phase II/III slope from data/findings/selection_validation.json. */
  b: number
  b_ci: [number, number]
  b_n: number
  b_label: string
  source: string
  formula: string
}

export interface SiteRow {
  site_id: string
  facility: string | null
  city: string | null
  state: string | null
  is_amc: boolean
  /** Lifetime lung trials at the site (any status). */
  n_hist: number
  /** Completed trials with actual enrollment that the fit used. */
  n_fit: number
  /** Final score (site_model.lam_eff), patients per month per trial. */
  score: number
  posterior_mean: number
  /** Posterior 10th to 90th percentile. */
  interval: [number, number]
  low_history: boolean
  /** The low-history cap lowered the score below the posterior mean. */
  capped: boolean
  percentile: number
  calibrated: number | null
}

export interface SiteList {
  total: number
  offset: number
  limit: number
  sort: string
  filters: { region: string; state: string | null; q: string | null; min_trials: number }
  calibration: Calibration | null
  cap: number
  rows: SiteRow[]
}

export interface ValidationBlock {
  label: string
  n: number
  slope: number
  se: number
  ci95: [number, number]
  p: number
  overstatement: number | null
}

export interface Validation {
  source: string
  script: string
  cutoff: string
  fit_trials: number
  outcome: string
  score: string
  controls: string
  industry_phase2_3: ValidationBlock
  all_trials: ValidationBlock | null
  reading: string
  interpretation: string
}

export interface Prior {
  alpha: number
  beta: number
  mean: number
  /** Prior 25th percentile: the low-history cap and the unseen-site rate. */
  p25: number
  p10?: number
  p50?: number
  p90?: number
  trials_used: number
  trim: [number, number]
}

export interface Bucket {
  label: string
  lo: number
  hi: number | null
  sites: number
  median_score: number | null
  median_posterior_mean: number | null
  capped: number
  low_history: boolean
}

export interface HistBin {
  lo: number
  hi: number
  low_history: number
  history_3plus: number
}

export interface Summary {
  method: string
  prior: Prior
  fit: {
    history_trials: number
    fitted_sites: number
    links: number
    iters: number
    enroll_fraction: number
    low_history_n: number
    low_history_q: number
    min_window_months: number
  }
  us: { sites: number; low_history: number; capped: number; median_score: number; m: number; geo_mean: number }
  buckets: Bucket[]
  histogram: { bin_log10: number; bins: HistBin[] }
  validation: Validation | null
  calibration: Calibration | null
  consistency: { compared: number; max_abs_diff: number; against: string }
  regions: string[]
  /** States in each region (null = every state). */
  region_states: Record<string, string[] | null>
  states: { state: string; sites: number }[]
  preset: { site_id: string; facility: string; n_fit: number } | null
}

export interface ContribTrial {
  nct_id: string
  title: string | null
  acronym: string | null
  status: string | null
  sponsor: string | null
  sponsor_class: string | null
  phases: string[]
  start: string
  primary_completion: string
  /** N_t, actual enrollment. */
  enrollment: number
  /** |S_t|, registered sites. */
  n_sites: number
  /** tau_t = 0.65 x (primary completion - start), months. */
  window_months: number
  /** This site's allocated enrollment from the final E-step. */
  n_hat: number
  share: number
  /** N_t / |S_t|. */
  equal_split: number
  /** e_ts (equals tau_t: no congestion or eligibility adjustment in the fit). */
  exposure: number
  /** N_t / (tau_t |S_t|): the trial's own per-site rate. */
  trial_rate: number
}

export interface SiteDetail {
  site: {
    site_id: string
    facility: string | null
    city: string | null
    state: string | null
    zip: string | null
    country: string | null
    is_amc: boolean
    in_us_list: boolean
  }
  history: {
    n_hist: number
    n_hist_industry: number
    n_fit: number
    n_not_fit: number
    not_fit: { reason: string; n: number; examples: string[] }[]
  }
  prior: Prior
  data: { sum_n_hat: number; sum_exposure: number; data_rate: number | null; data_weight: number }
  posterior: { shape: number; rate: number; mean: number; p10: number; p90: number }
  cap: { low_history: boolean; threshold: number; quantile: number; cap_value: number; applied: boolean; value: number }
  score: number
  percentile: number | null
  calibrated: (Calibration & { value: number; range_over_b_ci: [number, number] }) | null
  trials: ContribTrial[]
  method: { iters: number; enroll_fraction: number }
}

export interface ListParams {
  region: string
  state: string
  q: string
  min_trials: number
  sort: string
  limit: number
  offset: number
}

const BASE = '/api/site-scores'

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

export function listQuery(p: ListParams): string {
  const s = new URLSearchParams()
  s.set('region', p.region)
  if (p.state) s.set('state', p.state)
  if (p.q.trim()) s.set('q', p.q.trim())
  s.set('min_trials', String(p.min_trials))
  s.set('sort', p.sort)
  s.set('limit', String(p.limit))
  s.set('offset', String(p.offset))
  return s.toString()
}

export const siteScoresApi = {
  summary: (signal?: AbortSignal) => get<Summary>(`${BASE}/summary`, signal),
  list: (p: ListParams, signal?: AbortSignal) => get<SiteList>(`${BASE}?${listQuery(p)}`, signal),
  site: (id: string, signal?: AbortSignal) => get<SiteDetail>(`${BASE}/${encodeURIComponent(id)}`, signal),
}

/** Scores span 0.002 to 15 patients per month: three significant figures, never scientific notation. */
export function rate(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  if (x === 0) return '0'
  const digits = Math.max(0, Math.min(5, 2 - Math.floor(Math.log10(Math.abs(x)))))
  return x.toFixed(digits)
}

export function fixed(x: number | null | undefined, d = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function ordinal(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—'
  const n = Math.round(p)
  const k = n % 100
  const suf = k >= 11 && k <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suf}`
}
