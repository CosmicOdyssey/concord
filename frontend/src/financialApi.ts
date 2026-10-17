// Sponsor-budget worksheet API (docs/financial/CONTRACT.md, revision 2). A synthetic budget comparison at a fixed
// participant target over a budgeted contract period. There is no time model: no durations, rates or rankings.
// The request model forbids unknown fields, so a removed field posted back is a 422.

export const COVERAGE_STATUSES = ['SPONSOR', 'POTENTIALLY_PAYER_COVERED', 'POTENTIALLY_PATIENT_COST_SHARING', 'CONDITIONAL', 'UNKNOWN', 'REVIEW_REQUIRED'] as const
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number]
/** What research items and the investigational-supply reserve may be: never billed to an insurer or participant. */
export const SPONSOR_SIDE_STATUSES = ['SPONSOR', 'CONDITIONAL', 'UNKNOWN', 'REVIEW_REQUIRED'] as const satisfies readonly CoverageStatus[]
export type PayerKind = 'Medicare' | 'commercial' | 'Medicaid'
export type ScenarioId = 'A' | 'B' | 'C' | 'D' | 'E'

/** One synthetic site. Every number is an operator input. */
export interface FinancialSite {
  id: string
  name: string
  baseline_active: boolean
  feasible: boolean
  /** Sunk and excluded when the site is baseline-active. */
  activation_cost: number
  /** Multiplied by the budgeted contract period. */
  monthly_cost: number
  /** Site costs not itemized in the coverage worksheet (coordinator time, data entry). */
  per_participant_cost: number
  /** Stated capacity, an input. */
  capacity: number
}

export interface FinanceRequest {
  trial_id: string
  budget: number
  target: number
  /** The budgeted contract period: an input that prices monthly site costs, not a forecast. */
  budget_period_months: number
  admin_cost: number
  admin_reduction: number
  support_per_participant: number
  minimum_support: number
  extra_support: number
  seed: number
  draws: number
  cost_spread: number
  payer_kind: PayerKind
  jurisdiction: string
  payer_plan: string
  payer_fraction: number
  commercial_rate_assumption: boolean
  sponsor_rate_multiplier: number
  payer_admin_per_participant: number
  drug_contingency_per_participant: number
  coverage_overrides: Record<string, CoverageStatus>
  sites: FinancialSite[]
}

export interface CoverageItem {
  id: string
  label: string
  code: string | null
  trial_id: string
  protocol_reference: string
  quantity: number
  frequency: string
  schedule: string | null
  /** Fee-schedule benchmark. */
  unit_rate: number
  /** Benchmark x sponsor_rate_multiplier: what the sponsor pays or holds when responsible. */
  sponsor_unit_rate: number
  rate_kind: 'verified_fee_schedule_benchmark' | 'hypothetical_rate' | 'synthetic_contingency' | string
  source: string
  year: number
  status: CoverageStatus
  coverage_determination_status: string
  review_status: string
  explanation: string
  sponsor_per_participant: number
  /** null = UNKNOWN (commercial plan without the commercial-rate assumption). */
  payer_per_participant: number | null
  patient_per_participant: number | null
  reserve_per_participant: number
  insurer_amount_known: boolean
  /** The statuses the API accepts for this line: SPONSOR_SIDE_STATUSES for research items and the supply reserve,
   *  all six for routine care. Missing from an older API. */
  allowed_statuses?: CoverageStatus[]
  resource_cost_per_participant: number
  resource_cost_kind: string
  jurisdiction: string
  payer_plan: string
}

export interface CoverageTotals {
  sponsor: number
  payer: number | null
  patient: number | null
  reserve: number
  resource: number
}

export interface CoverageResult {
  items: CoverageItem[]
  /** Per participant. */
  totals: CoverageTotals
  insurer_amounts_unknown: number
  warnings: string[]
}

export interface BudgetLines {
  activation: number
  operating: number
  site_variable: number
  procedures: number
  support: number
  administration: number
}

export interface SiteRow {
  id: string
  name: string
  participants: number
  capacity: number
  activation: number
  activation_sunk: boolean
  operating: number
  variable: number
  procedure: number
  support: number
  total: number
}

export interface NetworkSearch {
  rule: string
  base_ids: string[]
  base_has_capacity: boolean
  candidate_networks_evaluated: number
  capacity_sufficient_networks: number
}

