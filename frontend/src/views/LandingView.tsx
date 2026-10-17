// The landing page (#home, or no hash): outside the app shell. Copy is the copy deck's section A, verbatim. The two
// product windows are real fragments of Portfolio overlap and Protocol to terms (landingData.ts): they render from
// the data pack's values at once and from the live API when it answers.
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { usd } from '../format'
import {
  absUsd,
  calDate,
  cropFromAudit,
  FALLBACK_CROP,
  FALLBACK_TERMS,
  FEATURED,
  HERO_SPONSOR,
  TERMS_NCT,
  TERMS_SITE_A,
  TERMS_SITE_B,
  termsFromCompare,
  type Crop,
  type CropPair,
  type TermsFragment,
} from '../landingData'
import { overlapApi } from '../overlapApi'
import { skipTo } from '../skip'
import { termsApi } from '../termsFlowApi'
import { ThemeControl } from '../theme'
import './landing.css'

const SECTIONS = ['overlap', 'terms', 'tested'] as const
type SectionId = (typeof SECTIONS)[number]
const sectionId = (s: string) => `landing-${s}`

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
      <ThemeControl />
      <a className="btn btn-primary lp-demo" href="#findings">
        See demo →
      </a>
    </div>
  )
}

/** The pair card beside the hero matrix (copy deck A3 "pair hover card", the lines Simple mode shows). */
function PairCard({ crop, sel }: { crop: Crop; sel: Oriented }) {
  const t = new Map(crop.trials.map((x) => [x.nct, x]))
  const A = t.get(sel.a)!
  const B = t.get(sel.b)!
  const p = sel.pair
  return (
    <div className="lp-paircard reveal">
      <p className="lp-paircard-title">
        {A.label} × {B.label}
      </p>
      <p className="lp-paircard-sub">
        {A.nct} · {A.phase} · <span className="num">{A.nSites}</span> registered sites — {B.nct} · {B.phase} · <span className="num">{B.nSites}</span>{' '}
        registered sites
      </p>
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
        <div className="lp-dl-row lp-dl-stack">
          <dt>Both recruiting</dt>
          <dd>
            {p.from ? (
              <>
                since {calDate(p.from)} · <span className="num strong">{p.months.toFixed(1)}</span> months through {calDate(p.to ?? crop.snapshot)}{' '}
                (estimated)
              </>
            ) : (
              'not at the same time'
            )}
          </dd>
        </div>
      </dl>
      <p className="lp-paircard-foot">
        Upper bound: a trial has restrictions the synthetic population can't represent, so these shares are ceilings. Registered sites, not confirmed
        enrolling.
      </p>
    </div>
  )
}

