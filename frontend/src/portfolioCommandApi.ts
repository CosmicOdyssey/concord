export interface PortfolioTrial {
  id: string; title: string; sponsor: string; target: number; enrolled: number; progress_basis: 'SIMULATED'
  priority: number; deadline: number; financial_template: 'NCT05800015' | 'NCT06627647'; admin: number; support: number
}
export interface SharedSite { id: string; name: string; capacity: number | null; capacity_basis: 'UNKNOWN' | 'ASSUMED'; slots: number }
export interface PortfolioEdge {
  trial: string; site: string; baseline: boolean; feasibility: 'UNKNOWN' | 'ASSUMED_FEASIBLE' | 'INFEASIBLE'
  rate_basis: 'UNKNOWN' | 'ASSUMED'; rate: number | null; lag: number; activation: number; operating: number
  monitoring: number; participant: number; screening: number
}
export interface PortfolioRequest {
  budget: number; objective: 'weighted_makespan' | 'sum_duration' | 'min_cost_deadline'; horizon: number
  seed: number; draws: number; spread: number; savings_realized: boolean; admin_reduction: number
  extra_support: number; support_rate_effect: number; operations_rate_effect: number; operations_cost: number
  no_loser: boolean; hospital_floor: number; trials: PortfolioTrial[]; sites: SharedSite[]; edges: PortfolioEdge[]
}
export interface RegistryContext { id: string; title: string; sponsor: string; source: string; captured_at: string; use: string }
export interface PortfolioDemo { request: PortfolioRequest; registry_context: RegistryContext[]; limitations: string[] }
export interface PortfolioScenario {
  id: string; label: string; feasible: boolean; violations: string[]; selected_edges: number[]; objective_value: number
  policy: { administrative_efficiency: boolean; additional_support: boolean; operations_investment: boolean }
  expected_makespan: number; weighted_makespan: number; weighted_sum_duration: number; interval: number[]
  censored_draws: number; paired_months_saved: number; paired_savings_interval: number[]
  trials: { id: string; remaining: number; expected_months: number; interval: number[]; expected_enrolled: number; deadline_draw_fraction: number; critical_path_draw_fraction: number }[]
  sites: { id: string; peak_rate: number; capacity: number | null; reserved_slots: number }[]
  edge_flows: { edge: number; expected_enrolled: number; expected_active_months: number; activation_cost: number; expected_site_payments: number }[]
  expected_cost_per_required_participant: number
  ledger: { expected_commitment: number; budget_commitment: number; budget_remaining: number; transfer_balance: number
    resource_cost: number; cash_expenditure: number; contingency: number
    trials: { trial: string; breakdown: Record<string, number>; budget_commitment: number; expected_commitment: number
      economics: { sponsor: { expenditure: number; contingency_reserve: number }; hospital: { revenue: number; resource_cost: number; net_contribution: number }
        insurer: { payments: number }; patient: { cost_sharing: number; access_support: number }; transfers: { from: string; to: string; amount: number }[]; transfer_balance: number } }[] }
}
export interface PortfolioResult {
  request: PortfolioRequest; execution_mode: string; run_id: string; input_sha256: string; result_sha256: string
  scenarios: PortfolioScenario[]; recommended_scenario_id: string | null; pareto_scenario_ids: string[]
  marginal: { label: string; feasible: boolean; violations: string[]; additional_expected_cost: number; additional_budget_reserve: number
    expected_months_saved: number; paired_savings_interval: number[]; additional_expected_enrollment_at_month: number
    additional_expected_enrollment: number; expected_enrollment_gain_per_dollar: number | null; affects_critical_path: boolean
    break_even_value_per_month: number | null; recommendation: string }[]
  coverage: { totals: Record<string, number>; items: {id: string; label: string; status: string; source: string; explanation: string}[] }[]
  available_admin_savings: number; potential_admin_savings: number; search_evaluations: number; seed: number; draws: number
  feasible_additional_site_assignments: number
  evidence: Record<string, unknown>; registry_context: RegistryContext[]; sources: { id: string; title: string; url: string; scope: string }[]; limitations: string[]
}
export function encodeRequest(request: PortfolioRequest): string {
  return JSON.stringify(request, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Every numeric assumption must be finite.')
    return value
  })
}
async function checked(response: Response) {
  if (response.ok) return response.json()
  let detail = `Portfolio service returned ${response.status}`
  try { const body = await response.json(); detail += `: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)}` } catch { /* retain HTTP status */ }
  throw new Error(detail)
}
export function runPath(id: string): string {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Enter a 32-character saved run ID.')
  return `/api/portfolio-command/runs/${id}`
}
export const portfolioApi = {
  async demo(signal?: AbortSignal): Promise<PortfolioDemo> { return checked(await fetch('/api/portfolio-command/demo', { signal })) },
  async compare(request: PortfolioRequest, signal?: AbortSignal): Promise<PortfolioResult> {
    return checked(await fetch('/api/portfolio-command/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: encodeRequest(request), signal }))
  },
  async load(id: string, signal?: AbortSignal): Promise<PortfolioResult> { return checked(await fetch(runPath(id), { signal })) },
  async validate(request: PortfolioRequest, signal?: AbortSignal): Promise<PortfolioRequest> {
    return checked(await fetch('/api/portfolio-command/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: encodeRequest(request), signal }))
  },
  reportUrl(id: string, format: 'json' | 'html') { return `${runPath(id)}/report/${format}` },
}
