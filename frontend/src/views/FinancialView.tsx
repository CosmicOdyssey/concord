// Sponsor budget: a sponsor-budget worksheet on SYNTHETIC site inputs (docs/financial/CONTRACT.md), in the Calm skin.
// It prices an authored visit schedule, says who pays for each protocol item, and compares five budget scenarios at a
// fixed participant target over a budgeted contract period. Scenarios are listed A to E; none is ranked or preferred.
// There is no time model: the contract period is an input that prices monthly site costs.
// Simple: the synthetic banner, the key inputs, scenarios A to E with feasibility, sponsor commitment and the change
// against A with its cause, the API's payer framing in one line (full sentences in a hover card) and the coverage
// worksheet's per-participant totals. Every other input and the exports stay one "Details" click away.
// Detailed: everything the API returns, in seven sections. Both modes run the same computation and exports.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Banner, Details, ErrorBox, HoverCard, InfoTip, KeyFigure, Loading, PageHead, Qualifier, Section, Segmented, Window } from '../components'
import { useDensity } from '../density'
import {
  commitment,
  COVERAGE_STATUSES,
  financialApi,
  finite,
  NONFINITE_MESSAGE,
  payerFraming,
  pct,
  sameCoverageInputs,
  scenarioChange,
  signedUsd,
  splitWords,
  usd,
  usd2,
  type ChangeCause,
  type CoverageResult,
  type FinanceRequest,
  type FinancialDemo,
  type FinancialResult,
  type FinancialScenario,
  type FinancialSite,
  type PayerFraming,
  type ScenarioChange,
  type ScenarioId,
} from '../financialApi'
import './financial.css'

const SECTIONS = ['Scenarios', 'Sites and network', 'Ledger', 'Budget reallocation', 'Cost sensitivity', 'Coverage worksheet', 'Report'] as const
type SectionName = (typeof SECTIONS)[number]

const PUBLIC_NOTE =
  'The public registry record does not verify this illustrative procedure schedule, the synthetic site network or any financial term. It is not a sponsor-approved protocol budget.'
const TARGET_NOTE = 'The participant target is a demo value, the same in every scenario, and unrelated to the registered trial target.'
const PERIOD_NOTE = 'The budgeted contract period is an input that prices each site’s monthly cost. It is not a forecast.'
const TRANSFER_NOTE =
  'Sponsor-to-hospital, insurer-to-hospital and participant-to-hospital payments are transfers. Consolidated resource cost counts delivery, the supply proxy, administration and access support once; it is not the sum of every party’s spending.'
const PAYER_INPUT_NOTE = 'Payer type, payer share and the commercial-rate assumption change only the insurer and participant lines.'

