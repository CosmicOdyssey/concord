import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import './hovercard.css'

const OPEN_DELAY = 120
// Time to cross the gap from the trigger into the card before it closes.
const CLOSE_GRACE = 150
const GAP = 6
const EDGE = 8
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// One card at a time: opening one closes whichever was open.
let closeCurrent: (() => void) | null = null

function keyboardFocused(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

interface HoverCardProps {
  /** Plain text (a string) becomes a tooltip: role="tooltip", wired to the trigger with aria-describedby. Anything
   *  else is a non-modal popover the trigger expands (aria-expanded); keyboard users can Tab into it. */
  content: ReactNode
  /** The trigger. It renders inside a <button>, so phrasing content only (no links or buttons). */
  children: ReactNode
  /** Accessible name for a trigger without text of its own. */
  label?: string
  className?: string
}

/** Shows `content` in a floating card on pointer hover (after a short delay), keyboard focus or a tap. The card
 *  is portalled to <body>, so scrolling or overflow-clipped parents do not cut it off. */
export function HoverCard({ content, children, label, className }: HoverCardProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const timer = useRef(0)
  // Mouse over the trigger or the card.
  const hovering = useRef(false)
  // Opened by a click or tap: stays open after the mouse leaves, until dismissed.
  const pinned = useRef(false)
  const pointerType = useRef('')
  // Focus moved back to the trigger by the card itself, which should not count as a keyboard open.
  const refocusing = useRef(false)
  const plain = typeof content === 'string'

  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    pinned.current = false
    setOpen(false)
  }, [])

  const show = useCallback(() => {
    window.clearTimeout(timer.current)
    if (closeCurrent !== hide) closeCurrent?.()
    closeCurrent = hide
    setOpen(true)
  }, [hide])

  const after = (ms: number, fn: () => void) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }

  // Keyboard focus on the trigger, or any focus in the card. A mouse click also focuses the trigger in Chrome;
  // that should not keep a hover card open after the pointer leaves.
  const focusInside = () => {
    const a = document.activeElement
    if (!a) return false
    return (a === triggerRef.current && keyboardFocused(a)) || !!cardRef.current?.contains(a)
  }

  const refocusTrigger = () => {
    refocusing.current = true
    triggerRef.current?.focus()
    refocusing.current = false
  }

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (closeCurrent === hide) closeCurrent = null
    },
    [hide],
  )

  // Below the trigger, or above it when the card would cross the bottom edge; centred on it, kept 8 px inside
  // the viewport. Written straight to the node so scrolling does not re-render.
  const place = useCallback(() => {
    const t = triggerRef.current
    const c = cardRef.current
    if (!t || !c) return
    const r = t.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    // Measure at the origin: a fixed card keeps the `left` of its last placement, and with that left near the
    // right edge (after the viewport shrank) it would size itself to the sliver of room left of it.
    c.style.left = '0px'
    c.style.top = '0px'
    const w = c.offsetWidth
    const h = c.offsetHeight
    const fitsBelow = r.bottom + GAP + h <= vh - EDGE
    const up = !fitsBelow && (r.top - GAP - h >= EDGE || r.top > vh - r.bottom)
    const top = up ? r.top - GAP - h : r.bottom + GAP
    c.style.top = `${Math.round(Math.max(EDGE, Math.min(top, vh - h - EDGE)))}px`
    c.style.left = `${Math.round(Math.max(EDGE, Math.min(r.left + r.width / 2 - w / 2, vw - w - EDGE)))}px`
    c.dataset.placement = up ? 'top' : 'bottom'
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    place()
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    // Capture: scrolling any ancestor (the overlap matrix, a table) moves the trigger.
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const ro = new ResizeObserver(schedule)
    if (cardRef.current) ro.observe(cardRef.current)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      ro.disconnect()
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    const onDown = (e: globalThis.PointerEvent) => {
      const n = e.target as Node
      if (!triggerRef.current?.contains(n) && !cardRef.current?.contains(n)) hide()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open, hide])

  const onEnter = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    hovering.current = true
    if (open) window.clearTimeout(timer.current)
    else after(OPEN_DELAY, show)
  }

  const onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    hovering.current = false
    after(CLOSE_GRACE, () => {
      if (!pinned.current && !focusInside()) hide()
    })
  }

  const onPress = (e: PointerEvent) => {
    pointerType.current = e.pointerType
  }

  // Mouse: hovering already opened it, so a click pins it open and a second click closes it.
  // Touch, pen and keyboard (detail 0): each activation toggles.
  const onClick = (e: MouseEvent) => {
    const mouse = pointerType.current === 'mouse' && e.detail > 0
    pointerType.current = ''
    if (mouse && open && !pinned.current) {
      pinned.current = true
      window.clearTimeout(timer.current)
    } else if (open) {
      hide()
    } else {
      show()
      pinned.current = true
    }
  }

  // Close when focus moves on to something else. Focus going nowhere is a click or tap on plain content (a tap
  // inside the card moves focus only after pointerup), and the outside-press listener already handles the outside case.
  const onBlur = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null
    if (!to || triggerRef.current?.contains(to) || cardRef.current?.contains(to)) return
    if (!hovering.current) hide()
  }

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.shiftKey || !open || plain) return
    const first = cardRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    if (first) {
      e.preventDefault()
      first.focus()
    }
  }

  // Keys stay inside the card: it is portalled, so React would otherwise bubble them to the trigger's ancestors
  // (a clickable table row, say), and the document-level Escape listener never sees them.
  const onCardKey = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      refocusTrigger()
      hide()
      return
    }
    if (e.key !== 'Tab') return
    const items = [...(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (e.shiftKey && document.activeElement === items[0]) {
      e.preventDefault()
      refocusTrigger()
    } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
      // Back to the trigger without preventing the default, so Tab carries on to whatever follows it on the page.
      refocusTrigger()
    }
  }

  const card =
    (plain || open) &&
    createPortal(
      <div
        ref={cardRef}
        id={id}
        className="hc-card"
        role={plain ? 'tooltip' : 'dialog'}
        aria-labelledby={plain ? undefined : `${id}-t`}
        hidden={!open}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return
          hovering.current = true
          window.clearTimeout(timer.current)
        }}
        onPointerLeave={onLeave}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onCardKey}
        onBlur={onBlur}
      >
        {content}
      </div>,
      document.body,
    )

  return (
    <>
      <button
        ref={triggerRef}
        id={`${id}-t`}
        type="button"
        className={`hc-trigger${className ? ` ${className}` : ''}`}
        aria-label={label}
        aria-describedby={plain ? id : undefined}
        aria-expanded={plain ? undefined : open}
        aria-controls={!plain && open ? id : undefined}
        data-open={open || undefined}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onPointerDown={onPress}
        onClick={onClick}
        onFocus={(e) => {
          if (!refocusing.current && keyboardFocused(e.currentTarget)) show()
        }}
        onBlur={onBlur}
        onKeyDown={onTriggerKey}
      >
        {children}
      </button>
      {card}
    </>
  )
}

/** Icon-only "i" button; `label` is its accessible name and `content` what the card shows. `size="lg"` is the 2 rem
 *  outlined circle that sits next to a section heading (copy deck: label "Details: {section title}"); the default is
 *  an inline icon sized to the text around it. */
export function InfoTip({ label, content, className, size = 'sm' }: { label: string; content: ReactNode; className?: string; size?: 'sm' | 'lg' }) {
  return (
    <HoverCard content={content} label={label} className={`hc-info${size === 'lg' ? ' hc-info-lg' : ''}${className ? ` ${className}` : ''}`}>
      {size === 'lg' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 11v6" />
          <path d="M12 7.25v.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.4v3.9" />
          <path d="M8 4.8v.1" strokeWidth="1.9" />
        </svg>
      )}
    </HoverCard>
  )
}
