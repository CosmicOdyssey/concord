// Data for the landing page's product windows (views/LandingView.tsx). Both windows are real fragments: they render
// at once from the values below (copied from the live API responses: GET /api/terms-flow/.../compare and GET
// /api/overlap with the Portfolio overlap tab's Regeneron preset), then from the live API (both cheap) when it
// answers. Nothing here is estimated or invented.
import { usd } from './format'
import { FIANLIMAB_PAIR, REGENERON_OVERLAP_PRESET, type OverlapAudit, type OverlapQuery } from './overlapApi'
import type { Compare } from './termsFlowApi'

/** The overlap preview loads the same query as the Portfolio overlap tab's "Regeneron, Sep 1, 2024" preset. */
export const OVERLAP_QUERY: OverlapQuery = REGENERON_OVERLAP_PRESET
/** The pair the preview's card opens on: the two fianlimab trials (NCT05800015 is also the Protocol to terms demo). */
export const FEATURED: [string, string] = FIANLIMAB_PAIR
/** At most this many trials in the preview matrix; a larger live audit keeps the saved values. */
const MAX_TRIALS = 8

/** Short descriptions of the featured trials, paraphrased from their ClinicalTrials.gov official titles. */
export const TRIAL_GLOSS: Record<string, string> = {
  NCT05785767: 'Fianlimab + cemiplimab vs cemiplimab, first-line advanced NSCLC, PD-L1 ≥50%',
  NCT05800015: 'Fianlimab + cemiplimab + chemotherapy vs cemiplimab + chemotherapy, first-line advanced NSCLC, any PD-L1',
}

export interface CropTrial {
  nct: string
  label: string
  phase: string
  nSites: number
}

export interface CropPair {
  p: string
  q: string
  /** Shared registered sites; null when a trial lists only anonymized sites (can't be counted; never shown as 0). */
  shared: number | null
  o_pq: number
  o_qp: number
  months: number
  from: string | null
  to: string | null
  upperBound: boolean
  unreviewed: boolean
}

export interface Crop {
  sponsor: string
  /** The as-of date of the query. */
  asOf: string
  /** Registry snapshot date. */
  snapshot: string
  /** 'estimated': recruiting on the as-of date is estimated from enrollment windows (a date before the snapshot). */
  basis: 'registry' | 'estimated'
  regionLabel: string
  /** Synthetic population size. */
  population: number
  trials: CropTrial[]
  pairs: CropPair[]
  /** Criteria of the featured pair: in both (labels of the first trial), only in the first, only in the second. */
  criteria: { both: string[]; onlyA: string[]; onlyB: string[] }
  live: boolean
}

const T = (nct: string, phase: string, nSites: number): CropTrial => ({ nct, label: nct, phase, nSites })
const P = (p: string, q: string, shared: number, o_pq: number, o_qp: number, months: number, from: string, to: string): CropPair => ({
  p,
  q,
  shared,
  o_pq,
  o_qp,
  months,
  from,
  to,
  upperBound: false,
  unreviewed: false,
})

