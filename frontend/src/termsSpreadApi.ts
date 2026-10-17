// Types and fetchers for the locality distribution and spread comparison (backend: concord/terms_spread.py,
// routes in concord/api/terms.py). Computed from CMS 2026 fee schedules and the proposed standard schedule; no
// forecasts and no market data.

import type { Locality, Overrides, StandardEdits } from './termsFlowApi'

export interface LocalityRow {
  key: string
  state: string
  code: string
  name: string
  gpci_work: number
  gpci_pe: number
  gpci_mp: number
  pfs: number
  lab: number
  unadjusted: number
  total: number
  percentile: number
}

export interface SiteMark {
  site_id: string
  label: string
  locality: Locality | null
  key: string | null
  total: number
  pfs: number
  lab: number
  unadjusted: number
  percentile: number | null
  n_below: number | null
  n_same: number | null
  budget_procedure_total: number
  note: string | null
}

export interface SpreadSources {
  gpci: string
  gpci_short: string
  pfs: string | null
  conversion_factor: number | null
  clfs: string | null
  standard: string
}

export interface LocalityDistribution {
  nct_id: string
  label: string
  disclaimer: string
  multiplier: number
  scope: string
  formula: string
  n_pfs_lines: number
  n_lab_lines: number
  n_placeholder_lines: number
  lab_constant: number
  lab_note: string
  n_unadjusted_lines: number
  unadjusted_constant: number
  unadjusted_note: string
  unpriced_codes: string[]
  localities: LocalityRow[]
  stats: {
    n: number
    min: number
    max: number
    median: number
    p10: number
    p90: number
    min_localities: string[]
    max_localities: string[]
    national: number
  }
  sites: SiteMark[]
  weighting: string
  percentile_method: string
  quantile_method: string
  sources: SpreadSources
}

export interface FeeItem {
  id: string
  label: string
  unit_amount: number
  count: number
  amount: number
  edited: boolean
  low: number
  high: number
}

export interface Spreads {
  nct_id: string
  label: string
  disclaimer: string
  geography: {
    id: 'geography'
    low: number
    high: number
    width: number
    p10: number
    p90: number
    width_p10_p90: number
    median: number
    min_localities: string[]
    max_localities: string[]
    n: number
    quantity: string
    source: string
    assumption: string
  }
  multiplier: {
    id: string
    site_id: string
    label: string
    locality: Locality | null
    low: number
    high: number
    width: number
    at_100: number
    m_low: number
    m_high: number
    quantity: string
    source: string
    assumption: string
  }[]
  fees: {
    id: 'fees'
    low: number
    high: number
    width: number
    base: number
    f_low: number
    f_high: number
    items: FeeItem[]
    edited: boolean
    quantity: string
    source: string
    assumption: string
  }
  overhead_note: string
  lab_constant: number
  unpriced_codes: string[]
  sources: SpreadSources
}

export interface Bands {
  multLo: number
  multHi: number
  feeLo: number
  feeHi: number
}

const BASE = '/api/terms-flow'
const enc = encodeURIComponent

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body && typeof body.detail === 'string') detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`${res.status} ${detail}`)
  }
  return (await res.json()) as T
}

function query(extra: Record<string, string | null | undefined>, overrides: Overrides, standard?: StandardEdits): string {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(extra)) if (v) s.set(k, v)
  if (Object.keys(overrides).length) s.set('overrides', JSON.stringify(overrides))
  if (standard && Object.keys(standard).length) s.set('standard', JSON.stringify(standard))
  return s.toString()
}

export const spreadApi = {
  distribution: (nct: string, siteA: string, siteB: string | null, overrides: Overrides, signal?: AbortSignal) =>
    get<LocalityDistribution>(`${BASE}/${enc(nct)}/locality-distribution?${query({ site_a: siteA, site_b: siteB }, overrides)}`, signal),
  spreads: (nct: string, siteA: string, siteB: string | null, bands: Bands, overrides: Overrides, standard: StandardEdits, signal?: AbortSignal) =>
    get<Spreads>(
      `${BASE}/${enc(nct)}/spreads?${query(
        {
          site_a: siteA,
          site_b: siteB,
          mult_lo: String(bands.multLo / 100),
          mult_hi: String(bands.multHi / 100),
          fee_lo: String(bands.feeLo / 100),
          fee_hi: String(bands.feeHi / 100),
        },
        overrides,
        standard,
      )}`,
      signal,
    ),
}
