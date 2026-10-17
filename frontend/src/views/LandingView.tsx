// The landing page (#home, or no hash): outside the app shell. It leads with Protocol to terms (the product); Portfolio
// overlap is the second tool. The two product windows are real fragments of those tabs (landingData.ts): they render
// from saved API values at once and from the live API when it answers. Simple shows each section's key numbers and
// one sentence, with sources in hover cards; Detailed shows every line.
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { InfoTip } from '../components'
import { DensityControl, useDensity } from '../density'
import { usd } from '../format'
import {
  absUsd,
  calDate,
  cropFromAudit,
  FALLBACK_CROP,
  FALLBACK_TERMS,
  FEATURED,
  OVERLAP_QUERY,
  TERMS_GLOSS,
  TERMS_NCT,
  TERMS_SITE_A,
  TERMS_SITE_B,
  termsFromCompare,
  TRIAL_GLOSS,
  type Crop,
  type CropPair,
  type TermsFragment,
  type TermsSide,
} from '../landingData'
import { overlapApi } from '../overlapApi'
import { skipTo } from '../skip'
import { DISCLAIMER, ILLUSTRATIVE, termsApi } from '../termsFlowApi'
import { ThemeControl } from '../theme'
import './landing.css'

const SECTIONS = ['terms', 'overlap', 'tested'] as const
type SectionId = (typeof SECTIONS)[number]
const sectionId = (s: string) => `landing-${s}`
/** The primary action everywhere on the page. */
const TERMS_HREF = '#terms-flow'
const TERMS_CTA = 'Open Protocol to terms →'
/** The Portfolio overlap tab with the same preset and pair the preview shows. */
const OVERLAP_HREF = '#overlap/regeneron'

const SRC_PFS = 'CMS 2026 Physician Fee Schedule, RVU file, October release (rvu26d.zip), conversion factor $33.4009, at the site’s Medicare locality (GPCIs)'
const SRC_CLFS = 'CMS 2026 Clinical Laboratory Fee Schedule, national amounts'
const SRC_STANDARD =
  'Assumption: Concord’s proposed standard schedule (coordinator time $175 per completed visit, 25% overhead, per-visit research fees). A starting point to negotiate against, not market data.'

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function scrollToSection(s: string, smooth: boolean) {
  const el = document.getElementById(sectionId(s))
  if (!el) return
  el.scrollIntoView({ behavior: smooth && !reducedMotion() ? 'smooth' : 'auto', block: 'start' })
}

/** In-page link to a section: #home/<section>, so it can be shared and survives a reload; the click scrolls without
 *  going through the router. */
function SectionLink({ to, className, children }: { to: SectionId; className?: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    try {
      window.history.pushState(null, '', `#home/${to}`)
    } catch {
      /* ignore */
    }
    scrollToSection(to, true)
  }
  return (
    <a className={className} href={`#home/${to}`} onClick={onClick}>
      {children}
    </a>
  )
}

const pctInt = (x: number) => Math.round(x * 100)
/** Shade step of the larger eligible-patient share (rounded as shown): 0, under 25, under 50, under 80, 80 or more. */
const heat = (share: number) => {
  const s = pctInt(share)
  return s === 0 ? 0 : s < 25 ? 1 : s < 50 ? 2 : s < 80 ? 3 : 4
}

interface Oriented {
  a: string
  b: string
  pair: CropPair
  o_ab: number
  o_ba: number
}

function orient(pairs: Map<string, CropPair>, a: string, b: string): Oriented | null {
  const p = pairs.get(`${a}|${b}`)
  if (p) return { a, b, pair: p, o_ab: p.o_pq, o_ba: p.o_qp }
  const r = pairs.get(`${b}|${a}`)
  if (r) return { a, b, pair: r, o_ab: r.o_qp, o_ba: r.o_pq }
  return null
}

function Marks({ pair, long }: { pair: CropPair; long?: boolean }) {
  return (
    <>
      {pair.upperBound && <span className="lp-mark">{long ? '† Upper bound' : '†'}</span>}
      {pair.unreviewed && <span className="lp-mark">{long ? '‡ Unreviewed' : '‡'}</span>}
    </>
  )
}

function HeadControls() {
  return (
    <div className="lp-head-ctl">
      <DensityControl />
      <ThemeControl />
      <a className="btn btn-primary lp-demo" href={TERMS_HREF}>
        {TERMS_CTA}
      </a>
    </div>
  )
}

/** "U.S. " when the preview counts U.S. sites only ("registered U.S. sites"), else nothing. */
const regionWord = (crop: Crop) => (crop.regionLabel.includes('U.S.') ? 'U.S. ' : '')

