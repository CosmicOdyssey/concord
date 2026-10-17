// Financial Coordination: a teammate's SYNTHETIC planning exercise (budgets, site resources, coverage and
// reinvestment at a fixed enrollment target), in the Calm skin.
// Simple: the synthetic banner, the key inputs, each scenario's feasibility and sponsor commitment, and the selected
// scenario's party ledger; assumptions and limitations sit in hover cards, and every other input and the exports
// stay one "Details" click away. Modeled months and time changes appear only in Detailed.
// Detailed: the six sections as the teammate built them. Both modes run the same computation and exports.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Banner, Details, ErrorBox, HoverCard, InfoTip, KeyFigure, Loading, PageHead, Qualifier, Section, Window } from '../components'
import { useDensity } from '../density'
import {
  COVERAGE_STATUSES,
  financialApi,
  NONFINITE_MESSAGE,
  type CoverageResult,
  type FinanceRequest,
  type FinancialDemo,
  type FinancialResult,
  type FinancialScenario,
} from '../financialApi'
import './financial.css'

const SECTIONS = ['Overview', 'Allocation Comparison', 'Three-Party Economics', 'Reinvestment Lab', 'Coverage Review', 'Evidence Report'] as const
type SectionName = (typeof SECTIONS)[number]

const PUBLIC_NOTE =
  'The public record does not verify this illustrative procedure schedule, synthetic site network, or financial terms. Original Concord research and protocol-to-terms views remain available in the top navigation.'
const TARGET_NOTE =
  'Actual protocol expansion requires clinical, statistical, ethics, and regulatory review. Modeled capacity is not a prediction of observed enrollment.'
const TRANSFER_NOTE =
  'Sponsor-to-hospital and payer-to-hospital payments are transfers. Consolidated resource costs count delivery and administration once. They are not the sum of every party’s expenditure.'
const NO_PROMISE = 'No promise that every party benefits; a transfer reduction does not establish a resource saving.'

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)
// Negative values take the minus sign (copy deck conventions).
const amount = (value: number | null | undefined) =>
  finite(value) ? `${value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}` : 'Unknown'
