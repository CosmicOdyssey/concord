// A view loaded on first use (its own chunk) that can also be fetched ahead of time. React.lazy suspends once on its
// first render even when the module is already in memory; this wrapper renders the loaded component directly once
// its chunk is here, so a view whose code was preloaded (App.tsx, after the first paint, or on tab hover / focus)
// mounts in the same render, with no fallback.
import { createElement, lazy, type ComponentType } from 'react'

export interface PreloadableView<P extends object> {
  View: ComponentType<P>
  /** Fetch the chunk now (idempotent; a failed fetch can be retried). */
  preload: () => Promise<unknown>
}

export function preloadable<P extends object>(factory: () => Promise<{ default: ComponentType<P> }>): PreloadableView<P> {
  let loaded: ComponentType<P> | null = null
  let pending: Promise<{ default: ComponentType<P> }> | null = null
  const load = () =>
    (pending ??= factory().then(
      (m) => {
        loaded = m.default
        return m
      },
      (e: unknown) => {
        pending = null
        throw e
      },
    ))
  const Lazy = lazy(load)
  function View(props: P) {
    return loaded ? createElement(loaded, props) : createElement(Lazy, props)
  }
  return { View, preload: () => load().catch(() => undefined) }
}
