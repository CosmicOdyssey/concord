// Budget transparency for Protocol to terms (backend: concord/anchoring.py through /api/terms-flow budget and compare):
// what each sponsor dollar is anchored to, the negotiation band on coded lines (an assumption the user sets), the
// editable overhead assumption, the RVU basis and lab notes, plain-language GPCI labels and the category breakdowns.
// Every number comes from the API; nothing here is market data or a forecast.
import { useState, type ReactNode } from 'react'
import { Badge, HoverCard, InfoTip, Segmented } from '../components'
import { useDensity } from '../density'
import { usd } from '../format'
import { localityTitle, type AnchorId, type AnchorShare, type Anchoring, type Band, type Budget, type BreakdownRow, type Compare, type Line, type PricingBasis } from '../termsFlowApi'
import { GPCI_PLAIN, type GpciKey } from './termsAnchoringText'
import './termsAnchoring.css'

// ---------------------------------------------------------------------- plain-language GPCI labels

/** Medicare's three geographic adjustments in plain words; the technical term goes in the tooltip. */
export function GpciLabel({ k, children }: { k: GpciKey; children?: ReactNode }) {
  return <HoverCard content={GPCI_PLAIN[k].term}>{children ?? GPCI_PLAIN[k].label}</HoverCard>
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}

function AssumptionTag({ title }: { title?: string }) {
  return (
    <Badge tone="warn" title={title}>
      assumption
    </Badge>
  )
}

// ---------------------------------------------------------------------- inputs

/** Percent input that keeps the draft while typing and commits only valid values. */
function PctInput({ value, min, max, step, label, onCommit }: { value: number; min: number; max: number; step: number; label: string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <span className="tf-num-input">
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft ?? String(value)}
        aria-label={label}
        onChange={(e) => {
          const s = e.target.value
          setDraft(s)
          const n = Number(s)
          if (s !== '' && Number.isFinite(n) && n >= min && n <= max) onCommit(n)
        }}
        onBlur={() => setDraft(null)}
      />
      <span aria-hidden="true">%</span>
    </span>
  )
}

/** The negotiation band on coded lines, in percent of Medicare. Low above high is held back until it is valid. */
export function BandInputs({ lo, hi, onChange }: { lo: number; hi: number; onChange: (lo: number, hi: number) => void }) {
  return (
    <fieldset className="tfa-band">
      <legend className="field-label">
        Range on coded lines, % of Medicare <AssumptionTag title="A band you set, not market data" />
      </legend>
      <span className="tfa-band-row">
        <PctInput value={lo} min={10} max={500} step={5} label="Range low, percent of Medicare" onCommit={(v) => onChange(v, Math.max(v, hi))} />
        <span aria-hidden="true">to</span>
        <PctInput value={hi} min={10} max={500} step={5} label="Range high, percent of Medicare" onCommit={(v) => onChange(Math.min(lo, v), v)} />
      </span>
    </fieldset>
  )
}

/** The overhead rate (an assumption): percent of research items and coordinator time. */
export function OverheadInput({ value, def, onChange }: { value: number; def: number; onChange: (v: number | null) => void }) {
  return (
    <label className="field tfa-over">
      <span className="field-label">
        Overhead <AssumptionTag title={`Proposed default ${pct(def)}; edit to the site's negotiated rate`} />
      </span>
      <PctInput
        value={Math.round(value * 1000) / 10}
        min={0}
        max={100}
        step={1}
        label="Overhead, percent of research items and coordinator time (assumption)"
        onCommit={(v) => onChange(Math.abs(v / 100 - def) < 1e-9 ? null : v / 100)}
      />
    </label>
  )
}

// ---------------------------------------------------------------------- anchored share

const ANCHOR_CLASS: Record<AnchorId, string> = { public: 'tfa-a-public', standard: 'tfa-a-standard', open: 'tfa-a-open' }
const ANCHOR_SHORT: Record<AnchorId, string> = { public: 'public rates', standard: 'proposed standard', open: 'open to negotiation' }

