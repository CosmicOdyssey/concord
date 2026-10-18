// Any trial in Protocol to terms (backend: concord/trial_import.py, routes in concord/api/terms.py): add a trial by
// NCT ID (fetched once from the public ClinicalTrials.gov API v2), then give it a schedule of assessments: the
// user's CSV, or a cited draft from the registry. No forecasting.

export const DRAFT_LABEL = "Draft from the public record, not the sponsor's protocol"

export interface ImportInfo {
  source: 'registry_draft' | 'csv'
  label: string
  fetched: string | null
  source_url: string
  n_visits: number
  n_items: number
  n_procedures: number
  n_unpriced_procedures: number
  /** Scheduled items whose procedure is unpriced (what the budget leaves out); absent in older cached files. */
  n_unpriced_items?: number
  /** When this schedule was written (ISO time): its version; a new one refetches the prices. */
  updated?: string
  /** Registry fields (or CSV items) that no table entry maps: listed, left unpriced. */
  unmapped: { field: string; quote: string; why: string }[]
  warnings: string[]
  coverage_note: string
}

export interface AddResult {
  nct_id: string
  status: 'fetched' | 'cached' | 'authored'
  message?: string
  import?: ImportInfo
}

const BASE = '/api/terms-flow'
const enc = encodeURIComponent

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const b = await res.json()
      if (b && typeof b.detail === 'string') detail = b.detail
      else if (b && Array.isArray(b.detail) && b.detail[0]?.msg) detail = String(b.detail[0].msg)
    } catch {
      /* non-JSON error body */
    }
    // A 4xx detail is a sentence for the user (unknown ID, no U.S. sites, a CSV problem); keep the code for the rest.
    throw new Error(res.status < 500 ? detail : `${res.status} ${detail}`)
  }
  return (await res.json()) as T
}

export const importApi = {
  add: (nct: string) => post<AddResult>(`${BASE}/add-trial`, { nct_id: nct }),
  upload: (nct: string, csv: string) => post<{ nct_id: string; import: ImportInfo }>(`${BASE}/${enc(nct)}/soa-csv`, { csv }),
  reset: (nct: string) => post<{ nct_id: string; import: ImportInfo }>(`${BASE}/${enc(nct)}/soa-draft`, {}),
  templateUrl: `${BASE}/soa-template.csv`,
  exportUrl: (nct: string) => `${BASE}/${enc(nct)}/soa.csv`,
}

export const NCT_PATTERN = /^NCT\d{8}$/
