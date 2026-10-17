# Financial API contract (branch `financial-reframe`, 17 Oct 2026)

For the frontend pass that moves `frontend/src/financialApi.ts` and `FinancialView.tsx` onto the reworked backend. Why it changed: decisions.md #24 (the product owner's ruling that payer amounts are benchmarks for fair-value reasoning and site negotiation, not a lever that lowers sponsor cost or speeds a trial; the app-wide rule that no view shows a predicted speedup, time-to-fill or enrollment rate).

Endpoints are unchanged: `GET /api/financial/demo`, `POST /api/financial/compare`, `POST /api/financial/report?format=json|html`. The request model still forbids unknown fields, so **posting any removed field is a 422**.

## 1. Removed and renamed

### Request

| Old | New | Notes |
|---|---|---|
| `horizon_months` | `budget_period_months` | Same bounds (0 < x <= 60, default 24). Now the **budgeted contract period**: each selected site's monthly cost is multiplied by it. An input, not a forecast. Suggested label: "Budgeted contract period (months)". |
| `rate_spread` | `cost_spread` | Same bounds (0 to 1, default 0.25). Log spread on site **cost** inputs, not recruitment rates. |
| `rate_multiplier` | `sponsor_rate_multiplier` | Same bounds (0.1 to 5, default 1). Now applies **only** to what the sponsor pays or holds (research items and contingency). Insurer and participant amounts use the benchmark. Suggested label: "Sponsor-site negotiated rate (x benchmark)". |
| `no_loser` | removed | No duration constraint exists. |
| `sites[].rate` | removed | No recruitment rates. |
| `sites[].activation_lag_months` | removed | No activation timing. |

### Response

| Old | New | Notes |
|---|---|---|
| `recommended_scenario_id` | removed | Nothing is recommended. Use `comparison.reference_scenario_id` ("A") for the initially selected scenario if one is needed. |
| `scenarios[].plan.modeled_months`, `core_modeled_months`, `site_completion_months` | removed | |
| `scenarios[].plan.projected_capacity` | `scenarios[].plan.stated_capacity` | Sum of the selected sites' stated capacity (was horizon x rate). |
| `scenarios[].plan.evaluated_subsets`, `feasible_subsets`, `required_ids`, `nominal_max_months`, `selection_rule` | `scenarios[].plan.network_search` (C and E only; `null` for A, B, D) | See section 3. |
| `scenarios[].plan.site_rows[].rate`, `projected_capacity` | `site_rows[].capacity` | |
| `scenarios[].reinvestment` (`incremental_ongoing_cost`, `modeled_time_change`) | `scenarios[].budget_reallocation` | Cost only. See section 3. |
| `scenarios[].sensitivity.modeled_months_quantiles`, `probability_horizon_exceeded` | removed | |
| `assumptions.sponsor_pilot` | `assumptions.sponsor_administration` | |
| violation "Insufficient deliverable participant capacity within the horizon" | "Stated capacity of the selected sites is below the participant target" | |
| violation "Sponsor total exceeds budget" | "Sponsor commitment exceeds budget" | |
| violations "Nominal modeled duration exceeds the horizon", "Timing exceeds the existing core model's supported range", "Nominal no-loser timing bound exceeded", "Every selected site must receive at least one participant", "Every selected site must have positive rate and horizon capacity" | removed | |

### New fields

`scenarios[].definition`, `scenarios[].inputs`, `scenarios[].plan.costed`, `scenarios[].plan.network_search`, `scenarios[].budget_reallocation`, `scenarios[].sensitivity.cost_spread`, `scenarios[].sensitivity.varied_inputs`, `comparison`, `coverage.insurer_amounts_unknown`, `coverage.items[].sponsor_unit_rate`, `coverage.items[].insurer_amount_known`, `assumptions.contract_period`, `assumptions.participant_split`, `assumptions.feasibility`, `assumptions.fee_benchmarks`, `assumptions.payer_benchmarks`, `assumptions.payer_billing`, `assumptions.payer_independence`.

### Values that can now be `null`

- `coverage.totals.payer`, `coverage.totals.patient`, `coverage.items[].payer_per_participant`, `coverage.items[].patient_per_participant`: `null` = UNKNOWN (commercial plan without `commercial_rate_assumption`). Show "Unknown", never 0.
- `economics.insurer.payments`, `economics.insurer.total`, `economics.patient.cost_sharing`, `economics.patient.net_cash_exposure`, `economics.hospital.revenue`, `economics.hospital.net_contribution`, `economics.transfers[].amount`, and the matching `delta.*`: `null` for the same reason.
- `plan.sponsor_total`, `breakdown`, `cost_per_participant`, `budget_utilization`, `unspent_budget`: `null` when `plan.costed` is false (stated capacity below the target).
- `budget_reallocation.line_changes`, `budget_reallocation.incremental_cost`: `null` when A is not costed.

