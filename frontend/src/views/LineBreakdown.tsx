// One physician-fee-schedule line, priced step by step (backend: concord/line_detail.py). Replaces the one-line
// formula "(work RVU x GPCI + ...) x CF = $" wherever a term-sheet line is shown. Plain labels on screen; RVU, GPCI,
// nonQPP and non-facility are explained in tooltips. Simple: the compact table (both sites' adjustments, Medicare rate,
// sponsor price) with sources in hover cards. Detailed: every step, sources written out, multiplier and overhead
// editable in place (bound to the budget's own controls). Every number comes from the API.
import { useId, useState, type ReactNode } from 'react'
import { Badge, ErrorBox, InfoTip, Loading } from '../components'
import { useDensity } from '../density'
import { usd } from '../format'
import { lineDetailUrl, scopeHasNode, useLineDetail, useLineDetailScope, type ComponentId, type LineDetail, type LineDetailScope, type LineSide } from '../lineDetailApi'
import './lineBreakdown.css'

const IDS: ComponentId[] = ['work', 'pe', 'mp']
const f3 = (x: number) => x.toFixed(3)
const f4 = (x: number) => x.toFixed(4)
const pctText = (x: number) => `${Math.round(x * 1000) / 10}%`

function sideTitle(s: LineSide): string {
  return s.locality ? `${s.locality.title} (${s.locality.state} ${s.locality.code})` : 'National amounts (no locality)'
}

function sidesOf(d: LineDetail): [string, LineSide][] {
  return d.sites.b ? [['Site A', d.sites.a], ['Site B', d.sites.b]] : [['Site A', d.sites.a]]
}

/** The step-by-step table for one term-sheet line, fetched for the Terms screen's trial, sites and parameters. */
export function LineBreakdown({
  nodeId,
  variant = 'auto',
  editable = true,
  fallback,
  inCard = false,
}: {
  nodeId: string
  /** auto follows Simple / Detailed; hover cards use compact. */
  variant?: 'auto' | 'compact' | 'full'
  editable?: boolean
  /** Shown instead of an error box when the breakdown cannot be loaded (the landing page with the API down). */
  fallback?: ReactNode
  /** Inside a hover card: no nested tooltips (opening one would close the card); sources are written out. */
  inCard?: boolean
}) {
  const scope = useLineDetailScope()
  const detailed = useDensity().density === 'detailed'
  const [retry, setRetry] = useState(0)
  // Only lines of the schedule on screen are asked for: after a new schedule (an added trial's CSV, or back to the
  // registry draft) a line of the old one is "no line selected", whether it is caught here or answered 404.
  const known = !scope || scopeHasNode(scope, nodeId)
  const url = scope && scope.siteA && known ? lineDetailUrl(scope, nodeId) : null
  const st = useLineDetail(url, retry)
  const data = st.data && st.data.node_id === nodeId ? st.data : null
  const full = variant === 'full' || (variant === 'auto' && detailed)
  if (!known || st.missing) return <p className="small muted lb-na">No line selected: this item is not in the current schedule.</p>
  // No scope yet (the new schedule's prices are on their way): the last table stays, dimmed.
  const stale = st.pending || (!url && !!data)
  if (!data) {
    if (st.error) return fallback !== undefined ? <>{fallback}</> : <ErrorBox error={st.error} onRetry={() => setRetry((n) => n + 1)} />
    if (!url && fallback !== undefined) return <>{fallback}</>
    return <Loading label="Building the price step by step…" />
  }
  if (!data.applicable) return <p className="small muted lb-na">{data.reason}</p>
  return (
    <div className={`lb${stale ? ' lb-stale' : ''}`} aria-busy={stale || undefined}>
      {full ? (
        <>
          {/* phones: the key numbers first, since the full table's site columns start off screen */}
          <div className="lb-phone-summary">
            <CompactTable d={data} inCard={inCard} canEdit={!!scope?.mult} />
          </div>
          <FullTable d={data} scope={editable ? scope : null} />
        </>
      ) : (
        <CompactTable d={data} inCard={inCard} canEdit={!!scope?.mult} />
      )}
      {inCard ? <CardNotes d={data} /> : <Notes d={data} full={full} />}
    </div>
  )
}

