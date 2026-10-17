import { useEffect, useRef } from 'react'

/** Keeps the selected tab (aria-selected="true") visible inside a horizontally scrolling tab bar,
 *  e.g. the Research tab at phone width. Scrolls only the bar, never the page. */
export function useActiveTabScroll<T extends HTMLElement>(activeKey: string) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const bar = ref.current
    const el = bar?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!bar || !el || bar.scrollWidth <= bar.clientWidth) return
    const b = bar.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (r.left < b.left) bar.scrollLeft += r.left - b.left - 16
    else if (r.right > b.right) bar.scrollLeft += r.right - b.right + 16
  }, [activeKey])
  return ref
}