/** The hero: a 7-trial crop of the Portfolio overlap matrix. Hover, focus or tap a cell to show that pair in the card. */
function HeroMatrix({ crop }: { crop: Crop }) {
  const pairs = useMemo(() => new Map(crop.pairs.map((p) => [`${p.p}|${p.q}`, p])), [crop])
  const rows = crop.trials.slice(0, -1)
  const cols = crop.trials.slice(1)
  const [selKey, setSelKey] = useState<[string, string]>(FEATURED)
  const sel = orient(pairs, selKey[0], selKey[1]) ?? orient(pairs, FEATURED[0], FEATURED[1])
  const anyUnreviewed = crop.pairs.some((p) => p.unreviewed)

  return (
    <div className="lp-hero-body">
      <div className="lp-matrix-col">
        <div className="lp-matrix-scroll">
          <div
            role="table"
            className="lp-matrix"
            aria-label={`Shared registered sites for ${crop.trials.length} ${HERO_SPONSOR.replace(' LLC', '')} trials; shade is the larger eligible-patient share`}
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
            Upper bound
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

/** Portfolio overlap section: the featured pair in full (copy deck A3). */
function PairDetail({ crop }: { crop: Crop }) {
  const pairs = useMemo(() => new Map(crop.pairs.map((p) => [`${p.p}|${p.q}`, p])), [crop])
  const sel = orient(pairs, FEATURED[0], FEATURED[1])
  if (!sel) return null
  const t = new Map(crop.trials.map((x) => [x.nct, x]))
  const A = t.get(sel.a)!
  const B = t.get(sel.b)!
  return (
    <div className="win lp-win lp-pair">
      <div className="win-strip">
        <span>
          <span className="win-title">
            {A.label} × {B.label}
          </span>{' '}
          · {HERO_SPONSOR}
        </span>
        <span>As of {calDate(crop.snapshot, true)} · all registered sites worldwide</span>
      </div>
      <div className="lp-win-body">
        <dl className="lp-stats">
          <div>
            <dt>Shared registered sites</dt>
            <dd className="num lp-big">{sel.pair.shared ?? <span className="lp-uncountable">can't be counted</span>}</dd>
          </div>
          <div>
            <dt>
              {A.label}'s eligible patients also eligible for {B.label}
            </dt>
            <dd>
              <span className="num lp-big">{pctInt(sel.o_ab)}%</span> <Marks pair={sel.pair} long />
            </dd>
          </div>
          <div>
            <dt>
              {B.label}'s eligible patients also eligible for {A.label}
            </dt>
            <dd>
              <span className="num lp-big">{pctInt(sel.o_ba)}%</span> <Marks pair={sel.pair} long />
            </dd>
          </div>
        </dl>
        <div className="lp-crit">
          <div className="lp-crit-box">
            <p className="lp-crit-h">Only in {A.label}</p>
            <ul className="lp-crit-list">
              {crop.criteria.onlyA.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="lp-crit-box lp-crit-both">
            <p className="lp-crit-h">Criteria in both</p>
            <ul className="lp-crit-list">
              {crop.criteria.both.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="lp-crit-box">
            <p className="lp-crit-h">Only in {B.label}</p>
            <ul className="lp-crit-list">
              {crop.criteria.onlyB.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="lp-win-foot">
          Upper bound: a trial has restrictions the synthetic population can't represent, so these shares are ceilings. Registered sites, not confirmed
          enrolling.
        </p>
      </div>
    </div>
  )
}

/** Protocol to terms section: two sites priced, and one term-sheet line (copy deck A4). */
function TermsWindow({ f }: { f: TermsFragment }) {
  const total = f.nRoutine + f.nResearch
  const lower = f.delta < 0
  return (
    <div className="win lp-win">
      <div className="win-strip">
        <span>
          <span className="win-title">Protocol to terms</span> · {TERMS_NCT}
        </span>
        <span className="lp-caution">Illustrative, authored from public trial information</span>
      </div>
      <div className="lp-win-body">
        <p className="lp-proto">
          <span className="strong lp-ink">Protocol: {TERMS_NCT}</span> · Fianlimab + cemiplimab + chemotherapy vs placebo + cemiplimab + chemotherapy, first-line advanced
          NSCLC
        </p>
        <div className="lp-terms">
          <div className="lp-terms-main">
            <p className="lp-terms-lead">Two budgets per participant: what the sponsor pays, and what is billable to insurance as routine care.</p>
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
                    <th scope="row">Billable to insurance, per participant (Medicare rates)</th>
                    <td className="num lp-money">{usd(f.a.insurance)}</td>
                    <td className="num lp-money">{usd(f.b.insurance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {lower && (
              <p className="lp-terms-note">
                Site B's sponsor total is {absUsd(f.delta)} lower per participant because Medicare's fee schedule prices the same physician services lower
                in {f.b.localityName}: {absUsd(f.deltaItems)} through CMS's geographic cost indexes (GPCIs), mostly practice expense ({absUsd(f.fromPe)}),
                plus {absUsd(f.deltaOverhead)} of {Math.round(f.overheadRate * 100)}% overhead on that. It reflects the fee schedule, not a saving.
              </p>
            )}
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
          </div>
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
                <dd>The protocol scans every 6 weeks where standard care scans about every 9, so one scan in three is extra.</dd>
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
        </div>
        <p className="lp-win-foot lp-win-foot-rule">
          Sponsor totals also include per-visit research fees (drug dispensing, sample shipping, scan upload, questionnaires, tissue retrieval), coordinator time ($175
          per completed visit) and 25% overhead, all from Concord's proposed standard schedule: a starting point to negotiate against, not market data. Decision
          support, not a fair-market-value legal opinion.
        </p>
      </div>
    </div>
  )
}

export default function LandingView({ focus }: { focus: { id: string | null; n: number } }) {
  const [crop, setCrop] = useState<Crop>(FALLBACK_CROP)
  const [terms, setTerms] = useState<TermsFragment>(FALLBACK_TERMS)

  useEffect(() => {
    document.title = 'Concord'
  }, [])

  // The live fragments: both requests are cheap. On any failure the data-pack values stay.
  useEffect(() => {
    const ctl = new AbortController()
    overlapApi
      .audit({ sponsor: HERO_SPONSOR, as_of: '', region: '' }, ctl.signal)
      .then((a) => {
        const c = cropFromAudit(a)
        if (c && !ctl.signal.aborted) setCrop(c)
      })
      .catch(() => {
        /* keep the data-pack values */
      })
    termsApi
      .compare(TERMS_NCT, TERMS_SITE_A, TERMS_SITE_B, { multiplier: 1, overrides: {}, standard: {} }, ctl.signal)
      .then((c) => {
        const t = termsFromCompare(c)
        if (t && !ctl.signal.aborted) setTerms(t)
      })
      .catch(() => {
        /* keep the data-pack values */
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
            <SectionLink to="overlap" className="lp-navlink">
              Portfolio overlap
            </SectionLink>
            <SectionLink to="terms" className="lp-navlink">
              Protocol to terms
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
              <h1 id="lp-h1">See where your lung cancer trials share registered sites and eligible patients.</h1>
              <p className="lp-sub">
                Concord reads public ClinicalTrials.gov records. It checks a sponsor's lung cancer trials for overlap, and prices a protocol per participant from CMS
                2026 fee schedules and our proposed standard fees, with a source on every line. No forecasts.
              </p>
              <div className="lp-actions">
                <a className="btn btn-primary btn-big lp-cta" href="#findings">
                  See demo →
                </a>
                <SectionLink to="tested" className="lp-quiet">
                  Read what we tested
                </SectionLink>
              </div>
            </div>

            <figure className="lp-hero-fig">
              <div className="win lp-win">
                <div className="win-strip">
                  <span>
                    <span className="win-title">Portfolio overlap</span> · {HERO_SPONSOR} · {calDate(crop.snapshot, true)}
                  </span>
                  <span>
                    All registered sites worldwide ·{' '}
                    <a className="lp-open" href="#overlap">
                      Open in demo →
                    </a>
                  </span>
                </div>
                <HeroMatrix crop={crop} />
              </div>
              <figcaption className="lp-figcap">
                7 of Merck Sharp &amp; Dohme's 16 lung cancer trials recruiting on October 16, 2026, from public ClinicalTrials.gov records: the Phase 3 trials with
                reviewed criteria, less one stage I trial our synthetic population can't tell apart from stage II-IIIB. Number: registered sites both trials list.
                Shade: the larger share of one trial's eligible patients who also qualify for the other, on a synthetic population. Every pair shown is an upper
                bound.
              </figcaption>
            </figure>
          </div>
        </section>

        <section id={sectionId('overlap')} className="lp-section" aria-labelledby="lp-h-overlap">
          <div className="lp-wrap">
            <div className="lp-intro">
              <p className="lp-eyebrow">Portfolio overlap</p>
              <h2 id="lp-h-overlap">Your trials, checked against each other</h2>
              <p className="lp-body">
                Pick a sponsor and a date. Concord lists that sponsor's non-small-cell lung cancer (NSCLC) trials recruiting that day (estimated for past dates) and
                counts the registered sites each pair shares. On a synthetic patient population, it estimates what share of one trial's eligible patients also qualify
                for the other, and lists the criteria that separate the two.
              </p>
            </div>

            <PairDetail crop={crop} />

            <p className="lp-support">
              Sharing sites doesn't mean sharing eligible patients. TroFuse-019 and NCT06422143 share 41 registered sites, and no synthetic patient is eligible for
              both.
            </p>

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
          </div>
        </section>

        <section id={sectionId('terms')} className="lp-section" aria-labelledby="lp-h-terms">
          <div className="lp-wrap">
            <div className="lp-intro">
              <p className="lp-eyebrow">Protocol to terms</p>
              <h2 id="lp-h-terms">From protocol to priced term sheet</h2>
              <p className="lp-body">
                Concord reads a protocol's schedule of assessments and marks each item routine care (billable to insurance) or research-only (paid by the sponsor),
                with the rule and reason shown. It prices physician services from the CMS 2026 physician fee schedule at the site's Medicare locality, lab tests from
                the CMS 2026 clinical lab fee schedule, and non-procedure fees from a proposed standard schedule. Every term-sheet line keeps its source; fee-schedule
                items also show their code, and physician services show the formula, so site and sponsor negotiate from the same numbers.
              </p>
            </div>
            <TermsWindow f={terms} />
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
                  See every table in the demo →
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
                <p className="strong">ClinicalTrials.gov</p>
                <p>7,221 NSCLC trials · snapshot October 16, 2026</p>
              </li>
              <li>
                <p className="strong">CMS 2026 Physician Fee Schedule</p>
                <p>RVU file, October release · conversion factor $33.4009 · Medicare locality GPCIs</p>
              </li>
              <li>
                <p className="strong">CMS 2026 Clinical Laboratory Fee Schedule</p>
                <p>Q4 release · national limitation amounts</p>
              </li>
              <li>
                <p className="strong">Concord proposed standard schedule</p>
                <p>Coordinator time, overhead and per-visit research fees · a starting point to negotiate against, not market data</p>
              </li>
              <li>
                <p className="strong">Medicare NCD 310.1</p>
                <p>Routine costs in clinical trials</p>
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
            <h2 id="lp-h-close">See portfolio overlap and a priced protocol in the working app.</h2>
            <a className="btn btn-primary btn-big lp-cta" href="#findings">
              See demo →
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
            <li>Protocol to terms is decision support priced from CMS 2026 fee schedules and a proposed standard schedule. It is not a fair-market-value legal opinion.</li>
            <li>Eligibility overlap is computed on a synthetic patient population, not patient records.</li>
            <li>Shared sites are sites registered on ClinicalTrials.gov, not sites confirmed to be enrolling.</li>
            <li>Registry snapshot: October 16, 2026.</li>
            <li>Demo protocol NCT05800015 is illustrative, authored from public trial information.</li>
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