/** GET /api/overlap?sponsor=Regeneron Pharmaceuticals&as_of=2024-09-01&region=US (registry snapshot 2026-10-16). */
export const FALLBACK_CROP: Crop = {
  sponsor: 'Regeneron Pharmaceuticals',
  asOf: '2024-09-01',
  snapshot: '2026-10-16',
  basis: 'estimated',
  regionLabel: 'All U.S. sites',
  population: 20000,
  live: false,
  trials: [
    T('NCT04077099', 'Phase 1/2', 8),
    T('NCT05557591', 'Phase 2', 9),
    T('NCT05785767', 'Phase 2/3', 23),
    T('NCT05800015', 'Phase 2/3', 29),
    T('NCT06161441', 'Phase 2', 8),
  ],
  pairs: [
    P('NCT04077099', 'NCT05557591', 0, 0.1013, 0.0246, 19.0, '2023-04-21', '2024-11-20'),
    P('NCT04077099', 'NCT05785767', 1, 0.1013, 0.0232, 16.7, '2023-06-30', '2024-11-20'),
    P('NCT04077099', 'NCT05800015', 1, 0.4557, 0.0276, 15.4, '2023-08-08', '2024-11-20'),
    P('NCT04077099', 'NCT06161441', 0, 0.0, 0.0, 4.2, '2024-07-16', '2024-11-20'),
    P('NCT05557591', 'NCT05785767', 0, 1.0, 0.9431, 33.1, '2023-06-30', '2026-04-03'),
    P('NCT05557591', 'NCT05800015', 0, 1.0, 0.2494, 33.6, '2023-08-08', '2026-05-26'),
    P('NCT05557591', 'NCT06161441', 0, 0.0, 0.0, 16.4, '2024-07-16', '2025-11-27'),
    P('NCT05785767', 'NCT05800015', 16, 1.0, 0.2645, 31.8, '2023-08-08', '2026-04-03'),
    P('NCT05785767', 'NCT06161441', 3, 0.0, 0.0, 16.4, '2024-07-16', '2025-11-27'),
    P('NCT05800015', 'NCT06161441', 2, 0.0, 0.0, 16.4, '2024-07-16', '2025-11-27'),
  ],
  criteria: {
    both: [
      'Stage IIIB–IV, not for curative therapy',
      'First line',
      'ECOG 0–1',
      'No active brain metastases',
      'No EGFR mutation',
      'No ALK translocation',
      'No ROS1 fusion',
      'No ILD / pneumonitis',
    ],
    onlyA: ['PD-L1 TPS ≥ 50%', 'Never-smokers excluded'],
    onlyB: [],
  },
}

function phaseText(phases: string[]): string {
  const n = phases.map((p) => p.replace(/^PHASE/, '').replace(/^EARLY_/, 'Early ')).filter(Boolean)
  return n.length ? `Phase ${n.join('/')}` : 'Phase not listed'
}

/** The crop from a live audit, or null when the audit lacks the featured pair or any pair of its trials, or has more
 *  trials than the preview shows (then the saved values stay). */