## 2. Request (`FinanceRequest`)

`GET /api/financial/demo` returns the default request under `request`; the view should start from it and post it back edited.

| Field | Type | Default | Bounds | Meaning |
|---|---|---|---|---|
| `trial_id` | `"NCT05800015" \| "NCT06627647"` | NCT05800015 | | Authored illustrative protocol to price. |
| `budget` | number | 1,500,000 | > 0, <= 1e9 | Sponsor budget, USD. |
| `target` | integer | 60 | 1 to 1000 | Fixed participant target, the same in every scenario. Demo value, not the registered enrollment. |
| `budget_period_months` | number | 24 | > 0, <= 60 | Budgeted contract period (input). |
| `admin_cost` | number | 120,000 | 0 to 1e8 | Sponsor administration, USD. |
| `admin_reduction` | number | 0.25 | 0 to 1 | Scenario B's assumed cut in administration (assumption, not measured savings). |
| `support_per_participant` | number | 500 | 0 to 100,000 | Participant access support, USD each. Must be >= `minimum_support` (422 otherwise). |
| `minimum_support` | number | 200 | 0 to 100,000 | Access-support floor. |
| `extra_support` | number | 300 | 0 to 100,000 | Scenario D's added support per participant. |
| `seed` | integer | 7 | 0 to 2^32-1 | Sensitivity seed. |
| `draws` | integer | 256 | 100 to 1000 | Sensitivity draws. |
| `cost_spread` | number | 0.25 | 0 to 1 | Log spread of the cost multipliers. 0 collapses the ranges to the nominal commitment. |
| `payer_kind` | `"Medicare" \| "commercial" \| "Medicaid"` | Medicare | | Changes only insurer/participant lines. |
| `jurisdiction` | string | "MA" | 2 to 80 chars | Label carried on coverage lines. |
| `payer_plan` | string | "UNVERIFIED DEMO" | 1 to 120 chars | Label carried on coverage lines. |
| `payer_fraction` | number | 0.8 | 0 to 1 | Insurer share of the routine-care benchmark; remainder is participant cost sharing. Changes only insurer/participant lines. |
| `commercial_rate_assumption` | boolean | false | | Commercial only: assume the allowed amount equals the Medicare benchmark. Without it, commercial routine amounts are UNKNOWN. |
| `sponsor_rate_multiplier` | number | 1 | 0.1 to 5 | Negotiated research-item rate as a multiple of the benchmark (FMV input). |
| `payer_admin_per_participant` | number | 30 | 0 to 10,000 | Insurer administration resource cost per participant. |
| `drug_contingency_per_participant` | number | 2,500 | 0 to 1e7 | Investigational-supply reserve per participant. |
| `coverage_overrides` | `{[nodeId]: CoverageStatus}` | {} | <= 200 | Operator responsibility edits. Research items cannot be set to payer/patient (422). `drug-contingency` may be SPONSOR/UNKNOWN/REVIEW_REQUIRED/CONDITIONAL only. Unknown ids are 422. |
| `sites` | `Site[]` | 4 synthetic sites | 1 to 8, unique ids, >= 1 baseline-active | |

`Site`: `id` (`^[A-Za-z0-9_-]{1,40}$`), `name` (1 to 120 chars), `baseline_active` (bool, default false), `feasible` (bool, default true; operator flag), `activation_cost` (0 to 1e7, default 30,000; sunk and excluded when baseline-active), `monthly_cost` (0 to 1e6, default 1,000), `per_participant_cost` (0 to 1e6, default 2,000), `capacity` (integer 1 to 10,000, default 60; stated capacity, an input). Nothing else.

`CoverageStatus`: `SPONSOR`, `POTENTIALLY_PAYER_COVERED`, `POTENTIALLY_PATIENT_COST_SHARING`, `CONDITIONAL`, `UNKNOWN`, `REVIEW_REQUIRED` (unchanged).

