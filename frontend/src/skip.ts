import type { MouseEvent } from 'react'

/** "Skip to content" without touching the hash (the hash is the router): focus the target and scroll it into view.
 *  The target needs tabIndex={-1}. */
export function skipTo(e: MouseEvent, id: string) {
  e.preventDefault()
  const el = document.getElementById(id)
  if (!el) return
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'start' })
}