export type ParticipantSplit = 'proportional_to_stated_capacity' | 'existing_sites_at_stated_capacity_then_added_sites_by_capacity'

export interface Plan {
  feasible: boolean
  /** False only when stated capacity is below the target: no price is invented. */
  costed: boolean
  violations: string[]
  selected_ids: string[]
  participant_split: ParticipantSplit | null
  site_rows: SiteRow[]
  /** The sponsor commitment, including held contingency. */
  sponsor_total: number | null
  breakdown: BudgetLines | null
  stated_capacity: number
  cost_per_participant: number | null
  budget_utilization: number | null
  /** Negative when over budget. */
  unspent_budget: number | null
  assumptions: string[]
  /** C and E only. */
  network_search: NetworkSearch | null
}

export interface AddedSitesCost {
  activation: number
  operating: number
  site_variable: number
  site_total: number
  participants: number
}

export interface BudgetReallocation {
  additional_sites: string[]
  additional_activations: number
  added_sites_cost: AddedSitesCost
  /** vs A; null when A is not costed. */
  line_changes: BudgetLines | null
  incremental_cost: number | null
}

export interface Economics {
  sponsor: { expenditure: number; contingency_reserve: number; budget_commitment: number; supply_resource_proxy: number }
  /** Excludes the investigational supply, which is the sponsor's supply_resource_proxy. */
  hospital: { revenue: number | null; resource_cost: number; net_contribution: number | null }
  insurer: { payments: number | null; administration: number; total: number | null; downstream_clinical_cost: null }
  /** Routine cost sharing and access support are separate amounts, never netted. */
  patient: { cost_sharing: number | null; access_support: number; unresolved_exposure: null }
  transfers: { from: string; to: string; amount: number | null }[]
  party_transfer_balances: Record<string, number>
  transfer_balance: number
  consolidated_resource_cost: number
  resource_assumptions: string[]
}

export interface Delta {
  sponsor_expenditure: number | null
  resources: number | null
  hospital_contribution: number | null
  insurer_expenditure: number | null
  patient_cost_sharing: number | null
  access_support: number | null
}

export interface Sensitivity {
  /** q10, q50, q90 of the sponsor commitment. */
  sponsor_total_quantiles: [number, number, number]
  /** Share of draws over budget. */
  probability_budget_exceeded: number
  seed: number
  draws: number
  cost_spread: number
  varied_inputs: string[]
  method: string
  calibration_status: string
}

export interface FinancialScenario {
  id: ScenarioId
  label: string
  definition: string
  inputs: { network_rule: 'existing_network' | 'capacity_rule'; admin_cost: number; support_per_participant: number }
  plan: Plan
  economics: Economics | null
  delta: Delta | null
  sensitivity: Sensitivity | null
  budget_reallocation: BudgetReallocation | null
}

export interface FinancialSource {
  id: string
  url: string
  title: string
  kind: string
  checked: string
  scope: string
}

export interface FinancialDemo {
  request: FinanceRequest
  trials: { id: string; title: string }[]
  coverage: CoverageResult
  limitations: string[]
}

export interface FinancialResult {
  request: FinanceRequest
  input_sha256: string
  run_id: string
  result_sha256: string
  execution_mode: 'synthetic_financial_demo'
  trial: { id: string; title: string; protocol_label: string; registry_url: string; source_type: string }
  coverage: CoverageResult
  /** Always five, A to E in that order. Listed, not ranked. */
  scenarios: FinancialScenario[]
  comparison: { reference_scenario_id: ScenarioId; ordering: string; basis: string }
  evidence: Record<string, unknown>
  sources: FinancialSource[]
  assumptions: Record<string, string>
  limitations: string[]
}

/* ------------------------------------------------------------------ formatting ------------------------------------------------------------------ */

export const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)

/** Whole US dollars; negative values take the minus sign; null (an UNKNOWN insurer or participant amount) is "Unknown",
 *  never 0. */
export const usd = (value: number | null | undefined): string =>
  finite(value) ? `${value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}` : 'Unknown'

/** Dollars and cents, for per-participant worksheet amounts. */
export const usd2 = (value: number | null | undefined): string =>
  finite(value)
    ? `${value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Unknown'

/** A change: "+$18,000", "−$30,000", "$0". */
export const signedUsd = (value: number | null | undefined): string =>
  finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${usd(Math.abs(value))}` : 'Unknown'

