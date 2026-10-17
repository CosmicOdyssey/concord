// Research tab: the pre-pivot views as sub-tabs, under one banner. Loaded lazily by App so the landing
// page does not ship Leaflet and the clearing views.
import type { Dispatch, SetStateAction } from 'react'
import type { Scenario } from '../api'
import type { ClearState } from '../App'
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
      <p className="rs-banner" role="note">
        Research views. Allocation results here are in-sample model outputs and are not product claims; see{' '}
        <a href="#findings">Findings</a>.
      </p>
      <nav className="rs-tabs" role="tablist" aria-label="Research views" ref={bar}>
        {RESEARCH_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={sub === t.id}
            className={`rs-tab${sub === t.id ? ' rs-tab-on' : ''}`}
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
