// Types and fetchers for the findings page (backend/concord/api/findings.py), plus the pure helpers the page uses
// to read numbers out of findings.json and self_overlap.json.
// findings.json is written by `python -m concord.findings`; self_overlap.json by `python -m concord.overlap`.

import { ApiError } from './api'

export type FindingStatus = 'final' | 'provisional' | 'missing'

export interface CiItem {
  label: string
  estimate: number
  lo: number
  hi: number
}

export interface CiChart {
  type: 'ci'
  reference: { label: string; value: number }
  items: CiItem[]
}

export interface FindingTable {
  id: string
  title: string
  columns: string[]
  rows: string[][]
  /** 0-based index into rows. */
  highlight_row?: number | null
  notes?: string[]
}

export interface FindingSource {
  label: string
  /** Repo-relative path. */
  path: string
  /** Added by the API: false when this checkout lacks the cited file (shown as plain text, not a link). */
  available?: boolean
}

export interface Finding {
  id: string
  title: string
  status: FindingStatus | string
  headline: string
  chart?: CiChart | { type: string } | null
  tables?: FindingTable[]
  caveats?: string[]
  sources?: FindingSource[]
}

export interface FindingsDoc {
  generated_at?: string
  rule?: string
  findings: Finding[]
}

/** data/findings/self_overlap.json, written by the portfolio overlap audit (python -m concord.overlap).
 *  Its shape: `headline` {count, upper_bound_count, sponsors, variant, text} (the count to lead with: pairs whose
 *  eligibility was hand-encoded and reviewed), the broad top-level `count`, `upper_bound_count` and
 *  `sponsors_with_pairs`, plus `definition` and `parameters`. Every field is optional here. */
export interface SelfOverlapHeadline {
  count?: number
  value?: number
  upper_bound_count?: number
  sponsors?: number
  variant?: string
  /** A short noun phrase for the count ("same-sponsor pairs where ..."), if the audit provides one. */
  label?: string
  text?: string
}

/** One same-sponsor pair of the broad count (only the fields this page reads). */
export interface SelfOverlapPair {
  sponsor?: string
  upper_bound?: boolean
  /** Per trial: "hand-encoded" or "rule-based parse". */
  eligibility_source?: Record<string, string>
  [k: string]: unknown
}

export interface SelfOverlap {
  headline?: string | SelfOverlapHeadline
  headline_count?: number
  headline_label?: string
  count?: number
  sponsors_with_pairs?: number
  upper_bound_count?: number
  definition?: string
  snapshot_date?: string
  parameters?: { min_shared_sites?: number; min_overlap_one_direction?: number; since?: string; until?: string; [k: string]: unknown }
  /** Pair counts by where the two trials' eligibility came from ("both hand-encoded", "one of each", "both rule-based parse"). */
  count_by_eligibility_source?: Record<string, number>
  robustness?: { container_at_most_2_criteria?: { count?: number; [k: string]: unknown }; [k: string]: unknown }
  notes?: string[]
  pairs?: SelfOverlapPair[]
  /** Not written today; shown as links when the audit starts citing its own sources. */
  sources?: FindingSource[]
  [k: string]: unknown
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal })
  if (!res.ok) {
    const fallbackPath = path === '/api/findings' ? '/api/findings/index.json' : `${path}.json`
    try {
      const fb = await fetch(fallbackPath, { signal })
      if (fb.ok) return (await fb.json()) as T
    } catch {
      /* ignore */
    }
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body && typeof body.detail === 'string') detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, `${res.status} ${detail}`)
  }
  return (await res.json()) as T
}

export const findingsApi = {
  findings: (signal?: AbortSignal) => get<FindingsDoc>('/api/findings', signal),
  selfOverlap: (signal?: AbortSignal) => get<SelfOverlap>('/api/findings/self-overlap', signal),
}

/** Link to a cited source file, served by the backend only if findings.json lists it. */
export function sourceHref(path: string): string {
  return `/api/findings/source?path=${encodeURIComponent(path)}`
}

export function isCiChart(c: Finding['chart']): c is CiChart {
  return !!c && c.type === 'ci' && Array.isArray((c as CiChart).items) && typeof (c as CiChart).reference?.value === 'number'
}

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0

export interface OverlapNote {
  /** The headline count, shown emphasised; null when the file only has a headline sentence. */
  count: number | null
  /** The rest of the sentence after the count (or the whole headline sentence when count is null). */
  text: string
  /** The audit's own definition, shown on request. */
  definition: string | null
  /** True when the count is the broad top-level `count` (no reviewed headline in the file): it then rests partly on
   *  the unreviewed rule-based parse and must carry that caveat. */
  broad?: boolean
  /** Pairs of the broad count that rest on the unreviewed parse for at least one trial, when the file says. */
  unreviewed?: number | null
}

