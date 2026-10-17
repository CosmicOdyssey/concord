import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, DEFAULT_SCENARIO, REGENERON_PRESET, scenarioKey, type Robustness, type RobustnessRow, type Scenario } from '../api'
import type { ClearState } from '../App'
import { Badge, Caveat, ErrorBox, Loading } from '../components'
import { int, isNum, num, times } from '../format'
import { atLeast, betaInfo, isFullSampleBeta, materialMonths, ShareCell } from '../summary'

type Async<T> =
  | { status: 'loading' }
  | { status: 'missing'; message: string }
  | { status: 'error'; error: string }
  | { status: 'ok'; data: T }

const PRESETS: { id: string; label: string; scenario: Scenario }[] = [
  { id: 'ne', label: 'US-Northeast (default)', scenario: DEFAULT_SCENARIO },
  { id: 'regn', label: 'Regeneron portfolio, Sept 2024', scenario: REGENERON_PRESET },
]

const LOW_HISTORY_LABEL: Record<string, string> = {
  model: 'model (capped)',
  prior: 'prior (raw posterior)',
  exclude: 'exclude low-history',
}

function isAssumed(r: RobustnessRow) {
  return r.beta_label.toLowerCase().includes('assumed')
}
function isData(r: RobustnessRow) {
  return r.beta_label === 'data estimate'
}

function range(xs: (number | null)[]): string {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  if (v.length === 0) return '—'
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  return Math.abs(hi - lo) < 0.005 ? times(lo) : `${times(lo)}–${times(hi)}`
}

