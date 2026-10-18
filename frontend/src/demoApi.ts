import type { PortfolioDemo, PortfolioResult, PortfolioScenario, PortfolioRequest } from './portfolioCommandApi'
import { SAVED_DEMO_SHA256 } from './demoSavedDigest.ts'

export type DemoPlan = Pick<PortfolioScenario, 'id' | 'label' | 'feasible' | 'violations' | 'selected_edges' | 'ledger' | 'expected_makespan' | 'interval' | 'censored_draws' | 'sites'> & { trials: { id: string; expected_months: number }[] }
export interface DemoBundle extends PortfolioDemo {
  baseline: DemoPlan; fixture_sha256: string; baseline_compute_ms: number
  data_mode: string; historical_predictive_performance: string; scope: string
}
export interface DemoRun { result: PortfolioResult; compute_ms: number; computed_at: string; delivery_mode: 'LIVE_COMPUTATION' | 'SAVED_RESULT_REPLAY'; fixture_sha256: string }
export const SCENES = ['The problem', 'The baseline', 'Run Concord', 'Compare outcomes', 'Money & evidence', 'What this proves'] as const
export function nextScene(scene: number, hasResult: boolean): number {
  return scene === 0 ? 1 : scene === 1 ? (hasResult ? 3 : 1) : scene === 3 ? 4 : scene === 4 ? 5 : scene
}
export function previousScene(scene: number): number { return scene === 3 ? 1 : Math.max(0, scene - 1) }
export function metrics(plan: DemoPlan, request: PortfolioRequest) {
  const activated = request.sites.filter(s => plan.selected_edges.some(j => request.edges[j].site === s.id)).length
  return { activated, assignments: plan.selected_edges.length, budgetFraction: plan.ledger.budget_commitment / request.budget,
    capacityFeasible: plan.sites.every(s => s.capacity !== null && s.peak_rate <= s.capacity + 1e-8 && s.reserved_slots <= request.sites.find(x => x.id === s.id)!.slots) }
}
export function proposal(result: PortfolioResult): PortfolioScenario {
  // Show the actual recommendation, including stable tie-breaking, never cherry-pick a prettier row.
  const chosen = result.scenarios.find(s => s.id === result.recommended_scenario_id)
  if (!chosen || !chosen.feasible || !['OPTIMAL', 'FEASIBLE_HEURISTIC'].includes(chosen.optimization?.status ?? '')) throw new Error('No verified feasible optimized recommendation. Inspect the evidence; do not claim success.')
  return chosen
}
async function checked(response: Response) {
  if (!response.ok) throw new Error(`Local demo service returned ${response.status}. Reset or explicitly open the saved rehearsal; no result has been substituted.`)
  return response.json()
}
export const demoApi = {
  async baseline(signal: AbortSignal): Promise<DemoBundle> { return checked(await fetch('/api/hackharvard-demo', { signal })) },
  async optimize(signal: AbortSignal): Promise<DemoRun> {
    return checked(await fetch('/api/hackharvard-demo/optimize', { method: 'POST', signal }))
  },
  async saved(signal: AbortSignal): Promise<{ bundle: DemoBundle; run: DemoRun }> {
    const response = await fetch('/demo/saved-result.json', { signal })
    if (!response.ok) throw new Error('Saved rehearsal is unavailable.')
    const raw = await response.text()
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].map(x => x.toString(16).padStart(2, '0')).join('')
    if (hash !== SAVED_DEMO_SHA256) throw new Error('Saved rehearsal checksum mismatch. Refusing altered evidence.')
    const saved = JSON.parse(raw)
    saved.run.delivery_mode = 'SAVED_RESULT_REPLAY'
    proposal(saved.run.result)
    return saved
  },
}
