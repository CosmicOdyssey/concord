// Protocol to terms: the step-tab state (termsSteps.tsx draws the nav, the pager and the placeholder panels). One
// step shows at a time; every step stays mounted, hidden while another is on show. Deep link:
// #terms-flow/<NCT>/<step slug>. The active step lives in a small store, not in ProtocolTermsView's state, so a
// switch re-renders the nav and the six step frames only, never the steps' contents (their elements are unchanged,
// so React skips them): the new step paints on the next frame.
import { createContext, useContext, useSyncExternalStore, type MouseEvent } from 'react'

export const STEPS = [
  { name: 'Protocol', nav: 'Protocol', slug: 'protocol' },
  { name: 'Coverage', nav: 'Coverage', slug: 'coverage' },
  { name: 'Budget at a site', nav: 'Budget', slug: 'budget' },
  { name: 'Compare two sites', nav: 'Compare', slug: 'compare' },
  { name: 'Site proposal', nav: 'Site proposal', slug: 'proposal' },
  { name: 'Term sheet', nav: 'Term sheet', slug: 'term-sheet' },
] as const

export const tabId = (i: number) => `tf-tab-${STEPS[i]?.slug ?? i}`
export const panelId = (i: number) => `tf-step-${i + 1}`

/** The step a #terms-flow/<NCT>/<slug> (or #terms-flow/<slug>) link names; 0 (Protocol) when it names none. */
export function stepFromHash(hash: string = window.location.hash): number {
  const slug = hash.match(/^#terms-flow(?:\/NCT\d{8})?\/([a-z-]+)\/?$/i)?.[1]?.toLowerCase()
  const i = STEPS.findIndex((s) => s.slug === slug)
  return i < 0 ? 0 : i
}

export function stepSlug(i: number): string {
  return STEPS[i]?.slug ?? STEPS[0].slug
}

/** Put the step in the address bar (#terms-flow/<NCT>[/<slug>]; step 1 has no slug), without a history entry. */
function writeStepHash(i: number) {
  try {
    const h = window.location.hash
    const nct = h.match(/^#terms-flow\/(NCT\d{8})/i)?.[1]?.toUpperCase()
    if (!nct) return
    const want = `#terms-flow/${nct}${i > 0 ? `/${stepSlug(i)}` : ''}`
    if (h !== want) window.history.replaceState(null, '', want)
  } catch {
    /* ignore */
  }
}

/** How a step was chosen: a pointer click, the keyboard on a button (Enter or Space), arrow keys in the tab list,
 *  or a link. Only 'keyboard' moves focus to the panel heading. */
export type How = 'pointer' | 'keyboard' | 'arrows' | 'link'

/** The step on show; `n` counts switches, so choosing the same step again still runs the switch effects. */
export interface Switch {
  i: number
  n: number
  how: How
}

export interface StepStore {
  get: () => Switch
  subscribe: (fn: () => void) => () => void
  select: (i: number, how?: How) => void
  /** From the address bar: no scroll, no focus. */
  setFromLink: (i: number) => void
}

export function createStepStore(initial: number): StepStore {
  let sw: Switch = { i: initial, n: 0, how: 'link' }
  const subs = new Set<() => void>()
  const set = (next: Switch) => {
    sw = next
    writeStepHash(next.i)
    subs.forEach((f) => f())
  }
  return {
    get: () => sw,
    subscribe: (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    select: (i, how = 'pointer') => set({ i: Math.max(0, Math.min(STEPS.length - 1, i)), n: sw.n + 1, how }),
    setFromLink: (i) => {
      if (i !== sw.i) set({ i, n: sw.n + 1, how: 'link' })
    },
  }
}

export const StepTabsContext = createContext<StepStore>(createStepStore(0))

/** The full switch record (the nav runs the scroll and focus effects from it). */
export function useStepSwitch(): Switch {
  const store = useContext(StepTabsContext)
  return useSyncExternalStore(store.subscribe, store.get)
}

export function useStepTabs(): { active: number; select: StepStore['select'] } {
  const store = useContext(StepTabsContext)
  const sw = useSyncExternalStore(store.subscribe, store.get)
  return { active: sw.i, select: store.select }
}

/** A click from Enter or Space on a button reports detail 0. */
export const howOf = (e: MouseEvent): How => (e.detail === 0 ? 'keyboard' : 'pointer')

/** After a switch, before paint: if the new panel's top would be hidden (the reader had scrolled down the old step),
 *  put it just under the sticky header and step nav, instantly; otherwise leave the page where it is. Focus moves to
 *  the panel heading only on keyboard activation (preventScroll). */
export function afterSwitch(sw: Switch) {
  if (sw.n === 0 || sw.how === 'link') return
  const el = document.getElementById(panelId(sw.i))
  if (!el) return
  const nav = document.querySelector<HTMLElement>('.tf-flow')
  const ncs = nav ? getComputedStyle(nav) : null
  const off = nav && ncs ? (ncs.position === 'sticky' ? parseFloat(ncs.top) || 0 : 0) + nav.getBoundingClientRect().height + 12 : 0
  // The fade-in starts 6 px low (a transform): measure the panel's layout position, not where it is drawn.
  let shift = 0
  try {
    const t = getComputedStyle(el).transform
    shift = t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0
  } catch {
    shift = 0
  }
  const top = el.getBoundingClientRect().top - shift
  if (top < off - 1) window.scrollTo({ top: Math.max(0, window.scrollY + top - off), behavior: 'instant' })
  if (sw.how === 'keyboard') {
    el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
    return
  }
  // A pointer click on Back or Next hides the clicked button: keep focus on the step's tab instead of losing it.
  const a = document.activeElement
  if (sw.how === 'pointer' && (!a || a === document.body || a.closest('[hidden]'))) document.getElementById(tabId(sw.i))?.focus({ preventScroll: true })
}
