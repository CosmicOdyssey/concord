// Main tabs stay mounted once visited (App.tsx): an inactive tab's view is hidden (the hidden attribute), not
// unmounted, so switching back is instant and keeps its state. A view reads whether it is on show from this context,
// to hold back work that only makes sense on screen (a deep-link scroll, a map resize) until it is shown again.
import { createContext, useContext } from 'react'

export const TabActiveContext = createContext(true)

/** True while this view's tab is on show (always true outside the app's tab panes). */
export function useTabActive(): boolean {
  return useContext(TabActiveContext)
}
