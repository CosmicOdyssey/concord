import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { DEFAULT_SCENARIO, scenarioKey, type AllocKey, type LowHistory, type Scenario, type Trial, type Universe } from '../api'
import type { ClearState } from '../App'
import { Badge, ErrorBox, Loading, RunLine } from '../components'
import { ALLOC_HINT, ALLOC_LABEL, ctgovUrl, int, isNum, num, phaseLabel, signedMonths, tOf } from '../format'
import { AssumptionsUsed, betaInfo, CalibrationLine, DecompositionTable, HeadlineBlock } from '../summary'

type SortKey = 'trial' | 'sponsor' | 'target' | 'sites' | AllocKey | 'saved'
const T_COLS: AllocKey[] = ['actual', 'indep', 'coord', 'coord_free']

interface Props {
  clear: ClearState
  regions: string[]
  form: Scenario
  setForm: Dispatch<SetStateAction<Scenario>>
  onOpenTrial: (nct: string) => void
}

export function saved(t: Trial): number | null {
  return isNum(t.T_actual) && isNum(t.T_coord) ? t.T_actual - t.T_coord : null
}

function sortValue(t: Trial, k: SortKey): string | number | null {
  switch (k) {
    case 'trial':
      return (t.acronym ?? t.nct_id).toLowerCase()
    case 'sponsor':
      return t.sponsor?.toLowerCase() ?? null
    case 'target':
      return t.target_region
    case 'sites':
      return t.sites_actual
    case 'saved':
      return saved(t)
    default:
      return tOf(t, k)
  }
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <span className="tnum strong">{unit === '×' ? `×${value.toFixed(2)}` : `${value} ${unit}`}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="muted small">{hint}</span>
    </label>
  )
}

export function TimeBar({ base, coord, cap }: { base: number | null; coord: number | null; cap: number }) {
  const w = (x: number | null) => (isNum(x) ? Math.min(100, (100 * x) / cap) : 0)
  const over = (x: number | null) => isNum(x) && x > cap
  return (
    <div className="tbar" title={`Registered ${num(base)} mo · Coordinated ${num(coord)} mo`} aria-hidden="true">
      <div className="tbar-row">
        <span className="tbar-indep" style={{ width: `${w(base)}%` }} />
        {over(base) && <span className="tbar-over">›</span>}
      </div>
      <div className="tbar-row">
        <span className="tbar-coord" style={{ width: `${w(coord)}%` }} />
        {over(coord) && <span className="tbar-over">›</span>}
      </div>
    </div>
  )
}

export function BackgroundBadge({ t }: { t: Trial }) {
  if (t.flagged)
    return (
      <Badge tone="warn" title="Implausible model time: held fixed at its registered sites and excluded from every number">
        background (excluded)
      </Badge>
    )
  if (!t.movable)
    return (
      <Badge tone="neutral" title="Another sponsor's trial, held fixed at its registered sites (portfolio mode)">
        background
      </Badge>
    )
  return null
}

export function EligBadge({ source }: { source: string }) {
  return (
    <Badge tone={source === 'hand-encoded' ? 'ok' : 'info'} title="How this trial's eligibility criteria were encoded">
      {source}
    </Badge>
  )
}

