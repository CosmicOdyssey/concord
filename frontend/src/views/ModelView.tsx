import { useEffect, useState } from 'react'
import { api, type BacktestCell, type CompileResult, type CongestionTest, type Status } from '../api'
import { Badge, Caveat, ErrorBox, Gloss, KeyFigure, Loading, Qualifier, Section, Stat } from '../components'
import { useDensity } from '../density'
import { GLOSSARY } from '../glossary'
import { int, isNum, num, pct } from '../format'
import { InSampleLine, RsHead } from './researchParts'

const SAMPLE = `Inclusion Criteria:
- Histologically confirmed stage IV non-small cell lung cancer
- EGFR mutation positive
- ECOG performance status 0-1
- At least one prior platinum-based chemotherapy

Exclusion Criteria:
- Active brain metastases
- Prior treatment with an immune checkpoint inhibitor
- History of interstitial lung disease`

/** Backend notes are bare clauses: capitalize and end with one period. */
function sentence(s: string): string {
  const t = s.trim().replace(/\.+$/, '')
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : ''
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const HELD_OUT_CARD = (
  <>
    <span className="hc-title">{GLOSSARY['held-out'].term}</span>
    {GLOSSARY['held-out'].gloss}
  </>
)

export default function ModelView() {
  const simple = useDensity().density === 'simple'
  const [status, setStatus] = useState<Status | null>(null)
  const [statusErr, setStatusErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [text, setText] = useState(SAMPLE)
  const [compiled, setCompiled] = useState<CompileResult | null>(null)
  const [compiling, setCompiling] = useState(false)
  const [compileErr, setCompileErr] = useState<string | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    setStatusErr(null)
    api
      .status(ctl.signal)
      .then(setStatus)
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setStatusErr(e instanceof Error ? e.message : String(e))
      })
    return () => ctl.abort()
  }, [tick])

  const compile = () => {
    setCompiling(true)
    setCompileErr(null)
    api
      .compileEligibility(text)
      .then(setCompiled)
      .catch((e: unknown) => setCompileErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setCompiling(false))
  }

  const m = status?.model
  const bt = m?.backtest
  const [cong, setCong] = useState<CongestionTest | null>(null)
  const [congErr, setCongErr] = useState<string | null>(null)
  useEffect(() => {
    const ctl = new AbortController()
    api
      .congestion(ctl.signal)
      .then(setCong)
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setCongErr(e instanceof Error ? e.message : String(e))
      })
    return () => ctl.abort()
  }, [tick])

  const btModel = bt?.by_model?.model?.industry_p23
  const btNaive = bt?.by_model?.naive?.industry_p23
  const offBy = bt ? Math.exp(btModel?.median_abs_log_error ?? bt.median_abs_log_error_model) : null

  return (
    <section className="view rs-view">
      <RsHead
        title={'Model & data'}
        lede="What the numbers rest on: the ClinicalTrials.gov crawl, the site enrollment-rate model, and how well that model predicts held-out trials."
      >
        <InSampleLine
          kind={
            <>
              <Qualifier tone="muted">Model inputs and checks</Qualifier> · a regression on completed trials with its <Gloss term="ci95">95% CI</Gloss>,
              and a <Gloss term="held-out">held-out</Gloss> backtest of the enrollment model the other Research views use
            </>
          }
        />
      </RsHead>

      {statusErr && <ErrorBox error={statusErr} onRetry={() => setTick((x) => x + 1)} />}

      <CongestionSection data={cong} error={congErr} simple={simple} />

      {!status && !statusErr && <Loading label="Loading status…" />}

      {status && (
        <>
          <Section
            id="rs-backtest"
            title="Backtest: predicting enrollment duration"
            lede={
              bt ? (
                <>
                  Individual predictions are coarse: on held-out industry Phase II/III trials the fitted model is typically off by a factor of{' '}
                  <span className="num rs-fig">{num(offBy, 1)}</span>
                  {btNaive && (
                    <>
                      , against <span className="num rs-fig">{num(Math.exp(btNaive.median_abs_log_error), 1)}</span> for a naive baseline
                    </>
                  )}
                  . Results are reported as ratios and medians across trials for that reason.
                </>
              ) : (
                'No backtest recorded.'
              )
            }
            qualifiers={
              bt ? (
                <p className="rs-qual-line">
                  <Qualifier tone="muted" info={HELD_OUT_CARD}>
                    Held-out
                  </Qualifier>
                  : fit on trials before {bt.cutoff} ({int(bt.train_trials)} trials), scored on {int(bt.test_trials)} later trials.
                </p>
              ) : undefined
            }
            figure={
              bt && simple ? (
                <div className="rs-figs">
                  <KeyFigure
                    value={`×${num(offBy, 1)}`}
                    label="Typical miss, fitted model"
                    qualifier={<Qualifier tone="muted">held-out</Qualifier>}
                    sub="Industry Phase II/III"
                  />
                  {btNaive && (
                    <KeyFigure
                      value={`×${num(Math.exp(btNaive.median_abs_log_error), 1)}`}
                      label="Typical miss, naive baseline"
                      qualifier={<Qualifier tone="muted">held-out</Qualifier>}
                      sub="Industry Phase II/III"
                    />
                  )}
                </div>
              ) : undefined
            }
            caption={
              bt && simple
                ? 'Typical miss = exp(median |log(predicted / actual)|) of enrollment duration: the factor a prediction is off by, in either direction.'
                : undefined
            }
            details={
              bt ? (
                <>
                  <p className="muted small">
                    Fit on trials before {bt.cutoff} ({int(bt.train_trials)} trials), scored on {int(bt.test_trials)} later trials. Error =
                    median |log(predicted / actual)| of enrollment duration, lower is better (in brackets as a typical “off by ×” factor).
                    Bias = median signed log error; negative means the predictor expects enrollment to finish faster than it did.
                  </p>
                  {bt.by_model ? <BacktestTable byModel={bt.by_model} /> : <p className="muted">Per-model breakdown not available.</p>}
                  <div className="kv-row small">
                    {bt.calibration_slope_industry_p23 && (
                      <span>
                        Calibration slope, industry Ph II/III:{' '}
                        <strong className="tnum">
                          {num(bt.calibration_slope_industry_p23.slope, 2)} ± {num(bt.calibration_slope_industry_p23.se, 2)}
                        </strong>{' '}
                        <span className="muted">(1 = predictions scale correctly; n = {int(bt.calibration_slope_industry_p23.n)})</span>
                      </span>
                    )}
                    {isNum(bt.level_log_bias_industry_p23) && <span>Level correction applied: log bias {num(bt.level_log_bias_industry_p23, 3)}</span>}
                    {bt.low_history_rule && (
                      <span>
                        Low-history rule: sites with fewer than {int(bt.low_history_rule.n_below)} past lung trials are capped at the prior’s{' '}
                        {num(bt.low_history_rule.prior_quantile * 100, 0)}th-percentile rate ({num(bt.low_history_rule.rate, 3)} pts/mo)
                      </span>
                    )}
                  </div>
                  <p className="note small">
                    Honest read: for industry Phase II/III trials the fitted model has lower error than the raw site rates and the naive
                    baseline, and its bias is near zero where the raw rates were strongly optimistic. Individual predictions are still coarse
                    (typically off by a factor of {num(offBy, 1)}), so results are reported as ratios and medians across trials.
                    {bt.note && <> Backend note: “{bt.note}”.</>}
                  </p>
                </>
              ) : undefined
            }
            detailsLabel="Details: error and bias by predictor"
          />

          <Section
            id="rs-data"
            title="Data"
            lede="The ClinicalTrials.gov crawl every Research view reads."
            figure={
              simple ? (
                <div className="rs-figs">
                  <KeyFigure value={int(status.counts?.trials)} label="Trials" sub="Interventional, from ClinicalTrials.gov" />
                  <KeyFigure value={int(status.counts?.sites)} label="Sites" sub="Distinct facilities" />
                  <KeyFigure value={int(status.counts?.trial_sites)} label="Trial–site links" sub="Registered site lists" />
                </div>
              ) : (
                <div className="stats stats-3">
                  <Stat label="Trials" value={int(status.counts?.trials)} sub="Interventional, from ClinicalTrials.gov" />
                  <Stat label="Sites" value={int(status.counts?.sites)} sub="Distinct facilities" />
                  <Stat label="Trial–site links" value={int(status.counts?.trial_sites)} sub="Registered site lists" />
                </div>
              )
            }
            details={
              Object.values(status.crawls).length > 0 || !status.db ? (
                <>
                  {Object.values(status.crawls).length > 0 && (
                    <div className="table-scroll">
                      <table className="tbl tbl-compact">
                        <thead>
                          <tr>
                            <th>Crawl</th>
                            <th>Condition</th>
                            <th className="num">Studies</th>
                            <th>State</th>
                            <th>Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.values(status.crawls).map((c) => (
                            <tr key={c.name}>
                              <td>{c.name}</td>
                              <td>
                                {c.cond}
                                {c.filter && (
                                  <div className="muted small">
                                    <code>{c.filter}</code>
                                  </div>
                                )}
                              </td>
                              <td className="num">
                                {int(c.studies)} / {int(c.total)}
                              </td>
                              <td>{c.done ? <Badge tone="ok">complete</Badge> : <Badge tone="info">in progress</Badge>}</td>
                              <td className="small nowrap">{new Date(c.updated).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {!status.db && <p className="note small">Database not built yet.</p>}
                </>
              ) : undefined
            }
            detailsLabel="Details: the crawl"
          />

          {m && (
            <Section
              id="rs-params"
              title="Model parameters"
              lede="A Gamma prior on each site’s enrollment rate (patients/month per trial) shrinks sites with little history toward the average."
              details={
                <div className="two-col">
                  <div>
                    <h3>Site-rate prior</h3>
                    <p className="muted small">Gamma prior on each site’s enrollment rate (patients/month per trial), shrinking sites with little history.</p>
                    <table className="tbl tbl-compact">
                      <tbody>
                        <tr>
                          <td>α (shape)</td>
                          <td className="num">{num(m.prior?.alpha, 3)}</td>
                        </tr>
                        <tr>
                          <td>β (rate)</td>
                          <td className="num">{num(m.prior?.beta, 3)}</td>
                        </tr>
                        <tr>
                          <td>Mean</td>
                          <td className="num">{num(m.prior?.mean, 3)}</td>
                        </tr>
                        <tr>
                          <td>Median</td>
                          <td className="num">{num(m.prior?.median, 3)}</td>
                        </tr>
                        <tr>
                          <td>Trials with history used</td>
                          <td className="num">{int(m.history_trials)}</td>
                        </tr>
                        <tr>
                          <td>Sites with fitted rates</td>
                          <td className="num">{int(m.fitted_sites)}</td>
                        </tr>
                        <tr>
                          <td>Reference eligible fraction f_ref</td>
                          <td className="num">{num(m.f_ref, 4)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h3>Assumptions</h3>
                    <div className="table-scroll">
                      <table className="tbl tbl-compact">
                        <tbody>
                          {Object.entries(m.assumptions ?? {}).map(([k, v]) => (
                            <tr key={k}>
                              <td>
                                <code>{k}</code>
                              </td>
                              <td className="num">{fmtValue(v)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              }
              detailsLabel="Details: prior and assumptions"
            />
          )}
        </>
      )}

      <Section
        id="rs-compiler"
        title="Eligibility compiler"
        lede="Free-text criteria → machine-readable predicates with the source sentence attached."
        qualifiers={
          <p className="rs-qual-line">
            <Qualifier>Review required.</Qualifier> Rule-based parse of free text, scored against a{' '}
            <Gloss term="synthetic-population">synthetic patient population</Gloss>. Not clinical advice; a person must review every predicate
            against the protocol.
          </p>
        }
      >
        <textarea
          className="textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          aria-label="Eligibility criteria text"
          spellCheck={false}
        />
        <div className="controls-row">
          <button className="btn btn-primary" onClick={compile} disabled={compiling || !text.trim()}>
            {compiling ? 'Compiling…' : 'Compile criteria'}
          </button>
          <button className="btn btn-small" onClick={() => setText(SAMPLE)}>
            Load sample
          </button>
        </div>
        {compileErr && <ErrorBox error={compileErr} onRetry={compile} />}
        {compiled && (
          <div className="compiled">
            <div className="kv-row">
              <span>
                Eligible fraction <strong className="tnum">{compiled.eligible_fraction === null ? '—' : pct(compiled.eligible_fraction, 1)}</strong>{' '}
                <span className="muted small">of the synthetic NSCLC population</span>
              </span>
              <span className="muted small">parser: {compiled.parser}</span>
              {compiled.review_required && <Badge tone="warn">review required</Badge>}
            </div>
            {compiled.criteria.length === 0 ? (
              <p className="note small">No criteria were recognized, so the eligible fraction is unknown (not 100%).</p>
            ) : (
              <div className="table-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Criterion</th>
                      <th>Kind</th>
                      <th>Predicate</th>
                      <th>Source sentence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compiled.criteria.map((c) => (
                      <tr key={c.id}>
                        <td className="strong">{c.label}</td>
                        <td>
                          <Badge tone={c.kind === 'exclusion' ? 'bad' : 'ok'}>{c.kind}</Badge>
                        </td>
                        <td>
                          <code>
                            {c.kind === 'exclusion' ? 'exclude if ' : 'require '}
                            {c.feature} {c.op} {fmtValue(c.value)}
                          </code>
                        </td>
                        <td className="muted small">“{c.source}”</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Section>
    </section>
  )
}

const MODEL_LABEL: Record<string, string> = {
  model: 'Fitted model (capped low-history rates)',
  raw: 'Raw site rates',
  naive: 'Naive baseline',
}
const SLICE_LABEL: Record<string, string> = {
  industry_p23: 'Industry Phase II/III',
  industry_p3: 'Industry Phase III',
  all: 'All test trials',
}

function signedLog(x: number): string {
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${num(Math.abs(x), 2)}`
}

function BacktestTable({ byModel }: { byModel: Record<string, Record<string, BacktestCell>> }) {
  const models = ['model', 'raw', 'naive'].filter((k) => byModel[k])
  const slices = ['industry_p23', 'industry_p3', 'all']
  return (
    <div className="table-scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th />
            {slices.map((sl) => (
              <th key={sl} className="num" colSpan={2}>
                {SLICE_LABEL[sl]}
              </th>
            ))}
          </tr>
          <tr>
            <th>Predictor</th>
            {slices.flatMap((sl) => [
              <th key={`${sl}-e`} className="num">
                Error
              </th>,
              <th key={`${sl}-b`} className="num">
                Bias
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {models.map((mk) => (
            <tr key={mk} className={mk === 'model' ? 'row-on' : ''}>
              <th scope="row">{MODEL_LABEL[mk] ?? mk}</th>
              {slices.flatMap((sl) => {
                const c = byModel[mk]?.[sl]
                return [
                  <td key={`${sl}-e`} className="num nowrap">
                    {c ? (
                      <>
                        {num(c.median_abs_log_error, 2)} <span className="muted">(×{num(Math.exp(c.median_abs_log_error), 1)})</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>,
                  <td key={`${sl}-b`} className="num nowrap">
                    {c ? signedLog(c.median_signed_log_bias) : '—'}
                  </td>,
                ]
              })}
            </tr>
          ))}
          <tr>
            <td className="muted small">Test trials (n)</td>
            {slices.flatMap((sl) => [
              <td key={`${sl}-n`} className="num muted small">
                {int(byModel.model?.[sl]?.n)}
              </td>,
              <td key={`${sl}-x`} />,
            ])}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

const SPEC_LABEL: Record<string, string> = {
  within: 'Within site',
  site_fe: 'Site fixed effects',
  pooled: 'Pooled (across sites)',
}
const EXPOSURE_LABEL: Record<string, string> = {
  overlap: 'log(1 + Σ overlap)',
  start: 'competitors at start',
  avg: 'average competitors',
}

function CongestionSection({ data, error, simple }: { data: CongestionTest | null; error: string | null; simple: boolean }) {
  if (error)
    return (
      <Section title="Does congestion exist?">
        <ErrorBox error={error} />
      </Section>
    )
  if (!data) return <Loading label="Loading congestion test…" />
  const prim = data.results[data.primary]
  const implied = data.model_implied_coef_overlap
  const lo = Math.min(implied, prim?.ci95[0] ?? 0, -0.2) - 0.1
  const hi = Math.max(prim?.ci95[1] ?? 0, 0.2) + 0.1
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100
  const outside = prim ? implied < prim.ci95[0] || implied > prim.ci95[1] : false
  const pooled = data.results.pooled_overlap
  // The default β is the full-sample within-site estimate (β = −coef, floored at 0 as the backend does).
  const defBeta =
    data.default_beta ??
    (prim
      ? { value: Math.max(0, -prim.coef), ci95: [Math.max(0, -prim.ci95[1]), Math.max(0, -prim.ci95[0])] as [number, number], note: undefined }
      : null)
  const subsets = data.subsets ? Object.entries(data.subsets) : []
  const mc = data.multiple_comparisons
  const parsers = data.parser_sensitivity ?? []
  const significant = !!prim && prim.p < 0.05 && prim.coef < 0
  const plain = prim
    ? `Within the same site, at the resolution of public registry data, ${
        significant
          ? 'busy periods with overlapping competitors measurably slow enrollment'
          : 'we cannot detect that busy periods with overlapping competitors slow enrollment: the full-sample estimate is not significant'
      }${outside ? ', and its 95% CI rules out the −1 the model had assumed' : ''}.`
    : null

  const plot = prim && (
    <div
      className="coefplot"
      role="img"
      aria-label={`Within-site estimate ${num(prim.coef, 3)}, 95% CI ${num(prim.ci95[0], 3)} to ${num(prim.ci95[1], 3)}; model assumed ${implied}`}
    >
      <div className="coef-axis" />
      <div className="coef-zero" style={{ left: `${x(0)}%` }} />
      <div className="coef-ci" style={{ left: `${x(prim.ci95[0])}%`, width: `${x(prim.ci95[1]) - x(prim.ci95[0])}%` }} />
      <div className="coef-dot" style={{ left: `${x(prim.coef)}%` }} />
      <div className="coef-assumed" style={{ left: `${x(implied)}%` }} />
      <span className="coef-lab coef-lab-top coef-lab-assumed" style={{ left: `${x(implied)}%` }}>
        model assumed {num(implied, 0)}
      </span>
      <span className="coef-lab coef-lab-top" style={{ left: `${x(prim.coef)}%` }}>
        estimate {num(prim.coef, 3)}
      </span>
    </div>
  )

  return (
    <Section
      id="rs-congestion"
      title="Does congestion exist?"
      lede={plain ?? undefined}
      qualifiers={
        <p className="rs-qual-line">
          {data.verdict && (
            <>
              <Qualifier tone="muted">{sentence(data.verdict)}</Qualifier>{' '}
            </>
          )}
          Within-site regression on {int(data.n_trials)} completed trials ({int(data.n_trial_sites)} trial–site rows)
          {prim && (
            <>
              :{' '}
              <span className="nowrap">
                estimate <span className="num">{num(prim.coef, 3)}</span>,{' '}
                <Qualifier tone="muted">
                  95% CI {num(prim.ci95[0], 3)} to {num(prim.ci95[1], 3)}
                </Qualifier>
              </span>
            </>
          )}
          .
        </p>
      }
      figure={
        prim && (
          <>
            {simple && (
              <div className="rs-figs">
                <KeyFigure
                  value={num(prim.coef, 3)}
                  label="Within-site estimate"
                  qualifier={
                    <Qualifier tone="muted">
                      95% CI {num(prim.ci95[0], 3)} to {num(prim.ci95[1], 3)}
                    </Qualifier>
                  }
                  sub={`p = ${num(prim.p, 2)}`}
                />
                <KeyFigure
                  value={num(implied, 0)}
                  label="Our original model had assumed"
                  qualifier={<Qualifier>{outside ? 'Outside the 95% CI' : 'Inside the 95% CI'}</Qualifier>}
                />
              </div>
            )}
            {plot}
          </>
        )
      }
      caption={
        prim ? (
          <>
            The coefficient on log(1 + Σ overlap) of competing trials with overlapping eligibility at the same site. 0 = no slowdown; the
            clearing model had assumed {num(implied, 0)}.
          </>
        ) : undefined
      }
      details={
        <>
          <p className="small">
            Within-site regression of enrollment rates on competing trials with overlapping eligibility at the same site,{' '}
            {int(data.n_trials)} completed trials ({int(data.n_trial_sites)} trial–site rows). The clearing model had assumed a coefficient of{' '}
            <strong>{num(implied, 0)}</strong> on log(1 + Σ overlap).
          </p>
          {prim && (
            <>
              <div className="stats stats-3">
                <div className="stat">
                  <div className="stat-label">Within-site estimate</div>
                  <div className="stat-value tnum">{num(prim.coef, 3)}</div>
                  <div className="stat-sub tnum">
                    95% CI {num(prim.ci95[0], 3)} to {num(prim.ci95[1], 3)}
                    {data.se_method && <> ({data.se_method})</>} · p = {num(prim.p, 2)}
                  </div>
                  {prim.ci95_trial_only && (
                    <div className="stat-sub tnum muted">
                      trial-clustered only: 95% CI {num(prim.ci95_trial_only[0], 3)} to {num(prim.ci95_trial_only[1], 3)} · p ={' '}
                      {num(prim.p_trial_only, 2)}
                    </div>
                  )}
                  {prim.ci95_twoway_unclipped && (
                    <div className="stat-sub tnum muted">
                      two-way before eigenvalue clipping (post hoc): 95% CI {num(prim.ci95_twoway_unclipped[0], 3)} to{' '}
                      {num(prim.ci95_twoway_unclipped[1], 3)} · p = {num(prim.p_twoway_unclipped, 2)}
                    </div>
                  )}
                </div>
                <div className="stat">
                  <div className="stat-label">Model had assumed</div>
                  <div className="stat-value tnum">{num(implied, 0)}</div>
                  <div className="stat-sub">{outside ? 'Outside the 95% CI' : 'Inside the 95% CI'}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Observations</div>
                  <div className="stat-value tnum">{int(prim.n_rows)}</div>
                  <div className="stat-sub">{prim.clusters ? `${int(prim.clusters)} clusters` : 'rows'}</div>
                </div>
              </div>
              {defBeta && (
                <p className="small">
                  <strong>default β = full-sample estimate</strong>{' '}
                  <span className="tnum">
                    = {num(defBeta.value, 3)} (−1 × the within-site coefficient; 95% CI {num(defBeta.ci95[0], 3)} to {num(defBeta.ci95[1], 3)}
                    {data.se_method && <>, {data.se_method}</>})
                  </span>
                  . Clear it uses it when the β box is blank.
                  {defBeta.note && <span className="muted"> {sentence(defBeta.note)}</span>}
                </p>
              )}
              {data.se_note && <p className="muted small">{sentence(data.se_note)}</p>}
              <p className="note small">
                Plain reading: {plain?.replace(/^W/, 'w').replace(/\.$/, '')}. Subset estimates, such as sites with many earlier lung
                trials, are listed separately below and never used as the default.
                {pooled && (
                  <>
                    {' '}
                    Across sites, busier sites {pooled.coef < 0 ? 'have slower trials' : 'do not have slower trials'} (pooled coefficient{' '}
                    {num(pooled.coef, 3)}, 95% CI {num(pooled.ci95[0], 3)} to {num(pooled.ci95[1], 3)}
                    {pooled.ci95[0] <= 0 && pooled.ci95[1] >= 0 ? ', which includes 0' : ''}), but that comparison is confounded with site
                    type.
                  </>
                )}
              </p>
            </>
          )}
          {subsets.length > 0 && (
            <>
              <h3>Subset estimates (not the default)</h3>
              <p className="muted small">
                The same regressions on subsets of the trials. Reported separately; none of them is used as the default β.
                {mc && (
                  <>
                    {' '}
                    {sentence(mc.note)} ({mc.method}, k = {int(mc.k)}, α = {num(mc.alpha, 2)}.)
                  </>
                )}
              </p>
              <div className="table-scroll">
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Subset</th>
                      <th className="num">Within-site coef</th>
                      <th className="num">95% CI</th>
                      <th className="num">p</th>
                      {mc && <th className="num">{mc.method} 95% CI</th>}
                      <th className="num" title="Site fixed effects / pooled designs on the same subset">
                        Site FE · pooled
                      </th>
                      <th className="num">n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subsets.map(([key, sub]) => {
                      const w = sub.within
                      const bci = mc?.bonferroni_ci95?.[key]
                      return (
                        <tr key={key}>
                          <td>
                            <div className="strong">
                              {sub.label} {sub.is_default && <Badge tone="info">default</Badge>}
                            </div>
                            <div className="muted small">{sub.definition}</div>
                          </td>
                          <td className="num">{num(w?.coef, 3)}</td>
                          <td className="num nowrap">{w ? `${num(w.ci95[0], 3)} to ${num(w.ci95[1], 3)}` : '—'}</td>
                          <td className="num">{num(w?.p, 3)}</td>
                          {mc && <td className="num nowrap">{bci ? `${num(bci[0], 3)} to ${num(bci[1], 3)}` : '—'}</td>}
                          <td className="num nowrap">
                            {num(sub.site_fe?.coef, 3)} · {num(sub.pooled?.coef, 3)}
                          </td>
                          <td className="num">
                            {int(w?.n_rows)}
                            {isNum(w?.clusters) && <div className="muted small nowrap">{int(w.clusters)} clusters</div>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {parsers.length > 0 && (
            <>
              <h3>β under each parser version</h3>
              <p className="muted small">
                The primary within-site estimate re-run with each version of the eligibility parser, oldest first, so the dependence on
                parsing is visible. β = −coefficient.
              </p>
              <div className="table-scroll">
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Parser version</th>
                      <th className="num">Coef</th>
                      <th className="num">95% CI</th>
                      <th className="num">p</th>
                      <th className="num" title="β = −coefficient">
                        Beta
                      </th>
                      <th className="num" title="Trials whose compiled criteria left no eligible synthetic patients">
                        Empty masks
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsers.map((ps) => {
                      const w = ps.within_overlap
                      const current = !!prim && isNum(w?.coef) && Math.abs(w.coef - prim.coef) < 1e-9
                      return (
                        <tr key={`${ps.parser_version}-${ps.commit}`} className={current ? 'row-on' : ''}>
                          <td>
                            <div className="strong">
                              {ps.parser_version} <code className="small">{ps.commit}</code>
                              {current && <> (current)</>}
                            </div>
                            <div className="muted small">{ps.description}</div>
                            {ps.ci_note && <div className="muted small">{sentence(ps.ci_note)}</div>}
                          </td>
                          <td className="num">{num(w?.coef, 3)}</td>
                          <td className="num nowrap">
                            {w ? `${num(w.ci95[0], 3)} to ${num(w.ci95[1], 3)}` : '—'}
                            {w?.twoway_estimable === false && <div className="muted small">trial-clustered</div>}
                          </td>
                          <td className="num">{num(w?.p, 3)}</td>
                          <td className="num strong">{isNum(w?.coef) ? num(-w.coef, 3) : '—'}</td>
                          <td className="num">{int(ps.empty_masks)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <details className="disclosure rs-specs">
            <summary>All specifications</summary>
            <div className="disclosure-body">
              <div className="table-scroll">
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Design</th>
                      <th>Exposure</th>
                      <th className="num">Coef</th>
                      <th className="num">95% CI</th>
                      <th className="num">p</th>
                      <th className="num">n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(SPEC_LABEL).flatMap((sp) =>
                      Object.keys(EXPOSURE_LABEL).map((ex) => {
                        const k = `${sp}_${ex}`
                        const rr = data.results[k]
                        if (!rr) return null
                        return (
                          <tr key={k} className={k === data.primary ? 'row-on' : ''}>
                            <td>
                              {SPEC_LABEL[sp]}
                              {k === data.primary && ' (primary)'}
                            </td>
                            <td>{EXPOSURE_LABEL[ex]}</td>
                            <td className="num">{num(rr.coef, 4)}</td>
                            <td className="num nowrap">
                              {num(rr.ci95[0], 4)} to {num(rr.ci95[1], 4)}
                            </td>
                            <td className="num">{num(rr.p, 3)}</td>
                            <td className="num">{int(rr.n_rows)}</td>
                          </tr>
                        )
                      }),
                    )}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                Only the overlap exposure is on the same scale as the model’s assumed −1; competitor counts are per trial.
                {data.se_method && <> Confidence intervals and p-values: {data.se_method}.</>}
              </p>
            </div>
          </details>
          <Caveat>
            Congestion elasticity (<Gloss term="congestion-elasticity">β</Gloss>) is −1 × this coefficient: how much a site’s enrollment rate
            falls as overlapping competing trials rise.
          </Caveat>
        </>
      }
      detailsLabel="Details: β, subsets, parser versions and all specifications"
    />
  )
}