export default function RobustnessView({ clear }: { clear: ClearState }) {
  const solved = clear.solvedParams
  const [choice, setChoice] = useState<string>('current')
  const scenario: Scenario =
    choice === 'current' ? (solved ?? DEFAULT_SCENARIO) : (PRESETS.find((p) => p.id === choice)?.scenario ?? DEFAULT_SCENARIO)
  const key = scenarioKey(scenario)
  const [state, setState] = useState<Async<Robustness>>({ status: 'loading' })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const ctl = new AbortController()
    setState({ status: 'loading' })
    api
      .robustness(scenario, ctl.signal)
      .then((d) => setState({ status: 'ok', data: d }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return
        if (e instanceof ApiError && e.status === 404) setState({ status: 'missing', message: e.message })
        else setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctl.abort()
    // scenario is captured through its key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])

  const rows = state.status === 'ok' ? state.data.rows : []
  const summary = useMemo(() => {
    if (rows.length === 0) return null
    const data = rows.filter((r) => !isAssumed(r))
    const assumed = rows.filter(isAssumed)
    return {
      pureData: range(data.map((r) => r.coordination_no_loser_vs_indep.ratio)),
      pureAssumed: range(assumed.map((r) => r.coordination_no_loser_vs_indep.ratio)),
      headData: range(data.map((r) => r.coord_vs_actual.ratio)),
      selData: range(data.map((r) => r.indep_vs_actual.ratio)),
      hasAssumed: assumed.length > 0,
    }
  }, [rows])

  const params = state.status === 'ok' ? state.data.params : undefined
  const slowerThr = atLeast(materialMonths(rows[0]?.coord_free_vs_actual))
  // The grid stores the β it was computed at. If the default (full-sample estimate) has moved since,
  // say so: the "data estimate" rows are then not at the current default.
  const curBeta = clear.result && clear.result.params.beta === null ? betaInfo(clear.result.summary.assumptions) : null
  const gridBeta = rows.find(isData)?.beta
  const staleBeta = isFullSampleBeta(curBeta) && isNum(gridBeta) && Math.abs(curBeta.beta - gridBeta) > 5e-4 ? curBeta : null

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Robustness</h1>
          <p className="lede tagline">We tried to break our own result.</p>
          <p className="lede">
            The same clearing, re-run under every combination of congestion elasticity β (the default β = full-sample
            estimate, its 95% CI ends, and the β = 1 the master doc assumed), site-rate rule for low-history sites, and site
            universe.
          </p>
        </div>
      </div>

      <div className="card controls">
        <div className="seg" role="radiogroup" aria-label="Scenario">
          <button
            role="radio"
            aria-checked={choice === 'current'}
            className={`seg-btn${choice === 'current' ? ' seg-on' : ''}`}
            onClick={() => setChoice('current')}
          >
            Current scenario{solved ? ` (${solved.region}${solved.sponsor ? ` · ${solved.sponsor}` : ''})` : ''}
          </button>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={choice === p.id}
              className={`seg-btn${choice === p.id ? ' seg-on' : ''}`}
              onClick={() => setChoice(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          Grids are precomputed offline (each takes minutes). Only the default US-Northeast scenario and the Regeneron
          September 2024 portfolio are expected to be available.
        </p>
      </div>

      {state.status === 'loading' && <Loading label="Loading robustness grid…" />}
      {state.status === 'error' && <ErrorBox error={state.error} onRetry={() => setTick((x) => x + 1)} />}
      {state.status === 'missing' && (
        <div className="empty">
          <p>
            <strong>Not precomputed</strong> for this scenario. The grid takes minutes to compute, so it is served from
            precomputed files only.
          </p>
          <p className="muted small">{state.message}</p>
        </div>
      )}

      {state.status === 'ok' && (
        <>
          {summary && (
            <div className="card">
              <h2>What survives</h2>
              <ul className="findings">
                <li>
                  <strong>Pure coordination</strong> (joint allocation on top of each trial’s own best response, no losers):{' '}
                  <span className="tnum strong">{summary.pureData}</span> with{' '}
                  {staleBeta ? 'the earlier full-sample β' : 'the default β (full-sample estimate)'} or either end of its CI
                  {summary.hasAssumed && (
                    <>
                      , against <span className="tnum strong">{summary.pureAssumed}</span> under the assumed β = 1. The
                      earlier coordination dividend came from that assumption.
                    </>
                  )}
                </li>
                <li>
                  <strong>Capped at registered times</strong> (in-sample; does not hold out of sample): <span className="tnum strong">{summary.headData}</span>{' '}
                  across data-based rows. <strong>Site selection alone</strong> (best response vs registered):{' '}
                  <span className="tnum strong">{summary.selData}</span>. With pure coordination near 1×, the in-sample gain
                  comes from moving trials to faster sites, not from relieving congestion between them.
                </li>
              </ul>
            </div>
          )}
          <div className="card">
            <div className="section-head">
              <h2>Grid</h2>
              {params && (
                <span className="muted small">
                  {params.region}
                  {params.sponsor ? ` · ${params.sponsor}` : ''}
                  {params.as_of ? ` · as of ${params.as_of}` : ' · recruiting today'}
                </span>
              )}
            </div>
            {staleBeta && (
              <p className="note small">
                This grid was computed at β = {num(gridBeta, 3)}, an earlier full-sample estimate. The current default β =
                full-sample estimate is {num(staleBeta.beta, 3)} (95% CI {num(staleBeta.ci95[0], 3)} to{' '}
                {num(staleBeta.ci95[1], 3)}), so these rows are not at the current default until the grid is regenerated.
              </p>
            )}
            <div className="table-scroll">
              <table className="tbl tbl-robust">
                <thead>
                  <tr>
                    <th>β</th>
                    <th>Site-rate rule</th>
                    <th>Universe</th>
                    <th className="num" title="Capped at registered times, vs registered, in-sample: ratio (median per-trial speedup)">
                      Capped vs registered (median)
                    </th>
                    <th className="num" title="Joint allocation vs each trial's best response, capped at best-response times (in-sample)">
                      Pure coordination
                    </th>
                    <th className="num" title="Joint optimum with losers allowed, vs registered">
                      Joint optimum
                    </th>
                    <th
                      className="num"
                      title={`Joint optimum with losers allowed: share of trials slower by ${slowerThr}; below it, slower by any amount. — = not in this precomputed grid`}
                    >
                      Slower {slowerThr}
                    </th>
                    <th className="num" title="Best response vs registered">
                      Site selection
                    </th>
                    <th className="num">Trials</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const assumed = isAssumed(r)
                    const isDefault = isData(r) && r.low_history === 'model' && r.universe === 'registered'
                    return (
                      <tr
                        key={i}
                        className={assumed ? 'row-assumed' : isDefault ? 'row-on' : isData(r) ? 'row-data' : ''}
                      >
                        <td className="nowrap">
                          <div className="strong">{r.beta_label}</div>
                          <div className="muted small tnum">β = {num(r.beta, 3)}</div>
                          {isData(r) && (
                            <div className="muted small">
                              {staleBeta ? 'earlier full-sample estimate' : 'default β = full-sample estimate'}
                            </div>
                          )}
                          {assumed && (
                            <Badge tone="bad" title="This elasticity was assumed, not estimated; it manufactured the earlier dividend">
                              assumed in master doc
                            </Badge>
                          )}
                          {isDefault && <Badge tone="info">default</Badge>}
                        </td>
                        <td>{LOW_HISTORY_LABEL[r.low_history] ?? r.low_history}</td>
                        <td>{r.universe}</td>
                        <td className="num nowrap">
                          <strong>{times(r.coord_vs_actual.ratio)}</strong>{' '}
                          <span className="muted">({times(r.coord_vs_actual.median_speedup)})</span>
                        </td>
                        <td className="num strong">
                          {times(r.coordination_no_loser_vs_indep.ratio, 3)}
                        </td>
                        <td className="num">{times(r.coord_free_vs_actual.ratio)}</td>
                        <td className="num">
                          <ShareCell
                            material={r.coord_free_vs_actual.share_slower_material}
                            any={r.coord_free_vs_actual.share_slower}
                          />
                        </td>
                        <td className="num">{times(r.indep_vs_actual.ratio)}</td>
                        <td className="num">{int(r.coord_vs_actual.trials)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Caveat>
              Ratios are total trial-months, baseline ÷ alternative; the bracket is the median per-trial speedup. Red rows use
              β = 1, the elasticity the master doc assumed; the within-site regression on completed trials does not
              support it (see Model &amp; data). The trial count varies slightly by row because trials whose model time
              exceeds the plausibility cap are held out as background. Rows were computed with a shorter solver time limit
              than an interactive clear, so they can differ slightly from the Clear it view.
            </Caveat>
          </div>
        </>
      )}
    </section>
  )
}
