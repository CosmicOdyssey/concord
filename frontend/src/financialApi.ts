export const COVERAGE_STATUSES = ['SPONSOR', 'POTENTIALLY_PAYER_COVERED', 'POTENTIALLY_PATIENT_COST_SHARING', 'CONDITIONAL', 'UNKNOWN', 'REVIEW_REQUIRED'] as const
export type CoverageStatus = typeof COVERAGE_STATUSES[number]
export interface FinancialSite {
  id: string; name: string; baseline_active: boolean; feasible: boolean
  activation_cost: number; monthly_cost: number; per_participant_cost: number; capacity: number
}
export interface FinanceRequest {
  trial_id: string; budget: number; target: number; budget_period_months: number
  admin_cost: number; admin_reduction: number; support_per_participant: number
  minimum_support: number; extra_support: number; seed: number; draws: number
  cost_spread: number; payer_kind: 'Medicare' | 'commercial' | 'Medicaid'
  jurisdiction: string; payer_plan: string; payer_fraction: number
  commercial_rate_assumption: boolean; sponsor_rate_multiplier: number
  payer_admin_per_participant: number; drug_contingency_per_participant: number
  coverage_overrides: Record<string, CoverageStatus>; sites: FinancialSite[]
}
export interface CoverageItem {
  id: string; label: string; code: string | null; quantity: number; unit_rate: number
  rate_kind: string; source: string; status: CoverageStatus; review_status: string; explanation: string
  sponsor_per_participant: number; payer_per_participant: number | null; patient_per_participant: number | null
  reserve_per_participant: number; resource_cost_per_participant: number
}
export interface CoverageResult { items: CoverageItem[]; totals: Record<string, number | null>; warnings: string[] }
export interface FinancialScenario {
  id: string; label: string; definition: string
  plan: {
    feasible: boolean; costed: boolean; violations: string[]; selected_ids: string[]
    site_rows: { id: string; name: string; participants: number; activation: number; operating: number; variable: number; procedure: number; support: number; total: number }[]
    sponsor_total: number | null; breakdown: Record<string, number> | null; stated_capacity: number | null
    cost_per_participant: number | null; budget_utilization: number | null; unspent_budget: number | null
  }
  economics: null | {
    sponsor: { expenditure: number; contingency_reserve: number; budget_commitment: number; supply_resource_proxy: number }
    hospital: { revenue: number | null; resource_cost: number; net_contribution: number | null }
    insurer: { payments: number | null; administration: number; total: number | null; downstream_clinical_cost: null }
    patient: { cost_sharing: number | null; access_support: number; unresolved_exposure: null }
    transfers: { from: string; to: string; amount: number | null }[]; consolidated_resource_cost: number; transfer_balance: number
  }
  delta: null | { sponsor_expenditure: number | null; resources: number | null; hospital_contribution: number | null; insurer_expenditure: number | null; patient_cost_sharing: number | null; access_support: number | null }
  sensitivity: null | { sponsor_total_quantiles: number[]; probability_budget_exceeded: number; seed: number; draws: number; method: string }
  budget_reallocation: null | { additional_sites: string[]; additional_activations: number; incremental_cost: number | null }
}
export interface FinancialDemo { request: FinanceRequest; trials: { id: string; title: string }[]; coverage: CoverageResult; limitations: string[] }
export interface FinancialResult {
  request: FinanceRequest; input_sha256: string; run_id: string; execution_mode: 'synthetic_financial_demo'
  trial: { id: string; title: string }; coverage: CoverageResult; scenarios: FinancialScenario[]
  result_sha256: string; sources: {id: string; title: string; url: string; scope: string}[]; assumptions: Record<string, string>
  comparison: { ordering: string; basis: string }; evidence: Record<string, unknown>; limitations: string[]
}

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response
  let detail = `Financial service returned ${response.status}`
  try { const body = await response.json(); detail += `: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)}` } catch { /* HTTP status remains useful */ }
  throw new Error(detail)
}
function body(request: FinanceRequest): string {
  // JSON.stringify silently turns NaN/Infinity into null; reject those before sending or exporting.
  return JSON.stringify(request, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Every numeric assumption needs a finite value.')
    return value
  })
}
export const financialApi = {
  async demo(signal?: AbortSignal): Promise<FinancialDemo> {
    return (await checked(await fetch('/api/financial/demo', { signal }))).json()
  },
  async compare(request: FinanceRequest, signal?: AbortSignal): Promise<FinancialResult> {
    return (await checked(await fetch('/api/financial/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(request), signal }))).json()
  },
  async report(request: FinanceRequest, format: 'json' | 'html', signal?: AbortSignal): Promise<Blob> {
    return (await checked(await fetch(`/api/financial/report?format=${format}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(request), signal }))).blob()
  },
}
