import type { AllocKey, Site, Trial } from './api'

const DASH = '—'

export function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

/** Fixed-digit number; null/undefined/NaN render as an em dash, never 0. */
export function num(x: number | null | undefined, digits = 1): string {
  if (!isNum(x)) return DASH
  return x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function int(x: number | null | undefined): string {
  if (!isNum(x)) return DASH
  return Math.round(x).toLocaleString('en-US')
}

export function pct(x: number | null | undefined, digits = 0): string {
  if (!isNum(x)) return DASH
  return `${(x * 100).toFixed(digits)}%`
}

export function times(x: number | null | undefined, digits = 2): string {
  if (!isNum(x)) return DASH
  return `${x.toFixed(digits)}×`
}

export function money(x: number | null | undefined): string {
  if (!isNum(x)) return DASH
  const a = Math.abs(x)
  if (a >= 1e9) return `$${(x / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(x / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `$${(x / 1e3).toFixed(0)}K`
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function usd(x: number | null | undefined): string {
  if (!isNum(x)) return DASH
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function trialName(t: Pick<Trial, 'acronym' | 'nct_id'>): string {
  return t.acronym ? `${t.acronym} (${t.nct_id})` : t.nct_id
}

export function siteName(s: Pick<Site, 'facility' | 'city' | 'state'>): string {
  const place = [s.city, s.state].filter(Boolean).join(', ')
  return place ? `${s.facility} · ${place}` : s.facility
}

export function ctgovUrl(nct: string): string {
  return `https://clinicaltrials.gov/study/${encodeURIComponent(nct)}`
}

export const ALLOC_LABEL: Record<AllocKey, string> = {
  actual: 'Registered',
  indep: 'Best response',
  coord: 'Coordinated (no losers)',
  coord_free: 'Joint optimum',
  coord_nl_indep: 'Pure coordination',
}

export const ALLOC_HINT: Record<AllocKey, string> = {
  actual: 'The site lists sponsors registered on ClinicalTrials.gov',
  indep: 'Each trial picks its best sites, ignoring the others',
  coord: 'Joint optimum with no trial slower than its registered sites (headline)',
  coord_free: 'Joint optimum with no participation constraint: some trials may be slower',
  coord_nl_indep: 'Joint optimum with no trial slower than its own best response',
}

export function tOf(t: Trial, k: AllocKey): number | null {
  return t[`T_${k}`]
}

export function sitesOf(t: Trial, k: AllocKey): number {
  return t[`sites_${k}`]
}

export function loadOf(s: Site, k: AllocKey): number {
  return s[`load_${k}`]
}

export function signedMonths(x: number | null | undefined): string {
  if (!isNum(x)) return DASH
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${num(Math.abs(x))}`
}

export function phaseLabel(phases: string[] | null | undefined): string {
  if (!phases || phases.length === 0) return DASH
  return phases.map((p) => p.replace('PHASE', 'Ph ').replace('EARLY_', 'Early ')).join('/')
}