export const pct = (value: number | null | undefined, digits = 1): string => (finite(value) ? `${(value * 100).toFixed(digits)}%` : 'Unknown')

/** A plan's sponsor commitment: "Not costed" when stated capacity is below the target (no price is invented). */
export const commitment = (plan: Plan): string => (plan.costed ? usd(plan.sponsor_total) : 'Not costed')

/* ----------------------------------------------------------- the API's payer framing ----------------------------------------------------------- */

/** The payer framing sentences, verbatim from the API (financial.py PAYER_BENCHMARKS, PAYER_BILLING,
 *  PAYER_INDEPENDENCE and NO_TIME_MODEL). Taken from a comparison's assumptions when there is one, else picked out of
 *  the limitations (which carry all four). A sentence the API does not send is null, and the view leaves it out
 *  rather than writing its own. */
export interface PayerFraming {
  benchmarks: string | null
  billing: string | null
  independence: string | null
  noTime: string | null
}

const FRAMING_STARTS: Record<keyof PayerFraming, RegExp> = {
  benchmarks: /^Medicare and insurer amounts for routine care are benchmarks/,
  billing: /^Whether an item may be billed to an insurer/,
  independence: /^In this worksheet, payer type/,
  noTime: /^Nothing here models/,
}

export function payerFraming(limitations: readonly string[], assumptions?: Record<string, string> | null): PayerFraming {
  const pick = (key: keyof PayerFraming) => limitations.find((l) => FRAMING_STARTS[key].test(l)) ?? null
  return {
    benchmarks: assumptions?.payer_benchmarks ?? pick('benchmarks'),
    billing: assumptions?.payer_billing ?? pick('billing'),
    independence: assumptions?.payer_independence ?? pick('independence'),
    noTime: pick('noTime'),
  }
}

/** The first sentence of an API sentence group, verbatim (up to the first ". " before a capital letter). */
export function firstSentence(text: string | null): string | null {
  if (!text) return null
  const m = text.match(/^.*?\.(?=\s+[A-Z])/)
  return m ? m[0] : text
}

/* ------------------------------------------------------------ responsibility options ------------------------------------------------------------ */

/** What kind of line this is, for the responsibility select: a research item or the investigational-supply reserve
 *  (sponsor side only), or routine care. Read from allowed_statuses; for an older API without it, an unedited
 *  authored SPONSOR line is a research item. */
export function lineKind(item: CoverageItem): 'supply' | 'research' | 'routine' {
  if (item.id === 'drug-contingency') return 'supply'
  if (item.allowed_statuses) return item.allowed_statuses.includes('POTENTIALLY_PAYER_COVERED') ? 'routine' : 'research'
  return item.status === 'SPONSOR' && item.review_status !== 'operator_interpretation' ? 'research' : 'routine'
}

/** The statuses offered for a line: research items and the supply reserve get only the sponsor-side four. Under
 *  Medicaid, participant cost sharing is offered but disabled (42 CFR 447.15); a line already holding it still shows it. */
export function responsibilityOptions(item: CoverageItem, payer: PayerKind): { status: CoverageStatus; disabled: boolean }[] {
  const base: readonly CoverageStatus[] = item.allowed_statuses ?? (lineKind(item) === 'routine' ? COVERAGE_STATUSES : SPONSOR_SIDE_STATUSES)
  return base.map((status) => ({ status, disabled: payer === 'Medicaid' && status === 'POTENTIALLY_PATIENT_COST_SHARING' }))
}

/** Lines the request puts on the participant in full. */
export function participantAssigned(request: FinanceRequest): number {
  return Object.values(request.coverage_overrides).filter((s) => s === 'POTENTIALLY_PATIENT_COST_SHARING').length
}

/* -------------------------------------------------------------- coverage currency -------------------------------------------------------------- */

/** The request fields the coverage worksheet depends on. */
export const COVERAGE_INPUTS = [
  'trial_id',
  'payer_kind',
  'jurisdiction',
  'payer_plan',
  'payer_fraction',
  'commercial_rate_assumption',
  'sponsor_rate_multiplier',
  'payer_admin_per_participant',
  'drug_contingency_per_participant',
  'coverage_overrides',
] as const satisfies readonly (keyof FinanceRequest)[]

