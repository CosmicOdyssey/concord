// Main tabs stay mounted once visited (App.tsx): an inactive tab's view is hidden (the hidden attribute), not
// unmounted, so switching back is instant and keeps its state. A view that has work only worth doing on screen (a
// deep-link scroll, a map resize) asks this signal whether it is on show, or to run something when it is shown
// next. It is a subscription, not a value, so a switch never re-renders the views themselves.
import { createContext, useContext } from 'react'

export interface TabSignal {
  /** True while this view is on show. */
  shown: () => boolean
  /** Run `fn` each time this view is shown again; returns an unsubscribe. */
  onShow: (fn: () => void) => () => void
}

export interface TabSignalControl extends TabSignal {
  set: (shown: boolean) => void
}

export function createTabSignal(initial: boolean): TabSignalControl {
  let on = initial
  const subs = new Set<() => void>()
  return {
    shown: () => on,
    onShow: (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    set: (next) => {
      if (next === on) return
      on = next
      if (on) [...subs].forEach((f) => f())
    },
  }
}

/** Outside the app's tab panes a view is always on show. */
const ALWAYS: TabSignal = { shown: () => true, onShow: () => () => undefined }

export const TabSignalContext = createContext<TabSignal>(ALWAYS)

export function useTabSignal(): TabSignal {
  return useContext(TabSignalContext)
}

/** Run `fn` now if the view is on show, else once, when it is next shown. `fn` may return a cleanup; the returned
 *  function cancels a pending run and runs that cleanup. */
export function whenShown(tab: TabSignal, fn: () => void | (() => void)): () => void {
  let cleanup: void | (() => void)
  if (tab.shown()) {
    cleanup = fn()
    return () => cleanup?.()
  }
  const off = tab.onShow(() => {
    off()
    cleanup = fn()
  })
  return () => {
    off()
    cleanup?.()
  }
}
