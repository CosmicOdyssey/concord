import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { DEFAULT_PARAMS, type ClearParams, type Trial } from '../api'
import type { ClearState } from '../App'
import { Badge, Caveat, ErrorBox, Loading, RunLine, Stat } from '../components'
import { ctgovUrl, int, isNum, money, num, pct, phaseLabel, times } from '../format'

type SortKey = 'trial' | 'sponsor' | 'target' | 'sites' | 'T_actual' | 'T_indep' | 'T_coord' | 'saved'

interface Props {
  clear: ClearState
  regions: string[]
  form: ClearParams
  setForm: Dispatch<SetStateAction<ClearParams>>
  onOpenTrial: (nct: string) => void
}

function saved(t: Trial): number | null {
  return isNum(t.T_indep) && isNum(t.T_coord) ? t.T_indep - t.T_coord : null
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
      return t.sites_coord
    case 'T_actual':
      return t.T_actual
    case 'T_indep':
      return t.T_indep
    case 'T_coord':
      return t.T_coord
    case 'saved':
      return saved(t)
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
        <span className="tnum strong">
          {unit === '×' ? `×${value.toFixed(2)}` : `${value} ${unit}`}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="muted small">{hint}</span>
    </label>
  )
}

function TimeBar({ indep, coord, cap }: { indep: number | null; coord: number | null; cap: number }) {
  const w = (x: number | null) => (isNum(x) ? Math.min(100, (100 * x) / cap) : 0)
  const over = (x: number | null) => isNum(x) && x > cap
  return (
    <div className="tbar" title={`Independent ${num(indep)} mo · Coordinated ${num(coord)} mo`} aria-hidden="true">
      <div className="tbar-row">
        <span className="tbar-indep" style={{ width: `${w(indep)}%` }} />
        {over(indep) && <span className="tbar-over">›</span>}
      </div>
      <div className="tbar-row">
        <span className="tbar-coord" style={{ width: `${w(coord)}%` }} />
        {over(coord) && <span className="tbar-over">›</span>}
      </div>
    </div>
  )
}

