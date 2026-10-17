// Types and fetchers for the site proposal check (backend: concord/proposal.py, routes in concord/api/terms.py).
// Medicare amounts are benchmarks for fair-value reasoning in sponsor-site negotiation; the band is an assumption.
import type { Locality, PriceParams, SiteOpt } from './termsFlowApi'

export type Flag = 'above' | 'below' | 'in_range' | 'justify' | 'unmatched'

export interface CmsSource {
  schedule: string | null
  file: string | null
  year: number | null
  locality: string | null
  code: string | null
  formula: string | null
  title: string | null
  text: string
}

export interface ProposalRow {
  row: number
  item: string
  ask: number
  ask_raw: string
  percent: boolean
  /** The ask is a rate (overhead given as a percentage), shown as a percent. */
  ask_rate: boolean
  flag: Flag
  flag_label: string
  kind: 'procedure' | 'lab' | 'non_procedure' | null
  match: string | null
  method: 'code' | 'label' | 'common name' | null
  matched_label: string | null
  code: string | null
  medicare: number | null
  range_low: number | null
  range_high: number | null
  outside_by: number
  reference: number | null
  reference_unit: string | null
  reference_label: string | null
  reference_rate?: boolean
  reference_edited?: boolean
  placeholder?: boolean
  coverage?: { sponsor_visits: number; insurance_visits: number }
  source: CmsSource | null
  /** The term-sheet line (protocol node) whose step-by-step price explains this code's Medicare amount. */
  node_id?: string | null
  notes: string[]
}

export interface ProposalResult {
  nct_id: string
  short_title: string
  label: string
  disclaimer: string
  /** The CSV carries a '# ... SYNTHETIC' comment line (the shipped sample does): invented prices. */
  synthetic: boolean
  synthetic_label: string
  site: SiteOpt
  locality: Locality | null
  band: { low: number; high: number; label: string; text: string }
  multiplier: number
  pfs_source: string | null
  clfs_source: string | null
  conversion_factor: number | null
  standard_source: string
  reference_label: string
  rows: ProposalRow[]
  errors: { row: number; text: string; error: string }[]
  header: boolean
  summary: {
    n_rows: number
    n_errors: number
    counts: Record<Flag, number>
    coded: { n: number; total_ask: number; range_low: number; range_high: number; above_by: number; below_by: number; position: Flag | null }
    top_outside: { row: number; item: string; code: string | null; ask: number; range_low: number; range_high: number; flag: Flag; outside_by: number }[]
  }
  flags: Record<Flag, string>
  generated: string
}

export interface ProposalSample {
  nct_id: string
  filename: string
  synthetic: true
  label: string
  csv: string
}

export interface ProposalQuery {
  siteId: string
  csv: string
  bandLow: number
  bandHigh: number
  params: PriceParams
}

const BASE = '/api/terms-flow'
const enc = encodeURIComponent

async function errorText(res: Response): Promise<string> {
  let detail = res.statusText
  try {
    const body = await res.json()
    if (body && typeof body.detail === 'string') detail = body.detail
    else if (body && Array.isArray(body.detail) && body.detail[0]?.msg) detail = String(body.detail[0].msg)
  } catch {
    /* non-JSON error body */
  }
  return `${res.status} ${detail}`
}

function body(q: ProposalQuery, detail?: 'simple' | 'detailed'): string {
  return JSON.stringify({
    site_id: q.siteId,
    csv: q.csv,
    band_low: q.bandLow,
    band_high: q.bandHigh,
    multiplier: q.params.multiplier,
    overrides: q.params.overrides,
    standard: q.params.standard,
    ...(detail ? { detail } : {}),
  })
}

async function post(path: string, payload: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal })
  if (!res.ok) throw new Error(await errorText(res))
  return res
}

export const proposalApi = {
  check: async (nct: string, q: ProposalQuery, signal?: AbortSignal) =>
    (await (await post(`${BASE}/${enc(nct)}/proposal-check`, body(q), signal)).json()) as ProposalResult,
  /** The SYNTHETIC sample for this trial, or null when there is none. */
  sample: async (nct: string, signal?: AbortSignal): Promise<ProposalSample | null> => {
    const res = await fetch(`${BASE}/${enc(nct)}/proposal-sample`, { signal })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(await errorText(res))
    return (await res.json()) as ProposalSample
  },
  /** The printable counter-proposal page as text (the caller saves it as a file). */
  counterHtml: async (nct: string, q: ProposalQuery, detail: 'simple' | 'detailed') =>
    (await post(`${BASE}/${enc(nct)}/counter-proposal.html`, body(q, detail))).text(),
}

export const BAND_DEFAULT = { low: 100, high: 150 } as const
export const REF_LABEL = 'proposed standard (not market data)'