const number = (value: number | null | undefined, digits = 1) => (finite(value) ? value.toFixed(digits) : 'Unknown')
const pct = (value: number | null | undefined) => (finite(value) ? `${(value * 100).toFixed(1)}%` : 'Unknown')
const signed = (value: number | null | undefined) => (finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${amount(Math.abs(value))}` : 'Unknown')
/** SNAKE_CASE codes from the service, as words: "POTENTIALLY_PAYER_COVERED" -> "Potentially payer covered". */
const words = (code: string) => {
  const s = code.replace(/_/g, ' ').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Everything the parts below read or change; built once per render of FinancialView. */
interface Ctx {
  request: FinanceRequest
  result: FinancialResult | null
  coverage: CoverageResult | undefined
  selected: string
  select: (id: string) => void
  selectedScenario: FinancialScenario | null
  field: <K extends keyof FinanceRequest>(key: K, value: FinanceRequest[K]) => void
  hasOverrides: boolean
  exporting: boolean
  download: (format: 'html' | 'json') => void
  limitations: string[]
}

function Numeric({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
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
        required
      />
    </label>
  )
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="fin-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="fin-empty">{children}</p>
}

/* ---------------------------------------------------------------- inputs ---------------------------------------------------------------- */

function KeyInputs({ c }: { c: Ctx }) {
  const r = c.request
  return (
    <div className="fin-inputs">
      <Numeric label="Total sponsor budget (USD)" value={r.budget} step={10000} onChange={(v) => c.field('budget', v)} />
      <Numeric label="Assumed demo target (participants)" value={r.target} min={1} onChange={(v) => c.field('target', v)} />
      <Numeric label="Planning horizon (months)" value={r.horizon_months} min={1} onChange={(v) => c.field('horizon_months', v)} />
      <Numeric label="Sponsor administration (USD)" value={r.admin_cost} step={1000} onChange={(v) => c.field('admin_cost', v)} />
    </div>
  )
}

const SITE_NUMBERS = [
  ['activation_cost', 'Activation USD'],
  ['monthly_cost', 'Monthly USD'],
  ['per_participant_cost', 'Per participant USD'],
  ['rate', 'Participants/month'],
  ['capacity', 'Capacity'],
  ['activation_lag_months', 'Lag months'],
] as const

function SiteAssumptions({ c }: { c: Ctx }) {
  const r = c.request
  const setSite = (index: number, patch: Partial<FinanceRequest['sites'][number]>) =>
    c.field(
      'sites',
      r.sites.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    )
  return (
    <>
      <p className="fin-text">
        Every site below is synthetic. Recruitment rates are assumed participants/month; capacity and activation lag constrain the selected network.
        Increased site count need not reduce time or cost.
      </p>
      <Check checked={r.no_loser} onChange={(v) => c.field('no_loser', v)}>
        Require nominal modeled duration no worse than feasible baseline A (single trial only)
      </Check>
      <div className="table-scroll">
        <table className="tbl fin-tbl fin-tbl-inputs">
          <caption>Synthetic candidate network. Baseline-active status is part of the fixture.</caption>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Available</th>
              {SITE_NUMBERS.map(([key, label]) => (
                <th scope="col" key={key}>
                  {label}
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
                    {site.id} · {site.baseline_active ? 'Baseline active' : 'Candidate activation'}
                  </div>
                </th>
                <td>
                  <label className="fin-cellcheck">
                    <input type="checkbox" aria-label={`${site.name} feasible`} checked={site.feasible} onChange={(e) => setSite(index, { feasible: e.target.checked })} />
                  </label>
                </td>
                {SITE_NUMBERS.map(([key]) => (
                  <td key={key}>
                    <input
                      type="number"
                      aria-label={`${site.name} ${key.replaceAll('_', ' ')}`}
                      min={0}
                      step={key === 'rate' ? 0.1 : 1}
                      value={Number.isFinite(site[key]) ? site[key] : ''}
                      onChange={(e) => setSite(index, { [key]: e.target.value === '' ? NaN : Number(e.target.value) })}
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

function ReinvestmentInputs({ c }: { c: Ctx }) {
  const r = c.request
  return (
    <>
      <div className="fin-inputs">
        <Numeric label="Administrative reduction fraction" value={r.admin_reduction} max={1} step={0.05} onChange={(v) => c.field('admin_reduction', v)} />
        <Numeric label="Baseline support per participant (USD)" value={r.support_per_participant} step={50} onChange={(v) => c.field('support_per_participant', v)} />
        <Numeric label="Minimum access support (USD)" value={r.minimum_support} step={50} onChange={(v) => c.field('minimum_support', v)} />
        <Numeric label="Insurer administration per participant (USD)" value={r.payer_admin_per_participant} step={5} onChange={(v) => c.field('payer_admin_per_participant', v)} />
        <Numeric
          label="Unverified drug supply reserve per participant (USD)"
          value={r.drug_contingency_per_participant}
          step={100}
          onChange={(v) => c.field('drug_contingency_per_participant', v)}
        />
        <Numeric label="Additional support per participant (USD)" value={r.extra_support} step={50} onChange={(v) => c.field('extra_support', v)} />
        <Numeric label="Recruitment log-rate spread" value={r.rate_spread} max={1} step={0.05} onChange={(v) => c.field('rate_spread', v)} />
        <Numeric label="Reproducible seed" value={r.seed} onChange={(v) => c.field('seed', v)} />
        <Numeric label="Sensitivity draws" value={r.draws} min={100} max={1000} onChange={(v) => c.field('draws', v)} />
      </div>
      <p className="fin-text">
        Assumed administrative reductions must be justified in a real pilot. Target enrollment stays fixed across each comparison. Changes in modeled time
        are conditional scenarios, not validated recruitment effects.
      </p>
    </>
  )
}

/** Additional activations for the selected scenario. The modeled time change is Detailed-only (honesty rule 7). */
function ReinvestmentResult({ c, withTime }: { c: Ctx; withTime: boolean }) {
  const re = c.selectedScenario?.reinvestment
  if (!re) return null
  return (
    <p className="fin-text">
      Additional activations: <strong className="num">{re.additional_activations}</strong> ({re.additional_sites.join(', ') || 'none'}). Incremental ongoing
      cost: <span className="num">{signed(re.incremental_ongoing_cost)}</span>.
      {withTime && (
        <>
          {' '}
          Modeled time change: <span className="num">{number(re.modeled_time_change)}</span> months.
        </>
      )}
    </p>
  )
}

function CoverageWorksheet({ c }: { c: Ctx }) {
  const r = c.request
  const coverage = c.coverage
  return (
    <>
      <p className="fin-text">
        Classifications are editable planning assumptions, never reimbursement authorization. Unknown or review-required expenses remain reserved rather than
        silently charged to a payer.
      </p>
      <div className="fin-inputs">
        <label className="field fin-field">
          <span className="field-label">Payer type</span>
          <select value={r.payer_kind} onChange={(e) => c.field('payer_kind', e.target.value as FinanceRequest['payer_kind'])}>
            <option>Medicare</option>
            <option value="commercial">Commercial</option>
            <option>Medicaid</option>
          </select>
        </label>
        <label className="field fin-field">
          <span className="field-label">Jurisdiction</span>
          <input type="text" value={r.jurisdiction} onChange={(e) => c.field('jurisdiction', e.target.value)} />
        </label>
        <label className="field fin-field">
          <span className="field-label">Plan assumption</span>
          <input type="text" value={r.payer_plan} onChange={(e) => c.field('payer_plan', e.target.value)} />
        </label>
        <Numeric label="Payer fraction of allowed routine amount" value={r.payer_fraction} max={1} step={0.05} onChange={(v) => c.field('payer_fraction', v)} />
        <Numeric label="Hypothetical rate multiplier" value={r.rate_multiplier} min={0.1} max={5} step={0.1} onChange={(v) => c.field('rate_multiplier', v)} />
      </div>
      <Check checked={r.commercial_rate_assumption} onChange={(v) => c.field('commercial_rate_assumption', v)}>
        Explicitly assume Medicare-derived commercial allowed amounts (unverified, not a negotiated rate)
      </Check>
      {coverage && (
        <div className="table-scroll">
          <table className="tbl fin-tbl fin-tbl-coverage">
            <caption>Illustrative procedures; amounts per modeled participant. Edit responsibility and recompute to update attribution.</caption>
            <thead>
              <tr>
                <th scope="col">Procedure / source</th>
                <th scope="col">Quantity / hypothetical rate</th>
                <th scope="col">Responsibility assumption</th>
                <th scope="col">Review and explanation</th>
                <th scope="col">Sponsor / payer / patient / reserve</th>
              </tr>
            </thead>
            <tbody>
              {coverage.items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">
                    {item.label}
                    <div className="fin-sub">
                      {item.code ?? 'Code unavailable'} · {item.source}
                    </div>
                  </th>
                  <td>
                    <span className="num fin-nowrap">
                      {number(item.quantity, 0)} × {amount(item.unit_rate)}
                    </span>
                    <div className="fin-sub">{words(item.rate_kind)}</div>
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
                    <strong>{words(c.result ? item.review_status : 'REVIEW_REQUIRED')}</strong>
                    <p className="fin-sub">{item.explanation}</p>
                  </td>
                  <td className={c.result ? 'num fin-nowrap' : undefined}>
                    {c.result
                      ? [item.sponsor_per_participant, item.payer_per_participant, item.patient_per_participant, item.reserve_per_participant].map(amount).join(' / ')
                      : <span className="fin-sub-inline">Recompute for current attribution</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {c.hasOverrides && !c.result && <p role="status">Coverage edits are pending. Recompute to obtain consistent costs and review warnings.</p>}
      {!coverage && <Empty>Compute a comparison to load the selected trial’s illustrative worksheet.</Empty>}
      {coverage?.warnings.map((w) => (
        <p className="note small" key={w}>
          {w}
        </p>
      ))}
    </>
  )
}

/** Provenance, the two exports and the source list. `full` adds the assumption and limitation lists (Detailed); in
 *  Simple they sit in hover cards. */
function EvidenceReport({ c, full }: { c: Ctx; full: boolean }) {
  const result = c.result
  return (
    <>
      <p className="fin-text">
        Exports include trial context, synthetic site identifiers, responsibility assumptions, baseline comparison, ledger, uncertainty, limitations, and
        source references. Exporting recomputes the same deterministic input; this is not a saved historical allocation replay.
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
                {result.trial.id} · {result.trial.title}
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
              Download readable HTML report
            </button>
            <button type="button" className="btn" onClick={() => c.download('json')} disabled={c.exporting}>
              Download JSON evidence
            </button>
          </div>
          <Details summary="Source and execution evidence">
            <pre className="fin-pre" tabIndex={0} role="region" aria-label="Source and execution evidence (JSON)">
              {JSON.stringify(result.evidence, null, 2)}
            </pre>
          </Details>
        </>
      ) : (
        <Empty>Compute a fresh comparison before exporting. Edits immediately invalidate the previous report.</Empty>
      )}
      {result && (
        <>
          <h3>Policy and protocol references</h3>
          <ul className="fin-list">
            {result.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>{' '}
                — {source.scope}
              </li>
            ))}
          </ul>
          {full && (
            <>
              <h3>Explicit modeling assumptions</h3>
              <ul className="fin-list">
                {Object.entries(result.assumptions).map(([key, value]) => (
                  <li key={key}>{value}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {full && (
        <>
          <h3>Limitations</h3>
          <ul className="fin-list">
            {c.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
      <p className="fin-text">
        Human coverage review, site feasibility confirmation, validated prices, and operational recruitment evidence are required before real decisions.
      </p>
    </>
  )
}

/* ---------------------------------------------------------------- results --------------------------------------------------------------- */

function Feasibility({ scenario }: { scenario: FinancialScenario }) {
  if (scenario.plan.feasible) return <span className="fin-nowrap">Feasible under assumptions</span>
  return (
    <>
      <Qualifier>Infeasible</Qualifier>
      {scenario.plan.violations.length > 0 && (
        <ul className="fin-viol">
          {scenario.plan.violations.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      )}
    </>
  )
}

/** The full scenario table (Detailed), with modeled months. */
function ScenarioTable({ c }: { c: Ctx }) {
  if (!c.result) return null
  return (
    <div className="table-scroll">
      <table className="tbl fin-tbl">
        <caption>Fixed-target financial and allocation scenarios. All figures are synthetic assumptions.</caption>
        <thead>
          <tr>
            <th scope="col">Scenario</th>
            <th scope="col">Feasibility</th>
            <th scope="col" className="num">
              Sponsor commitment incl. contingency
            </th>
            <th scope="col" className="num">
              Sites
            </th>
            <th scope="col" className="num">
              Capacity within horizon
            </th>
            <th scope="col" className="num">
              Modeled months
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
                <button type="button" className="fin-pick" onClick={() => c.select(s.id)} aria-pressed={s.id === c.selected}>
                  {s.id}. {s.label}
                </button>
              </th>
              <td>
                <Feasibility scenario={s} />
              </td>
              <td className="num">{amount(s.plan.sponsor_total)}</td>
              <td className="num">{s.plan.selected_ids.length}</td>
              <td className="num">{number(s.plan.projected_capacity)}</td>
              <td className="num">{number(s.plan.modeled_months)}</td>
              <td className="num">{amount(s.plan.unspent_budget)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Simple: each scenario reduced to feasibility and sponsor commitment, with commitment drawn against the entered
 *  budget (a meter: the track is the budget). The whole row selects the scenario. */
function ScenarioSummary({ c }: { c: Ctx }) {
  if (!c.result) return null
  return (
    <ul className="fin-scen" aria-label="Scenarios: feasibility and sponsor commitment">
      {c.result.scenarios.map((s) => {
        const on = s.id === c.selected
        const share = s.plan.budget_utilization
        return (
          <li key={s.id} className={on ? 'fin-scen-row fin-scen-on' : 'fin-scen-row'}>
            <button type="button" className="fin-scen-pick" aria-pressed={on} onClick={() => c.select(s.id)}>
              {s.id}. {s.label}
              {on && <span className="fin-scen-sel"> · Selected</span>}
            </button>
            <span className="fin-scen-amt num">{amount(s.plan.sponsor_total)}</span>
            <div className="fin-scen-feas">
              <Feasibility scenario={s} />
            </div>
            {finite(share) && (
              <span className="fin-scen-share">
                <span className="fin-meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(Math.max(share, 0), 1) * 100}%` }} />
                </span>
                <span>{pct(share)} of entered budget</span>
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function OverviewCards({ c }: { c: Ctx }) {
  const s = c.selectedScenario
  if (!s) return null
  const totals = c.coverage?.totals
  return (
    <div className="fin-cards">
      <article>
        <h3>Sponsor commitment</h3>
        <strong className="fin-card-value">{amount(s.plan.sponsor_total)}</strong>
        <p>{pct(s.plan.budget_utilization)} of entered budget, including contingency</p>
      </article>
      <article>
        <h3>Activation / per participant</h3>
        <strong className="fin-card-value">{amount(s.plan.breakdown?.activation)}</strong>
        <p>Total modeled commitment per participant {amount(s.plan.cost_per_participant)}</p>
      </article>
      <article>
        <h3>Procedure attribution / participant</h3>
        <p>
          Sponsor {amount(totals?.sponsor)} · potential payer {amount(totals?.payer)} · potential patient {amount(totals?.patient)} · unresolved reserve{' '}
          {amount(totals?.reserve)}
        </p>
      </article>
      <article>
        <h3>Uncertainty assumptions</h3>
        <p>
          Seed {c.request.seed} · {c.request.draws} paired draws · log-rate spread {c.request.rate_spread}. See Reinvestment Lab; intervals are not clinically
          calibrated.
        </p>
      </article>
    </div>
  )
}

