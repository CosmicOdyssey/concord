// The indication selector of Portfolio overlap. Lung cancer (the default) renders the lung audit exactly as before
// (eligibility overlap); an extra indication fetched into its own DB renders OverlapSitesView (site overlap only).
// A lung deep link (#overlap/<sponsor>...) always switches back to lung.
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Loading } from '../components'
import { LUNG, LUNG_INDICATION, overlapSitesApi, type IndicationInfo } from '../overlapSitesApi'
import OverlapSitesView from './OverlapSitesView'
import './overlapSites.css'

const KEY = 'concord.overlap.indication'
const DEEP_LINK = /^#overlap\/./

function initialSlug(): string {
  if (DEEP_LINK.test(window.location.hash)) return LUNG
  try {
    return sessionStorage.getItem(KEY) || LUNG
  } catch {
    return LUNG
  }
}

export function IndicationSwitch({ regions, renderLung }: { regions: string[]; renderLung: (field: ReactNode) => ReactNode }) {
  const ids = useId()
  const [list, setList] = useState<IndicationInfo[]>([LUNG_INDICATION])
  const [loaded, setLoaded] = useState(false)
  const [slug, setSlug] = useState(initialSlug)

  useEffect(() => {
    const ctl = new AbortController()
    overlapSitesApi
      .indications(ctl.signal)
      .then((r) => {
        if (!ctl.signal.aborted && r.indications.length) setList(r.indications)
      })
      .catch(() => {
        /* lung only */
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoaded(true)
      })
    return () => ctl.abort()
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, slug)
    } catch {
      /* storage unavailable */
    }
  }, [slug])

  useEffect(() => {
    const onHash = () => {
      if (DEEP_LINK.test(window.location.hash)) setSlug(LUNG)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // A lung deep link no longer describes the view once another indication is chosen; without this, a reload or a
  // shared URL would switch back to lung (the deep-link rule above). Mirrors LungOverlapView's update().
  const choose = (next: string) => {
    if (next !== LUNG && DEEP_LINK.test(window.location.hash)) {
      try {
        window.history.replaceState(null, '', '#overlap')
      } catch {
        /* ignore */
      }
    }
    setSlug(next)
  }

  const ind = list.find((i) => i.slug === slug)
  if (!ind && slug !== LUNG && !loaded) return <Loading label="Loading indications…" />
  const field = (
    <div className="field ov-f-ind">
      <label className="field-label" htmlFor={`${ids}-ind`}>
        Indication
      </label>
      <select id={`${ids}-ind`} value={ind ? slug : LUNG} onChange={(e) => choose(e.target.value)}>
        {list.map((i) => (
          <option key={i.slug} value={i.slug}>
            {i.label}
            {i.eligibility ? '' : ' (site overlap only)'}
          </option>
        ))}
      </select>
    </div>
  )
  if (!ind || ind.eligibility) return <>{renderLung(field)}</>
  return <OverlapSitesView key={ind.slug} indication={ind} indicationField={field} regions={regions} />
}
