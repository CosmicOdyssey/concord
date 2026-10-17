import { useEffect, useState } from 'react'
import { api, type CompileResult, type Status } from '../api'
import { Badge, Caveat, ErrorBox, Loading, Stat } from '../components'
import { int, isNum, num, pct } from '../format'

const SAMPLE = `Inclusion Criteria:
- Histologically confirmed stage IV non-small cell lung cancer
- EGFR mutation positive
- ECOG performance status 0-1
- At least one prior platinum-based chemotherapy

Exclusion Criteria:
- Active brain metastases
- Prior treatment with an immune checkpoint inhibitor
- History of interstitial lung disease`

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function ModelView() {
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

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Model &amp; data</h1>
          <p className="lede">
            What the numbers rest on: the ClinicalTrials.gov crawl, the site enrollment-rate model, and how well that
            model predicts held-out trials.
          </p>
        </div>
      </div>

      {statusErr && <ErrorBox error={statusErr} onRetry={() => setTick((x) => x + 1)} />}
      {!status && !statusErr && <Loading label="Loading status…" />}

      {status && (
        <>
          <div className="card">
            <h2>Data</h2>
            <div className="stats stats-3">
              <Stat label="Trials" value={int(status.counts?.trials)} sub="Interventional, from ClinicalTrials.gov" />
              <Stat label="Sites" value={int(status.counts?.sites)} sub="Distinct facilities" />
              <Stat label="Trial–site links" value={int(status.counts?.trial_sites)} sub="Registered site lists" />
            </div>
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
                          {c.filter && <div className="muted small"><code>{c.filter}</code></div>}
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
          </div>

          <div className="card">
            <h2>Backtest: predicting enrollment duration</h2>
            {bt ? (
              <>
                <p className="muted small">
                  Fit on trials before {bt.cutoff} ({int(bt.train_trials)} trials), scored on {int(bt.test_trials)} later
                  trials. Error is |log(predicted / actual)| of enrollment duration; lower is better.
                </p>
                <div className="stats stats-3">
                  <Stat
                    label="Model, median abs log error"
                    value={num(bt.median_abs_log_error_model, 2)}
                    sub={<>typical prediction off by a factor of {num(Math.exp(bt.median_abs_log_error_model), 1)}</>}
                  />
                  <Stat
                    label="Naive baseline, median abs log error"
                    value={num(bt.median_abs_log_error_naive, 2)}
                    sub={<>off by a factor of {num(Math.exp(bt.median_abs_log_error_naive), 1)}</>}
                  />
                  <Stat
                    label="Test trials where model beats naive"
                    value={pct(bt.model_beats_naive_share)}
                    sub={isNum(bt.median_share_of_test_sites_seen_in_train) ? <>median {pct(bt.median_share_of_test_sites_seen_in_train)} of a test trial’s sites seen in training</> : undefined}
                  />
                </div>
                <p className="note small">
                  Honest read: the model is better than the naive baseline more often than not, but individual predictions
                  remain coarse (a factor of about {num(Math.exp(bt.median_abs_log_error_model), 1)} at the median). That is
                  why the headline uses medians and a trimmed dividend rather than per-trial point estimates.
                  {bt.note && <> Backend note: “{bt.note}”.</>}
                </p>
              </>
            ) : (
              <p className="muted">No backtest recorded.</p>
            )}
          </div>

          {m && (
            <div className="card">
              <h2>Model parameters</h2>
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
          )}
        </>
      )}

      <div className="card">
        <div className="section-head">
          <div>
            <h2>Eligibility compiler</h2>
            <p className="muted small">Free-text criteria → machine-readable predicates with the source sentence attached.</p>
          </div>
          <Badge tone="warn">review required</Badge>
        </div>
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
                Eligible fraction{' '}
                <strong className="tnum">{compiled.criteria.length > 0 ? pct(compiled.eligible_fraction, 1) : '—'}</strong>{' '}
                <span className="muted small">of the synthetic NSCLC population</span>
              </span>
              <span className="muted small">parser: {compiled.parser}</span>
              {compiled.review_required && <Badge tone="warn">review required</Badge>}
            </div>
            {compiled.criteria.length === 0 ? (
              <p className="note small">
                No criteria were recognized. The backend reports {pct(compiled.eligible_fraction)} eligible in that case,
                which means “nothing parsed”, not “everyone qualifies”.
              </p>
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
        <Caveat>
          Rule-based parse of free text, scored against a synthetic patient population. Not clinical advice; a person must
          review every predicate against the protocol.
        </Caveat>
      </div>
    </section>
  )
}