export default function ClearView({ clear, regions, form, setForm, onOpenTrial }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('saved')
  const [asc, setAsc] = useState(false)
  const [query, setQuery] = useState('')
  const [flaggedMode, setFlaggedMode] = useState<'last' | 'inline' | 'hide'>('last')
  const r = clear.result
  const s = r?.summary
  const rb = s?.robust

  const rows = useMemo(() => {
    if (!r) return []
    const ql = query.trim().toLowerCase()
    const filtered = r.trials.filter(
      (t) =>
        (flaggedMode !== 'hide' || !t.flagged) &&
        (!ql ||
          t.nct_id.toLowerCase().includes(ql) ||
          (t.acronym ?? '').toLowerCase().includes(ql) ||
          (t.sponsor ?? '').toLowerCase().includes(ql) ||
          t.title.toLowerCase().includes(ql)),
    )
    return filtered.sort((a, b) => {
      if (flaggedMode === 'last' && a.flagged !== b.flagged) return a.flagged ? 1 : -1
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      // Unknowns always sort last, whichever direction.
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      const c = va < vb ? -1 : va > vb ? 1 : 0
      return asc ? c : -c
    })
  }, [r, query, flaggedMode, sortKey, asc])

  const setSort = (k: SortKey) => {
    if (k === sortKey) setAsc(!asc)
    else {
      setSortKey(k)
      setAsc(k === 'trial' || k === 'sponsor')
    }
  }
  const th = (k: SortKey, label: string, cls = '') => (
    <th className={`sortable ${cls}`} aria-sort={sortKey === k ? (asc ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort(k)}>
        {label}
        <span className="sort-ind">{sortKey === k ? (asc ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )

  const cap = rb?.plausible_T_cap_months ?? 120
  const modified =
    form.activation_lag !== DEFAULT_PARAMS.activation_lag ||
    form.overlap_scale !== DEFAULT_PARAMS.overlap_scale ||
    form.capacity_scale !== DEFAULT_PARAMS.capacity_scale

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Clear the market</h1>
          <p className="lede">
            Allocate every concurrent trial’s sites jointly, then compare enrollment times against each sponsor picking
            its own sites independently. The difference is the coordination dividend.
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
          {form.region === 'US' && <span className="muted small">US-wide clears take roughly 30–60 s.</span>}
        </div>
        <details className="assumptions" open={modified || undefined}>
          <summary>
            Assumptions {modified && <Badge tone="info">modified</Badge>}
          </summary>
          <div className="sliders">
            <Slider
              label="Activation lag"
              hint="Months from site selection to first patient."
              value={form.activation_lag}
              min={2}
              max={12}
              step={1}
              unit="mo"
              onChange={(v) => setForm({ ...form, activation_lag: v })}
            />
            <Slider
              label="Patient-pool overlap"
              hint="Scales how much concurrent trials compete for the same eligible patients (0 = none)."
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
          <button
            className="btn btn-small"
            onClick={() => setForm({ ...DEFAULT_PARAMS, region: form.region })}
            disabled={!modified}
          >
            Reset to defaults
          </button>
        </details>
      </div>

      {clear.loading && (
        <Loading
          label={`Clearing ${clear.pendingParams?.region}…`}
          hint="Solving independent and coordinated allocations. Results below are from the previous run until this finishes."
        />
      )}
      {clear.error && !clear.loading && <ErrorBox error={clear.error} onRetry={() => clear.run(form)} />}

      {r && s && rb && (
        <>
          <RunLine params={r.params} stale={clear.loading} extra={<span className="muted">{int(r.counts.trials)} trials · {int(r.counts.sites)} sites</span>} />
          <div className="stats">
            <Stat
              emphasis
              label="Median speedup"
              value={times(rb.median_speedup)}
              sub={<>Median per-trial T<sub>indep</sub> ÷ T<sub>coord</sub>, all {int(r.counts.trials)} trials</>}
            />
            <Stat
              label="Trials that fill faster"
              value={pct(rb.share_trials_faster)}
              sub={<>{pct(rb.share_trials_slower)} fill slower; the rest unchanged</>}
            />
            <Stat
              label="Coordination dividend"
              value={
                <>
                  {int(rb.trimmed_dividend_trial_months)} <span className="unit">trial-months</span>
                </>
              }
              sub={
                <>
                  Trimmed: {int(rb.trimmed_trials)} trials; {int(rb.flagged_trials)} with model times over {int(cap)} mo excluded
                </>
              }
            />
            <Stat
              label="Price of anarchy"
              value={times(rb.trimmed_poa)}
              sub={<>Trimmed: total months independent ÷ coordinated</>}
            />
            <Stat
              label="Dollar conversion"
              value={money(s.dollars_direct)}
              sub={
                <>
                  direct cost · {money(s.dollars_lost_sales)} lost-sales equivalent · from {int(s.dividend_days)} trial-days
                </>
              }
            />
          </div>
          <Caveat>
            <strong>Dollar caveat:</strong> {s.dollars_note}
          </Caveat>

          <div className="card raw">
            <div className="raw-grid small">
              <div>
                <span className="muted">Median enrollment time</span>
                <div className="tnum">
                  actual {num(rb.median_T_actual)} · independent {num(rb.median_T_indep)} · coordinated {num(rb.median_T_coord)} months
                </div>
              </div>
              <div>
                <span className="muted">Untrimmed (all trials; dominated by {int(rb.flagged_trials)} flagged trials)</span>
                <div className="tnum">
                  PoA {times(s.poa)} · dividend {int(s.dividend_trial_months)} trial-months
                </div>
              </div>
              <div>
                <span className="muted">Coordinated vs actual CT.gov sites (untrimmed)</span>
                <div className="tnum">
                  PoA {times(s.poa_vs_actual)}
                  {isNum(s.dividend_vs_actual_trial_months) && <> · {int(s.dividend_vs_actual_trial_months)} trial-months</>}
                </div>
              </div>
              <div>
                <span className="muted">Solver</span>
                <div className="tnum">
                  {num(s.solver.seconds, 1)} s, {int(s.solver.improvements)} improving moves
                  {s.solver.hit_time_limit && ' · stopped at time limit (feasible, not proven optimal)'}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="table-tools">
              <h2>Trials in the region</h2>
              <input
                type="search"
                placeholder="Filter by NCT, acronym, sponsor, title"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter trials"
              />
              <label className="check small">
                Flagged trials
                <select value={flaggedMode} onChange={(e) => setFlaggedMode(e.target.value as 'last' | 'inline' | 'hide')}>
                  <option value="last">sorted last</option>
                  <option value="inline">sorted inline</option>
                  <option value="hide">hidden</option>
                </select>
              </label>
              <span className="muted small">
                {rows.length} shown · click a row for its price tags
              </span>
            </div>
            <div className="table-scroll">
              <table className="tbl tbl-trials">
                <thead>
                  <tr>
                    {th('trial', 'Trial')}
                    {th('sponsor', 'Sponsor')}
                    {th('target', 'Regional target', 'num')}
                    {th('sites', 'Sites indep → coord', 'num')}
                    {th('T_actual', 'T actual', 'num')}
                    {th('T_indep', 'T indep', 'num')}
                    {th('T_coord', 'T coord', 'num')}
                    <th className="bar-col">
                      <span className="legend-inline small">
                        <i className="sw sw-indep" /> indep <i className="sw sw-coord" /> coord
                      </span>
                    </th>
                    {th('saved', 'Months saved', 'num')}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const d = saved(t)
                    return (
                      <tr
                        key={t.nct_id}
                        className="clickable"
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
                            {t.flagged && (
                              <Badge tone="warn" title={`Model time over ${int(cap)} months; treat as an estimate failure until reviewed`}>
                                needs review
                              </Badge>
                            )}
                          </div>
                          <div className="muted small trunc" title={t.title}>
                            {t.acronym ? `${t.nct_id} · ` : ''}
                            {phaseLabel(t.phases)}
                          </div>
                        </td>
                        <td className="sponsor-cell" title={t.sponsor ?? ''}>
                          {t.sponsor ?? '—'}
                        </td>
                        <td className="num">{num(t.target_region)}</td>
                        <td className="num">
                          {t.sites_indep} → {t.sites_coord}
                        </td>
                        <td className="num">{num(t.T_actual)}</td>
                        <td className="num">{num(t.T_indep)}</td>
                        <td className="num">{num(t.T_coord)}</td>
                        <td className="bar-col">
                          <TimeBar indep={t.T_indep} coord={t.T_coord} cap={cap} />
                        </td>
                        <td className={`num ${d !== null && d > 0 ? 'pos' : d !== null && d < 0 ? 'neg' : ''}`}>
                          {d === null ? '—' : `${d > 0 ? '+' : ''}${num(d)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              T = model-estimated months to fill the trial’s regional enrollment target (regional target = total
              enrollment pro-rated by the share of the trial’s CT.gov sites in this region). Bars are scaled to {int(cap)} months; › marks a value beyond that.
              “Needs review” marks an implausible model time (over {int(cap)} months), excluded from the trimmed headline.
              Unknown values show “—”.
            </p>
          </div>
        </>
      )}
    </section>
  )
}
