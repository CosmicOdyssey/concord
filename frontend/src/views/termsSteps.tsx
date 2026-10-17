// Protocol to terms: the six steps as real tabs (WAI-ARIA tabs pattern, automatic activation). One step shows at a
// time; every step stays mounted (inactive panels carry the hidden attribute), so fetched data, a pasted proposal,
// overrides and band inputs survive switching. The newly shown panel fades in (CSS only, protocolTerms.css, and only
// when motion is allowed); the old one is removed at once, so there is no blank gap. The page scrolls (instantly)
// only when the new panel's top would sit under the sticky header and step nav; focus moves to the panel heading
// only on keyboard activation. Deep link: #terms-flow/<NCT>/<step slug>.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { STEPS, StepTabsContext, howOf, panelId, tabId, useStepTabs, type StepTabs } from './termsStepTabs'

export function StepTabsProvider({ value, children }: { value: StepTabs; children: ReactNode }) {
  return <StepTabsContext.Provider value={value}>{children}</StepTabsContext.Provider>
}

/** The step nav: a tab list, one tab per step, the active one marked with the accent. */
export function StepNav() {
  const { active, select } = useStepTabs()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const listRef = useRef<HTMLOListElement>(null)
  const last = STEPS.length - 1

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
    <nav className="tf-flow" role="tablist" aria-label="Steps">
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