Default fixture: SYN-A and SYN-B baseline-active (capacity 60 each; SYN-B monthly 1,200); SYN-C (activation 35,000, monthly 1,600, per participant 2,400) and SYN-D (50,000, 2,200, 2,800) not active. Baseline stated capacity 120 covers the target 60, so **C equals A and E equals B + D by default**; lower SYN-A/SYN-B capacity below 60 combined to see C add SYN-C.

## 3. `POST /api/financial/compare` response

```ts
interface FinancialResult {
  request: FinanceRequest                       // validated echo
  input_sha256: string; run_id: string          // run_id = input_sha256[:24]
  result_sha256: string
  execution_mode: 'synthetic_financial_demo'
  trial: { id: string; title: string; protocol_label: string; registry_url: string; source_type: string }
  coverage: CoverageResult
  scenarios: Scenario[]                          // always 5, ids A..E in that order
  comparison: { reference_scenario_id: 'A'; ordering: string; basis: string }
  evidence: Record<string, unknown>              // commit, dirty, hashes, cache policy (unchanged)
  sources: { id: string; url: string; title: string; kind: string; checked: string; scope: string }[]
  assumptions: Record<string, string>            // keys listed below
  limitations: string[]                          // render all; includes the payer and no-time sentences
}
```

`assumptions` keys: `active_site_activation`, `sponsor_administration`, `contract_period`, `participant_split`, `feasibility`, `hospital_payment`, `fee_benchmarks`, `payer_benchmarks`, `payer_billing`, `payer_independence`, `trial_target`, `resource_costs`.

### Coverage

```ts
interface CoverageResult {
  items: CoverageItem[]
  totals: { sponsor: number; payer: number | null; patient: number | null; reserve: number; resource: number }  // per participant
  insurer_amounts_unknown: number   // count of routine lines whose insurer amount is UNKNOWN
  warnings: string[]                // [review warning, payer-kind note, payer-independence sentence]
}
interface CoverageItem {
  id: string; label: string; code: string | null; trial_id: string; protocol_reference: string
  quantity: 1; frequency: string; schedule: string | null
  unit_rate: number            // fee-schedule BENCHMARK (Medicare / standard schedule / $75 placeholder)
  sponsor_unit_rate: number    // benchmark x sponsor_rate_multiplier: what the sponsor pays or holds if responsible
  rate_kind: 'verified_fee_schedule_benchmark' | 'hypothetical_rate' | 'synthetic_contingency'
  source: string; year: number
  status: CoverageStatus; coverage_determination_status: 'NOT_DETERMINED' | 'UNKNOWN'
  review_status: 'REVIEW_REQUIRED' | 'operator_interpretation'; explanation: string
  sponsor_per_participant: number
  payer_per_participant: number | null     // null = UNKNOWN
  patient_per_participant: number | null   // null = UNKNOWN
  reserve_per_participant: number
  insurer_amount_known: boolean
  resource_cost_per_participant: number; resource_cost_kind: string
  jurisdiction: string; payer_plan: string
}
```

Line rules: `SPONSOR` -> sponsor = `sponsor_unit_rate`. `UNKNOWN`/`CONDITIONAL`/`REVIEW_REQUIRED` -> reserve = `sponsor_unit_rate`. `POTENTIALLY_PAYER_COVERED` -> payer + patient = `unit_rate` split by `payer_fraction`, or both `null` for commercial without the assumption; sponsor and reserve are 0. `POTENTIALLY_PATIENT_COST_SHARING` -> patient = `unit_rate`.

### Scenario