/** The noun phrase a headline sentence starts with: "21 same-sponsor pairs where ...; in 19 of them ..." gives
 *  "same-sponsor pairs where ...". Null unless the sentence starts with the count itself. */
function leadPhrase(text: string | undefined, count: number): string | null {
  const m = typeof text === 'string' ? text.trim().match(/^([\d,]+)\s+([^;.]+)/) : null
  if (!m || Number(m[1].replace(/,/g, '')) !== count) return null
  return m[2].trim() || null
}

/** The self-overlap file's headline count, described with the file's own thresholds (shared sites, eligibility
 *  overlap) and labels. Lead with `headline.count` (the audit's reviewed subset); fall back to the broad `count`.
 *  A plain `headline` string is shown as written. */
export function overlapNote(d: SelfOverlap | null): OverlapNote | null {
  if (!d) return null
  const definition = typeof d.definition === 'string' && d.definition.trim() ? d.definition.trim() : null
  const h = d.headline
  if (typeof h === 'string') return h.trim() ? { count: null, text: h.trim(), definition } : null

  let count: number | null = null
  let label: string | null = null
  let sponsors: number | null = null
  let upper: number | null = null
  if (h && typeof h === 'object') {
    const n = isCount(h.count) ? h.count : isCount(h.value) ? h.value : null
    if (n === null) {
      if (typeof h.text === 'string' && h.text.trim()) return { count: null, text: h.text.trim(), definition }
    } else {
      count = n
      label = (typeof h.label === 'string' && h.label.trim()) || leadPhrase(h.text, n)
      sponsors = isCount(h.sponsors) ? h.sponsors : null
      upper = isCount(h.upper_bound_count) ? h.upper_bound_count : null
    }
  }
  if (count === null && isCount(d.headline_count)) {
    count = d.headline_count
    label = d.headline_label ?? null
  }
  let broad = false
  if (count === null && isCount(d.count)) {
    count = d.count
    sponsors = isCount(d.sponsors_with_pairs) ? d.sponsors_with_pairs : null
    upper = isCount(d.upper_bound_count) ? d.upper_bound_count : null
    broad = true
  }
  if (count === null) return null
  const by = d.count_by_eligibility_source
  const parsed = by ? (by['both rule-based parse'] ?? NaN) + (by['one of each'] ?? NaN) : NaN
  const unreviewed = isCount(parsed) ? parsed : null

  const p = d.parameters ?? {}
  const sites = isCount(p.min_shared_sites) ? p.min_shared_sites : null
  const share = isCount(p.min_overlap_one_direction) && p.min_overlap_one_direction <= 1 ? p.min_overlap_one_direction : null
  const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`
  const clause = [
    'concurrent',
    sites !== null ? `sharing at least ${plural(sites, 'registered site')}` : null,
    share !== null ? `with at least ${Math.round(share * 100)}% of one trial’s eligible patients also eligible for the other` : null,
  ].filter(Boolean)
  let text = label ?? `same-sponsor trial pair${count === 1 ? '' : 's'}`
  if (sponsors !== null) text += `, across ${plural(sponsors, 'sponsor')}`
  text += clause.length > 1 ? `: ${clause.join(', ')}.` : ' overlap.'
  if (upper !== null && upper > 0)
    text += ` For ${upper.toLocaleString('en-US')} of them the eligibility overlap is an upper bound (criteria the synthetic population does not model).`
  return { count, text, definition, broad, unreviewed: broad ? unreviewed : null }
}

/* =====================================================================================================================
   Display helpers. The copy deck typesets ratios with "×" and negatives with the minus sign "−"; the files store
   "1.42x" and "-0.093". Only the glyphs change, never a digit.
   ===================================================================================================================== */

/** "1.42x" -> "1.42×", "-0.093" -> "−0.093", "[-0.297, +0.111]" -> "[−0.297, +0.111]". Hyphens inside words and
 *  dates ("pre-registered", "2024-09-01", "completion - start") are left alone. */
export function typeset(s: string): string {
  return s.replace(/(^|[\s([,/=])-(?=\.?\d)/g, '$1−').replace(/(\d)x\b/g, '$1×')
}

/** "Oct 16, 2026" from "2026-10-16"; null for anything that is not an ISO date. */
export function shortDate(iso: string | undefined): string | null {
  const m = typeof iso === 'string' ? iso.match(/^(\d{4})-(\d{2})-(\d{2})/) : null
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
}

/** "October 16, 2026" from "2026-10-16" (prose dates, copy deck conventions). */
export function longDate(iso: string | undefined): string | null {
  const m = typeof iso === 'string' ? iso.match(/^(\d{4})-(\d{2})-(\d{2})/) : null
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}

/** A ratio as stored ("1.05x (1.11x / 0.99x)" -> the lead value 1.05, shown "1.05×"). */
export interface Ratio {
  v: number
  text: string
}

export function leadRatio(s: string | undefined): Ratio | null {
  const m = typeof s === 'string' ? s.trim().match(/^(\d+(?:\.\d+)?)x(?:\b|$)/) : null
  if (!m) return null
  const v = Number(m[1])
  return Number.isFinite(v) ? { v, text: `${m[1]}×` } : null
}

function table(f: Finding, id: string): FindingTable | null {
  return (f.tables ?? []).find((t) => t.id === id) ?? null
}

/** The first row whose label (column 0) starts with `prefix`. */
function row(t: FindingTable | null, prefix: string): string[] | null {
  return t?.rows.find((r) => typeof r[0] === 'string' && r[0].startsWith(prefix)) ?? null
}

/** Every [actual, expected] pair is equal: the copy deck's sentences quote these exact stored values. */
function quoted(pairs: [unknown, string][]): boolean {
  return pairs.every(([a, b]) => typeof a === 'string' && a.trim() === b)
}

const startsWith = (s: string | undefined, p: string) => (typeof s === 'string' && s.trim().startsWith(p) ? p : s)

/* =====================================================================================================================
   Per-finding models for Simple mode. Each reads the numbers its visual draws from findings.json and returns null
   unless the stored values still equal the ones the copy deck's sentences quote (copy deck section C-F). A finding
   whose numbers have moved falls back to the generic layout (its own title, headline, chart and tables), so no
   sentence on the page can describe numbers the file no longer has.
   ===================================================================================================================== */

export interface CongestionModel {
  item: CiItem
  reference: number
}

export function congestionModel(f: Finding): CongestionModel | null {
  if (!isCiChart(f.chart) || f.chart.items.length !== 1) return null
  const item = f.chart.items[0]
  if (![item.estimate, item.lo, item.hi].every(Number.isFinite)) return null
  const est = table(f, 'estimates')
  const within = row(est, 'Within site')
  const pooled = row(est, 'Pooled')
  const parser = table(f, 'parser')
  const coefs = (parser?.rows ?? []).map((r) => r[2])
  const ok =
    quoted([
      [item.estimate.toFixed(2), '0.09'],
      [item.lo.toFixed(2), '0.00'],
      [item.hi.toFixed(2), '0.30'],
      [f.chart.reference.value.toFixed(1), '1.0'],
      [within?.[1], '-0.093'],
      [within?.[2], '[-0.297, +0.111]'],
      [pooled?.[1], '-0.107'],
      [pooled?.[3], '0.0552'],
    ]) &&
    coefs.includes('-0.027') &&
    coefs.includes('-0.136') &&
    /floored at 0/.test(f.headline)
  return ok ? { item, reference: f.chart.reference.value } : null
}

export interface AllocationLane {
  inSample: Ratio
  heldOut: [Ratio, Ratio]
  calibrated: [Ratio, Ratio]
  /** Share of trials slower, held-out, time split ("51%"). */
  slower: string
}

export interface AllocationModel {
  coordination: AllocationLane
  selection: AllocationLane
  /** The calibration slope b the calibrated points use ("0.33"). */
  b: string
  /** Site selection, calibrated held-out, across the slope's 95% CI: the b = 0.16 low end from findings.json and the
   *  b = 0.50 high end the README reports (copy deck F27). */
  selectionRange: [number, number]
}

export function allocationModel(f: Finding): AllocationModel | null {
  const ne = table(f, 'allocation-US-Northeast')
  const sel = row(ne, 'Site selection alone')
  const coord = row(ne, 'Coordination (joint optimum')
  const cal = table(f, 'selection-calibrated')
  const sel33 = row(cal, 'Site selection alone, b = 0.33')
  const coord33 = row(cal, 'Coordination, b = 0.33')
  const sel16 = row(cal, 'Site selection alone, b = 0.16')
  const val = row(table(f, 'selection-validation'), 'industry Phase II/III')
  const reg = table(f, 'allocation-US_Regeneron_2024-09-01')
  const regCoord = row(reg, 'Coordination (joint optimum')
  const ok =
    quoted([
      [ne?.title, 'US-Northeast (46 trials)'],
      [sel?.[1], '1.76x'],
      [startsWith(sel?.[3], '1.73x'), '1.73x'],
      [startsWith(sel?.[5], '1.70x'), '1.70x'],
      [sel?.[6], '13%'],
      [coord?.[1], '1.42x'],
      [startsWith(coord?.[3], '1.05x'), '1.05x'],
      [startsWith(coord?.[5], '1.05x'), '1.05x'],
      [coord?.[6], '51%'],
      [sel33?.[2], '1.18x'],
      [sel33?.[3], '1.17x'],
      [coord33?.[2], '1.03x'],
      [coord33?.[3], '1.03x'],
      [sel16?.[2], '1.07x'],
      [sel16?.[3], '1.06x'],
      [val?.[1], '0.33'],
      [val?.[2], '[+0.16, +0.50]'],
      [val?.[4], '390'],
      [reg?.title, 'US Regeneron 2024-09-01 (5 trials)'],
      [regCoord?.[1], '1.01x'],
      [startsWith(regCoord?.[3], '0.99x'), '0.99x'],
      [startsWith(regCoord?.[5], '1.03x'), '1.03x'],
    ]) &&
    (f.caveats ?? []).some((c) => /pre-registered script/.test(c)) &&
    (f.caveats ?? []).some((c) => /post hoc/.test(c))
  if (!ok || !sel || !coord || !sel33 || !coord33 || !sel16) return null
  const lane = (r: string[], c: string[]): AllocationLane | null => {
    const v = [leadRatio(r[1]), leadRatio(r[3]), leadRatio(r[5]), leadRatio(c[2]), leadRatio(c[3])]
    if (v.some((x) => !x)) return null
    const [a, b, c2, d, e] = v as Ratio[]
    return { inSample: a, heldOut: [b, c2], calibrated: [d, e], slower: r[6] }
  }
  const coordination = lane(coord, coord33)
  const selection = lane(sel, sel33)
  const low = Math.min(leadRatio(sel16[2])!.v, leadRatio(sel16[3])!.v)
  if (!coordination || !selection) return null
  return { coordination, selection, b: '0.33', selectionRange: [low, 1.3] }
}

export interface ImplicationModel {
  /** Typical miss: "1.9×", and the naive estimate's "2.8×". */
  miss: string
  naive: string
  /** "7,486 of 11,710" and its share as stored ("64%"). */
  sparse: string
  sparseShare: string
  /** Site-level enrollment counts in the public registry ("0"). */
  siteCounts: string
}

export function implicationModel(f: Finding): ImplicationModel | null {
  const t = table(f, 'data-limits')
  const miss = row(t, 'Typical miss')
  const sparse = row(t, 'U.S. sites with fewer than 3')
  const counts = row(t, 'Site-level enrollment counts')
  const ok =
    quoted([
      [miss?.[1], '1.9x (site model)'],
      [miss?.[2], '2.8x (naive median rate)'],
      [sparse?.[1], '7,486 of 11,710'],
      [sparse?.[2], '64%'],
      [counts?.[1], '0'],
    ]) && (f.caveats ?? []).some((c) => /fit before 2018/.test(c))
  if (!ok || !miss || !sparse || !counts) return null
  return {
    miss: leadRatio(miss[1])!.text,
    naive: leadRatio(miss[2])!.text,
    sparse: sparse[1],
    sparseShare: sparse[2],
    siteCounts: counts[1],
  }
}

/* ---------- self-overlap ---------- */

export interface SponsorGroup {
  sponsor: string
  /** One entry per pair: true when its overlap is an upper bound. */
  upper: boolean[]
}

export interface SelfOverlapModel {
  count: number
  sponsors: number
  upper: number
  minSites: number
  /** Whole percent, e.g. 80. */
  minShare: number
  since: string
  until: string
  /** The broad count and how many of it rest on the unreviewed rule-based parse for at least one trial. */
  broad: number
  unreviewed: number
  /** Headline pairs grouped by sponsor, largest group first; null when the file's pair list does not reproduce the headline. */
  groups: SponsorGroup[] | null
}

const HAND = 'hand-encoded'

/** Both trials hand-encoded and reviewed: the headline variant. */
export function bothHandEncoded(p: SelfOverlapPair): boolean {
  const s = Object.values(p.eligibility_source ?? {})
  return s.length > 0 && s.every((x) => x === HAND)
}

/** Lead-block numbers, all from self_overlap.json. Null unless the file has the reviewed headline
 *  (`headline.variant` both_hand_encoded) with its thresholds, so the sentences below it hold. */
export function selfOverlapModel(d: SelfOverlap | null): SelfOverlapModel | null {
  const h = d?.headline
  if (!d || !h || typeof h !== 'object' || h.variant !== 'both_hand_encoded') return null
  const p = d.parameters ?? {}
  const until = p.until ?? d.snapshot_date
  if (
    !isCount(h.count) ||
    h.count === 0 ||
    !isCount(h.sponsors) ||
    !isCount(h.upper_bound_count) ||
    !isCount(p.min_shared_sites) ||
    !isCount(p.min_overlap_one_direction) ||
    p.min_overlap_one_direction > 1 ||
    !longDate(p.since) ||
    !longDate(until) ||
    !isCount(d.count)
  )
    return null
  const bySource = d.count_by_eligibility_source ?? {}
  const parsed = (bySource['both rule-based parse'] ?? NaN) + (bySource['one of each'] ?? NaN)
  const unreviewed = isCount(parsed) ? parsed : d.count - h.count

  let groups: SponsorGroup[] | null = null
  const pairs = (d.pairs ?? []).filter(bothHandEncoded)
  if (pairs.length === h.count && pairs.filter((x) => x.upper_bound === true).length === h.upper_bound_count) {
    const by = new Map<string, boolean[]>()
    for (const x of pairs) {
      const k = typeof x.sponsor === 'string' ? x.sponsor : '?'
      by.set(k, [...(by.get(k) ?? []), x.upper_bound === true])
    }
    if (by.size === h.sponsors)
      groups = [...by.entries()]
        .map(([sponsor, u]) => ({ sponsor, upper: [...u].sort((a, b) => Number(b) - Number(a)) }))
        .sort((a, b) => b.upper.length - a.upper.length)
  }
  return {
    count: h.count,
    sponsors: h.sponsors,
    upper: h.upper_bound_count,
    minSites: p.min_shared_sites,
    minShare: Math.round(p.min_overlap_one_direction * 100),
    since: longDate(p.since)!,
    until: longDate(until)!,
    broad: d.count,
    unreviewed,
    groups,
  }
}

/** The audit's notes as caveats for readers: its note to writers ("Lead with headline.count ...") is left out, and
 *  field names become words ("upper_bound:" -> "Upper bound:"; "; see context.<field>" pointers are dropped). */
export function overlapCaveats(notes: string[] | undefined): string[] {
  return (notes ?? [])
    .filter((n) => typeof n === 'string' && n.trim() && !/^Lead with headline\./.test(n.trim()))
    .map((n) =>
      n
        .trim()
        .replace(/^upper_bound:/, 'Upper bound:')
        .replace(/;\s*see context\.[a-z_]+/g, '')
        .replace(/\s*\(see robustness\)/g, ''),
    )
}

/** Rows of the "pairs by eligibility source" table: pairs from count_by_eligibility_source, upper bounds counted
 *  from the pair list (null when the list is not the full broad count). */
export interface SourceRow {
  key: 'both hand-encoded' | 'one of each' | 'both rule-based parse' | 'all'
  pairs: number | null
  upper: number | null
}

export function sourceRows(d: SelfOverlap): SourceRow[] {
  const pairs = d.pairs ?? []
  const full = isCount(d.count) && pairs.length === d.count
  const kind = (p: SelfOverlapPair) => {
    const s = Object.values(p.eligibility_source ?? {})
    const hand = s.filter((x) => x === HAND).length
    return hand === s.length ? 'both hand-encoded' : hand === 0 ? 'both rule-based parse' : 'one of each'
  }
  const ub = (k: string) => (full ? pairs.filter((p) => kind(p) === k && p.upper_bound === true).length : null)
  const by = d.count_by_eligibility_source ?? {}
  const h = typeof d.headline === 'object' ? d.headline : undefined
  const rows: SourceRow[] = [
    { key: 'both hand-encoded', pairs: by['both hand-encoded'] ?? h?.count ?? null, upper: ub('both hand-encoded') ?? h?.upper_bound_count ?? null },
    { key: 'one of each', pairs: by['one of each'] ?? null, upper: ub('one of each') },
    { key: 'both rule-based parse', pairs: by['both rule-based parse'] ?? null, upper: ub('both rule-based parse') },
    { key: 'all', pairs: isCount(d.count) ? d.count : null, upper: isCount(d.upper_bound_count) ? d.upper_bound_count : null },
  ]
  return rows.filter((r) => r.pairs !== null)
}
