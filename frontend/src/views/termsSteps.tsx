// Protocol to terms: the six steps as real tabs (WAI-ARIA tabs pattern, automatic activation). One step shows at a
// time; every step stays mounted (inactive panels carry the hidden attribute), so fetched data, a pasted proposal,
// overrides and band inputs survive switching. The newly shown panel fades in (CSS only, protocolTerms.css, and only
// when motion is allowed); the old one is removed at once, so there is no blank gap. The page scrolls (instantly)
// only when the new panel's top would sit under the sticky header and step nav; focus moves to the panel heading
// only on keyboard activation. Deep link: #terms-flow/<NCT>/<step slug>.
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { STEPS, StepTabsContext, afterSwitch, howOf, panelId, tabId, useStepSwitch, useStepTabs, type StepStore } from './termsStepTabs'

export function StepTabsProvider({ store, children }: { store: StepStore; children: ReactNode }) {
  return <StepTabsContext.Provider value={store}>{children}</StepTabsContext.Provider>
}

/** The step nav: a tab list, one tab per step, the active one marked with the accent. */
export function StepNav() {
  const { active, select } = useStepTabs()
  const sw = useStepSwitch()
  // After the panels swap (same commit), before paint: scroll if the new top would be hidden, focus on keyboard use.
  useLayoutEffect(() => afterSwitch(sw), [sw])
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const listRef = useRef<HTMLOListElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const last = STEPS.length - 1

  // Stick just under what the app header keeps on screen (the one-row header, or the tab bar below 1320 px), measured:
  // the CSS fallback (--sticky-h) is short of the two-line tab bar on narrow screens.
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const els = [...document.querySelectorAll<HTMLElement>('.appbar, nav.tabs')]
    const fit = () => {
      let h = 0
      for (const el of els) {
        const cs = getComputedStyle(el)
        if (cs.position === 'sticky' || cs.position === 'fixed') h = Math.max(h, (parseFloat(cs.top) || 0) + el.getBoundingClientRect().height)
      }
      nav.style.top = h > 0 ? `${Math.floor(h)}px` : ''
    }
    fit()
    const ro = new ResizeObserver(fit)
    els.forEach((el) => ro.observe(el))
    window.addEventListener('resize', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [])

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to =
      e.key === 'ArrowRight' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null
    if (to === null) return
    e.preventDefault()
    select(to, 'arrows')
    refs.current[to]?.focus({ preventScroll: true })
  }

  // On a narrow screen the nav scrolls sideways: keep the active step in view inside it (never the page).
  useEffect(() => {
    const list = listRef.current
    const b = refs.current[active]
    if (!list || !b || list.scrollWidth <= list.clientWidth + 1) return
    const l = b.offsetLeft - list.offsetLeft
    const r = l + b.offsetWidth
    if (l < list.scrollLeft + 8) list.scrollLeft = Math.max(0, l - 8)
    else if (r > list.scrollLeft + list.clientWidth - 8) list.scrollLeft = r - list.clientWidth + 8
  }, [active])

  return (
    <nav ref={navRef} className="tf-flow" role="tablist" aria-label="Steps">
      <ol ref={listRef} role="presentation">
        {STEPS.map((s, i) => {
          const on = i === active
          return (
            <li key={s.slug} role="presentation">
              <button
                ref={(el) => {
                  refs.current[i] = el
                }}
                type="button"
                role="tab"
                id={tabId(i)}
                aria-selected={on}
                aria-controls={panelId(i)}
                tabIndex={on ? 0 : -1}
                className={`tf-flow-btn${on ? ' tf-flow-on' : ''}`}
                onClick={(e) => select(i, howOf(e))}
                onKeyDown={(e) => onKey(e, i)}
              >
                <span className="tf-flow-n num" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="tf-flow-label">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.nav}
                </span>
              </button>
              {i < last && (
                <span className="tf-flow-arrow" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Back and Next at the foot of a step. */
export function StepPager({ i }: { i: number }) {
  const { select } = useStepTabs()
  const prev = i > 0 ? STEPS[i - 1] : null
  const next = i < STEPS.length - 1 ? STEPS[i + 1] : null
  return (
    <div className="tf-pager">
      {prev && (
        <button type="button" className="btn tf-pager-back" aria-label={`Back to step ${i}: ${prev.nav}`} onClick={(e) => select(i - 1, howOf(e))}>
          <span aria-hidden="true">←</span> Back
        </button>
      )}
      {next && (
        <button type="button" className="btn btn-primary tf-pager-next" onClick={(e) => select(i + 1, howOf(e))}>
          Next: {next.nav} <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  )
}

/** A step whose content needs the protocol, while it loads (or failed): same frame, same ids, so the tabs and deep
 *  links work from the first paint. */
export function StepPlaceholder({ i, children }: { i: number; children: ReactNode }) {
  const { active } = useStepTabs()
  return (
    <section id={panelId(i)} className="win section tf-step" role="tabpanel" aria-labelledby={tabId(i)} hidden={active !== i}>
      <div className="win-strip">
        <span className="win-title">
          Step {i + 1} of {STEPS.length}
        </span>
      </div>
      <div className="win-body">
        <div className="section-title">
          <h2 tabIndex={-1}>{STEPS[i].name}</h2>
        </div>
        {children}
      </div>
    </section>
  )
}