function AnchorDefinitions({ a }: { a: Anchoring }) {
  return (
    <>
      <span className="hc-title">How each sponsor dollar is classified</span>
      {a.shares.map((s) => (
        <p key={s.id}>
          <strong>{s.label}.</strong> {s.definition}
        </p>
      ))}
      <span className="hc-src">
        Per participant ({a.scope}), sponsor-paid only. Coordinator time and overhead are counted per visit; the three amounts add up to the
        per-participant total.
      </span>
    </>
  )
}

function ShareSources({ s }: { s: AnchorShare }) {
  return (
    <>
      <span className="hc-title">
        {s.label}: <span className="num">{usd(s.amount)}</span>
      </span>
      {s.components.map((c) => (
        <span key={c.label} className="tf-hc-kv">
          <span>{c.label}</span> <span className="num">{usd(c.amount)}</span>
        </span>
      ))}
      <span className="hc-src">{s.definition}</span>
    </>
  )
}

/** One horizontal bar: the per-participant sponsor amount split into its three anchors, with $ and %. */
export function AnchorBar({ a }: { a: Anchoring }) {
  const detailed = useDensity().density === 'detailed'
  const pub = a.shares.find((s) => s.id === 'public')
  return (
    <section className="tfa-card" aria-labelledby="tfa-anchor-h">
      <div className="tfa-card-head">
        <h3 id="tfa-anchor-h">What the sponsor amount is anchored to</h3>
        <InfoTip label="How each sponsor dollar is classified" content={<AnchorDefinitions a={a} />} />
      </div>
      <p className="tfa-lede">
        <span className="tnum strong">{pub ? `${pub.pct.toFixed(0)}%` : '—'}</span> of the <span className="tnum">{usd(a.total)}</span> per participant is
        priced from public CMS rates; the rest is Concord’s proposed standard or open to negotiation.
      </p>
      <div className="tfa-bar" role="img" aria-label={a.shares.map((s) => `${s.label}: ${usd(s.amount)}, ${s.pct.toFixed(1)}%`).join('; ')}>
        {a.shares.map((s) => (
          <span key={s.id} className={ANCHOR_CLASS[s.id]} style={{ flexGrow: Math.max(s.amount, 0) }} />
        ))}
      </div>
      <ul className="tfa-legend">
        {a.shares.map((s) => (
          <li key={s.id}>
            <span className={`tf-key ${ANCHOR_CLASS[s.id]}`} aria-hidden="true" />
            <HoverCard content={<ShareSources s={s} />}>{s.label}</HoverCard>
            <span className="tfa-legend-v">
              <span className="num strong">{usd(s.amount)}</span> <span className="num muted">{s.pct.toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
      {detailed && (
        <div className="table-scroll">
          <table className="tbl tbl-compact tfa-tbl">
            <caption className="sr-only">Anchored shares by component</caption>
            <thead>
              <tr>
                <th scope="col">Anchor and component</th>
                <th scope="col" className="num">
                  Point
                </th>
                <th scope="col" className="num">
                  Range
                </th>
              </tr>
            </thead>
            <tbody>
              {a.shares.map((s) => (
                <AnchorRows key={s.id} s={s} />
              ))}
            </tbody>
          </table>
          {Math.abs(a.rounding_to_open) >= 0.005 && (
            <p className="small muted">Cent rounding of {usd(a.rounding_to_open)} between visit totals and line sums is counted as open.</p>
          )}
        </div>
      )}
    </section>
  )
}

function AnchorRows({ s }: { s: AnchorShare }) {
  return (
    <>
      <tr className="tfa-tbl-group">
        <th scope="row">
          <span className={`tf-key ${ANCHOR_CLASS[s.id]}`} aria-hidden="true" /> {s.label}{' '}
          <span className="muted small">
            ({s.pct.toFixed(1)}%{s.n_lines > 0 ? `, ${s.n_lines} line${s.n_lines === 1 ? '' : 's'}` : ''})
          </span>
        </th>
        <td className="num strong">{usd(s.amount)}</td>
        <td className="num">{rangeText(s.low, s.high)}</td>
      </tr>
      {s.components.map((c) => (
        <tr key={c.label}>
          <th scope="row" className="tfa-sub">
            {c.label}
          </th>
          <td className="num">{usd(c.amount)}</td>
          <td className="num">{rangeText(c.low, c.high)}</td>
        </tr>
      ))}
    </>
  )
}

function rangeText(lo: number | null | undefined, hi: number | null | undefined): string {
  if (lo == null || hi == null) return '—'
  return Math.abs(hi - lo) < 0.005 ? `${usd(lo)} (fixed)` : `${usd(lo)} – ${usd(hi)}`
}

// ---------------------------------------------------------------------- range

/** Per-participant low-high at the user's band; non-procedure lines stay at their point value. */
export function RangeFigure({ b }: { b: Budget }) {
  const detailed = useDensity().density === 'detailed'
  const band = b.band
  const t = b.totals
  if (!band || t.per_participant_low == null || t.per_participant_high == null) return null
  const over = b.standard_schedule.find((i) => i.id === 'overhead')
  return (
    <section className="tfa-card" aria-labelledby="tfa-range-h">
      <div className="tfa-card-head">
        <h3 id="tfa-range-h">Range per participant</h3>
        <InfoTip label="How the range is computed" content={<BandInfo band={band} />} />
      </div>
      <p className="tfa-range-v num">
        {usd(t.per_participant_low)} – {usd(t.per_participant_high)}
      </p>
      <p className="tfa-lede">
        Coded lines at{' '}
        <span className="tnum">
          {pct(band.lo)}–{pct(band.hi)}
        </span>{' '}
        of Medicare <AssumptionTag title={band.note} />. Proposed standard fees and coordinator time stay at their point value; overhead
        {over?.amount != null ? ` (${pct(over.amount)})` : ''} follows its rate.
      </p>
      {detailed && (
        <ul className="tfa-list small">
          <li>
            <span className="tnum">{band.n_banded_lines}</span> coded sponsor lines move with the range. The term sheet prices them at{' '}
            <span className="tnum">{pct(band.point_multiplier)}</span> of Medicare: <span className="tnum">{usd(t.per_participant)}</span> per participant.
          </li>
          {t.per_occurrence.map((x) => (
            <li key={x.visit_id}>
              {x.label}: <span className="tnum">{rangeText(x.low, x.high)}</span> each
            </li>
          ))}
          <li>
            Screen failure, as incurred: <span className="tnum">{rangeText(t.screen_failure_low, t.screen_failure_high)}</span>
          </li>
          <li>{band.note}</li>
        </ul>
      )}
    </section>
  )
}

function BandInfo({ band }: { band: Band }) {
  return (
    <>
      <span className="hc-title">
        Range at {pct(band.lo)}–{pct(band.hi)} of Medicare
      </span>
      <p>
        Each sponsor-paid coded line (physician and lab fee schedule) is shown at its Medicare amount × {pct(band.lo)} and × {pct(band.hi)}. Non-procedure
        lines keep their point value, and overhead is recomputed at its rate on each end.
      </p>
      <span className="hc-src">{band.note}</span>
    </>
  )
}

// ---------------------------------------------------------------------- pricing basis (RVU column, OPPS, labs)

export function BasisNotes({ pb }: { pb: PricingBasis }) {
  const detailed = useDensity().density === 'detailed'
  if (!detailed)
    return (
      <p className="tfa-basis small">
        Physician lines use Medicare’s{' '}
        <HoverCard
          content={
            <>
              <span className="hc-title">Non-facility rates</span>
              {pb.pfs}
              <span className="hc-src">{pb.pfs_column}</span>
            </>
          }
        >
          non-facility rates
        </HoverCard>{' '}
        and exclude hospital outpatient facility fees (OPPS). Lab prices are{' '}
        <HoverCard content={pb.lab}>one national amount</HoverCard> and do not vary by site.
      </p>
    )
  return (
    <ul className="tfa-basis tfa-list small">
      <li>
        {pb.pfs} <span className="muted">(Source column: {pb.pfs_column}.)</span>
      </li>
      <li>{pb.lab}</li>
    </ul>
  )
}

// ---------------------------------------------------------------------- per-line anchor and range (budget table)

export function AnchorChip({ l }: { l: Line }) {
  if (!l.anchor) return <span className="muted">—</span>
  return (
    <HoverCard content={l.anchor_reason ?? ANCHOR_SHORT[l.anchor]} className="tfa-chip-btn">
      <span className={`tfa-chip ${ANCHOR_CLASS[l.anchor]}-chip`}>{ANCHOR_SHORT[l.anchor]}</span>
    </HoverCard>
  )
}

export function LineRange({ l }: { l: Line }) {
  if (l.payer !== 'Sponsor' || l.low == null || l.high == null) return <span className="muted">—</span>
  if (!l.banded) return <span className="muted">point value</span>
  return (
    <span className="num">
      {usd(l.low)} – {usd(l.high)}
    </span>
  )
}

// ---------------------------------------------------------------------- breakdowns

type GroupBy = 'payer' | 'cost_type' | 'visit' | 'anchoring'
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: 'payer', label: 'Who pays' },
  { value: 'cost_type', label: 'Cost type' },
  { value: 'visit', label: 'Visit' },
  { value: 'anchoring', label: 'Anchoring' },
]

export function Breakdown({ b }: { b: Budget }) {
  const detailed = useDensity().density === 'detailed'
  const [by, setBy] = useState<GroupBy>('cost_type')
  const bd = b.breakdowns
  if (!bd) return null
  const rows: BreakdownRow[] = bd[by]
  const total = b.totals.per_participant
  const max = Math.max(...rows.map((r) => r.amount), 0.01)
  return (
    <section className="tfa-card tfa-card-wide" aria-labelledby="tfa-bd-h">
      <div className="tfa-card-head tfa-bd-head">
        <h3 id="tfa-bd-h">Budget by category</h3>
        <Segmented label="Group the budget by" options={GROUPS} value={by} onChange={setBy} className="tfa-seg" />
      </div>
      <p className="tfa-lede small">
        {by === 'payer'
          ? 'Two different payers over the same visits: the sponsor’s amount and routine care billed to insurance at Medicare rates. They are not one total.'
          : `Per participant (${bd.scope}); the groups add up to the sponsor’s ${usd(total)}.`}
      </p>
      <div className="table-scroll">
        <table className="tbl tbl-compact tfa-tbl tfa-bd">
          <thead>
            <tr>
              <th scope="col">{GROUPS.find((g) => g.value === by)?.label}</th>
              <th scope="col" className="num">
                Amount
              </th>
              {by !== 'payer' && (
                <th scope="col" className="num tfa-bd-share">
                  Share
                </th>
              )}
              {detailed && (
                <th scope="col" className="num">
                  Range
                </th>
              )}
              {detailed && (
                <th scope="col" className="num">
                  Lines
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.label}</th>
                <td className="num strong">{usd(r.amount)}</td>
                {by !== 'payer' && (
                  <td className="num tfa-bd-share">
                    <span className="tfa-bd-cell">
                      <span className="tfa-bd-track" aria-hidden="true">
                        <span className="tfa-bd-bar" style={{ width: `${(Math.max(r.amount, 0) / max) * 100}%` }} />
                      </span>
                      <span>{total ? `${((100 * r.amount) / total).toFixed(0)}%` : '—'}</span>
                    </span>
                  </td>
                )}
                {detailed && <td className="num">{rangeText(r.low, r.high)}</td>}
                {detailed && <td className="num">{r.n_lines}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detailed && (
        <p className="small muted">
          Outside the per-participant amount: {bd.outside.one_time_fees.label}, <span className="tnum">{usd(bd.outside.one_time_fees.amount)}</span>; and
          per-occurrence visits ({bd.outside.per_occurrence.map((x) => `${x.label} ${usd(x.amount)}`).join('; ')}).
        </p>
      )}
    </section>
  )
}

/** The Budget step's transparency panel: anchored share, range, pricing basis and the category breakdown. */
export function BudgetTransparency({ b, stale }: { b: Budget; stale: boolean }) {
  if (!b.anchoring) return null
  return (
    <div className={`tfa${stale ? ' tf-stale' : ''}`}>
      <div className="tfa-grid">
        <AnchorBar a={b.anchoring} />
        <RangeFigure b={b} />
      </div>
      {b.pricing_basis && <BasisNotes pb={b.pricing_basis} />}
      <Breakdown b={b} />
    </div>
  )
}

// ---------------------------------------------------------------------- compare: why the budgets differ

const PART_SHORT: Record<GpciKey, string> = { work: 'doctor’s time', pe: 'practice costs', mp: 'malpractice insurance' }

/** Why two sites' sponsor budgets differ: Medicare's geographic adjustment of three cost components; labs and the
 *  proposed standard do not vary. States the size of the difference, not which site is cheaper. */
export function CompareWhy({ c }: { c: Compare }) {
  const sm = c.summary
  const d = sm.delta_per_participant
  const same = !!c.a.locality && !!c.b.locality && c.a.locality.code === c.b.locality.code && c.a.locality.state === c.b.locality.state
  const constant =
    'Lab prices are one national amount and the proposed standard fees are set once for every site, so neither differs. The difference reflects the fee schedule, not a saving.'
  if (Math.abs(d) < 0.005)
    return (
      <>
        The two sponsor budgets match{same && c.a.locality ? `: both sites are in Medicare locality ${localityTitle(c.a.locality.name)}` : ''}. Medicare adjusts
        physician fees by locality, and here the adjustments are the same. {constant}
      </>
    )
  const parts = (['pe', 'work', 'mp'] as const)
    .map((k) => ({ k, v: k === 'work' ? sm.from_work : k === 'pe' ? sm.from_pe : sm.from_mp }))
    .sort((x, y) => Math.abs(y.v) - Math.abs(x.v))
  const aligned = parts.every((p) => Math.abs(p.v) < 0.005 || Math.sign(p.v) === Math.sign(d))
  return (
    <>
      The sponsor budgets differ by <span className="tnum strong">{usd(Math.abs(d))}</span> per participant because Medicare adjusts physician fees for
      local costs in three parts, <GpciLabel k="work">doctor’s time</GpciLabel>, <GpciLabel k="pe">practice costs (rent, staff, equipment)</GpciLabel> and{' '}
      <GpciLabel k="mp">malpractice insurance</GpciLabel>, and the two sites are in different Medicare localities.{' '}
      {aligned ? (
        <>
          Of the difference,{' '}
          {parts.map((p, i) => (
            <span key={p.k}>
              {i === 0 ? '' : i === parts.length - 1 ? ' and ' : ', '}
              {PART_SHORT[p.k]} {i === 0 ? 'contribute ' : ''}
              <span className="tnum">{usd(Math.abs(p.v))}</span>
            </span>
          ))}
          ; overhead ({pct(sm.overhead_rate)}, an assumption) on those adds <span className="tnum">{usd(Math.abs(sm.delta_overhead))}</span>.
        </>
      ) : (
        <>The three parts pull in different directions; the table below shows each one.</>
      )}{' '}
      {constant}
    </>
  )
}