export function cropFromAudit(a: OverlapAudit): Crop | null {
  const byId = new Map(a.trials.map((t) => [t.nct_id, t]))
  const trials = a.trials
  if (trials.length < 2 || trials.length > MAX_TRIALS || !byId.has(FEATURED[0]) || !byId.has(FEATURED[1])) return null
  const pairs: CropPair[] = a.pairs.map((p) => {
    const countable = (byId.get(p.p)?.n_sites_identified ?? 0) > 0 && (byId.get(p.q)?.n_sites_identified ?? 0) > 0
    return {
      p: p.p,
      q: p.q,
      shared: countable ? p.shared_sites : null,
      o_pq: p.o_pq,
      o_qp: p.o_qp,
      months: p.months_both_recruiting_estimated,
      from: p.both_recruiting_from,
      to: p.both_recruiting_to,
      upperBound: p.upper_bound,
      unreviewed: p.unreviewed_criteria,
    }
  })
  if (pairs.length !== (trials.length * (trials.length - 1)) / 2) return null

  let criteria = FALLBACK_CROP.criteria
  const fp = a.pairs.find((p) => (p.p === FEATURED[0] && p.q === FEATURED[1]) || (p.p === FEATURED[1] && p.q === FEATURED[0]))
  const ta = byId.get(FEATURED[0])
  const tb = byId.get(FEATURED[1])
  if (fp && ta && tb) {
    const flip = fp.p !== FEATURED[0]
    const labelsA = new Map(ta.criteria.map((c) => [c.id, c.label]))
    const labelsB = new Map(tb.criteria.map((c) => [c.id, c.label]))
    const d = fp.criteria_diff
    const onlyA = (flip ? d.only_q : d.only_p).map((id) => labelsA.get(id) ?? id)
    const onlyB = (flip ? d.only_p : d.only_q).map((id) => labelsB.get(id) ?? id)
    const both = d.shared.filter((s) => s.same).flatMap((s) => (flip ? s.q : s.p).map((id) => labelsA.get(id) ?? id))
    if (both.length + onlyA.length + onlyB.length > 0) criteria = { both, onlyA, onlyB }
  }

  return {
    sponsor: a.sponsor,
    asOf: a.as_of,
    snapshot: a.snapshot_date,
    basis: a.basis,
    regionLabel: a.region_label,
    population: a.population.n,
    live: true,
    trials: trials.map((t) => ({ nct: t.nct_id, label: t.acronym || t.nct_id, phase: phaseText(t.phases), nSites: t.n_sites })),
    pairs,
    criteria,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Protocol to terms: NCT05800015 priced at two sites (copy deck A4, ledger C-T).

export const TERMS_NCT = 'NCT05800015'
export const TERMS_SITE_A = '334d690736c4'
export const TERMS_SITE_B = '0bf11037dddd'
const CT_CHEST = 'ct_chest'

export interface TermsSide {
  site: string
  localityCode: string
  localityName: string
  /** Paid by sponsor, per participant. */
  sponsor: number
  /** Billable to insurance, per participant (Medicare rates). */
  insurance: number
}

export interface TermsFragment {
  a: TermsSide
  b: TermsSide
  /** Site B minus site A, per participant (negative: B is lower). */
  delta: number
  deltaItems: number
  fromPe: number
  deltaOverhead: number
  overheadRate: number
  scope: string
  nRoutine: number
  nResearch: number
  ctA: number
  ctB: number
  ctFormulaA: string
  live: boolean
}

/** GET /api/terms-flow/NCT05800015/compare?site_a=334d690736c4&site_b=0bf11037dddd&multiplier=1. */
export const FALLBACK_TERMS: TermsFragment = {
  a: { site: 'NYU Langone Health Perlmutter Cancer Center, New York, NY', localityCode: '01', localityName: 'Manhattan', sponsor: 6568.67, insurance: 6820.11 },
  b: { site: 'Hattiesburg Clinic, Hattiesburg, MS', localityCode: '00', localityName: 'Mississippi', sponsor: 6193.66, insurance: 5500.88 },
  delta: -375.01,
  deltaItems: -300.02,
  fromPe: -270.04,
  deltaOverhead: -74.99,
  overheadRate: 0.25,
  scope: 'Screening through cycle 8, end of treatment and safety follow-up.',
  nRoutine: 83,
  nResearch: 56,
  ctA: 191.25,
  ctB: 148.38,
  ctFormulaA: '(1.13 × 1.064 + 3.77 × 1.162 + 0.09 × 1.586) × 33.4009 = $191.25',
  live: false,
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
const sentence = (s: string) => {
  const t = s.trim().replace(/\.$/, '')
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : ''
}

/** The fragment from a live comparison, or null when the response does not have the expected shape (Site B lower,
 *  the CT line present), in which case the fallback, which the copy describes, stays. */
export function termsFromCompare(c: Compare): TermsFragment | null {
  const ct = c.rows.find((r) => r.procedure_id === CT_CHEST)
  const s = c.summary
  if (!ct || !c.a.locality || !c.b.locality || !(s.delta_per_participant < 0)) return null
  return {
    a: {
      site: c.a.site.label,
      localityCode: c.a.locality.code,
      localityName: titleCase(c.a.locality.name),
      sponsor: c.a.totals.per_participant,
      insurance: c.a.totals.per_participant_insurance_medicare,
    },
    b: {
      site: c.b.site.label,
      localityCode: c.b.locality.code,
      localityName: titleCase(c.b.locality.name),
      sponsor: c.b.totals.per_participant,
      insurance: c.b.totals.per_participant_insurance_medicare,
    },
    delta: s.delta_per_participant,
    deltaItems: s.delta_research_items,
    fromPe: s.from_pe,
    deltaOverhead: s.delta_overhead,
    overheadRate: s.overhead_rate,
    scope: sentence(c.a.totals.per_participant_scope) || FALLBACK_TERMS.scope,
    nRoutine: c.a.totals.n_insurance_lines,
    nResearch: c.a.totals.n_sponsor_lines,
    ctA: ct.unit_a,
    ctB: ct.unit_b,
    ctFormulaA: (ct.formula_a ?? FALLBACK_TERMS.ctFormulaA).replace(/ x /g, ' × '),
    live: true,
  }
}

/** "$375.01" for a signed amount (the sentence says lower or higher). */
export const absUsd = (x: number) => usd(Math.abs(x))

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-10-16" -> "October 16, 2026" (or "Oct 16, 2026" when short). Parsed as a calendar date, no time zone. */
export function calDate(iso: string | null | undefined, short = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!m) return '—'
  const month = MONTHS[Number(m[2]) - 1] ?? ''
  return `${short ? month.slice(0, 3) : month} ${Number(m[3])}, ${m[1]}`
}