/** SNAKE_CASE codes from the service, as words: "POTENTIALLY_PAYER_COVERED" -> "Potentially payer covered". */
const words = (code: string) => {
  const s = code.replace(/_/g, ' ').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Everything the parts below read or change; built once per render of FinancialView. */
interface Ctx {
  request: FinanceRequest
  demo: FinancialDemo | null
  result: FinancialResult | null
  /** Worksheet lines for display and responsibility edits. */
  coverage: CoverageResult | undefined
  /** The worksheet amounts match the current inputs (a fresh comparison, or the demo's worksheet for unchanged inputs). */
  coverageCurrent: boolean
  selected: ScenarioId
  select: (id: ScenarioId) => void
  field: <K extends keyof FinanceRequest>(key: K, value: FinanceRequest[K]) => void
  hasOverrides: boolean
  exporting: boolean
  download: (format: 'html' | 'json') => void
  limitations: string[]
  framing: PayerFraming
}

/* ---------------------------------------------------------------- inputs ---------------------------------------------------------------- */

function Numeric({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  disabled,
  note,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  note?: ReactNode
}) {
  return (
    <label className="field fin-field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? NaN : Number(event.target.value))}
        disabled={disabled}
        required
      />
      {note && <span className="fin-field-note">{note}</span>}
    </label>
  )
}

function Check({ checked, onChange, disabled, children }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <label className={`fin-check${disabled ? ' fin-check-off' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="fin-empty">{children}</p>
}

/** The four inputs shown in both modes. */
function KeyInputs({ c }: { c: Ctx }) {
  const r = c.request
  return (
    <div className="fin-inputs">
      <Numeric label="Sponsor budget (USD)" value={r.budget} step={10000} onChange={(v) => c.field('budget', v)} />
      <Numeric label="Participant target (demo value)" value={r.target} min={1} max={1000} onChange={(v) => c.field('target', v)} />
      <Numeric label="Budgeted contract period (months)" value={r.budget_period_months} min={1} max={60} onChange={(v) => c.field('budget_period_months', v)} />
      <Numeric label="Sponsor administration (USD)" value={r.admin_cost} step={1000} onChange={(v) => c.field('admin_cost', v)} />
    </div>
  )
}

/** What B and D change, and the access-support floor. */
function ScenarioInputs({ c }: { c: Ctx }) {
  const r = c.request
  return (
    <>
      <div className="fin-inputs">
        <Numeric
          label="Scenario B: assumed administration cut (fraction)"
          value={r.admin_reduction}
          max={1}
          step={0.05}
          onChange={(v) => c.field('admin_reduction', v)}
        />
        <Numeric
          label="Participant access support, each (USD)"
          value={r.support_per_participant}
          step={50}
          onChange={(v) => c.field('support_per_participant', v)}
        />
        <Numeric label="Access-support floor, each (USD)" value={r.minimum_support} step={50} onChange={(v) => c.field('minimum_support', v)} />
        <Numeric label="Scenario D: added support, each (USD)" value={r.extra_support} step={50} onChange={(v) => c.field('extra_support', v)} />
      </div>
      <p className="fin-text">
        Scenario B’s cut is an input with no modeled source; it is not a measured result. Access support reimburses trial-related travel and lodging.
      </p>
    </>
  )
}

const SITE_NUMBERS: { key: keyof FinancialSite & ('activation_cost' | 'monthly_cost' | 'per_participant_cost' | 'capacity'); label: string; step: number }[] = [
  { key: 'activation_cost', label: 'Activation (USD)', step: 1000 },
  { key: 'monthly_cost', label: 'Monthly cost (USD)', step: 100 },
  { key: 'per_participant_cost', label: 'Site per-participant cost, not itemized (USD)', step: 100 },
  { key: 'capacity', label: 'Stated capacity', step: 1 },
]

function SiteInputs({ c }: { c: Ctx }) {
  const r = c.request
  const setSite = (index: number, patch: Partial<FinancialSite>) =>
    c.field(
      'sites',
      r.sites.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    )
  return (
    <>
      <p className="fin-text">
        Every site is synthetic and every number is an operator input. Activation of an existing site is sunk and left out. The site per-participant cost
        covers only costs the coverage worksheet does not itemize (coordinator time, data entry), so no procedure is counted twice.
      </p>
      <div className="table-scroll">
        <table className="tbl fin-tbl fin-tbl-inputs">
          <caption>Synthetic site network. Existing sites are part of the fixture; the others are candidates.</caption>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Operator-feasible</th>
              {SITE_NUMBERS.map((n) => (
                <th scope="col" key={n.key}>
                  {n.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.sites.map((site, index) => (
              <tr key={site.id}>
                <th scope="row">
                  {site.name}
                  <div className="fin-sub">
                    {site.id} · {site.baseline_active ? 'Existing site' : 'Candidate site'}
                  </div>
                </th>
                <td>
                  <label className="fin-cellcheck">
                    <input type="checkbox" aria-label={`${site.name} operator-feasible`} checked={site.feasible} onChange={(e) => setSite(index, { feasible: e.target.checked })} />
                  </label>
                </td>
                {SITE_NUMBERS.map((n) => (
                  <td key={n.key}>
                    <input
                      type="number"
                      aria-label={`${site.name}: ${n.label}`}
                      min={n.key === 'capacity' ? 1 : 0}
                      step={n.step}
                      value={Number.isFinite(site[n.key]) ? site[n.key] : ''}
                      onChange={(e) => setSite(index, { [n.key]: e.target.value === '' ? NaN : Number(e.target.value) })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function SensitivityInputs({ c }: { c: Ctx }) {
  const r = c.request
  return (
    <div className="fin-inputs">
      <Numeric label="Cost spread (log scale, 0 to 1)" value={r.cost_spread} max={1} step={0.05} onChange={(v) => c.field('cost_spread', v)} />
      <Numeric label="Seed" value={r.seed} onChange={(v) => c.field('seed', v)} />
      <Numeric label="Draws" value={r.draws} min={100} max={1000} step={10} onChange={(v) => c.field('draws', v)} />
    </div>
  )
}

/** Payer and sponsor-pricing inputs, then the worksheet lines with their responsibility selects. */
function CoverageWorksheet({ c }: { c: Ctx }) {
  const r = c.request
  const coverage = c.coverage
  const medicaid = r.payer_kind === 'Medicaid'
  const commercial = r.payer_kind === 'commercial'
  return (
    <>
      <h3 className="fin-h3">Payer inputs</h3>
      <p className="fin-text">{PAYER_INPUT_NOTE} Amounts the worksheet cannot know show as Unknown, never 0.</p>
      <div className="fin-inputs">
        <label className="field fin-field">
          <span className="field-label">Payer type</span>
          <select value={r.payer_kind} onChange={(e) => c.field('payer_kind', e.target.value as FinanceRequest['payer_kind'])}>
            <option value="Medicare">Medicare</option>
            <option value="commercial">Commercial</option>
            <option value="Medicaid">Medicaid</option>
          </select>
        </label>
        <Numeric
          label="Insurer share of the routine benchmark (0 to 1)"
          value={r.payer_fraction}
          max={1}
          step={0.05}
          disabled={medicaid}
          onChange={(v) => c.field('payer_fraction', v)}
          note={medicaid ? 'Not applied for Medicaid: the insurer amount is the benchmark and the participant share is 0.' : undefined}
        />
        <Numeric
          label="Insurer administration per participant (USD)"
          value={r.payer_admin_per_participant}
          step={5}
          onChange={(v) => c.field('payer_admin_per_participant', v)}
        />
        <label className="field fin-field">
          <span className="field-label">Jurisdiction (label)</span>
          <input type="text" value={r.jurisdiction} onChange={(e) => c.field('jurisdiction', e.target.value)} />
        </label>
        <label className="field fin-field">
          <span className="field-label">Plan (label)</span>
          <input type="text" value={r.payer_plan} onChange={(e) => c.field('payer_plan', e.target.value)} />
        </label>
      </div>
      <Check checked={r.commercial_rate_assumption} disabled={!commercial} onChange={(v) => c.field('commercial_rate_assumption', v)}>
        Commercial only: assume the allowed amount equals the Medicare benchmark (unverified, not a negotiated rate). Without it, commercial routine amounts
        are Unknown and stay off the sponsor.
      </Check>
      <h3 className="fin-h3">Sponsor-side pricing</h3>
      <p className="fin-text">
        The sponsor pays research items, and holds contingency, at the benchmark times the negotiated rate below: an explicit stand-in for the rate negotiated
        with each site. Insurer and participant amounts use the benchmark.
      </p>
      <div className="fin-inputs">
        <Numeric
          label="Sponsor-site negotiated rate (x benchmark)"
          value={r.sponsor_rate_multiplier}
          min={0.1}
          max={5}
          step={0.05}
          onChange={(v) => c.field('sponsor_rate_multiplier', v)}
        />
        <Numeric
          label="Investigational-supply reserve per participant (USD)"
          value={r.drug_contingency_per_participant}
          step={100}
          onChange={(v) => c.field('drug_contingency_per_participant', v)}
        />
      </div>
      {coverage && (
        <div className="table-scroll">
          <table className="tbl fin-tbl fin-tbl-coverage">
            <caption>
              {coverage.items.length} protocol items, per participant ({coverage.items[0]?.jurisdiction ?? r.jurisdiction} · {coverage.items[0]?.payer_plan ?? r.payer_plan}).
              Each line is assigned to one party. Edit a responsibility and compare again to update the amounts.
            </caption>
            <thead>
              <tr>
                <th scope="col">Protocol item</th>
                <th scope="col">Benchmark / sponsor rate</th>
                <th scope="col">Responsibility</th>
                <th scope="col">Review</th>
                <th scope="col" className="num">
                  Sponsor
                </th>
                <th scope="col" className="num">
                  Insurer (illustrative)
                </th>
                <th scope="col" className="num">
                  Participant (illustrative)
                </th>
                <th scope="col" className="num">
                  Held as contingency
                </th>
              </tr>
            </thead>
            <tbody>
              {coverage.items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">
                    {item.label}
                    <div className="fin-sub">
                      {item.code ?? 'No code'} · {item.frequency}
                      {item.schedule ? ` · ${item.schedule}` : ''}
                    </div>
                  </th>
                  <td>
                    <span className="num fin-nowrap">
                      {usd2(item.unit_rate)} / {usd2(item.sponsor_unit_rate)}
                    </span>
                    <div className="fin-sub">
                      {words(item.rate_kind)} · {item.source}
                      {item.year ? ` (${item.year})` : ''}
                    </div>
                    <div className="fin-sub">
                      Resource cost {usd2(item.resource_cost_per_participant)} ({words(item.resource_cost_kind)})
                    </div>
                  </td>
                  <td>
                    <select
                      aria-label={`Responsibility for ${item.label}`}
                      value={r.coverage_overrides[item.id] ?? item.status}
                      onChange={(e) => c.field('coverage_overrides', { ...r.coverage_overrides, [item.id]: e.target.value as typeof item.status })}
                    >
                      {COVERAGE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {words(status)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <strong>{words(item.review_status)}</strong>
                    <div className="fin-sub">Coverage determination: {words(item.coverage_determination_status).toLowerCase()}</div>
                    <p className="fin-sub">{item.explanation}</p>
                  </td>
                  {c.coverageCurrent ? (
                    [item.sponsor_per_participant, item.payer_per_participant, item.patient_per_participant, item.reserve_per_participant].map((v, i) => (
                      <td key={i} className="num fin-nowrap">
                        {usd2(v)}
                      </td>
                    ))
                  ) : (
                    <td colSpan={4} className="fin-sub-inline">
                      Compare again for current amounts
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {c.hasOverrides && !c.result && <p role="status">Responsibility edits are pending. Compare again for consistent amounts.</p>}
      {!coverage && <Empty>Compare to load the selected trial’s coverage worksheet.</Empty>}
      {coverage?.warnings.map((w) => (
        <p className="note small" key={w}>
          {w}
        </p>
      ))}
    </>
  )
}

/** Provenance, the two exports and the sources. `full` adds every assumption and limitation (Detailed); in Simple
 *  they sit in hover cards. */
function Report({ c, full }: { c: Ctx; full: boolean }) {
  const result = c.result
  return (
    <>
      <p className="fin-text">
        The exports recompute the same inputs: the budget comparison, budget lines, ledger, cost sensitivity, the coverage worksheet with the payer framing,
        sources and hashes. They are not a saved record of a past run.
      </p>
      {result ? (
        <>
          <dl className="fin-prov">
            <div>
              <dt>Execution mode</dt>
              <dd>
                <code>{result.execution_mode}</code>
              </dd>
            </div>
            <div>
              <dt>Trial context</dt>
              <dd>
                <a href={result.trial.registry_url} target="_blank" rel="noreferrer">
                  {result.trial.id}
                </a>{' '}
                · {result.trial.title}
                <div className="fin-sub">
                  {result.trial.protocol_label} · {result.trial.source_type}
                </div>
              </dd>
            </div>
            <div>
              <dt>Run</dt>
              <dd>
                <code>{result.run_id}</code>
              </dd>
            </div>
            <div>
              <dt>Result SHA-256</dt>
              <dd>
                <code>{result.result_sha256}</code>
              </dd>
            </div>
            <div>
              <dt>Input SHA-256</dt>
              <dd>
                <code>{result.input_sha256}</code>
              </dd>
            </div>
          </dl>
          <div className="fin-actions">
            <button type="button" className="btn" onClick={() => c.download('html')} disabled={c.exporting}>
              Download HTML report
            </button>
            <button type="button" className="btn" onClick={() => c.download('json')} disabled={c.exporting}>
              Download JSON
            </button>
          </div>
          <Details summary="Source and execution evidence">
            <pre className="fin-pre" tabIndex={0} role="region" aria-label="Source and execution evidence (JSON)">
              {JSON.stringify(result.evidence, null, 2)}
            </pre>
          </Details>
          <h3 className="fin-h3">Sources</h3>
          <ul className="fin-list">
            {result.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>{' '}
                — {source.scope} <span className="fin-sub-inline">(checked {source.checked})</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Empty>Compare before exporting. Any edit clears the previous comparison and its exports.</Empty>
      )}
      {full && result && (
        <>
          <h3 className="fin-h3">Assumptions</h3>
          <AssumptionList assumptions={result.assumptions} />
        </>
      )}
      {full && (
        <>
          <h3 className="fin-h3">Limitations</h3>
          <ul className="fin-list">
            {c.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function AssumptionList({ assumptions, keys }: { assumptions: Record<string, string>; keys?: string[] }) {
  const entries = Object.entries(assumptions).filter(([k]) => !keys || keys.includes(k))
  return (
    <ul className="fin-list">
      {entries.map(([key, value]) => (
        <li key={key}>
          <strong>{words(key)}.</strong> {value}
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------- cards (portalled) ------------------------------------------------------------- */

/** The payer framing, verbatim from the API: benchmarks, billing, independence and the no-time sentence. */
function FramingCard({ framing }: { framing: PayerFraming }) {
  const lines = [framing.benchmarks, framing.billing, framing.independence, framing.noTime].filter((x): x is string => !!x)
  return (
    <div className="fin-tip-scroll" tabIndex={0} role="region" aria-label="Payer framing">
      <span className="hc-title">How payer amounts are used</span>
      <ul className="fin-tip-list">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  )
}

function LimitationsCard({ limitations }: { limitations: string[] }) {
  return (
    <div className="fin-tip-scroll" tabIndex={0} role="region" aria-label="Limitations">
      <span className="hc-title">Limitations</span>
      <ul className="fin-tip-list">
        {limitations.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

const SCENARIO_ASSUMPTIONS = ['sponsor_administration', 'contract_period', 'participant_split', 'feasibility', 'active_site_activation', 'site_per_participant_cost', 'access_support']

function AssumptionsCard({ assumptions, keys }: { assumptions: Record<string, string>; keys?: string[] }) {
  const entries = Object.entries(assumptions).filter(([k]) => !keys || keys.includes(k))
  return (
    <div className="fin-tip-scroll" tabIndex={0} role="region" aria-label="Assumptions">
      <span className="hc-title">Assumptions</span>
      <ul className="fin-tip-list">
        {entries.map(([key, value]) => (
          <li key={key}>{value}</li>
        ))}
      </ul>
    </div>
  )
}

/* ---------------------------------------------------------------- results --------------------------------------------------------------- */

function Feasibility({ scenario }: { scenario: FinancialScenario }) {
  if (scenario.plan.feasible) return <span>Feasible under these inputs</span>
  return (
    <>
      <Qualifier>Not feasible</Qualifier>
      {scenario.plan.violations.length > 0 && <span className="fin-viol">: {scenario.plan.violations.join('; ')}.</span>}
    </>
  )
}

function causeText(cause: ChangeCause, ch: ScenarioChange): string {
  switch (cause.key) {
    case 'administration':
      return ch.adminReduction !== null ? `assumed ${pct(ch.adminReduction, 0)} cut in sponsor administration` : 'sponsor administration'
    case 'support':
      return ch.supportIncrease !== null ? `participant access support ${signedUsd(ch.supportIncrease)} each` : 'participant access support'
    case 'sites':
      return 'site costs of a different network'
    case 'procedures':
      return 'procedures and held contingency'
  }
}

/** The change in sponsor commitment against A and its cause, in the API's numbers (budget_reallocation). */
function ChangeVsA({ s, c }: { s: FinancialScenario; c: Ctx }) {
  const r = c.result
  if (!r) return null
  const reference = r.scenarios.find((x) => x.id === r.comparison.reference_scenario_id)
  const ch = scenarioChange(s, reference, r.request)
  const several = ch.causes.length > 1
  const parts = ch.causes.map((cause) => `${causeText(cause, ch)}${several ? ` (${signedUsd(cause.amount)})` : ''}`)
  if (ch.noSitesAdded) parts.push('no sites added, because the existing network’s stated capacity covers the target')
  const added = ch.addedSites
    ? `Adds ${ch.addedSites.ids.join(', ')}: site costs ${usd(ch.addedSites.cost.site_total)} for ${ch.addedSites.cost.participants} participants.`
    : null
  switch (ch.kind) {
    case 'reference':
      return <span className="fin-chg">Reference: B to E are compared with A.</span>
    case 'not_costed':
      return <span className="fin-chg">No change to state: not costed.</span>
    case 'reference_not_costed':
      return (
        <span className="fin-chg">
          No change against A to state: A is not costed.{added && ` ${added}`}
        </span>
      )
    case 'change':
      return (
        <span className="fin-chg">
          <strong className="num">{signedUsd(ch.incremental)}</strong> against A{parts.length ? `: ${parts.join('; ')}.` : ': the same budget lines as A.'}
          {added && ` ${added}`}
        </span>
      )
  }
}

/** Simple: A to E as a list. Each row: feasibility, sponsor commitment (with its share of the budget) and the change
 *  against A with its cause. The scenario name opens its definition. Not selectable, not ranked. */
function ScenarioList({ c }: { c: Ctx }) {
  if (!c.result) return null
  return (
    <ul className="fin-scen" aria-label="Scenarios A to E">
      {c.result.scenarios.map((s) => {
        const share = s.plan.budget_utilization
        return (
          <li key={s.id} className="fin-scen-row">
            <span className="fin-scen-name">
              <HoverCard content={s.definition}>
                {s.id}. {s.label}
              </HoverCard>
            </span>
            <span className="fin-scen-amt num">{commitment(s.plan)}</span>
            <div className="fin-scen-feas">
              <Feasibility scenario={s} />
            </div>
            {finite(share) && (
              <span className="fin-scen-share">
                <span className="fin-meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(Math.max(share, 0), 1) * 100}%` }} />
                </span>
                <span>{pct(share)} of budget</span>
              </span>
            )}
            <div className="fin-scen-chg">
              <ChangeVsA s={s} c={c} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function ScenarioName({ s, c }: { s: FinancialScenario; c: Ctx }) {
  return (
    <button type="button" className="fin-pick" onClick={() => c.select(s.id)} aria-pressed={s.id === c.selected}>
      {s.id}. {s.label}
    </button>
  )
}

