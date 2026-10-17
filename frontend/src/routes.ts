// Research sub-tabs (the pre-pivot views). Kept out of App.tsx and ResearchView.tsx so the hash router can
// use them without pulling the lazily loaded research views into the landing bundle.

export const RESEARCH_TABS = [
  { id: 'clear', label: 'Clear it' },
  { id: 'robustness', label: 'Robustness' },
  { id: 'map', label: 'Map' },
  { id: 'portfolio', label: 'Portfolio clearing' },
  { id: 'prices', label: 'Price tags' },
  { id: 'terms', label: 'Term sheet' },
  { id: 'model', label: 'Model & data' },
] as const
export type ResearchTabId = (typeof RESEARCH_TABS)[number]['id']

/** Sub-tabs that show nothing useful until a clear has run: opening one starts the default clear (once). */
export const NEEDS_CLEAR: ReadonlySet<ResearchTabId> = new Set<ResearchTabId>(['clear', 'map', 'prices', 'terms'])

export function researchTab(id: string | undefined): ResearchTabId | null {
  const k = (id ?? '').toLowerCase()
  return RESEARCH_TABS.find((t) => t.id === k)?.id ?? null
}
