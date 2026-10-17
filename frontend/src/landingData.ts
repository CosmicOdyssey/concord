// Data for the landing page's product windows (views/LandingView.tsx). Both windows are real fragments: they render
// at once from the values below (copied from the API responses saved in the redesign data pack, copy deck ledger
// C-C, C-H and C-T), then from the live API (GET /api/overlap and /api/terms-flow/.../compare, both cheap) when it
// answers. Nothing here is estimated or invented.
import { usd } from './format'
import type { OverlapAudit, OverlapTrial } from './overlapApi'
import type { Compare } from './termsFlowApi'

export const HERO_SPONSOR = 'Merck Sharp & Dohme LLC'
/** The hero crop (copy deck A2 / ledger C-H): the Phase 3 trials with reviewed criteria among the sponsor's trials
 *  recruiting at the snapshot, less INTerpath-014 (stage I; the synthetic population cannot tell it from II-IIIB). */
export const HERO_IDS = ['NCT06170788', 'NCT06312137', 'NCT06345729', 'NCT06422143', 'NCT06623422', 'NCT07190248', 'NCT07554339'] as const
/** The pair the hero opens on, and the one the Portfolio overlap section details (TroFuse-019 x NCT06623422). */
export const FEATURED: [string, string] = ['NCT06312137', 'NCT06623422']

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
  snapshot: string
  trials: CropTrial[]
  pairs: CropPair[]
  /** Criteria of the featured pair: in both (labels of the first trial), only in the first, only in the second. */
  criteria: { both: string[]; onlyA: string[]; onlyB: string[] }
  live: boolean
}

const T = (nct: string, label: string, nSites: number): CropTrial => ({ nct, label, phase: 'Phase 3', nSites })
const P = (p: string, q: string, shared: number, o_pq: number, o_qp: number, months: number, from: string): CropPair => ({
  p,
  q,
  shared,
  o_pq,
  o_qp,
  months,
  from,
  to: '2026-10-16',
  upperBound: true,
  unreviewed: false,
})

/** GET /api/overlap?sponsor=Merck Sharp & Dohme LLC (all registered sites worldwide, as of the 2026-10-16 snapshot). */
export const FALLBACK_CROP: Crop = {
  snapshot: '2026-10-16',
  live: false,
  trials: [
    T('NCT06170788', 'TroFuse-007', 220),
    T('NCT06312137', 'TroFuse-019', 270),
    T('NCT06345729', 'NCT06345729', 240),
    T('NCT06422143', 'NCT06422143', 217),
    T('NCT06623422', 'NCT06623422', 243),
    T('NCT07190248', 'NCT07190248', 219),
    T('NCT07554339', 'NCT07554339', 95),
  ],
  pairs: [
    P('NCT06170788', 'NCT06312137', 36, 0.0, 0.0, 30.4, '2024-04-03'),
    P('NCT06170788', 'NCT06345729', 31, 0.1027, 0.5695, 28.7, '2024-05-24'),
    P('NCT06170788', 'NCT06422143', 36, 0.2832, 0.2948, 28.2, '2024-06-10'),
    P('NCT06170788', 'NCT06623422', 16, 0.0, 0.0, 23.8, '2024-10-21'),
    P('NCT06170788', 'NCT07190248', 17, 0.1027, 0.1654, 12.3, '2025-10-08'),
    P('NCT06170788', 'NCT07554339', 14, 0.0, 0.0, 3.9, '2026-06-18'),
    P('NCT06312137', 'NCT06345729', 34, 0.0, 0.0, 28.7, '2024-05-24'),
    P('NCT06312137', 'NCT06422143', 41, 0.0, 0.0, 28.2, '2024-06-10'),
    P('NCT06312137', 'NCT06623422', 20, 0.7962, 0.9106, 23.8, '2024-10-21'),
    P('NCT06312137', 'NCT07190248', 18, 0.0, 0.0, 12.3, '2025-10-08'),
    P('NCT06312137', 'NCT07554339', 14, 0.0, 0.0, 3.9, '2026-06-18'),
    P('NCT06345729', 'NCT06422143', 30, 0.0, 0.0, 28.2, '2024-06-10'),
    P('NCT06345729', 'NCT06623422', 15, 0.0, 0.0, 23.8, '2024-10-21'),
    P('NCT06345729', 'NCT07190248', 16, 1.0, 0.2904, 12.3, '2025-10-08'),
    P('NCT06345729', 'NCT07554339', 15, 0.245, 0.2298, 3.9, '2026-06-18'),
    P('NCT06422143', 'NCT06623422', 21, 0.0, 0.0, 23.8, '2024-10-21'),
    P('NCT06422143', 'NCT07190248', 16, 0.0, 0.0, 12.3, '2025-10-08'),
    P('NCT06422143', 'NCT07554339', 9, 0.0, 0.0, 3.9, '2026-06-18'),
    P('NCT06623422', 'NCT07190248', 14, 0.0, 0.0, 12.3, '2025-10-08'),
    P('NCT06623422', 'NCT07554339', 9, 0.0, 0.0, 3.9, '2026-06-18'),
    P('NCT07190248', 'NCT07554339', 10, 0.2731, 0.882, 3.9, '2026-06-18'),
  ],
  criteria: {
    both: ['Resectable stage II-IIIB (N2)', 'No EGFR-directed therapy indicated', 'No ALK-directed therapy indicated', 'No prior therapy for current NSCLC'],
    onlyA: ['No active autoimmune disease', 'No ILD / pneumonitis history'],
    onlyB: ['ECOG 0-1', 'No prior PD-1/PD-L1 inhibitor'],
  },
}

function phaseText(phases: string[]): string {
  const n = phases.map((p) => p.replace(/^PHASE/, '').replace(/^EARLY_/, 'Early ')).filter(Boolean)
  return n.length ? `Phase ${n.join('/')}` : 'Phase not listed'
}

/** The crop from a live audit, or null when the audit does not hold every crop trial and pair (then the fallback stays). */
export function cropFromAudit(a: OverlapAudit): Crop | null {
  const byId = new Map(a.trials.map((t) => [t.nct_id, t]))
  const trials: OverlapTrial[] = []
  for (const id of HERO_IDS) {
    const t = byId.get(id)
    if (!t) return null
    trials.push(t)
  }
  const inCrop = new Set<string>(HERO_IDS)
  const pairs: CropPair[] = a.pairs
    .filter((p) => inCrop.has(p.p) && inCrop.has(p.q))
    .map((p) => {
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
  if (pairs.length !== (HERO_IDS.length * (HERO_IDS.length - 1)) / 2) return null

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
    snapshot: a.snapshot_date,
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