/** Detailed: A to E with every plan figure. A row's name selects the scenario the per-scenario sections show. */
function ScenarioTable({ c }: { c: Ctx }) {
  if (!c.result) return null
  return (
    <div className="table-scroll">
      <table className="tbl fin-tbl fin-tbl-scen">
        <caption>Scenarios A to E: sponsor commitment includes held contingency. Select a name to show that scenario in the other sections.</caption>
        <thead>
          <tr>
            <th scope="col">Scenario</th>
            <th scope="col">Feasibility</th>
            <th scope="col" className="num">
              Sponsor commitment
            </th>
            <th scope="col">Change against A</th>
            <th scope="col" className="num">
              Sites
            </th>
            <th scope="col" className="num">
              Stated capacity
            </th>
            <th scope="col" className="num">
              Per participant
            </th>
            <th scope="col" className="num">
              Share of budget
            </th>
            <th scope="col" className="num">
              Unspent budget
            </th>
          </tr>
        </thead>
        <tbody>
          {c.result.scenarios.map((s) => (
            <tr key={s.id} className={s.id === c.selected ? 'row-on' : undefined}>
              <th scope="row">
                <ScenarioName s={s} c={c} />
                <p className="fin-sub">{s.definition}</p>
              </th>
              <td className="fin-cell-feas">
                <Feasibility scenario={s} />
              </td>
              <td className="num">{commitment(s.plan)}</td>
              <td className="fin-cell-wide">
                <ChangeVsA s={s} c={c} />
              </td>
              <td className="num">{s.plan.selected_ids.length}</td>
              <td className="num">{s.plan.stated_capacity}</td>
              <td className="num">{s.plan.costed ? usd(s.plan.cost_per_participant) : '—'}</td>
              <td className="num">{s.plan.costed ? pct(s.plan.budget_utilization) : '—'}</td>
              <td className="num">{s.plan.costed ? usd(s.plan.unspent_budget) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const LINES = [
  ['activation', 'Activation (added sites)'],
  ['operating', 'Operating (monthly x period)'],
  ['site_variable', 'Site per-participant'],
  ['procedures', 'Procedures and contingency'],
  ['support', 'Access support'],
  ['administration', 'Administration'],
] as const

function BudgetLinesTable({ c }: { c: Ctx }) {
  if (!c.result) return null
  return (
    <div className="table-scroll">
      <table className="tbl fin-tbl">
        <caption>Budget lines by scenario (sponsor commitment = their sum).</caption>
        <thead>
          <tr>
            <th scope="col">Scenario</th>
            {LINES.map(([k, label]) => (
              <th scope="col" className="num" key={k}>
                {label}
              </th>
            ))}
            <th scope="col" className="num">
              Sponsor commitment
            </th>
          </tr>
        </thead>
        <tbody>
          {c.result.scenarios.map((s) => (
            <tr key={s.id} className={s.id === c.selected ? 'row-on' : undefined}>
              <th scope="row">
                {s.id}. {s.label}
              </th>
              {LINES.map(([k]) => (
                <td className="num" key={k}>
                  {s.plan.breakdown ? usd(s.plan.breakdown[k]) : '—'}
                </td>
              ))}
              <td className="num">{commitment(s.plan)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Detailed: which scenario the per-scenario parts show. */
function ScenarioPicker({ c }: { c: Ctx }) {
  if (!c.result) return null
  const s = c.result.scenarios.find((x) => x.id === c.selected)
  return (
    <div className="fin-picker">
      <span className="fin-picker-label">Scenario shown</span>
      <Segmented
        label="Scenario shown"
        options={c.result.scenarios.map((x) => ({ value: x.id, label: x.id, hint: x.label }))}
        value={c.selected}
        onChange={c.select}
        className="fin-picker-seg"
      />
      {s && <span className="fin-picker-name">{s.label}</span>}
    </div>
  )
}

function selectedOf(c: Ctx): FinancialScenario | null {
  return c.result?.scenarios.find((s) => s.id === c.selected) ?? null
}

function NotCosted({ s }: { s: FinancialScenario }) {
  return (
    <Empty>
      {s.id}. {s.label} is not costed: {s.plan.violations[0] ?? 'stated capacity of the selected sites is below the participant target'}. No price is
      invented for it.
    </Empty>
  )
}

function SiteRowsTable({ s }: { s: FinancialScenario }) {
  return (
    <div className="table-scroll">
      <table className="tbl fin-tbl">
        <caption>
          {s.id}. {s.label}: sponsor funds by site
        </caption>
        <thead>
          <tr>
            <th scope="col">Site</th>
            {['Participants', 'Stated capacity', 'Activation', 'Operating', 'Site per-participant', 'Procedures and contingency', 'Access support', 'Total'].map(
              (h) => (
                <th scope="col" className="num" key={h}>
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {s.plan.site_rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                {row.name}
                <div className="fin-sub">{row.id}</div>
              </th>
              <td className="num">{row.participants}</td>
              <td className="num">{row.capacity}</td>
              <td className="num">{row.activation_sunk ? <span className="fin-sub-inline">Sunk</span> : usd(row.activation)}</td>
              {[row.operating, row.variable, row.procedure, row.support, row.total].map((v, i) => (
                <td className="num" key={i}>
                  {usd(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NetworkBlock({ s }: { s: FinancialScenario }) {
  const ns = s.plan.network_search
  const re = s.budget_reallocation
  return (
    <div className="fin-panel">
      <h3>Network</h3>
      <p>
        Sites: {s.plan.selected_ids.join(', ')} · stated capacity {s.plan.stated_capacity}.{' '}
        {s.inputs.network_rule === 'existing_network' ? 'The existing network, as entered.' : 'Chosen by the capacity rule below.'}
      </p>
      {splitWords(s.plan.participant_split) && <p>{splitWords(s.plan.participant_split)}</p>}
      {ns && (
        <>
          <p>{ns.rule}</p>
          {ns.base_has_capacity ? (
            <p>
              {s.id} adds no sites: the existing network’s stated capacity covers the target. Existing network: {ns.base_ids.join(', ')}.
            </p>
          ) : (
            <p>
              The existing network ({ns.base_ids.join(', ')}) lacks stated capacity. Networks evaluated: <span className="num">{ns.candidate_networks_evaluated}</span>;
              with enough capacity: <span className="num">{ns.capacity_sufficient_networks}</span>.
            </p>
          )}
        </>
      )}
      {re && re.additional_sites.length > 0 && (
        <p>
          Added sites {re.additional_sites.join(', ')} ({re.additional_activations} activation{re.additional_activations === 1 ? '' : 's'}): activation{' '}
          {usd(re.added_sites_cost.activation)}, operating {usd(re.added_sites_cost.operating)}, site per-participant {usd(re.added_sites_cost.site_variable)}
          ; site costs {usd(re.added_sites_cost.site_total)} for {re.added_sites_cost.participants} participants.
        </p>
      )}
    </div>
  )
}

/** Detailed: one party card. */
function Party({ title, value, children }: { title: string; value: ReactNode; children: ReactNode }) {
  return (
    <article>
      <h3>{title}</h3>
      {value !== null && <strong className="fin-card-value">{value}</strong>}
      {children}
    </article>
  )
}

/** Detailed: the selected scenario's four parties, transfers and resource costs. Participant cost sharing and
 *  sponsor access support are two separate values, never netted. */
function PartyLedger({ s, c }: { s: FinancialScenario; c: Ctx }) {
  const e = s.economics
  if (!e) return <NotCosted s={s} />
  return (
    <>
      <div className="fin-cards">
        <Party title="Sponsor commitment" value={usd(e.sponsor.budget_commitment)}>
          <p>
            Spending {usd(e.sponsor.expenditure)} · held as contingency {usd(e.sponsor.contingency_reserve)}
          </p>
          <p>
            Investigational-supply resource proxy {usd(e.sponsor.supply_resource_proxy)}: a sponsor-side resource (the sponsor supplies the product), not a
            hospital cost.
          </p>
        </Party>
        <Party title="Hospital operating contribution" value={usd(e.hospital.net_contribution)}>
          <p>
            Revenue {usd(e.hospital.revenue)} · resource cost {usd(e.hospital.resource_cost)} (excludes the investigational supply)
          </p>
        </Party>
        <Party title="Insurer payments and administration" value={usd(e.insurer.total)}>
          <p>
            Payments {usd(e.insurer.payments)} · administration {usd(e.insurer.administration)}
          </p>
          <p>Downstream clinical cost: Unknown</p>
        </Party>
        <Party title="Participant" value={null}>
          <dl className="fin-split">
            <div>
              <dt>Participant routine cost sharing (illustrative)</dt>
              <dd className="num">{usd(e.patient.cost_sharing)}</dd>
            </div>
            <div>
              <dt>Sponsor access support</dt>
              <dd className="num">{usd(e.patient.access_support)}</dd>
            </div>
          </dl>
          <p>Shown separately, never netted. Unresolved exposure: Unknown.</p>
        </Party>
      </div>
      {c.result?.assumptions.access_support && <p className="fin-text">{c.result.assumptions.access_support}</p>}
      <div className="table-scroll">
        <table className="tbl fin-tbl fin-tbl-narrow">
          <caption>
            Transfers in {s.id}. {s.label}
          </caption>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col" className="num">
                Payment
              </th>
            </tr>
          </thead>
          <tbody>
            {e.transfers.map((t, i) => (
              <tr key={i}>
                <td>{t.from}</td>
                <td>{t.to}</td>
                <td className="num">{usd(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fin-text">
        Transfers balance to <span className="num">{usd(e.transfer_balance)}</span> (Unknown amounts are left out, not set to 0). Consolidated resource cost{' '}
        <strong className="num">{usd(e.consolidated_resource_cost)}</strong>.
      </p>
      <ul className="fin-list">
        {e.resource_assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </>
  )
}

/** Detailed: every scenario's ledger in one table (the report's columns), then the change against A by party. */
function LedgerTables({ c }: { c: Ctx }) {
  if (!c.result) return null
  const cols: [string, (s: FinancialScenario) => number | null | undefined][] = [
    ['Sponsor spending', (s) => s.economics?.sponsor.expenditure],
    ['Held contingency', (s) => s.economics?.sponsor.contingency_reserve],
    ['Supply resource proxy (sponsor-side)', (s) => s.economics?.sponsor.supply_resource_proxy],
    ['Hospital contribution', (s) => s.economics?.hospital.net_contribution],
    ['Insurer payments and administration', (s) => s.economics?.insurer.total],
    ['Participant routine cost sharing (illustrative)', (s) => s.economics?.patient.cost_sharing],
    ['Sponsor access support', (s) => s.economics?.patient.access_support],
    ['Consolidated resource cost', (s) => s.economics?.consolidated_resource_cost],
  ]
  const deltas: [string, keyof NonNullable<FinancialScenario['delta']>][] = [
    ['Sponsor spending', 'sponsor_expenditure'],
    ['Resource cost', 'resources'],
    ['Hospital contribution', 'hospital_contribution'],
    ['Insurer', 'insurer_expenditure'],
    ['Participant routine cost sharing', 'patient_cost_sharing'],
    ['Sponsor access support', 'access_support'],
  ]
  return (
    <>
      <div className="table-scroll">
        <table className="tbl fin-tbl fin-tbl-ledger">
          <caption>Ledger by scenario. Participant cost sharing and sponsor access support are separate columns, never netted.</caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              {cols.map(([label]) => (
                <th scope="col" className="num" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.result.scenarios.map((s) => (
              <tr key={s.id} className={s.id === c.selected ? 'row-on' : undefined}>
                <th scope="row">
                  {s.id}. {s.label}
                </th>
                {cols.map(([label, get]) => (
                  <td className="num" key={label}>
                    {s.economics ? usd(get(s)) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-scroll">
        <table className="tbl fin-tbl">
          <caption>Change against A by party (Unknown where an insurer or participant amount is unknown; blank where a scenario or A is not costed).</caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              {deltas.map(([label]) => (
                <th scope="col" className="num" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.result.scenarios.map((s) => (
              <tr key={s.id}>
                <th scope="row">
                  {s.id}. {s.label}
                </th>
                {deltas.map(([label, key]) => (
                  <td className="num" key={label}>
                    {s.delta ? signedUsd(s.delta[key]) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Detailed: budget reallocation, cost only. */
function ReallocationTables({ c }: { c: Ctx }) {
  if (!c.result) return null
  return (
    <>
      <div className="table-scroll">
        <table className="tbl fin-tbl">
          <caption>Sites added beyond the existing network, and their own site costs (stated even when A is not costed).</caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Added sites</th>
              {['Activation', 'Operating', 'Site per-participant', 'Site costs', 'Participants placed'].map((h) => (
                <th scope="col" className="num" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.result.scenarios.map((s) => {
              const re = s.budget_reallocation
              const a = re?.added_sites_cost
              return (
                <tr key={s.id}>
                  <th scope="row">
                    {s.id}. {s.label}
                  </th>
                  <td>{re ? re.additional_sites.join(', ') || 'None' : 'Not costed'}</td>
                  {a ? (
                    <>
                      <td className="num">{usd(a.activation)}</td>
                      <td className="num">{usd(a.operating)}</td>
                      <td className="num">{usd(a.site_variable)}</td>
                      <td className="num">{usd(a.site_total)}</td>
                      <td className="num">{a.participants}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="num">
                      —
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="table-scroll">
        <table className="tbl fin-tbl">
          <caption>Budget line changes against A, and the total change in sponsor commitment.</caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              {LINES.map(([k, label]) => (
                <th scope="col" className="num" key={k}>
                  {label}
                </th>
              ))}
              <th scope="col" className="num">
                Commitment change
              </th>
            </tr>
          </thead>
          <tbody>
            {c.result.scenarios.map((s) => {
              const lc = s.budget_reallocation?.line_changes
              return (
                <tr key={s.id}>
                  <th scope="row">
                    {s.id}. {s.label}
                  </th>
                  {LINES.map(([k]) => (
                    <td className="num" key={k}>
                      {lc ? signedUsd(lc[k]) : '—'}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{lc ? signedUsd(s.budget_reallocation?.incremental_cost) : '—'}</strong>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function SensitivityTable({ c }: { c: Ctx }) {
  if (!c.result) return null
  const first = c.result.scenarios.find((s) => s.sensitivity)?.sensitivity
  return (
    <>
      <div className="table-scroll">
        <table className="tbl fin-tbl">
          <caption>Sponsor commitment under varied site cost inputs (10th, 50th and 90th percentiles of the draws), and the share of draws over budget.</caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              {['10th percentile', 'Median', '90th percentile', 'Share of draws over budget'].map((h) => (
                <th scope="col" className="num" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.result.scenarios.map((s) => {
              const q = s.sensitivity
              return (
                <tr key={s.id}>
                  <th scope="row">
                    {s.id}. {s.label}
                  </th>
                  {q ? (
                    <>
                      {q.sponsor_total_quantiles.map((v, i) => (
                        <td className="num" key={i}>
                          {usd(v)}
                        </td>
                      ))}
                      <td className="num">{pct(q.probability_budget_exceeded)}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="num">
                      Not costed
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {first && (
        <div className="fin-panel">
          <h3>Method</h3>
          <p>{first.method}.</p>
          <p>
            Varied inputs: {first.varied_inputs.join('; ')}. Seed <span className="num">{first.seed}</span>, <span className="num">{first.draws}</span> draws, cost
            spread <span className="num">{first.cost_spread}</span>. Calibration: {words(first.calibration_status).toLowerCase()}; these are not calibrated
            intervals.
          </p>
        </div>
      )}
    </>
  )
}

/** The coverage worksheet's totals per participant: sponsor, insurer, participant and held contingency. */
function CoverageTotals({ c, resource }: { c: Ctx; resource?: boolean }) {
  const t = c.coverage?.totals
  const show = (v: number | null | undefined) => (c.coverageCurrent && t ? usd2(v) : 'Compare to update')
  return (
    <div className="fin-totals">
      <KeyFigure label="Sponsor pays" value={show(t?.sponsor)} sub="Research items, at the sponsor-site rate" />
      <KeyFigure label="Insurer (illustrative)" value={show(t?.payer)} sub="Routine care billed under coverage rules" />
      <KeyFigure label="Participant cost sharing (illustrative)" value={show(t?.patient)} sub="Routine care, the participant’s share" />
      <KeyFigure label="Held as sponsor contingency" value={show(t?.reserve)} sub="Unknown, conditional or review-required lines" />
      {resource && <KeyFigure label="Resource cost (assumed)" value={show(t?.resource)} sub="Delivery cost assumption, not a payment" />}
    </div>
  )
}

function payerLine(r: FinanceRequest): string {
  if (r.payer_kind === 'Medicaid') return 'Payer: Medicaid; insurer amount at the benchmark, no participant share.'
  if (r.payer_kind === 'commercial')
    return r.commercial_rate_assumption
      ? `Payer: commercial, allowed amount assumed equal to the Medicare benchmark; insurer share ${pct(r.payer_fraction, 0)}.`
      : 'Payer: commercial, allowed amounts unknown (no rate assumption).'
  return `Payer: Medicare; insurer share ${pct(r.payer_fraction, 0)} of the benchmark.`
}

/* ----------------------------------------------------------------- view ----------------------------------------------------------------- */

export default function FinancialView() {
  const { density } = useDensity()
  const simple = density === 'simple'
  const [demo, setDemo] = useState<FinancialDemo | null>(null)
  const [request, setRequest] = useState<FinanceRequest | null>(null)
  const [result, setResult] = useState<FinancialResult | null>(null)
  const [selected, setSelected] = useState<ScenarioId>('A')
  const [section, setSection] = useState<SectionName>('Scenarios')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  const pending = useRef({ controller: null as AbortController | null, revision: 0 })

  useEffect(() => {
    const lifecycle = pending.current
    const controller = new AbortController()
    financialApi
      .demo(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDemo(data)
          setRequest(data.request)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
      lifecycle.controller?.abort()
      lifecycle.revision++
    }
  }, [attempt])

  function retryDemo() {
    setError(null)
    setLoading(true)
    setAttempt((n) => n + 1)
  }

  function change(next: FinanceRequest) {
    pending.current.revision++
    pending.current.controller?.abort()
    pending.current.controller = null
    setRequest(next)
    setResult(null)
    setError(null)
    setLoading(false)
    setExporting(false)
    setNotice('Inputs changed. The previous comparison and its exports are cleared; compare again.')
  }
  function field<K extends keyof FinanceRequest>(key: K, value: FinanceRequest[K]) {
    if (request) change({ ...request, [key]: value })
  }
  async function compare() {
    if (!request) return
    pending.current.controller?.abort()
    const controller = new AbortController(),
      revision = ++pending.current.revision
    pending.current.controller = controller
    setLoading(true)
    setError(null)
    setResult(null)
    setNotice('')
    try {
      const output = await financialApi.compare(request, controller.signal)
      if (pending.current.revision !== revision || controller.signal.aborted) return
      if (!output.scenarios?.length || !output.input_sha256) throw new Error('The financial service returned an incomplete comparison.')
      setResult(output)
      setSelected(output.comparison?.reference_scenario_id ?? output.scenarios[0].id)
      setNotice('Comparison computed from these inputs. Every figure rests on synthetic inputs.')
    } catch (e) {
      if (!controller.signal.aborted && pending.current.revision === revision) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (pending.current.revision === revision) {
        setLoading(false)
        pending.current.controller = null
      }
    }
  }
  async function download(format: 'html' | 'json') {
    if (!result || !request) return
    const revision = pending.current.revision,
      controller = new AbortController()
    pending.current.controller?.abort()
    pending.current.controller = controller
    setExporting(true)
    setError(null)
    try {
      const blob = await financialApi.report(result.request, format, controller.signal)
      if (revision !== pending.current.revision || controller.signal.aborted) return
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `concord-sponsor-budget-${result.run_id}.${format}`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(`${format.toUpperCase()} report downloaded for input ${result.input_sha256.slice(0, 12)}.`)
    } catch (e) {
      if (!controller.signal.aborted && revision === pending.current.revision) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (revision === pending.current.revision) {
        setExporting(false)
        pending.current.controller = null
      }
    }
  }

  const limitations = result?.limitations ?? demo?.limitations ?? []
  const framing = payerFraming(limitations, result?.assumptions)

  const banner = (
    <Banner title="Synthetic worksheet.">
      Every site, cost, capacity and payer share here is a synthetic input, not a registered site fact or a negotiated price, and no insurer takes part.
      Coverage classifications need human review. The public trial identifier gives context only.
      {limitations.length > 0 && (
        <>
          {' '}
          <HoverCard content={<LimitationsCard limitations={limitations} />}>All {limitations.length} limitations</HoverCard>
        </>
      )}
    </Banner>
  )

  const errorBox =
    error &&
    (error === NONFINITE_MESSAGE ? (
      <div className="error" role="alert">
        <strong>Check the inputs.</strong> <span>{error}</span>
      </div>
    ) : (
      <div className="fin-error">
        <ErrorBox error={error} onRetry={request ? undefined : retryDemo} />
        {!request && <p className="small">The financial service or its demo inputs are unavailable. Check the backend, then try again.</p>}
      </div>
    ))

  const head = (
    <PageHead
      title="Sponsor budget"
      lede="A sponsor-budget worksheet on synthetic site inputs: who pays for each protocol item, and what changes the sponsor’s commitment."
      meta="Synthetic worksheet"
    />
  )

  if (!request)
    return (
      <div className="view financial">
        {head}
        {banner}
        {errorBox}
        {loading ? <Loading label="Loading the worksheet…" /> : !error && <p role="status">Worksheet not loaded.</p>}
      </div>
    )

  const sameTrial = !result && demo !== null && request.trial_id === demo.request.trial_id
  const coverage = result?.coverage ?? (sameTrial ? demo?.coverage : undefined)
  const coverageCurrent = !!result || (demo !== null && sameCoverageInputs(request, demo.request))
  const hasOverrides = Object.keys(request.coverage_overrides).length > 0

  const c: Ctx = {
    request,
    demo,
    result,
    coverage,
    coverageCurrent,
    selected,
    select: setSelected,
    field,
    hasOverrides,
    exporting,
    download,
    limitations,
    framing,
  }

  const setup = (
    <Window label="Worksheet inputs" className="fin-setup">
      <div className="fin-setup-top">
        <label className="field fin-trial">
          <span className="field-label">Public trial context</span>
          <select value={request.trial_id} onChange={(e) => change({ ...request, trial_id: e.target.value, coverage_overrides: {} })}>
            {demo?.trials.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} · {t.title}
              </option>
            ))}
          </select>
        </label>
        <p className="fin-registry">
          <a href={`https://clinicaltrials.gov/study/${request.trial_id}`} target="_blank" rel="noreferrer">
            Public registry record ↗
          </a>
          <InfoTip label="About the public record" content={PUBLIC_NOTE} />
        </p>
      </div>
      <KeyInputs c={c} />
      <p className="fin-hint">
        {TARGET_NOTE} {PERIOD_NOTE}
      </p>
      <div className="fin-run">
        <button type="button" className="btn btn-primary" onClick={compare} disabled={loading || exporting}>
          {loading ? 'Computing…' : 'Compare budget scenarios'}
        </button>
        <p className="fin-status" role="status" aria-live="polite">
          {notice || 'Review the inputs, then compare.'}
        </p>
      </div>
    </Window>
  )

  const framingTrigger = (framing.benchmarks || framing.billing || framing.independence || framing.noTime) && (
    <HoverCard content={<FramingCard framing={framing} />}>How payer amounts are used</HoverCard>
  )

  return (
    <div className="view financial">
      {head}
      {banner}
      {errorBox}
      {setup}
      {simple ? (
        <>
          <Section
            title="Budget scenarios"
            lede={result ? result.comparison.basis : 'Compare to price five budget scenarios, A to E, at the same participant target, budget and contract period.'}
            qualifiers={
              result && (
                <p className="fin-quals">
                  {result.comparison.ordering} <Qualifier>Synthetic inputs</Qualifier>
                </p>
              )
            }
            info={result ? <AssumptionsCard assumptions={result.assumptions} keys={SCENARIO_ASSUMPTIONS} /> : undefined}
          >
            {result ? <ScenarioList c={c} /> : null}
            {result && <p className="fin-caption">Sponsor commitment includes held contingency. Bar: share of the sponsor budget. Hover a name for its definition.</p>}
          </Section>
          <Section
            title="Who pays, per participant"
            lede={
              <>
                {framing.benchmarks} {framingTrigger}
              </>
            }
            qualifiers={
              <p className="fin-quals">
                {payerLine(request)}
                {coverage && coverageCurrent && coverage.insurer_amounts_unknown > 0 && (
                  <>
                    {' '}
                    <Qualifier>
                      {coverage.insurer_amounts_unknown} routine line{coverage.insurer_amounts_unknown === 1 ? '' : 's'}: insurer amount unknown
                    </Qualifier>
                  </>
                )}
              </p>
            }
            figure={coverage ? <CoverageTotals c={c} /> : <Empty>Compare to load the selected trial’s coverage worksheet.</Empty>}
            caption={
              coverage
                ? `From the coverage worksheet: ${coverage.items.length} protocol items for ${request.trial_id}, per participant${hasOverrides ? `, with ${Object.keys(request.coverage_overrides).length} responsibility edit${Object.keys(request.coverage_overrides).length === 1 ? '' : 's'}` : ''}.`
                : undefined
            }
          />
          <Section
            title="Other inputs, the worksheet and the report"
            lede="Scenario, site, coverage and sensitivity inputs, and the exports. Any edit clears the comparison until you compare again."
          >
            <div className="fin-more">
              <Details summary="Scenario inputs">
                <ScenarioInputs c={c} />
              </Details>
              <Details summary={`Synthetic sites (${request.sites.length})`}>
                <SiteInputs c={c} />
              </Details>
              <Details summary={coverage ? `Coverage worksheet (${coverage.items.length} protocol items)` : 'Coverage worksheet'}>
                <CoverageWorksheet c={c} />
              </Details>
              <Details summary="Cost sensitivity inputs">
                <SensitivityInputs c={c} />
                <p className="fin-text">The commitment ranges these inputs give are in the Detailed view, under Cost sensitivity.</p>
              </Details>
              <Details summary="Report and exports">
                <Report c={c} full={false} />
              </Details>
            </div>
          </Section>
        </>
      ) : (
        <>
          <nav className="fin-nav" aria-label="Worksheet sections">
            {SECTIONS.map((s) => (
              <button type="button" key={s} onClick={() => setSection(s)} aria-current={s === section ? 'page' : undefined}>
                {s}
              </button>
            ))}
          </nav>
          <DetailedSection name={section} c={c} />
        </>
      )}
    </div>
  )
}

function DetailedSection({ name, c }: { name: SectionName; c: Ctx }) {
  const result = c.result
  const s = selectedOf(c)
  const none = <Empty>No current comparison. Review the inputs and select “Compare budget scenarios”.</Empty>
  let body: ReactNode = null
  switch (name) {
    case 'Scenarios':
      body = (
        <>
          <ScenarioInputs c={c} />
          {result ? (
            <>
              <p className="fin-text">
                {result.comparison.basis} {result.comparison.ordering}
              </p>
              <ScenarioTable c={c} />
              <BudgetLinesTable c={c} />
            </>
          ) : (
            none
          )}
        </>
      )
      break
    case 'Sites and network':
      body = (
        <>
          <SiteInputs c={c} />
          {result && s ? (
            <>
              <ScenarioPicker c={c} />
              {s.plan.costed ? <SiteRowsTable s={s} /> : <NotCosted s={s} />}
              <NetworkBlock s={s} />
              <h3 className="fin-h3">Plan assumptions</h3>
              <ul className="fin-list">
                {s.plan.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </>
          ) : (
            none
          )}
        </>
      )
      break
    case 'Ledger':
      body = result ? (
        <>
          <p className="fin-text">{TRANSFER_NOTE}</p>
          <LedgerTables c={c} />
          {s && (
            <>
              <ScenarioPicker c={c} />
              <PartyLedger s={s} c={c} />
            </>
          )}
        </>
      ) : (
        none
      )
      break
    case 'Budget reallocation':
      body = result ? (
        <>
          <p className="fin-text">
            Cost only: the sites each scenario adds beyond the existing network and what they cost, then each budget line’s change against A. When A is not
            costed there is no change against A to state, and the added sites’ own costs still are.
          </p>
          <ReallocationTables c={c} />
        </>
      ) : (
        none
      )
      break
    case 'Cost sensitivity':
      body = (
        <>
          <SensitivityInputs c={c} />
          {result ? <SensitivityTable c={c} /> : none}
        </>
      )
      break
    case 'Coverage worksheet':
      body = (
        <>
          <div className="fin-panel">
            <h3>How payer amounts are used</h3>
            {[c.framing.benchmarks, c.framing.billing, c.framing.independence, c.framing.noTime]
              .filter((x): x is string => !!x)
              .map((l) => (
                <p key={l}>{l}</p>
              ))}
          </div>
          <p className="fin-quals">{payerLine(c.request)}</p>
          {c.coverage && <CoverageTotals c={c} resource />}
          {c.coverage && c.coverageCurrent && (
            <p className="fin-text">
              Routine lines with an unknown insurer amount: <span className="num">{c.coverage.insurer_amounts_unknown}</span>.
            </p>
          )}
          <CoverageWorksheet c={c} />
        </>
      )
      break
    case 'Report':
      body = <Report c={c} full />
      break
  }
  return (
    <section className="win fin-section" aria-label={name}>
      <div className="win-body fin-stack">
        <h2 className="fin-h2">{name}</h2>
        {body}
      </div>
    </section>
  )
}