```ts
interface Scenario {
  id: 'A' | 'B' | 'C' | 'D' | 'E'
  label: string          // "Existing site network" | "Lower sponsor administrative cost" |
                         // "Site network with enough stated capacity" | "Expanded participant access support" | "B + C + D combined"
  definition: string     // one-sentence plain description of what differs from A; show it
  inputs: { network_rule: 'existing_network' | 'capacity_rule'; admin_cost: number; support_per_participant: number }
  plan: Plan
  economics: Economics | null            // null when plan.costed is false
  delta: Delta | null                    // vs A; null when this scenario or A is not costed
  sensitivity: Sensitivity | null        // null when plan.costed is false
  budget_reallocation: BudgetReallocation | null   // null when plan.costed is false
}
interface Plan {
  feasible: boolean      // stated capacity >= target AND commitment <= budget AND all selected sites operator-feasible AND support >= floor
  costed: boolean        // false only when stated capacity < target (no price is invented)
  violations: string[]   // reasons feasible is false
  selected_ids: string[] // sorted
  site_rows: { id: string; name: string; participants: number; capacity: number
               activation: number; activation_sunk: boolean; operating: number
               variable: number; procedure: number; support: number; total: number }[]
  sponsor_total: number | null           // the sponsor commitment, including held contingency
  breakdown: { activation: number; operating: number; site_variable: number
               procedures: number; support: number; administration: number } | null
  stated_capacity: number
  cost_per_participant: number | null; budget_utilization: number | null
  unspent_budget: number | null          // negative when over budget
  assumptions: string[]
  network_search: null | {               // C and E only
    rule: string; base_ids: string[]; base_has_capacity: boolean
    candidate_networks_evaluated: number; capacity_sufficient_networks: number }
}
interface BudgetReallocation {
  additional_sites: string[]             // sites beyond the existing (baseline-active) network
  additional_activations: number
  line_changes: { activation: number; operating: number; site_variable: number
                  procedures: number; support: number; administration: number } | null   // vs A
  incremental_cost: number | null        // commitment change vs A
}
interface Economics {   // unchanged shape; some values may be null (see section 1)
  sponsor: { expenditure: number; contingency_reserve: number; budget_commitment: number }
  hospital: { revenue: number | null; resource_cost: number; net_contribution: number | null }
  insurer: { payments: number | null; administration: number; total: number | null; downstream_clinical_cost: null }
  patient: { cost_sharing: number | null; access_support: number; net_cash_exposure: number | null; unresolved_exposure: null }
  transfers: { from: string; to: string; amount: number | null }[]
  party_transfer_balances: Record<'Sponsor' | 'Hospital' | 'Insurer' | 'Participant', number>
  transfer_balance: number              // 0; UNKNOWN amounts are left out, not set to 0
  consolidated_resource_cost: number
  resource_assumptions: string[]
}
interface Delta { sponsor_expenditure: number | null; resources: number | null
  hospital_contribution: number | null; insurer_expenditure: number | null; patient_exposure: number | null }
interface Sensitivity {
  sponsor_total_quantiles: [number, number, number]   // q10, q50, q90
  probability_budget_exceeded: number                  // share of draws over budget
  seed: number; draws: number; cost_spread: number
  varied_inputs: string[]; method: string; calibration_status: 'not_established'
}
```

Scenario semantics: A = baseline-active sites, entered admin and support. B = A with `admin_cost x (1 - admin_reduction)`. C = A's network if its stated capacity covers the target, else the lowest-commitment network of A's sites plus operator-feasible extras that covers it. D = A with `support_per_participant + extra_support`. E = B's admin, C's rule, D's support. Participants are split in proportion to stated capacity. Operating = monthly cost x `budget_period_months`.

## 4. Other endpoints

- `GET /api/financial/demo` -> `{ request: FinanceRequest; trials: {id, title}[]; coverage: CoverageResult; limitations: string[] }` (shape unchanged; contents follow the new request and coverage).
- `POST /api/financial/report?format=json` -> exactly the compare result, as an attachment. `format=html` -> a standalone escaped HTML report (budget comparison, budget lines, ledger, cost sensitivity, coverage worksheet with the payer framing, sources, hashes, full JSON).

## 5. UI rules that follow from the ruling

- Show no months, durations, "faster"/"slower", time-to-fill, enrollment or recruitment rates, and no "recommended"/"best"/"fastest" badge. List A to E; select A (or nothing) initially.
- Label `budget_period_months` as an input ("Budgeted contract period"), never a forecast.
- Rename "Reinvestment Lab" to something cost-only (e.g. "Budget reallocation"); show `budget_reallocation.line_changes` and `incremental_cost`.
- Wherever payer type, payer share or the commercial assumption is edited, say that it changes only the insurer and participant lines; render `null` insurer/participant amounts as "Unknown".
- When `plan.network_search.base_has_capacity` is true, say C adds no sites because the existing network's stated capacity covers the target.
- Render `limitations` (it carries the payer-benchmark, billing, independence and no-time sentences).
- Current view breakpoints: `FinancialView.tsx` line 16 (`plan.projected_capacity`, `plan.modeled_months` column), line 57 (`recommended_scenario_id`), line 92 (`horizon_months` input), line 94 (`rate_multiplier`), line 96 (`no_loser` checkbox; per-site rate and lag columns), lines 92/100 (`rate_spread`), and the Reinvestment Lab section; `financialApi.ts` types `FinancialSite`, `FinanceRequest`, `FinancialScenario`, `FinancialResult`.
