// Protocol to terms: the step-tab state (termsSteps.tsx draws the nav, the pager and the placeholder panels). One
// step shows at a time; every step stays mounted, hidden while another is on show. Deep link:
// #terms-flow/<NCT>/<step slug>. The page scrolls (instantly) only when the new panel's top would sit under the sticky
// header and step nav; focus moves to the panel heading only on keyboard activation.
import { createContext, useCallback, useContext, useLayoutEffect, useState, type MouseEvent } from 'react'

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

/** How a step was chosen: a pointer click, the keyboard on a button (Enter or Space), arrow keys in the tab list,
 *  or a link. Only 'keyboard' moves focus to the panel heading. */
export type How = 'pointer' | 'keyboard' | 'arrows' | 'link'

export interface StepTabs {
  active: number
  select: (i: number, how?: How) => void
}

export const StepTabsContext = createContext<StepTabs>({ active: 0, select: () => {} })

export const useStepTabs = () => useContext(StepTabsContext)

/** A click from Enter or Space on a button reports detail 0. */
export const howOf = (e: MouseEvent): How => (e.detail === 0 ? 'keyboard' : 'pointer')

/** Where a panel's top should sit when the page has to scroll: under the sticky app header and the sticky step nav. */
function stickyOffset(): number {
  const nav = document.querySelector<HTMLElement>('.tf-flow')
  if (!nav) return 0
  const cs = getComputedStyle(nav)
  const top = cs.position === 'sticky' ? parseFloat(cs.top) || 0 : 0
  return top + nav.getBoundingClientRect().height + 12
}

/** The active step and the switch that changes it; `initial` is read once. */
export function useStepState(initial: () => number): StepTabs & { setFromLink: (i: number) => void } {
  const [sw, setSw] = useState<{ i: number; n: number; how: How }>(() => ({ i: initial(), n: 0, how: 'link' }))
  const select = useCallback((i: number, how: How = 'pointer') => {
    const to = Math.max(0, Math.min(STEPS.length - 1, i))
    setSw((s) => ({ i: to, n: s.n + 1, how }))
  }, [])
  const setFromLink = useCallback((i: number) => setSw((s) => (s.i === i ? s : { i, n: s.n + 1, how: 'link' })), [])

  // Before paint: if the new panel's top would be hidden (the reader had scrolled down the old one), put it just under
  // the sticky header and nav, instantly. Otherwise leave the page where it is.
  useLayoutEffect(() => {
    if (sw.n === 0 || sw.how === 'link') return
    const el = document.getElementById(panelId(sw.i))
    if (!el) return
    const off = stickyOffset()
    const top = el.getBoundingClientRect().top
    if (top < off - 1) window.scrollTo({ top: Math.max(0, window.scrollY + top - off), behavior: 'instant' })
    if (sw.how === 'keyboard') {
      el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
      return
    }
    // A pointer click on Back or Next hides the clicked button: keep focus on the step's tab instead of losing it.
    const a = document.activeElement
    if (sw.how === 'pointer' && (!a || a === document.body || a.closest('[hidden]'))) document.getElementById(tabId(sw.i))?.focus({ preventScroll: true })
  }, [sw])

  return { active: sw.i, select, setFromLink }
}