// ---------------------------------------------------------------------- Simple: compact

/** An info tip, or nothing inside a hover card (whose notes carry the same sources). */
function Tip({ inCard, label, content }: { inCard: boolean; label: string; content: ReactNode }) {
  return inCard ? null : <InfoTip label={label} content={content} />
}

function CompactTable({ d, inCard, canEdit }: { d: LineDetail; inCard: boolean; canEdit: boolean }) {
  const sides = sidesOf(d)
  const sponsor = d.payer === 'Sponsor' && !!d.sites.a.sponsor
  const sp = d.sites.a.sponsor
  return (
    <div className="table-scroll">
      <table className="tbl tbl-compact lb-tbl lb-compact">
        <caption className="sr-only">
          How the price of {d.label} ({d.code}) is built{d.sites.b ? ' at Site A and Site B' : ''}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Step</span>
            </th>
            {sides.map(([k, s]) => (
              <th key={k} scope="col" className="num">
                {k}
                <span className="lb-loc">{sideTitle(s)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              Regional adjustments{' '}
              <Tip
                inCard={inCard}
                label="Source of the regional adjustments"
                content={
                  <>
                    <span className="hc-title">Regional adjustments</span>
                    Doctor’s time · practice costs · malpractice insurance, for each site’s Medicare locality. {d.glossary?.gpci}
                    {sides.map(([k, s]) => (
                      <span key={k} className="hc-src">
                        {k}: {s.adjustment_source.label}
                      </span>
                    ))}
                  </>
                }
              />
              <span className="lb-sub">doctor’s time, practice costs, malpractice insurance (top to bottom)</span>
            </th>
            {sides.map(([k, s]) => (
              <td key={k} className="num">
                {IDS.map((i) => (
                  <span key={i} className="lb-stack">
                    {f3(s.adjustment[i])}
                  </span>
                ))}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">
              Medicare rate{' '}
              <Tip
                inCard={inCard}
                label="How the Medicare rate is built, and its sources"
                content={
                  <>
                    <span className="hc-title">Medicare rate</span>
                    Units for this code ({d.components?.map((c) => c.units.toFixed(2)).join(' · ')}) times each site’s regional adjustments, summed, times
                    Medicare dollars per unit ({usd4(d.conversion_factor)}). {d.same_note}
                    <span className="hc-src">
                      Units: {d.units_source?.label}. Dollars per unit: {d.conversion_factor_source?.label}. {d.setting_note}
                    </span>
                  </>
                }
              />
            </th>
            {sides.map(([k, s]) => (
              <td key={k} className="num strong">
                {usd(s.medicare_rate)}
              </td>
            ))}
          </tr>
          {sponsor && sp ? (
            <tr>
              <th scope="row">
                Sponsor price{' '}
                <Tip
                  inCard={inCard}
                  label="How the sponsor price is built (assumptions)"
                  content={
                    <>
                      <span className="hc-title">Sponsor price for this line</span>
                      Medicare rate × {pctText(sp.multiplier)} (the multiplier, an assumption you set) + {pctText(sp.overhead_rate)} overhead (an
                      assumption you set).{' '}
                      {canEdit
                        ? 'Edit both in step 3 or in Detailed view.'
                        : `Shown at ${pctText(sp.multiplier)} and ${pctText(sp.overhead_rate)} overhead; set both in step 3 of Protocol to terms.`}
                    </>
                  }
                />
                <span className="lb-sub">
                  × {pctText(sp.multiplier)}, + {pctText(sp.overhead_rate)} overhead <AssumptionBadge />
                </span>
              </th>
              {sides.map(([k, s]) => (
                <td key={k} className="num strong">
                  {usd(s.sponsor?.sponsor_price)}
                </td>
              ))}
            </tr>
          ) : (
            <tr>
              <th scope="row">Sponsor price</th>
              <td className="muted" colSpan={sides.length}>
                Routine care: billed to insurance at the Medicare rate, not to the sponsor
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function usd4(x: number | undefined): string {
  return x === undefined ? '—' : `$${x.toFixed(4)}`
}

function AssumptionBadge() {
  return (
    <Badge tone="warn" title="Set by you, not a public rate">
      assumption
    </Badge>
  )
}

// ---------------------------------------------------------------------- Detailed: every step

function FullTable({ d, scope }: { d: LineDetail; scope: LineDetailScope | null }) {
  const sides = sidesOf(d)
  const sponsor = d.payer === 'Sponsor' && !!d.sites.a.sponsor
  const sp = d.sites.a.sponsor
  const span = 2
  return (
    <div className="table-scroll">
      <table className="tbl tbl-compact lb-tbl lb-full">
        <caption className="sr-only">
          How the price of {d.label} ({d.code}) is built, step by step{d.sites.b ? ', at Site A and Site B' : ''}
        </caption>
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className="lb-step">
              Step
            </th>
            <th scope="col" rowSpan={2} className="num lb-units">
              Units for this code <InfoTip label="What the units are" content={d.glossary?.rvu ?? ''} />
              <span className="lb-src">
                {d.units_source?.label} <InfoTip label="Exact file and columns for the units" content={d.units_source?.detail ?? ''} />
              </span>
            </th>
            {sides.map(([k, s]) => (
              <th key={k} scope="colgroup" colSpan={span} className="lb-site">
                {k} · {sideTitle(s)}
                <span className="lb-src">
                  {s.adjustment_source.label}{' '}
                  {s.adjustment_source.detail && <InfoTip label={`Exact file and row for ${k}'s adjustments`} content={s.adjustment_source.detail} />}
                </span>
              </th>
            ))}
          </tr>
          <tr>
            {sides.map(([k]) => [
              <th key={`${k}-adj`} scope="col" className="num">
                × Regional adjustment <InfoTip label={`What the regional adjustment is (${k})`} content={d.glossary?.gpci ?? ''} />
              </th>,
              <th key={`${k}-out`} scope="col" className="num">
                = Adjusted units
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {d.components?.map((c) => (
            <tr key={c.id}>
              <th scope="row">
                {c.label} <InfoTip label={`${c.label}: technical terms`} content={c.term} />
              </th>
              <td className="num">{c.units.toFixed(2)}</td>
              {sides.map(([k, s]) => [
                <td key={`${k}-a`} className="num">
                  × {f3(s.adjustment[c.id])}
                </td>,
                <td key={`${k}-o`} className="num">
                  = {s.adjusted_units ? f4(s.adjusted_units[c.id]) : '—'}
                </td>,
              ])}
            </tr>
          ))}
          <tr className="lb-sum">
            <th scope="row">Total units</th>
            <td className="num muted">{d.components ? d.components.reduce((a, c) => a + c.units, 0).toFixed(2) : '—'}</td>
            {sides.map(([k, s]) => (
              <td key={k} className="num strong" colSpan={span}>
                {s.total_units !== undefined ? f4(s.total_units) : '—'}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">
              × Medicare dollars per unit (2026 conversion factor) <InfoTip label="About the conversion factor" content={d.glossary?.nonqpp ?? ''} />
              <span className="lb-src">
                {d.conversion_factor_source?.label}, the same in every locality{' '}
                <InfoTip label="Exact file and column for the conversion factor" content={d.conversion_factor_source?.detail ?? ''} />
              </span>
            </th>
            <td />
            {sides.map(([k]) => (
              <td key={k} className="num" colSpan={span}>
                × {usd4(d.conversion_factor)}
              </td>
            ))}
          </tr>
          <tr className="lb-sum">
            <th scope="row">= Medicare rate</th>
            <td />
            {sides.map(([k, s]) => (
              <td key={k} className="num strong lb-big" colSpan={span}>
                {usd(s.medicare_rate)}
              </td>
            ))}
          </tr>
          {sponsor && sp ? (
            <>
              <tr>
                <th scope="row">
                  <span className="lb-th-line">
                    × multiplier <AssumptionBadge />
                  </span>
                  {scope?.mult ? (
                    <PctBox
                      value={scope.mult.pct}
                      min={10}
                      max={500}
                      step={5}
                      label="Multiplier: percent of Medicare applied to coded items (assumption; the same control as in step 3)"
                      onCommit={scope.mult.set}
                    />
                  ) : (
                    <span className="lb-src">{pctText(sp.multiplier)} of Medicare, set in step 3</span>
                  )}
                </th>
                <td />
                {sides.map(([k, s]) => (
                  <td key={k} className="num" colSpan={span}>
                    × {pctText(s.sponsor?.multiplier ?? sp.multiplier)} = {usd(s.sponsor?.line_price)}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">
                  <span className="lb-th-line">
                    + overhead <AssumptionBadge />
                  </span>
                  {scope?.overhead ? (
                    <PctBox
                      value={Math.round(scope.overhead.value * 1000) / 10}
                      min={0}
                      max={100}
                      step={1}
                      label="Overhead: percent of research items and coordinator time (assumption; the same control as in step 3)"
                      onCommit={(v) => {
                        const o = scope.overhead
                        if (o) o.set(Math.abs(v / 100 - o.def) < 1e-9 ? null : v / 100)
                      }}
                    />
                  ) : (
                    <span className="lb-src">{pctText(sp.overhead_rate)} of research items, set in step 3</span>
                  )}
                </th>
                <td />
                {sides.map(([k, s]) => (
                  <td key={k} className="num" colSpan={span}>
                    + {usd(s.sponsor?.overhead)}
                    <span className="lb-sub">
                      {pctText(s.sponsor?.overhead_rate ?? sp.overhead_rate)} of {usd(s.sponsor?.line_price)}
                    </span>
                  </td>
                ))}
              </tr>
              <tr className="lb-sum lb-final">
                <th scope="row">= Sponsor price for this line</th>
                <td />
                {sides.map(([k, s]) => (
                  <td key={k} className="num strong lb-big" colSpan={span}>
                    {usd(s.sponsor?.sponsor_price)}
                  </td>
                ))}
              </tr>
            </>
          ) : (
            <tr>
              <th scope="row">Sponsor price</th>
              <td colSpan={1 + span * sides.length} className="muted">
                Routine care: billed to insurance at the Medicare rate; the sponsor pays nothing for this line, so no multiplier or overhead applies.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/** Percent box: typed values apply on Enter or when the box loses focus; out-of-range values are not applied. */
function PctBox({
  value,
  min,
  max,
  step,
  label,
  onCommit,
}: {
  value: number
  min: number
  max: number
  step: number
  label: string
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const noteId = useId()
  const ok = (s: string) => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= min && Number(s) <= max
  const commit = (s: string) => {
    setDraft(null)
    if (ok(s)) {
      setMsg(null)
      if (Number(s) !== value) onCommit(Number(s))
    } else setMsg(`${s.trim() === '' ? 'Empty' : `${s}%`} is outside ${min}% to ${max}%; kept ${value}%.`)
  }
  return (
    <span className="lb-pct">
      <span className="lb-pct-row">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={draft ?? String(value)}
          aria-label={label}
          aria-describedby={msg ? noteId : undefined}
          aria-invalid={(draft !== null && !ok(draft)) || undefined}
          onChange={(e) => {
            const s = e.target.value
            setMsg(null)
            const typed = (e.nativeEvent as Partial<InputEvent>).inputType
            if (!typed && ok(s)) commit(s)
            else setDraft(s)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft !== null) commit(draft)
            else if (e.key === 'Escape') setDraft(null)
          }}
          onBlur={() => {
            if (draft !== null) commit(draft)
          }}
        />
        <span aria-hidden="true">%</span>
      </span>
      {msg && (
        <span id={noteId} className="lb-pct-msg" role="status">
          {msg}
        </span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------- notes, reconciliation, CMS link

function Notes({ d, full }: { d: LineDetail; full: boolean }) {
  const sides = sidesOf(d)
  const lookup = d.cms_lookup ? (
    <a className="lb-cms" href={d.cms_lookup.url} target="_blank" rel="noreferrer">
      Check this on CMS<span className="sr-only"> ({d.cms_lookup.label}, opens in a new tab)</span>
      <span aria-hidden="true"> ↗</span>
    </a>
  ) : null
  const setting = (
    <>
      {d.setting_note}{' '}
      <InfoTip label="Office setting (non-facility) rate" content={d.glossary?.non_facility ?? ''} />
    </>
  )
  if (!full) {
    const a = d.sites.a
    return (
      <div className="lb-notes">
        <p>
          {d.same_note}
          {a.sponsor &&
            (a.reconcile.count > 0 ? (
              <>
                {' '}
                In Budget, this line adds {usd(a.reconcile.in_research_items + a.reconcile.in_overhead)} (with overhead) to Site A’s{' '}
                {usd(a.reconcile.per_participant)} per participant.
              </>
            ) : (
              <>
                {' '}
                Priced {a.reconcile.count_text}: each occurrence pays {usd(a.sponsor.sponsor_price)} for this line at Site A, overhead included.
              </>
            ))}
        </p>
        <p className="lb-muted">
          {setting} {lookup}
        </p>
      </div>
    )
  }
  return (
    <div className="lb-notes">
      <p>{d.same_note}</p>
      <p className="lb-muted">{setting}</p>
      {d.payer === 'Sponsor' && (
        <div className="lb-recon">
          <p className="lb-recon-h">How this line reconciles with Budget</p>
          <ul>
            {sides.map(([k, s]) => (
              <Recon key={k} k={k} s={s} />
            ))}
          </ul>
        </div>
      )}
      <p className="lb-muted">{d.rounding_note}</p>
      <p className="lb-muted">
        {lookup} Search code {d.code} for 2026 at the site’s Medicare locality and compare the office-setting price{' '}
        <InfoTip label="Which CMS column to compare" content="CMS labels it the Non-Facility Price: the office-setting rate used in this table." />.
      </p>
    </div>
  )
}

function CardNotes({ d }: { d: LineDetail }) {
  const sides = sidesOf(d)
  return (
    <div className="lb-notes lb-card-notes">
      <p>{d.same_note}</p>
      <p className="lb-muted">
        Units: {d.units_source?.label}. Dollars per unit: {d.conversion_factor_source?.label} ({usd4(d.conversion_factor)}).{' '}
        {sides.map(([k, s]) => `${k} adjustments: ${s.adjustment_source.label}. `)}
        Multiplier and overhead are assumptions you set in step 3.
      </p>
      <p className="lb-muted">{d.setting_note}</p>
      {d.cms_lookup && (
        <p>
          <a className="lb-cms" href={d.cms_lookup.url} target="_blank" rel="noreferrer">
            Check this on CMS<span className="sr-only"> ({d.cms_lookup.label}, opens in a new tab)</span>
            <span aria-hidden="true"> ↗</span>
          </a>
        </p>
      )}
    </div>
  )
}

function Recon({ k, s }: { k: string; s: LineSide }): ReactNode {
  const r = s.reconcile
  if (!s.sponsor) return null
  return (
    <li>
      <strong>{k}</strong> ({s.site.label}): {r.visit_label} counts {r.count_text}
      {r.count > 0 ? (
        <>
          , so this line puts {usd(r.in_research_items)} into research items and {usd(r.in_overhead)} into overhead. Per participant ({r.scope}):
          research items {usd(r.per_participant_research_items)} + coordinator time {usd(r.per_participant_coordinator)} (Concord’s proposed
          standard schedule, an assumption) + overhead {usd(r.per_participant_overhead)} (at the {pctText(s.sponsor.overhead_rate)} overhead assumption) ={' '}
          <span className="strong">{usd(r.per_participant)}</span>
          {r.adds_up ? ', the total shown in Budget.' : ' (does not add up to the cent; report this).'}
        </>
      ) : (
        <>. Each occurrence pays {usd(s.sponsor.sponsor_price)} for this line, overhead included.</>
      )}
    </li>
  )
}