function SiteFunds({ c }: { c: Ctx }) {
  const s = c.selectedScenario
  if (!s) return null
  return (
    <div className="table-scroll">
      <table className="tbl fin-tbl">
        <caption>{s.label}: sponsor funds by site</caption>
        <thead>
          <tr>
            <th scope="col">Site</th>
            {['Participants', 'Activation', 'Operating', 'Variable', 'Procedures', 'Support', 'Total'].map((h) => (
              <th scope="col" className="num" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {s.plan.site_rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.name}</th>
              <td className="num">{number(row.participants, 0)}</td>
              {[row.activation, row.operating, row.variable, row.procedure, row.support, row.total].map((v, i) => (
                <td className="num" key={i}>
                  {amount(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Detailed: the four party cards, gross transfers and consolidated resource costs. */
function PartyLedger({ c }: { c: Ctx }) {
  const s = c.selectedScenario
  const e = s?.economics
  if (!s || !e) return <Empty>Compute a comparison and select a feasible scenario to inspect its ledger.</Empty>
  return (
    <>
      <div className="fin-cards">
        <article>
          <h3>Sponsor</h3>
          <strong className="fin-card-value">{amount(e.sponsor.expenditure)}</strong>
          <p>Modeled spending excluding held reserve · change {signed(s.delta?.sponsor_expenditure)} vs A</p>
          <p>
            Contingency held {amount(e.sponsor.contingency_reserve)} · total commitment {amount(e.sponsor.budget_commitment)}
          </p>
        </article>
        <article>
          <h3>Hospital</h3>
          <strong className="fin-card-value">{amount(e.hospital.net_contribution)}</strong>
          <p>Operating contribution</p>
          <p>
            Revenue {amount(e.hospital.revenue)} · resource costs {amount(e.hospital.resource_cost)}
          </p>
        </article>
        <article>
          <h3>Insurer</h3>
          <strong className="fin-card-value">{amount(e.insurer.total)}</strong>
          <p>
            Payments {amount(e.insurer.payments)} · administration {amount(e.insurer.administration)}
          </p>
          <p>Downstream clinical expenditure: Unknown</p>
        </article>
        <article>
          <h3>Patient</h3>
          <strong className="fin-card-value">{amount(e.patient.net_cash_exposure)}</strong>
          <p>
            Net modeled exposure (specified lines only) · cost sharing {amount(e.patient.cost_sharing)} · access support {amount(e.patient.access_support)}
          </p>
          <p>Unresolved exposure: Unknown. A negative net is support less specified cost sharing, not a guaranteed patient gain.</p>
        </article>
      </div>
      <div className="table-scroll">
        <table className="tbl fin-tbl fin-tbl-narrow">
          <caption>Gross financial transfers in {s.label}</caption>
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
                <td className="num">{amount(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fin-text">
        <strong>Consolidated resource costs {amount(e.consolidated_resource_cost)}</strong> · change vs A {signed(s.delta?.resources)} · transfer balance{' '}
        {amount(e.transfer_balance)}
      </p>
      <p className="fin-text">{NO_PROMISE}</p>
    </>
  )
}

/** Simple: the selected scenario's ledger as four key figures, qualifiers beside them. */
function LedgerSummary({ s }: { s: FinancialScenario }) {
  const e = s.economics
  if (!e) return null
  return (
    <div className="fin-ledger">
      <KeyFigure
        label="Sponsor: modeled spending"
        value={amount(e.sponsor.expenditure)}
        sub={`Excludes ${amount(e.sponsor.contingency_reserve)} contingency held · total commitment ${amount(e.sponsor.budget_commitment)}`}
      />
      <KeyFigure
        label="Hospital: operating contribution"
        value={amount(e.hospital.net_contribution)}
        sub={`Revenue ${amount(e.hospital.revenue)} less resource costs ${amount(e.hospital.resource_cost)}`}
      />
      <KeyFigure
        label="Insurer: payments and administration"
        value={amount(e.insurer.total)}
        qualifier={<Qualifier>Downstream clinical cost unknown</Qualifier>}
        sub={`Payments ${amount(e.insurer.payments)} · administration ${amount(e.insurer.administration)}`}
      />
      <KeyFigure
        label="Patient: net modeled exposure"
        value={amount(e.patient.net_cash_exposure)}
        qualifier={<Qualifier>Specified lines only</Qualifier>}
        sub={
          e.patient.net_cash_exposure < 0
            ? 'Unresolved exposure unknown. A negative net is support less specified cost sharing, not a guaranteed patient gain.'
            : 'Unresolved exposure unknown'
        }
      />
    </div>
  )
}

function AssumptionsCard({ assumptions, keys }: { assumptions: Record<string, string>; keys?: string[] }) {
  const entries = Object.entries(assumptions).filter(([k]) => !keys || keys.includes(k))
  return (
    <>
      <span className="hc-title">Explicit modeling assumptions</span>
      <ul className="fin-tip-list">
        {entries.map(([key, value]) => (
          <li key={key}>{value}</li>
        ))}
      </ul>
    </>
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

/* ----------------------------------------------------------------- view ----------------------------------------------------------------- */

export default function FinancialView() {
  const { density } = useDensity()
  const simple = density === 'simple'
  const [demo, setDemo] = useState<FinancialDemo | null>(null)
  const [request, setRequest] = useState<FinanceRequest | null>(null)
  const [result, setResult] = useState<FinancialResult | null>(null)
  const [selected, setSelected] = useState('A')
  const [section, setSection] = useState<SectionName>('Overview')
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
    setNotice('Inputs changed. Previous results and exports cleared; compare again.')
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
      setSelected(output.recommended_scenario_id ?? output.scenarios[0].id)
      setNotice('Comparison computed from these inputs. Figures remain synthetic and conditional.')
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
      anchor.download = `concord-financial-${result.run_id}.${format}`
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

  const scenario = result?.scenarios.find((s) => s.id === selected)
  const coverage = result?.coverage ?? (request?.trial_id === demo?.request.trial_id ? demo?.coverage : undefined)
  const selectedScenario = scenario && scenario.plan.feasible ? scenario : null
  const limitations = result?.limitations ?? demo?.limitations ?? []

  const banner = (
    <Banner title="Synthetic financial demo.">
      No verified financial inputs or insurer partnership. Public trial identifiers provide context only. All site budgets, site identities, rates,
      recruitment, and payer assumptions in this financial exercise are synthetic. Coverage classifications require human review. No realized savings,
      clinical benefit, or validated acceleration is claimed.
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
        {!request && <p className="small">The financial service or its demo fixture is unavailable. Check the backend, then try again.</p>}
      </div>
    ))

  const head = (
    <PageHead
      title="Financial Coordination"
      lede="Compare trial budgets, site resources, coverage responsibilities, and reinvestment at a fixed enrollment target."
      meta="Sponsor-funded planning pilot"
    />
  )

  if (!request)
    return (
      <div className="view financial">
        {head}
        {banner}
        {errorBox}
        {loading ? <Loading label="Loading financial demo…" /> : !error && <p role="status">Financial demo not loaded.</p>}
      </div>
    )

  const c: Ctx = {
    request,
    result,
    coverage,
    selected,
    select: setSelected,
    selectedScenario,
    field,
    hasOverrides: Object.keys(request.coverage_overrides).length > 0,
    exporting,
    download,
    limitations,
  }

  const setup = (
    <Window label="Scenario setup" className="fin-setup">
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
            View public registry record ↗
          </a>
          {simple && <InfoTip label="About the public record" content={PUBLIC_NOTE} />}
        </p>
      </div>
      {simple ? (
        <>
          <KeyInputs c={c} />
          <p className="fin-hint">
            Changing enrollment is an assumption only. <InfoTip label="About the enrollment target" content={TARGET_NOTE} />
          </p>
        </>
      ) : (
        <p className="fin-hint">{PUBLIC_NOTE}</p>
      )}
      <div className="fin-run">
        <button type="button" className="btn btn-primary" onClick={compare} disabled={loading || exporting}>
          {loading ? 'Computing comparison…' : 'Compare funding scenarios'}
        </button>
        <p className="fin-status" role="status" aria-live="polite">
          {notice || 'Review assumptions, then compute a fresh comparison.'}
        </p>
      </div>
    </Window>
  )

  const feasibleCount = result?.scenarios.filter((s) => s.plan.feasible).length ?? 0

  return (
    <div className="view financial">
      {head}
      {banner}
      {errorBox}
      {setup}
      {simple ? (
        <>
          <Section
            title="Funding scenarios"
            lede={
              result
                ? `${feasibleCount} of ${result.scenarios.length} scenarios meet the entered model constraints. Select one to see who pays what.`
                : 'No current comparison. Enter assumptions and select “Compare funding scenarios”.'
            }
            qualifiers={
              result && (
                <p className="fin-quals">
                  <Qualifier>Synthetic assumptions</Qualifier> · the same assumed enrollment target in every scenario
                </p>
              )
            }
            info={result ? <AssumptionsCard assumptions={result.assumptions} /> : undefined}
            figure={result ? <ScenarioSummary c={c} /> : undefined}
            caption={result ? 'Sponsor commitment includes contingency. Bar: share of the entered sponsor budget.' : undefined}
          />
          <Section
            title="Who pays what"
            lede={
              selectedScenario?.economics
                ? `${selectedScenario.id}. ${selectedScenario.label}: modeled amounts for each party at the fixed target.`
                : 'Compute a comparison and select a feasible scenario to inspect its ledger.'
            }
            qualifiers={selectedScenario?.economics && <p className="fin-quals">{NO_PROMISE}</p>}
            info={
              selectedScenario?.economics ? (
                <>
                  <span className="hc-title">Transfers and resource costs</span>
                  <p>{TRANSFER_NOTE}</p>
                  {result && <AssumptionsCard assumptions={result.assumptions} keys={['hospital_payment', 'resource_costs']} />}
                </>
              ) : undefined
            }
            figure={selectedScenario?.economics ? <LedgerSummary s={selectedScenario} /> : undefined}
          />
          <Section
            title="More assumptions and the report"
            lede="Site, coverage and reinvestment assumptions, and the evidence report exports. Changing any input clears the comparison until you compare again."
          >
            <div className="fin-more">
              <Details summary={`Synthetic sites (${request.sites.length})`}>
                <SiteAssumptions c={c} />
              </Details>
              <Details summary={coverage ? `Coverage worksheet (${coverage.items.length} illustrative procedures)` : 'Coverage worksheet'}>
                <CoverageWorksheet c={c} />
              </Details>
              <Details summary="Reinvestment and uncertainty inputs">
                <ReinvestmentInputs c={c} />
                <ReinvestmentResult c={c} withTime={false} />
              </Details>
              <Details summary="Evidence report and exports">
                <EvidenceReport c={c} full={false} />
              </Details>
            </div>
          </Section>
        </>
      ) : (
        <>
          <nav className="fin-nav" aria-label="Financial sections">
            {SECTIONS.map((s) => (
              <button type="button" key={s} onClick={() => setSection(s)} aria-current={s === section ? 'page' : undefined}>
                {s}
              </button>
            ))}
          </nav>
          <DetailedSection name={section} c={c} feasibleCount={feasibleCount} />
        </>
      )}
    </div>
  )
}

function DetailedSection({ name, c, feasibleCount }: { name: SectionName; c: Ctx; feasibleCount: number }) {
  const result = c.result
  const s = c.selectedScenario
  let title = ''
  let body: ReactNode = null
  switch (name) {
    case 'Overview':
      title = 'Overview'
      body = (
        <>
          <KeyInputs c={c} />
          <p className="note small">Changing enrollment is an assumption only. {TARGET_NOTE}</p>
          {result && (
            <>
              <ScenarioTable c={c} />
              <p className="fin-text">
                {feasibleCount} of {result.scenarios.length} scenarios meet the entered model constraints. Select a row for detailed economics.
              </p>
            </>
          )}
          <OverviewCards c={c} />
          {!result && <Empty>No current comparison. Enter assumptions and select “Compare funding scenarios”.</Empty>}
        </>
      )
      break
    case 'Allocation Comparison':
      title = 'Allocation and site assumptions'
      body = (
        <>
          <SiteAssumptions c={c} />
          <ScenarioTable c={c} />
          {result && <SiteFunds c={c} />}
        </>
      )
      break
    case 'Three-Party Economics':
      title = 'Payments, economic effects, and resource costs'
      body = (
        <>
          <p className="fin-text">{TRANSFER_NOTE}</p>
          <ScenarioTable c={c} />
          <PartyLedger c={c} />
        </>
      )
      break
    case 'Reinvestment Lab':
      title = 'Reinvestment under a fixed sponsor budget'
      body = (
        <>
          <ReinvestmentInputs c={c} />
          <ScenarioTable c={c} />
          <ReinvestmentResult c={c} withTime />
          {s?.sensitivity && (
            <div className="fin-panel">
              <h3>Paired sensitivity under explicit assumptions</h3>
              <p>{s.sensitivity.method}</p>
              <p>
                Seed {s.sensitivity.seed}; {s.sensitivity.draws} draws. Quantiles: 10th / 50th / 90th percentiles:
              </p>
              <p>
                Modeled months: <span className="num">{s.sensitivity.modeled_months_quantiles.map((v) => number(v)).join(' / ')}</span> · sponsor commitment:{' '}
                <span className="num">{s.sensitivity.sponsor_total_quantiles.map(amount).join(' / ')}</span>
              </p>
              <p>
                Fraction of draws above budget: <span className="num">{pct(s.sensitivity.probability_budget_exceeded)}</span>. These are assumed uncertainty
                draws, not calibrated confidence intervals.
              </p>
            </div>
          )}
        </>
      )
      break
    case 'Coverage Review':
      title = 'Preliminary coverage worksheet'
      body = <CoverageWorksheet c={c} />
      break
    case 'Evidence Report':
      title = 'Traceable evidence report'
      body = <EvidenceReport c={c} full />
      break
  }
  return (
    <section className="win fin-section" aria-label={name}>
      <div className="win-body fin-stack">
        <h2 className="fin-h2">{title}</h2>
        {body}
      </div>
    </section>
  )
}