export function AssumptionsForm({
  form,
  setForm,
  regions,
  betaHint,
}: {
  form: Scenario
  setForm: Dispatch<SetStateAction<Scenario>>
  regions?: string[]
  betaHint?: string
}) {
  const [betaText, setBetaText] = useState(form.beta === null ? '' : String(form.beta))
  const [lastBeta, setLastBeta] = useState(form.beta)
  if (form.beta !== lastBeta) {
    // Keep the text box in sync when the scenario is reset or a preset is loaded.
    setLastBeta(form.beta)
    if (form.beta === null ? betaText.trim() !== '' : Number(betaText) !== form.beta) setBetaText(form.beta === null ? '' : String(form.beta))
  }
  return (
    <>
      <div className="form-grid">
        {regions && (
          <label className="field">
            <span className="field-label">Region</span>
            <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
              {regions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Congestion elasticity β</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="data estimate"
            value={betaText}
            onChange={(e) => {
              const v = e.target.value
              setBetaText(v)
              const n = v.trim() === '' ? null : Number(v)
              setForm({ ...form, beta: n === null || Number.isNaN(n) ? null : n })
            }}
          />
          <span className="muted small">{betaHint ?? 'Blank = estimate from the within-site regression.'} The master doc assumed 1.</span>
        </label>
        <label className="field">
          <span className="field-label">Low-history site rates</span>
          <select value={form.low_history} onChange={(e) => setForm({ ...form, low_history: e.target.value as LowHistory })}>
            <option value="model">model: capped at prior 25th pct (wins backtest)</option>
            <option value="prior">prior: raw posterior</option>
            <option value="exclude">exclude low-history sites</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Site universe</span>
          <select value={form.universe} onChange={(e) => setForm({ ...form, universe: e.target.value as Universe })}>
            <option value="registered">registered: sites some trial registered</option>
            <option value="history">history: any site with lung-trial history</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">As of date</span>
          <input
            type="date"
            value={form.as_of ?? ''}
            min="2010-01-01"
            max="2026-12-31"
            onChange={(e) => setForm({ ...form, as_of: e.target.value || null })}
          />
          <span className="muted small">Blank = trials recruiting today.</span>
        </label>
        <label className="field">
          <span className="field-label">Sponsor (portfolio mode)</span>
          <input
            type="text"
            placeholder="all sponsors"
            value={form.sponsor ?? ''}
            onChange={(e) => setForm({ ...form, sponsor: e.target.value || null })}
          />
          <span className="muted small">Only this sponsor’s trials move; everyone else is background.</span>
        </label>
      </div>
      <div className="sliders">
        <Slider
          label="Activation lag"
          hint="Months from site selection to first patient."
          value={form.activation_lag}
          min={0}
          max={12}
          step={1}
          unit="mo"
          onChange={(v) => setForm({ ...form, activation_lag: v })}
        />
        <Slider
          label="Patient-pool overlap"
          hint="Scales how much concurrent trials compete for the same eligible patients."
          value={form.overlap_scale}
          min={0}
          max={2}
          step={0.05}
          unit="×"
          onChange={(v) => setForm({ ...form, overlap_scale: v })}
        />
        <Slider
          label="Site capacity"
          hint="Multiplies every site’s concurrent-trial capacity."
          value={form.capacity_scale}
          min={0.5}
          max={2}
          step={0.05}
          unit="×"
          onChange={(v) => setForm({ ...form, capacity_scale: v })}
        />
      </div>
    </>
  )
}

export default function ClearView({ clear, regions, form, setForm, onOpenTrial }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('saved')
  const [asc, setAsc] = useState(false)
  const [query, setQuery] = useState('')
  const [bgMode, setBgMode] = useState<'last' | 'inline' | 'hide'>('last')
  const r = clear.result
  const s = r?.summary

  const rows = useMemo(() => {
    if (!r) return []
    const ql = query.trim().toLowerCase()
    const filtered = r.trials.filter(
      (t) =>
        (bgMode !== 'hide' || t.movable) &&
        (!ql ||
          t.nct_id.toLowerCase().includes(ql) ||
          (t.acronym ?? '').toLowerCase().includes(ql) ||
          (t.sponsor ?? '').toLowerCase().includes(ql) ||
          t.title.toLowerCase().includes(ql)),
    )
    return filtered.sort((a, b) => {
      if (bgMode === 'last' && a.movable !== b.movable) return a.movable ? -1 : 1
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      const c = va < vb ? -1 : va > vb ? 1 : 0
      return asc ? c : -c
    })
  }, [r, query, bgMode, sortKey, asc])

  const setSort = (k: SortKey) => {
    if (k === sortKey) setAsc(!asc)
    else {
      setSortKey(k)
      setAsc(k === 'trial' || k === 'sponsor')
    }
  }
  const th = (k: SortKey, label: string, cls = '', title?: string) => (
    <th key={k} className={`sortable ${cls}`} aria-sort={sortKey === k ? (asc ? 'ascending' : 'descending') : 'none'} title={title}>
      <button onClick={() => setSort(k)}>
        {label}
        <span className="sort-ind">{sortKey === k ? (asc ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )

  const cap = s?.assumptions.plausible_T_cap_months ?? 120
  const modified = scenarioKey({ ...form, region: DEFAULT_SCENARIO.region }) !== scenarioKey(DEFAULT_SCENARIO)
  const b = s ? betaInfo(s.assumptions) : null
  const betaHint =
    b && r?.params.beta === null && isNum(b.ci95[0])
      ? `Blank = data estimate (${num(b.beta, 3)}, 95% CI ${num(b.ci95[0], 3)} to ${num(b.ci95[1], 3)}).`
      : undefined
  const nBackground = r ? r.trials.filter((t) => !t.movable).length : 0

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Clear the market</h1>
          <p className="lede">
            Allocate every concurrent trial’s sites jointly, then compare enrollment times with the sites sponsors actually
            registered. All allocations are evaluated under the same model.
          </p>
        </div>
      </div>

      <div className="card controls">
        <div className="controls-row">
          <label className="field">
            <span className="field-label">Region</span>
            <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
              {regions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary btn-big" onClick={() => clear.run(form)} disabled={clear.loading}>
            {clear.loading ? 'Clearing…' : 'Clear the market'}
          </button>
          <span className="muted small">Clears take about 15–25 s{form.region === 'US' ? ' (US-wide: about 25 s or more)' : ''}.</span>
        </div>
        <details className="assumptions" open={modified || undefined}>
          <summary>Assumptions {modified && <Badge tone="info">modified</Badge>}</summary>
          <AssumptionsForm form={form} setForm={setForm} betaHint={betaHint} />
          <button
            className="btn btn-small"
            onClick={() => setForm({ ...DEFAULT_SCENARIO, region: form.region })}
            disabled={!modified}
          >
            Reset to defaults
          </button>
        </details>
      </div>

      {clear.loading && (
        <Loading
          label={`Clearing ${clear.pendingParams?.region}${clear.pendingParams?.sponsor ? ` · ${clear.pendingParams.sponsor}` : ''}…`}
          hint="Solving registered, best-response, joint-optimum and no-loser allocations. Results below are from the previous run until this finishes."
        />
      )}
      {clear.error && !clear.loading && <ErrorBox error={clear.error} onRetry={() => clear.run(form)} />}

      {r && s && (
        <>
          <RunLine
            params={r.params}
            stale={clear.loading}
            extra={
              <span className="muted">
                {int(r.counts.movable_trials)} trials compared · {int(r.counts.trials)} in instance · {int(r.counts.sites)} sites
              </span>
            }
          />
          <HeadlineBlock r={r} />

          <div className="card">
            <h2>Where the gain comes from</h2>
            <p className="muted small">
              Five comparisons over the same {int(s.coord_vs_actual.trials)} trials. Ratio = total trial-months, baseline ÷
              alternative. If “pure coordination” is near 1×, the headline gain comes from better site selection, which a
              single sponsor could make alone.
            </p>
            <DecompositionTable r={r} />
            {s.background_trials > 0 && (
              <p className="muted small">
                {int(s.background_trials)} background trials are held at their registered sites and excluded from every number.
                Under the joint optimum with losers allowed, {int(s.background_worse_under_coord_free)} of them would be slower;
                the headline allocation caps every trial, background included, at its registered time.
              </p>
            )}
          </div>

          <div className="card raw">
            <h2>Assumptions used</h2>
            <AssumptionsUsed a={s.assumptions} />
            <h3>Calibration check</h3>
            <CalibrationLine c={s.calibration_check} />
            <h3>Solver</h3>
            <div className="small tnum">
              {Object.entries(s.solver).map(([k, st]) => (
                <div key={k}>
                  <span className="muted">{ALLOC_LABEL[k as AllocKey] ?? k}:</span> {num(st.seconds, 1)} s,{' '}
                  {int(st.improvements)} improving moves
                  {st.hit_time_limit && ' · stopped at time limit (feasible, not proven optimal)'}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="table-tools">
              <h2>Trials</h2>
              <input
                type="search"
                placeholder="Filter by NCT, acronym, sponsor, title"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter trials"
              />
              <label className="check small">
                Background trials ({nBackground})
                <select value={bgMode} onChange={(e) => setBgMode(e.target.value as 'last' | 'inline' | 'hide')}>
                  <option value="last">sorted last</option>
                  <option value="inline">sorted inline</option>
                  <option value="hide">hidden</option>
                </select>
              </label>
              <span className="muted small">{rows.length} shown · click a row for its price tags</span>
            </div>
            <div className="table-scroll">
              <table className="tbl tbl-trials">
                <thead>
                  <tr>
                    {th('trial', 'Trial')}
                    {th('sponsor', 'Sponsor')}
                    {th('target', 'Regional target', 'num')}
                    {th('sites', 'Sites', 'num', 'Registered sites in the region')}
                    {T_COLS.map((k) => th(k, ALLOC_LABEL[k], 'num', ALLOC_HINT[k]))}
                    <th className="bar-col">
                      <span className="legend-inline small">
                        <i className="sw sw-indep" /> reg. <i className="sw sw-coord" /> coord.
                      </span>
                    </th>
                    {th('saved', 'Months saved', 'num', 'Registered minus coordinated (no losers)')}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const d = saved(t)
                    return (
                      <tr
                        key={t.nct_id}
                        className={`clickable${t.movable ? '' : ' row-bg'}`}
                        onClick={() => onOpenTrial(t.nct_id)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onOpenTrial(t.nct_id)
                        }}
                      >
                        <td className="trial-cell">
                          <div className="trial-id">
                            <a href={ctgovUrl(t.nct_id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                              {t.acronym ?? t.nct_id}
                            </a>
                            <BackgroundBadge t={t} />
                          </div>
                          <div className="muted small trunc" title={t.title}>
                            {t.acronym ? `${t.nct_id} · ` : ''}
                            {phaseLabel(t.phases)}
                          </div>
                          <EligBadge source={t.eligibility_source} />
                        </td>
                        <td className="sponsor-cell" title={t.sponsor ?? ''}>
                          {t.sponsor ?? '—'}
                        </td>
                        <td className="num">{num(t.target_region)}</td>
                        <td className="num">{int(t.sites_actual)}</td>
                        {T_COLS.map((k) => (
                          <td key={k} className="num">
                            {num(tOf(t, k))}
                          </td>
                        ))}
                        <td className="bar-col">
                          <TimeBar base={t.T_actual} coord={t.T_coord} cap={cap} />
                        </td>
                        <td className={`num ${t.movable && d !== null && d > 0 ? 'pos' : ''}`}>
                          {t.movable ? signedMonths(d) : <span className="muted">excluded</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              T = model-estimated months to fill the trial’s regional enrollment target (total enrollment pro-rated by the
              share of its CT.gov sites in the region). Months saved = Registered − Coordinated (no losers). Bars are scaled to{' '}
              {int(cap)} months; › marks a value beyond that. “Background (excluded)” marks an implausible model time (over{' '}
              {int(cap)} months): the trial stays at its registered sites as congestion and is left out of every number.
              Unknown values show “—”.
            </p>
          </div>
        </>
      )}
    </section>
  )
}
