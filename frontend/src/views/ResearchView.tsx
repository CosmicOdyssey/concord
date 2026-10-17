// Research tab: the pre-pivot views as sub-tabs, under one banner. Loaded lazily by App so the landing
// page does not ship Leaflet and the clearing views.
import type { Dispatch, SetStateAction } from 'react'
import type { Scenario } from '../api'
import type { ClearState } from '../App'
import { Banner } from '../components'
import { RESEARCH_TABS, type ResearchTabId } from '../routes'
import { useActiveTabScroll } from '../useActiveTabScroll'
import ClearView from './ClearView'
import MapView from './MapView'
import ModelView from './ModelView'
import PortfolioView from './PortfolioView'
import PriceTagsView from './PriceTagsView'
import RobustnessView from './RobustnessView'
import TermsView from './TermsView'
import './research.css'

interface Props {
  sub: ResearchTabId
  onSub: (s: ResearchTabId) => void
  clear: ClearState
  regions: string[]
  form: Scenario
  setForm: Dispatch<SetStateAction<Scenario>>
  selectedTrial: string | null
  setSelectedTrial: (nct: string | null) => void
  onOpenTrial: (nct: string) => void
}

export default function ResearchView({ sub, onSub, clear, regions, form, setForm, selectedTrial, setSelectedTrial, onOpenTrial }: Props) {
  const bar = useActiveTabScroll<HTMLElement>(sub)
  return (
    <div className="rs">
      {/* Copy deck B8, in both densities. */}
      <div className="rs-banner">
        <Banner tone="caution">
          Earlier site-clearing views, kept for reference. These are <strong>in-sample model outputs, not product claims</strong>. See{' '}
          <a href="#findings/allocation">Findings</a> for how they held up on held-out data.
        </Banner>
      </div>
      {/* Sub-tabs as a Calm segmented control; it scrolls sideways inside itself at phone width. */}
      <nav className="seg rs-tabs" role="tablist" aria-label="Research views" ref={bar}>
        {RESEARCH_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={sub === t.id}
            className={`seg-btn rs-tab${sub === t.id ? ' seg-on' : ''}`}
            onClick={() => onSub(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {sub === 'clear' && <ClearView clear={clear} regions={regions} form={form} setForm={setForm} onOpenTrial={onOpenTrial} />}
      {sub === 'robustness' && <RobustnessView clear={clear} />}
      {sub === 'map' && <MapView clear={clear} />}
      {sub === 'portfolio' && (
        <PortfolioView clear={clear} regions={regions} form={form} setForm={setForm} onOpenTrial={onOpenTrial} />
      )}
      {sub === 'prices' && <PriceTagsView clear={clear} selected={selectedTrial} setSelected={setSelectedTrial} />}
      {sub === 'terms' && <TermsView clear={clear} />}
      {sub === 'model' && <ModelView />}
    </div>
  )
}
