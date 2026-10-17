import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, DEFAULT_SCENARIO, REGENERON_PRESET, scenarioKey, type Robustness, type RobustnessRow, type Scenario } from '../api'
import type { ClearState } from '../App'
import { Badge, Caveat, ErrorBox, Gloss, Loading, Section } from '../components'
import { int, isNum, num, times } from '../format'
import { atLeast, betaInfo, isFullSampleBeta, materialMonths, ShareCell } from '../summary'
import { InSampleLine, InSampleMark, RatioLanes, RsHead } from './researchParts'

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

function bounds(xs: (number | null)[]): [number, number] | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  if (v.length === 0) return null
  return [Math.min(...v), Math.max(...v)]
}

function range(b: [number, number] | null): string {
  if (!b) return '—'
  const [lo, hi] = b
  return Math.abs(hi - lo) < 0.005 ? times(lo) : `${times(lo)}–${times(hi)}`
}

/** A range in prose: "1.00× to 1.14×", numbers in the mono face. */
function RangeText({ b }: { b: [number, number] | null }) {
  if (!b) return <span className="num rs-fig">—</span>
  if (Math.abs(b[1] - b[0]) < 0.005) return <span className="num rs-fig">{times(b[0])}</span>
  return (
    <span className="nowrap">
      <span className="num rs-fig">{times(b[0])}</span> to <span className="num rs-fig">{times(b[1])}</span>
    </span>
  )
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
      pureData: bounds(data.map((r) => r.coordination_no_loser_vs_indep.ratio)),
      pureAssumed: bounds(assumed.map((r) => r.coordination_no_loser_vs_indep.ratio)),
      headData: bounds(data.map((r) => r.coord_vs_actual.ratio)),
      selData: bounds(data.map((r) => r.indep_vs_actual.ratio)),
      hasAssumed: assumed.length > 0,
      nData: data.length,
    }
  }, [rows])

  const params = state.status === 'ok' ? state.data.params : undefined
  const slowerThr = atLeast(materialMonths(rows[0]?.coord_free_vs_actual))
  // The grid stores the β it was computed at. If the default (full-sample estimate) has moved since,
  // say so: the "data estimate" rows are then not at the current default.
  const curBeta = clear.result && clear.result.params.beta === null ? betaInfo(clear.result.summary.assumptions) : null
  const gridBeta = rows.find(isData)?.beta
  const staleBeta = isFullSampleBeta(curBeta) && isNum(gridBeta) && Math.abs(curBeta.beta - gridBeta) > 5e-4 ? curBeta : null
  const betaWords = staleBeta ? 'the earlier full-sample β' : 'the default β (full-sample estimate)'
  const nearOne = !!summary?.pureData && summary.pureData[1] < 1.05

  return (
    <section className="view rs-view">
      <RsHead
        title="Robustness"
        lede={
          <>
            <strong className="rs-tagline">We tried to break our own result.</strong> The same clearing, re-run under every combination of
            congestion elasticity β (the default β = full-sample estimate, its 95% CI ends, and the β = 1 the master doc assumed), site-rate
            rule for low-history sites, and site universe.
          </>
        }
      >
        <InSampleLine />
      </RsHead>

      <div className="card controls rs-controls">
        <div className="rs-scenario">
          <span className="field-label" id="rs-scenario-label">
            Scenario
          </span>
          <div className="seg seg-inline" role="radiogroup" aria-labelledby="rs-scenario-label">
            <button
              type="button"
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
                type="button"
                role="radio"
                aria-checked={choice === p.id}
                className={`seg-btn${choice === p.id ? ' seg-on' : ''}`}
                onClick={() => setChoice(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">
          Grids are precomputed offline (each takes minutes). Only the default US-Northeast scenario and the Regeneron September 2024
          portfolio are expected to be available.
        </p>
      </div>

      {state.status === 'loading' && <Loading label="Loading robustness grid…" />}
      {state.status === 'error' && <ErrorBox error={state.error} onRetry={() => setTick((x) => x + 1)} />}
      {state.status === 'missing' && (
        <div className="empty">
          <p>
            <strong>Not precomputed</strong> for this scenario. The grid takes minutes to compute, so it is served from precomputed files
            only.
          </p>
          <p className="muted small">{state.message}</p>
        </div>
      )}

      {state.status === 'ok' && (
        <>
          {summary && (
            <Section
              id="rs-survives"
              title="What survives"
              lede={
                <>
                  Pure coordination (joint allocation on top of each trial’s own best response, no losers) is <RangeText b={summary.pureData} />{' '}
                  with {betaWords} or either end of its CI
                  {summary.hasAssumed ? (
                    <>
                      , against <RangeText b={summary.pureAssumed} /> under the assumed β = 1. The earlier coordination dividend came from that
                      assumption.
                    </>
                  ) : (
                    '.'
                  )}
                  {nearOne && ' The in-sample gain comes from moving trials to faster sites, not from relieving congestion between them.'}
                </>
              }
              qualifiers={
                <p className="rs-qual-line">
                  <InSampleMark /> · <Gloss term="scored-by-model">scored by our enrollment model</Gloss>. Ranges span the grid’s{' '}
                  {int(summary.nData)} data-based rows.
                </p>
              }
              figure={
                <RatioLanes
                  label="Ranges of in-sample ratios across the grid"
                  lanes={[
                    { label: 'Pure coordination', sub: 'β from the data, or either end of its CI', value: summary.pureData, note: 'in-sample' },
                    ...(summary.hasAssumed
                      ? [
                          {
                            label: 'Pure coordination',
                            sub: 'β = 1, as the master doc assumed',
                            value: summary.pureAssumed,
                            note: 'assumed β',
                            tone: 'assumed' as const,
                          },
                        ]
                      : []),
                    { label: 'Capped at registered times', sub: 'β from the data', value: summary.headData, note: 'in-sample' },
                    { label: 'Site selection alone', sub: 'β from the data', value: summary.selData, note: 'in-sample' },
                  ]}
                />
              }
              caption={
                <>
                  Each bar spans the grid’s rows for that β across site-rate rules and site universes. Ratio = total trial-months,
                  baseline ÷ alternative, in-sample. 1.00× = no gain. The diamond marks the β the master doc assumed, which the data do not
                  support.
                </>
              }
              details={
                <ul className="findings">
                  <li>
                    <strong>Pure coordination</strong> (joint allocation on top of each trial’s own best response, no losers):{' '}
                    <span className="tnum strong">{range(summary.pureData)}</span> with {betaWords} or either end of its CI
                    {summary.hasAssumed && (
                      <>
                        , against <span className="tnum strong">{range(summary.pureAssumed)}</span> under the assumed β = 1. The earlier
                        coordination dividend came from that assumption.
                      </>
                    )}
                  </li>
                  <li>
                    <strong>Capped at registered times</strong> (in-sample; does not hold out of sample):{' '}
                    <span className="tnum strong">{range(summary.headData)}</span> across data-based rows. <strong>Site selection alone</strong>{' '}
                    (best response vs registered): <span className="tnum strong">{range(summary.selData)}</span>. With pure coordination near
                    1×, the in-sample gain comes from moving trials to faster sites, not from relieving congestion between them.
                  </li>
                </ul>
              }
              detailsLabel="Details: the ranges in words"
            />
          )}
          <Section
            id="rs-grid"
            title="Grid"
            lede={
              <>
                {int(rows.length)} runs of the same clearing
                {params && (
                  <>
                    {' '}
                    for {params.region}
                    {params.sponsor ? ` · ${params.sponsor}` : ''}
                    {params.as_of ? ` · as of ${params.as_of}` : ' · recruiting today'}
                  </>
                )}
                . Each row is one combination of β, site-rate rule and site universe.
              </>
            }
            qualifiers={
              staleBeta ? (
                <p className="note small">
                  This grid was computed at β = {num(gridBeta, 3)}, an earlier full-sample estimate. The current default β = full-sample
                  estimate is {num(staleBeta.beta, 3)} (95% CI {num(staleBeta.ci95[0], 3)} to {num(staleBeta.ci95[1], 3)}), so these rows
                  are not at the current default until the grid is regenerated.
                </p>
              ) : undefined
            }
            details={
              <>
                <div className="table-scroll">
                  <table className="tbl tbl-robust">
                    <thead>
                      <tr>
                        <th>β</th>
                        <th>Site-rate rule</th>
                        <th>Universe</th>
                        <th className="num" title="Capped at registered times, vs registered, in-sample: ratio (median per-trial ratio)">
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
                          <tr key={i} className={assumed ? 'row-assumed' : isDefault ? 'row-on' : isData(r) ? 'row-data' : ''}>
                            <td className="nowrap">
                              <div className="strong">{r.beta_label}</div>
                              <div className="muted small tnum">β = {num(r.beta, 3)}</div>
                              {isData(r) && (
                                <div className="muted small">{staleBeta ? 'earlier full-sample estimate' : 'default β = full-sample estimate'}</div>
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
                              <strong>{times(r.coord_vs_actual.ratio)}</strong> <span className="muted">({times(r.coord_vs_actual.median_speedup)})</span>
                            </td>
                            <td className="num strong">{times(r.coordination_no_loser_vs_indep.ratio, 3)}</td>
                            <td className="num">{times(r.coord_free_vs_actual.ratio)}</td>
                            <td className="num">
                              <ShareCell material={r.coord_free_vs_actual.share_slower_material} any={r.coord_free_vs_actual.share_slower} />
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
                  Ratios are total trial-months, baseline ÷ alternative; the bracket is the median per-trial ratio. Rows marked “assumed in
                  master doc” use β = 1, the elasticity the master doc assumed; the within-site regression on completed trials does not
                  support it (see Model &amp; data). The trial count varies slightly by row because trials whose model time exceeds the
                  plausibility cap are held out as background. Rows were computed with a shorter solver time limit than an interactive
                  clear, so they can differ slightly from the Clear it view.
                </Caveat>
              </>
            }
            detailsLabel={`Show the grid (${int(rows.length)} runs)`}
          />
        </>
      )}
    </section>
  )
}