/** True when two requests give the same coverage worksheet, so the demo's worksheet amounts still hold before a
 *  comparison is computed. */
export function sameCoverageInputs(a: FinanceRequest, b: FinanceRequest): boolean {
  return COVERAGE_INPUTS.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]))
}

/* ------------------------------------------------------------ change against A ------------------------------------------------------------ */

/** One budget line that moved against the reference scenario, in the API's own numbers. */
export interface ChangeCause {
  key: 'administration' | 'support' | 'sites' | 'procedures'
  amount: number
}

/** How a scenario's sponsor commitment differs from the reference scenario (A), and why. Read from
 *  budget_reallocation (cost only): line_changes name the cause, incremental_cost is the total. */
export interface ScenarioChange {
  /** reference: this is A. not_costed: this scenario has no price. reference_not_costed: A has no price, so there is
   *  no change to state (added_sites_cost still says what added sites cost). change: incremental is set. */
  kind: 'reference' | 'not_costed' | 'reference_not_costed' | 'change'
  incremental: number | null
  causes: ChangeCause[]
  addedSites: { ids: string[]; cost: AddedSitesCost } | null
  /** C or E kept the existing network because its stated capacity covers the target. */
  noSitesAdded: boolean
  /** Scenario B's administration cut and D's added support, from the echoed request and the scenario inputs. */
  adminReduction: number | null
  supportIncrease: number | null
}

export function scenarioChange(s: FinancialScenario, reference: FinancialScenario | undefined, request: FinanceRequest): ScenarioChange {
  const re = s.budget_reallocation
  const added = re && re.additional_sites.length > 0 ? { ids: re.additional_sites, cost: re.added_sites_cost } : null
  const noSitesAdded = !!s.plan.network_search?.base_has_capacity
  const base = {
    causes: [] as ChangeCause[],
    addedSites: added,
    noSitesAdded,
    adminReduction: reference && s.inputs.admin_cost !== reference.inputs.admin_cost ? request.admin_reduction : null,
    supportIncrease: reference && s.inputs.support_per_participant !== reference.inputs.support_per_participant ? s.inputs.support_per_participant - reference.inputs.support_per_participant : null,
  }
  if (reference && s.id === reference.id) return { ...base, kind: 'reference', incremental: null }
  if (!s.plan.costed || !re) return { ...base, kind: 'not_costed', incremental: null }
  if (re.line_changes === null || re.incremental_cost === null) return { ...base, kind: 'reference_not_costed', incremental: null }
  const lc = re.line_changes
  const causes: ChangeCause[] = []
  const round = (v: number) => Math.round(v * 100) / 100
  const push = (key: ChangeCause['key'], amount: number) => {
    if (Math.abs(amount) >= 0.005) causes.push({ key, amount: round(amount) })
  }
  push('administration', lc.administration)
  push('support', lc.support)
  push('sites', lc.activation + lc.operating + lc.site_variable)
  push('procedures', lc.procedures)
  return { ...base, kind: 'change', incremental: re.incremental_cost, causes }
}

/** The participant split rule in plain words. */
export function splitWords(split: ParticipantSplit | null): string | null {
  if (split === 'proportional_to_stated_capacity') return 'Participants are split across the selected sites in proportion to stated capacity.'
  if (split === 'existing_sites_at_stated_capacity_then_added_sites_by_capacity')
    return 'Existing sites take participants up to their stated capacity; only the shortfall is split across the added sites by capacity.'
  return null
}

/* ------------------------------------------------------------------ requests ------------------------------------------------------------------ */

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response
  let detail = `Financial service returned ${response.status}`
  try {
    const body = await response.json()
    detail += `: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)}`
  } catch {
    /* HTTP status remains useful */
  }
  throw new Error(detail)
}

/** Thrown before any request when an input is empty or not finite; the view shows it as an input problem, not a
 *  failed request. */
export const NONFINITE_MESSAGE = 'Every numeric assumption needs a finite value.'

function body(request: FinanceRequest): string {
  // JSON.stringify silently turns NaN/Infinity into null; reject those before sending or exporting.
  return JSON.stringify(request, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(NONFINITE_MESSAGE)
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
    return (
      await checked(await fetch(`/api/financial/report?format=${format}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(request), signal }))
    ).blob()
  },
}