const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`)

const shortName = (sponsor: string) => sponsor.replace(/ (LLC|Inc\.?|Pharmaceuticals)$/, '')

/** How recruiting on a date before the snapshot is estimated (the Portfolio overlap tab's wording): ClinicalTrials.gov
 *  registers a start and a primary completion, not when recruiting closed. */
const WINDOW_ASSUMPTION =
  "estimated: from each trial's registered start to start + 65% of the time to its registered primary completion, bounded by its status at the snapshot; the 65% is an assumption"

/** "September 1, 2024 (estimated: ... the 65% is an assumption ...)" or, on the snapshot date, a registry fact. Simple
 *  keeps the assumption label visible and puts the method in a hover card. */
function AsOf({ crop, detailed }: { crop: Crop; detailed: boolean }) {
  if (crop.basis !== 'estimated') return <>{calDate(crop.asOf)} (registry status)</>
  if (detailed) return <>{`${calDate(crop.asOf)} (${WINDOW_ASSUMPTION})`}</>
  return (
    <>
      {calDate(crop.asOf)} (estimated; the recruiting window is an assumption{' '}
      <InfoTip label="How recruiting on a past date is estimated" content={`Recruiting on ${calDate(crop.asOf)} is ${WINDOW_ASSUMPTION}.`} />)
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Protocol to terms

const sourcesCard = (
  <span className="lp-src">
    <span className="hc-title">Where these numbers come from</span>
    <span>Physician services: {SRC_PFS}.</span>
    <span>Lab tests: {SRC_CLFS}.</span>
    <span>Coverage: Medicare NCD 310.1 (routine costs in clinical trials), by Concord’s rules; the payer decides coverage.</span>
    <span>{SRC_STANDARD}</span>
  </span>
)

const insuranceCard =
  'Medicare rates for the routine-care lines, a public benchmark for fair-value reasoning in sponsor-site negotiation. Billed to the participant’s insurer, not part of the sponsor’s total and never subtracted from it.'

const pct0 = (part: number, whole: number) => Math.round((part / whole) * 100)
const rest = (s: TermsSide) => (s.split ? s.sponsor - s.split.cms : 0)

/** How much of the sponsor total is priced from public CMS fee schedules before anyone negotiates, and how much comes
 *  from the proposed standard schedule (an assumption). Computed from the comparison's own lines and totals. */
function PublicShare({ f, detailed }: { f: TermsFragment; detailed: boolean }) {
  const a = f.a.split!
  const b = f.b.split
  const breakdown = (s: TermsSide) =>
    s.split
      ? `per-visit research fees ${usd(s.split.fees)}, coordinator time ${usd(s.split.coordinator)} and ${Math.round(f.overheadRate * 100)}% overhead ${usd(s.split.overhead)}`
      : ''
  const card = (
    <span className="lp-src">
      <span className="hc-title">Priced from public sources, and the rest</span>
      <span>
        {usd(a.cms)} at Site A: the research-only procedures with a CPT or lab code, over the fixed schedule ({f.scope.replace(/\.$/, '').toLowerCase()}),
        priced from the {SRC_PFS}, and the {SRC_CLFS}, at 100% of Medicare.
      </span>
      <span>
        {usd(rest(f.a))}: {breakdown(f.a)}. {SRC_STANDARD}
      </span>
    </span>
  )
  if (!detailed)
    return (
      <p className="lp-terms-note lp-public">
        <span className="num strong lp-ink">{usd(a.cms)}</span> ({pct0(a.cms, f.a.sponsor)}%) of Site A's {usd(f.a.sponsor)} is priced from public CMS 2026 fee
        schedules, so both sides can check it; the other <span className="num strong lp-ink">{usd(rest(f.a))}</span> comes from Concord's proposed standard
        schedule, an assumption left to negotiate. <InfoTip label="What is priced from public sources" content={card} />
      </p>
    )
  return (
    <p className="lp-terms-note lp-public">
      Priced from public sources before anyone negotiates: <span className="num strong lp-ink">{usd(a.cms)}</span> of Site A's {usd(f.a.sponsor)} (
      {pct0(a.cms, f.a.sponsor)}%)
      {b && (
        <>
          {' '}
          and <span className="num strong lp-ink">{usd(b.cms)}</span> of Site B's {usd(f.b.sponsor)} ({pct0(b.cms, f.b.sponsor)}%)
        </>
      )}
      : the research procedures, at CMS 2026 fee-schedule rates (100% of Medicare; the multiplier is itself a term in Protocol to terms). Left to negotiate:{' '}
      <span className="num strong lp-ink">{usd(rest(f.a))}</span> at Site A from Concord's proposed standard schedule (assumption): {breakdown(f.a)}
      {b && <>; at Site B, {breakdown(f.b)}</>}. <InfoTip label="What is priced from public sources" content={card} />
    </p>
  )
}

/** Protocol to terms section: two sites priced, and (Detailed) one term-sheet line with its formula. */
function TermsWindow({ f }: { f: TermsFragment }) {
  const detailed = useDensity().density === 'detailed'
  const total = f.nRoutine + f.nResearch
  const lower = f.delta < 0
  return (
    <div className="win lp-win">
      <div className="win-strip">
        <span>
          <span className="win-title">Protocol to terms</span> · {TERMS_NCT}
        </span>
        <span>
          <span className="lp-caution">{ILLUSTRATIVE}</span> ·{' '}
          <a className="lp-open" href={TERMS_HREF}>
            Open →
          </a>
        </span>
      </div>
      <div className="lp-win-body">
        <p className="lp-proto">
          <span className="strong lp-ink">Protocol: {TERMS_NCT}</span> · {TERMS_GLOSS}
        </p>
        <div className={detailed ? 'lp-terms' : 'lp-terms lp-terms-simple'}>
          <div className="lp-terms-main">
            <p className="lp-terms-lead">
              Two budgets per participant: what the sponsor pays, and what is billable to insurance as routine care.{' '}
              <InfoTip label="Sources for these prices" content={sourcesCard} />
            </p>
            <div className="table-scroll">
              <table className="lp-tbl">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Measure</span>
                    </th>
                    <th scope="col">Site A</th>
                    <th scope="col">Site B</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Site</th>
                    <td>{f.a.site}</td>
                    <td>{f.b.site}</td>
                  </tr>
                  <tr>
                    <th scope="row">Medicare locality</th>
                    <td>
                      <span className="num">{f.a.localityCode}</span> · {f.a.localityName}
                    </td>
                    <td>
                      <span className="num">{f.b.localityCode}</span> · {f.b.localityName}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Paid by sponsor, per participant</th>
                    <td className="num lp-money">{usd(f.a.sponsor)}</td>
                    <td className="num lp-money">{usd(f.b.sponsor)}</td>
                  </tr>
                  <tr>
                    <th scope="row">
                      Billable to insurance, per participant (Medicare rates) <InfoTip label="About the insurance amounts" content={insuranceCard} />
                    </th>
                    <td className="num lp-money">{usd(f.a.insurance)}</td>
                    <td className="num lp-money">{usd(f.b.insurance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {f.a.split && <PublicShare f={f} detailed={detailed} />}
            {lower &&
              (detailed ? (
                <p className="lp-terms-note">
                  Site B's sponsor total is {absUsd(f.delta)} lower per participant because Medicare's fee schedule prices the same physician services lower
                  in {f.b.localityName}: {absUsd(f.deltaItems)} through CMS's geographic cost indexes (GPCIs), mostly practice expense ({absUsd(f.fromPe)}),
                  plus {absUsd(f.deltaOverhead)} of {Math.round(f.overheadRate * 100)}% overhead on that. It reflects the fee schedule, not a saving.
                </p>
              ) : (
                <p className="lp-terms-note">
                  Site B's sponsor total is {absUsd(f.delta)} lower per participant because Medicare prices the same physician services lower in {f.b.localityName}
                  : the fee schedule, not a saving.
                </p>
              ))}
            {detailed && (
              <>
                <p className="lp-terms-scope">{f.scope}</p>
                <div className="lp-lines">
                  <p>
                    <span className="num lp-ink strong">{total}</span> lines: <span className="num lp-ink strong">{f.nRoutine}</span> routine care (billable to
                    insurance), <span className="num lp-ink strong">{f.nResearch}</span> research (sponsor).
                  </p>
                  <div className="lp-lines-bar" aria-hidden="true">
                    <span style={{ flexGrow: f.nRoutine }} className="lp-lines-routine" />
                    <span style={{ flexGrow: f.nResearch }} className="lp-lines-research" />
                  </div>
                </div>
              </>
            )}
          </div>
          {detailed && (
            <div className="lp-sheet">
              <p className="lp-sheet-h">Term sheet · Cycle 7 Day 1</p>
              <dl className="lp-sheet-dl">
                <div>
                  <dt>Visit</dt>
                  <dd>Cycle 7 Day 1</dd>
                </div>
                <div>
                  <dt>Item</dt>
                  <dd>
                    CT chest with contrast · <span className="num">71260</span>
                  </dd>
                </div>
                <div>
                  <dt>Coverage</dt>
                  <dd>
                    <span className="strong">Research</span> · R4: More frequent than standard care
                  </dd>
                </div>
                <div>
                  <dt>Why</dt>
                  <dd>
                    The protocol scans every 6 weeks where Concord's authored standard-care reference (an assumption, not a coverage determination) scans about
                    every 9, so one scan in three is extra.
                  </dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd>
                    <span className="num strong">{usd(f.ctA)}</span> at Site A · <span className="num strong">{usd(f.ctB)}</span> at Site B
                  </dd>
                </div>
                <div>
                  <dt>Formula (Site A)</dt>
                  <dd className="num lp-formula">{f.ctFormulaA}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>CMS 2026 Physician Fee Schedule, RVU file, October release (rvu26d.zip)</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
        <p className="lp-win-foot lp-win-foot-rule">
          {detailed && (
            <>
              Sponsor totals also include per-visit research fees (drug dispensing, sample shipping, scan upload, questionnaires, tissue retrieval), coordinator
              time ($175 per completed visit) and 25% overhead, all from Concord's proposed standard schedule: an assumption, a starting point to negotiate
              against, not market data.{' '}
            </>
          )}
          {!detailed && <>Coordinator time, overhead and per-visit fees are labeled assumptions from Concord’s proposed standard schedule. </>}
          <span className="strong">Decision support, not a fair-market-value legal opinion.</span>
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Portfolio overlap

/** The pair card beside the preview matrix: the selected pair's key numbers (Detailed adds the window and glosses). */
function PairCard({ crop, sel }: { crop: Crop; sel: Oriented }) {
  const detailed = useDensity().density === 'detailed'
  const t = new Map(crop.trials.map((x) => [x.nct, x]))
  const A = t.get(sel.a)!
  const B = t.get(sel.b)!
  const p = sel.pair
  const region = regionWord(crop)
  return (
    <div className="lp-paircard reveal">
      <p className="lp-paircard-title">
        {A.label} × {B.label}
      </p>
      <p className="lp-paircard-sub">
        {A.nct} · {A.phase} · <span className="num">{A.nSites}</span> registered {region}sites — {B.nct} · {B.phase} · <span className="num">{B.nSites}</span>{' '}
        registered {region}sites
      </p>
      {detailed && (TRIAL_GLOSS[A.nct] || TRIAL_GLOSS[B.nct]) && (
        <ul className="lp-gloss">
          {[A, B].map((x) => TRIAL_GLOSS[x.nct] && <li key={x.nct}>{`${x.nct}: ${TRIAL_GLOSS[x.nct]}`}</li>)}
        </ul>
      )}
      <dl className="lp-dl">
        <div className="lp-dl-row">
          <dt>Shared registered sites</dt>
          <dd className="num lp-fig">{p.shared ?? <span className="lp-uncountable">can't be counted (sites anonymized on CT.gov)</span>}</dd>
        </div>
        <div className="lp-dl-row">
          <dt>
            {A.label}'s eligible patients also eligible for {B.label}
          </dt>
          <dd>
            <span className="num lp-fig">{pctInt(sel.o_ab)}%</span>
            <br />
            <span className="lp-marks-sm">
              <Marks pair={p} long />
            </span>
          </dd>
        </div>
        <div className="lp-dl-row">
          <dt>
            {B.label}'s eligible patients also eligible for {A.label}
          </dt>
          <dd>
            <span className="num lp-fig">{pctInt(sel.o_ba)}%</span>
            <br />
            <span className="lp-marks-sm">
              <Marks pair={p} long />
            </span>
          </dd>
        </div>
        {detailed && (
          <div className="lp-dl-row lp-dl-stack">
            <dt>Both recruiting</dt>
            <dd>
              {p.from ? (
                <>
                  since {calDate(p.from)} · <span className="num strong">{p.months.toFixed(1)}</span> months through {calDate(p.to ?? crop.snapshot)}{' '}
                  (estimated with the 65% recruiting-window assumption)
                </>
              ) : (
                'not at the same time'
              )}
            </dd>
          </div>
        )}
      </dl>
      <p className="lp-paircard-foot">
        {p.upperBound
          ? "Upper bound: a trial has restrictions the synthetic population can't represent, so these shares are ceilings. "
          : `Shares are estimates on a synthetic population of ${crop.population.toLocaleString('en-US')} simulated patients, not patient records. `}
        Registered sites, not confirmed enrolling.
      </p>
    </div>
  )
}

/** The preview: the Regeneron preset's matrix. Hover, focus or tap a cell to show that pair in the card. */
function OverlapMatrix({ crop }: { crop: Crop }) {
  const pairs = useMemo(() => new Map(crop.pairs.map((p) => [`${p.p}|${p.q}`, p])), [crop])
  const rows = crop.trials.slice(0, -1)
  const cols = crop.trials.slice(1)
  const [selKey, setSelKey] = useState<[string, string]>(FEATURED)
  const sel = orient(pairs, selKey[0], selKey[1]) ?? orient(pairs, FEATURED[0], FEATURED[1])
  const anyUpper = crop.pairs.some((p) => p.upperBound)
  const anyUnreviewed = crop.pairs.some((p) => p.unreviewed)

  return (
    <div className="lp-hero-body">
      <div className="lp-matrix-col">
        <div className="lp-matrix-scroll">
          <div
            role="table"
            className="lp-matrix"
            style={{ '--lp-cols': cols.length } as CSSProperties}
            aria-label={`Shared registered sites for ${crop.trials.length} ${shortName(crop.sponsor)} trials; shade is the larger eligible-patient share`}
          >
            <div role="row" className="lp-mrow">
              <div role="columnheader" className="lp-corner">
                Row × column
              </div>
              {cols.map((c) => (
                <div role="columnheader" key={c.nct} className="lp-colh">
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
            {rows.map((r, i) => (
              <div role="row" className="lp-mrow" key={r.nct}>
                <div role="rowheader" className="lp-rowh">
                  <span className="lp-rowh-label">{r.label}</span>
                  <span className="lp-rowh-sub">{r.phase}</span>
                </div>
                {cols.map((c, j) => {
                  if (j < i) return <div role="cell" key={c.nct} className="lp-cell-empty" />
                  const o = orient(pairs, r.nct, c.nct)
                  if (!o) return <div role="cell" key={c.nct} className="lp-cell-empty" />
                  const share = Math.max(o.o_ab, o.o_ba)
                  const on = !!sel && sel.pair === o.pair
                  const desc =
                    `${r.label} and ${c.label}: ` +
                    (o.pair.shared === null ? "shared sites can't be counted" : `${o.pair.shared} shared registered sites`) +
                    `, larger eligible-patient share ${pctInt(share)}%` +
                    (o.pair.upperBound ? ', upper bound' : '') +
                    (o.pair.unreviewed ? ', unreviewed criteria' : '')
                  return (
                    <div role="cell" key={c.nct}>
                      <button
                        type="button"
                        className={`lp-cell heat-${heat(share)}${on ? ' lp-cell-on' : ''}`}
                        aria-pressed={on}
                        aria-label={desc}
                        onPointerEnter={(e) => {
                          if (e.pointerType === 'mouse') setSelKey([r.nct, c.nct])
                        }}
                        onFocus={() => setSelKey([r.nct, c.nct])}
                        onClick={() => setSelKey([r.nct, c.nct])}
                      >
                        {o.pair.shared !== null && <span className="num lp-cell-n">{o.pair.shared}</span>}
                        <span className="lp-cell-mk" aria-hidden="true">
                          {o.pair.upperBound ? '†' : ''}
                          {o.pair.unreviewed ? '‡' : ''}
                        </span>
                        {pctInt(share) >= 80 && <span className="lp-cell-hi" aria-hidden="true" />}
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="lp-legend">
          <span className="lp-legend-item">
            Shade
            <span className="lp-sw heat-0" />
            <span className="lp-sw heat-1" />
            <span className="lp-sw heat-2" />
            <span className="lp-sw heat-3" />
            <span className="lp-sw heat-4" />
            <span className="num">0% → 100%</span>
          </span>
          <span className="lp-legend-item">
            <span className="lp-legend-dot" aria-hidden="true" />
            80% or more, one way
          </span>
          <span>
            <span aria-hidden="true" className="strong">
              †
            </span>{' '}
            Upper bound{anyUpper ? '' : ' (none in this view)'}
          </span>
          {anyUnreviewed && (
            <span>
              <span aria-hidden="true" className="strong">
                ‡
              </span>{' '}
              Unreviewed
            </span>
          )}
        </div>
      </div>
      {sel && <PairCard crop={crop} sel={sel} />}
    </div>
  )
}

/** Detailed: the featured pair's criteria, side by side. */
function PairCriteria({ crop }: { crop: Crop }) {
  const [a, b] = FEATURED
  const { both, onlyA, onlyB } = crop.criteria
  const box = (h: string, items: string[], cls = '') => (
    <div className={`lp-crit-box${cls}`}>
      <p className="lp-crit-h">{h}</p>
      {items.length ? (
        <ul className="lp-crit-list">
          {items.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : (
        <p className="lp-crit-none">None</p>
      )}
    </div>
  )
  return (
    <div className="lp-crit lp-crit-pad">
      {box(`Only in ${a}`, onlyA)}
      {box('Criteria in both', both, ' lp-crit-both')}
      {box(`Only in ${b}`, onlyB)}
    </div>
  )
}

/** Two contrasts the preview's own pairs show (computed from the data shown, so they follow the live response). */
function Contrasts({ crop }: { crop: Crop }) {
  const region = regionWord(crop)
  const sitesNoPatients = crop.pairs
    .filter((p) => (p.shared ?? 0) > 0 && p.o_pq === 0 && p.o_qp === 0)
    .sort((x, y) => (y.shared ?? 0) - (x.shared ?? 0))[0]
  const patientsNoSites = crop.pairs.filter((p) => p.shared === 0 && pctInt(Math.max(p.o_pq, p.o_qp)) >= 80).sort((x, y) => Math.max(y.o_pq, y.o_qp) - Math.max(x.o_pq, x.o_qp))[0]
  if (!sitesNoPatients && !patientsNoSites) return null
  return (
    <p className="lp-support">
      {sitesNoPatients && (
        <>
          Sharing sites doesn't mean sharing eligible patients: {sitesNoPatients.p} and {sitesNoPatients.q} share{' '}
          <span className="num">{sitesNoPatients.shared}</span> registered {region}sites, and no synthetic patient is eligible for both.{' '}
        </>
      )}
      {patientsNoSites && (
        <>
          The reverse holds too: {patientsNoSites.p} and {patientsNoSites.q} share no registered {region}site, yet up to{' '}
          <span className="num">{pctInt(Math.max(patientsNoSites.o_pq, patientsNoSites.o_qp))}%</span> of one trial's eligible patients also qualify for the
          other.
        </>
      )}
    </p>
  )
}

export default function LandingView({ focus }: { focus: { id: string | null; n: number } }) {
  const detailed = useDensity().density === 'detailed'
  const [crop, setCrop] = useState<Crop>(FALLBACK_CROP)
  const [terms, setTerms] = useState<TermsFragment>(FALLBACK_TERMS)

  useEffect(() => {
    document.title = 'Concord'
  }, [])

  // The live fragments: both requests are cheap. On any failure the saved values stay.
  useEffect(() => {
    const ctl = new AbortController()
    termsApi
      .compare(TERMS_NCT, TERMS_SITE_A, TERMS_SITE_B, { multiplier: 1, overrides: {}, standard: {} }, ctl.signal)
      .then((c) => {
        const t = termsFromCompare(c)
        if (t && !ctl.signal.aborted) setTerms(t)
      })
      .catch(() => {
        /* keep the saved values */
      })
    overlapApi
      .audit(OVERLAP_QUERY, ctl.signal)
      .then((a) => {
        const c = cropFromAudit(a)
        if (c && !ctl.signal.aborted) setCrop(c)
      })
      .catch(() => {
        /* keep the saved values */
      })
    return () => ctl.abort()
  }, [])

  // #home/<section>: on load and when the hash names a section.
  useEffect(() => {
    if (!focus.id) return
    const s = focus.id.toLowerCase()
    if (!(SECTIONS as readonly string[]).includes(s)) return
    const id = window.requestAnimationFrame(() => scrollToSection(s, focus.n > 0))
    return () => window.cancelAnimationFrame(id)
  }, [focus])

  const toTop = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    try {
      window.history.pushState(null, '', '#home')
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  const region = regionWord(crop)

  return (
    <div className="lp">
      <a className="skip" href="#landing-main" onClick={(e) => skipTo(e, 'landing-main')}>
        Skip to content
      </a>

      <header className="lp-head">
        <div className="lp-head-in">
          <a className="wordmark" href="#home" onClick={toTop}>
            Concord
          </a>
          <nav className="lp-nav" aria-label="Page sections">
            <SectionLink to="terms" className="lp-navlink">
              Protocol to terms
            </SectionLink>
            <SectionLink to="overlap" className="lp-navlink">
              Portfolio overlap
            </SectionLink>
            <SectionLink to="tested" className="lp-navlink">
              What we tested
            </SectionLink>
          </nav>
          <HeadControls />
        </div>
      </header>

      <main id="landing-main" tabIndex={-1}>
        <section className="lp-hero" aria-labelledby="lp-h1">
          <div className="lp-wrap">
            <div className="lp-hero-text reveal">
              <h1 id="lp-h1">Turn a trial protocol into a budget both sides can check.</h1>
              <p className="lp-sub">
                Concord prices every procedure from public Medicare rates, separates what insurance covers from what the sponsor pays, and shows how much of the budget is
                settled before anyone negotiates. Demonstrated on lung cancer trials from ClinicalTrials.gov.
              </p>
              <div className="lp-actions">
                <a className="btn btn-primary btn-big lp-cta" href={TERMS_HREF}>
                  {TERMS_CTA}
                </a>
                <SectionLink to="tested" className="lp-quiet">
                  Read what we tested
                </SectionLink>
              </div>
            </div>
          </div>
        </section>

        <section id={sectionId('terms')} className="lp-section lp-section-first" aria-labelledby="lp-h-terms">
          <div className="lp-wrap">
            <div className="lp-intro">
              <p className="lp-eyebrow">Protocol to terms</p>
              <h2 id="lp-h-terms">From protocol to priced term sheet</h2>
              {detailed ? (
                <p className="lp-body">
                  Concord reads a protocol's schedule of assessments and marks each item routine care (billable to insurance) or research-only (paid by the sponsor),
                  with the rule and reason shown. It prices physician services from the CMS 2026 physician fee schedule at the site's Medicare locality, lab tests from
                  the CMS 2026 clinical lab fee schedule, and non-procedure fees from a proposed standard schedule, labeled as an assumption. Every term-sheet line keeps
                  its source; fee-schedule items also show their code, and physician services show the formula, so site and sponsor negotiate from the same numbers.
                </p>
              ) : (
                <p className="lp-body">
                  Each item in the schedule of assessments is marked routine care or research and priced from public CMS fee schedules, so site and sponsor negotiate
                  from the same numbers.
                </p>
              )}
            </div>
            <TermsWindow f={terms} />
          </div>
        </section>

        <section id={sectionId('overlap')} className="lp-section" aria-labelledby="lp-h-overlap">
          <div className="lp-wrap">
            <div className="lp-intro">
              <p className="lp-eyebrow">Portfolio overlap · a second tool</p>
              <h2 id="lp-h-overlap">A sponsor's trials, checked against each other</h2>
              {detailed ? (
                <p className="lp-body">
                  Pick a sponsor and a date. Concord lists that sponsor's non-small-cell lung cancer (NSCLC) trials recruiting that day (estimated for past dates, with an assumed recruiting window) and
                  counts the registered sites each pair shares. On a synthetic patient population, it estimates what share of one trial's eligible patients also qualify
                  for the other, and lists the criteria that separate the two. Counts and shares only: no forecasts.
                </p>
              ) : (
                <p className="lp-body">
                  For one sponsor on one date: the registered sites each pair of its lung cancer trials shares, and what share of one trial's eligible patients
                  also qualify for the other, on a synthetic population.
                </p>
              )}
            </div>

            <figure className="lp-ov-fig">
              <div className="win lp-win">
                <div className="win-strip">
                  <span>
                    <span className="win-title">Portfolio overlap</span> · {crop.sponsor} · {calDate(crop.asOf, true)}
                  </span>
                  <span>
                    {crop.regionLabel} ·{' '}
                    <a className="lp-open" href={OVERLAP_HREF}>
                      Open in Portfolio overlap →
                    </a>
                  </span>
                </div>
                <OverlapMatrix crop={crop} />
                {detailed && <PairCriteria crop={crop} />}
              </div>
              <figcaption className="lp-figcap">
                {possessive(crop.sponsor)} <span className="num">{crop.trials.length}</span> NSCLC trials recruiting on <AsOf crop={crop} detailed={detailed} />, from public ClinicalTrials.gov records
                (snapshot {calDate(crop.snapshot)}). Number: registered {region}sites both trials list, not sites confirmed enrolling. Shade: the larger share of one
                trial's eligible patients who also qualify for the other, on a synthetic population of {crop.population.toLocaleString('en-US')} simulated patients.
                {detailed && " † marks an upper bound: a trial has a restriction the synthetic population can't represent, so the share is a ceiling."}
              </figcaption>
            </figure>

            {detailed && <Contrasts crop={crop} />}

            {detailed && (
              <div className="lp-self">
                <div>
                  <p className="lp-self-lead">21 same-sponsor pairs, 10 sponsors, since 2015</p>
                  <p className="lp-self-sub">Among industry-sponsored lung cancer trials, each pair:</p>
                </div>
                <div>
                  <ul className="lp-hair">
                    <li>Recruited at the same time</li>
                    <li>Shared at least 10 registered sites</li>
                    <li>On a synthetic patient population, had at least 80% of one trial's eligible patients also eligible for the other</li>
                  </ul>
                  <p className="lp-self-note">
                    We counted only pairs where a person entered and reviewed both trials' criteria.{' '}
                    <span className="lp-caution">19 of the 21 are upper bounds: the true overlap is at most this.</span>
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section id={sectionId('tested')} className="lp-section" aria-labelledby="lp-h-tested">
          <div className="lp-wrap">
            <div className="lp-intro">
              <h2 id="lp-h-tested">What we tested</h2>
              <p className="lp-body">
                Concord began as a way to assign sites to many concurrent trials at once. We tested that idea on public data from 7,221 NSCLC trials. These results
                are why the product now sticks to counts, criteria and sourced prices.
              </p>
            </div>

            <ol className="lp-results">
              <li>
                <h3>Competing trials barely slow each other within a site.</h3>
                <div>
                  <p className="lp-result-key">
                    <span className="num strong">0.09</span>, against the <span className="num strong">1.0</span> our original model assumed.
                  </p>
                  <p className="lp-result-label">Congestion elasticity · 0 means no slowdown</p>
                  <p className="lp-result-plain">
                    About 6% slower enrollment per doubling of overlapping competition at a site, and not statistically significant. At 1.0, a doubling would halve a
                    site's enrollment rate.
                  </p>
                </div>
                <p className="lp-result-q">
                  95% CI 0.00 to 0.30, floored at 0. Before flooring, the regression coefficient's own interval, −0.297 to +0.111, crosses zero (negative means
                  slower). Within-site estimate from 3,442 completed lung trials.
                </p>
              </li>
              <li>
                <h3>Coordinating sites across trials did not hold up on held-out data.</h3>
                <div>
                  <p className="lp-result-key">
                    <span className="num strong">1.42×</span> in-sample, <span className="num strong">1.05×</span> held-out (1.00× = no gain), with{' '}
                    <span className="num strong">51%</span> of trials scored slower than if each chose its sites on its own.
                  </p>
                  <p className="lp-result-key lp-result-key-2">
                    Choosing sites trial by trial held up in the model: <span className="num strong">1.73×</span> and <span className="num strong">1.70×</span> on the
                    two held-out splits. Re-scored post hoc with site rates calibrated to observed enrollment (still scored by our enrollment model), it falls to about{' '}
                    <span className="num strong">1.2×</span> (1.18× and 1.17×; roughly 1.06× to 1.3× across the calibration slope's 95% CI).
                  </p>
                </div>
                <p className="lp-result-q">
                  US-Northeast, 46 trials. Ratios compare total trial-months, scored by our enrollment model, not observed enrollment. In-sample means scored on the same
                  history used to choose the sites, which flatters it. Held-out means sites were chosen with one half of history and scored with the other. The 51% is
                  from the split by time.
                </p>
              </li>
              <li>
                <h3>Public data says only a little about which sites enroll well.</h3>
                <div>
                  <p className="lp-result-key">
                    On later trials it never saw, our model's enrollment-time prediction is typically off by <span className="num strong">1.9×</span>, too long or too
                    short (<span className="num strong">2.8×</span> for a naive estimate).
                  </p>
                </div>
                <p className="lp-result-q">
                  Industry Phase II/III trials; model fit before 2018 and checked on later trials. 64% of U.S. sites (7,486 of 11,710) have fewer than 3 lung trials of
                  history. The registry reports enrollment per trial, never per site.
                </p>
              </li>
            </ol>

            <div className="lp-after">
              <p>These are research results, not product claims. No product view shows a predicted speedup, time-to-fill or enrollment rate.</p>
              <p>
                <a href="#findings" className="strong">
                  See every table in Findings →
                </a>
              </p>
            </div>
          </div>
        </section>

        <section className="lp-sources" aria-labelledby="lp-h-sources">
          <div className="lp-wrap">
            <h2 id="lp-h-sources">Sources</h2>
            <ul>
              <li>
                <p className="strong">CMS 2026 Physician Fee Schedule</p>
                <p>RVU file, October release · conversion factor $33.4009 · Medicare locality GPCIs</p>
              </li>
              <li>
                <p className="strong">CMS 2026 Clinical Laboratory Fee Schedule</p>
                <p>Q4 release · national limitation amounts</p>
              </li>
              <li>
                <p className="strong">Medicare NCD 310.1</p>
                <p>Routine costs in clinical trials</p>
              </li>
              <li>
                <p className="strong">Concord proposed standard schedule</p>
                <p>Assumption: coordinator time, overhead and per-visit research fees · a starting point to negotiate against, not market data</p>
              </li>
              <li>
                <p className="strong">ClinicalTrials.gov</p>
                <p>7,221 NSCLC trials · snapshot October 16, 2026</p>
              </li>
              <li>
                <p className="strong">Synthetic NSCLC population</p>
                <p>20,000 simulated patients · prevalences are rounded modeling assumptions, not patient data</p>
              </li>
            </ul>
          </div>
        </section>

        <section className="lp-close" aria-labelledby="lp-h-close">
          <div className="lp-close-in">
            <h2 id="lp-h-close">Price a protocol line by line, and see where every number comes from.</h2>
            <a className="btn btn-primary btn-big lp-cta" href={TERMS_HREF}>
              {TERMS_CTA}
            </a>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-foot-in">
          <div className="lp-foot-credit">
            <p className="lp-foot-name">Concord</p>
            <p>
              Built by the Bruno Bears, a team from Brown University, for HackHarvard 2026, Regeneron track. · Source code:{' '}
              <a href="https://github.com/CosmicOdyssey/concord">github.com/CosmicOdyssey/concord</a>
            </p>
          </div>
          <ol className="lp-foot-notes">
            <li>Protocol to terms is decision support priced from CMS 2026 fee schedules and a proposed standard schedule. {DISCLAIMER}</li>
            <li>Demo protocol {TERMS_NCT} is illustrative, authored from public trial information.</li>
            <li>Insurance amounts are Medicare-rate benchmarks for fair-value reasoning; they never lower what the sponsor pays.</li>
            <li>Eligibility overlap is computed on a synthetic patient population, not patient records.</li>
            <li>Shared sites are sites registered on ClinicalTrials.gov, not sites confirmed to be enrolling.</li>
            <li>Registry snapshot: October 16, 2026.</li>
            <li>
              Sponsor and trial names come from public ClinicalTrials.gov records. No sponsor shown endorses or uses Concord; Regeneron sponsors the HackHarvard track it
              was built for.
            </li>
          </ol>
        </div>
      </footer>
    </div>
  )
}
