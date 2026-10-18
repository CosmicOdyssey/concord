import { useCallback, useEffect, useRef, useState } from 'react'
import { demoApi, metrics, nextScene, previousScene, proposal, SCENES, type DemoBundle, type DemoPlan, type DemoRun } from '../demoApi'
import { skipTo } from '../skip'
import { ThemeControl } from '../theme'
import './hackharvard-demo.css'

const usd = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const mo = (value: number) => `${value.toFixed(2)} mo`
const pct = (value: number) => `${(100 * value).toFixed(1)}%`

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="demo-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}
function Network({ bundle, plan }: { bundle: DemoBundle; plan?: DemoPlan }) {
  const req = bundle.request
  const selected = plan?.selected_edges ?? req.edges.flatMap((e, j) => e.baseline ? [j] : [])
  return <div className="demo-network" aria-label="Trial and hospital allocation">
    <div className="demo-trials">{req.trials.map((t, i) => <article key={t.id}><small>REGISTRY CONTEXT · TRIAL {i + 1}</small><h3>{t.id}</h3><p>{i === 0 ? 'Fianlimab + cemiplimab + chemotherapy' : 'Fianlimab + cemiplimab vs cemiplimab'}</p><b>{t.target} participants</b><span>Hypothetical planning target · not actual enrollment</span></article>)}</div>
    <div className="demo-hospitals">{req.sites.map(s => {
      const edges = selected.map(j => req.edges[j]).filter(e => e.site === s.id)
      const demand = edges.reduce((n, e) => n + (e.rate ?? 0), 0)
      const observed = plan?.sites.find(x => x.id === s.id)
      return <article key={s.id} className={edges.length ? 'is-active' : ''}><small>SYNTHETIC HOSPITAL {s.id.slice(-1)}</small><strong>{edges.length ? `${edges.length} trials` : 'Not activated'}</strong><p>{s.capacity} participants / month capacity</p><div className="demo-capacity" aria-hidden="true"><i style={{ width: `${Math.min(100, demand / (s.capacity ?? 1) * 100)}%` }} /></div><span>{observed && edges.length ? `Peak simulated load ${observed.peak_rate.toFixed(2)} / ${s.capacity}` : edges.length ? `Nominal demand ${demand.toFixed(2)} / ${s.capacity}` : 'Available after assumed 3-month activation'}</span></article>
    })}</div>
    <p className="demo-note">Both trials share the activated hospitals. Capacity is split proportionally; no hospital may exceed its entered cap. Slots are reserved for the selected network.</p>
  </div>
}
export default function HackHarvardDemo() {
  const [bundle, setBundle] = useState<DemoBundle | null>(null)
  const [run, setRun] = useState<DemoRun | null>(null)
  const [scene, setScene] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const active = useRef<AbortController | null>(null)
  const epoch = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)

  const reset = useCallback(async () => {
    active.current?.abort()
    const token = ++epoch.current
    const ctl = new AbortController(); active.current = ctl
    setBundle(null); setRun(null); setScene(0); setBusy(false); setError(''); setElapsed(0)
    try {
      const b = await demoApi.baseline(AbortSignal.any([ctl.signal, AbortSignal.timeout(15000)]))
      if (token === epoch.current) setBundle(b)
    } catch (e) { if (token === epoch.current && !ctl.signal.aborted) setError(String(e)) }
  }, [])
  useEffect(() => {
    const pending = Promise.resolve().then(() => { if (!disposed) void reset() })
    let disposed = false
    void pending
    const epochSlot = epoch; const requestSlot = active
    return () => { disposed = true; ++epochSlot.current; requestSlot.current?.abort() }
  }, [reset])
  useEffect(() => { heading.current?.focus(); window.scrollTo({ top: 0 }) }, [scene])
  useEffect(() => {
    if (!busy) return
    const start = performance.now()
    const timer = window.setInterval(() => setElapsed((performance.now() - start) / 1000), 100)
    return () => window.clearInterval(timer)
  }, [busy])
  async function optimize() {
    if (!bundle || busy) return
    active.current?.abort()
    const ctl = new AbortController(); active.current = ctl
    const token = ++epoch.current
    setBusy(true); setScene(2); setRun(null); setError(''); setElapsed(0)
    try {
      const r = await demoApi.optimize(AbortSignal.any([ctl.signal, AbortSignal.timeout(15000)]))
      proposal(r.result)
      if (r.delivery_mode !== 'LIVE_COMPUTATION' || r.fixture_sha256 !== bundle.fixture_sha256 || JSON.stringify(r.result.request) !== JSON.stringify(bundle.request)) throw new Error('Fixture or delivery identity mismatch. Reset before presenting.')
      if (token === epoch.current) { setRun(r); setScene(3) }
    } catch (e) { if (token === epoch.current && !ctl.signal.aborted) { setError(String(e)); setScene(1) } }
    finally { if (token === epoch.current) setBusy(false) }
  }
  async function saved() {
    active.current?.abort()
    const ctl = new AbortController(); active.current = ctl
    const token = ++epoch.current
    setError(''); setBusy(false)
    try {
      const snapshot = await demoApi.saved(AbortSignal.any([ctl.signal, AbortSignal.timeout(10000)]))
      if (token === epoch.current) { setBundle(snapshot.bundle); setRun(snapshot.run); setScene(3) }
    } catch (e) { if (token === epoch.current && !ctl.signal.aborted) setError(String(e)) }
  }
  const chosen = run ? proposal(run.result) : null
  const base = bundle?.baseline
  const req = bundle?.request
  const replay = run?.delivery_mode === 'ARTIFACT_REPLAY'
  const rows: [string, (p: DemoPlan) => string][] = req ? [
    ['Modeled final enrollment completion', p => mo(p.expected_makespan)],
    ['Expected sponsor expenditure', p => usd(p.ledger.cash_expenditure)],
    ['Sponsor contingency (not expenditure)', p => usd(p.ledger.contingency)],
    ['Conservative budget commitment', p => usd(p.ledger.budget_commitment)],
    ['Budget reserved / fixed ceiling', p => pct(metrics(p, req).budgetFraction)],
    ['Activated hospitals / trial–site assignments', p => `${metrics(p, req).activated} / ${metrics(p, req).assignments}`],
    ['Site capacity and slot limits', p => metrics(p, req).capacityFeasible ? 'Feasible under assumptions' : 'NOT FEASIBLE'],
  ] : []
  const economy = chosen?.ledger.trials.reduce((a, t) => ({ hospitalRevenue: a.hospitalRevenue + t.economics.hospital.revenue, hospitalCost: a.hospitalCost + t.economics.hospital.resource_cost, hospitalNet: a.hospitalNet + t.economics.hospital.net_contribution, payer: a.payer + t.economics.insurer.payments, sharing: a.sharing + t.economics.patient.cost_sharing, support: a.support + t.economics.patient.access_support }), { hospitalRevenue: 0, hospitalCost: 0, hospitalNet: 0, payer: 0, sharing: 0, support: 0 })
  return <div className="hh-demo">
    <a className="skip" href="#demo-main" onClick={e => skipTo(e, 'demo-main')}>Skip to demo</a>
    <header className="demo-header"><a href="#home" className="wordmark">Concord</a><span>HACKHARVARD 2026 · REGENERON TRACK</span><div><ThemeControl /><button onClick={() => void reset()}>Reset Demo</button><a href="#findings">General app ↗</a></div></header>
    <div className="demo-disclosure"><b>ILLUSTRATIVE PLANNING · NOT A FORECAST</b><span>{replay ? 'ARTIFACT_REPLAY — saved evidence; no new computation' : run ? 'Live backend computation · bundled registry context · synthetic operations' : 'Backend result pending · bundled registry context · synthetic operations'}</span></div>
    <main id="demo-main">
      <div className="demo-scene-label">SCENE {scene + 1} / 6 · {SCENES[scene]}</div>
      <h1 ref={heading} tabIndex={-1}>{['One sponsor. Two trials. Shared hospitals.', 'A feasible baseline leaves a bottleneck.', 'Concord is computing—not replaying.', 'More capacity. A real budget trade-off.', 'Who pays—and what is the evidence?', 'A planning decision, not a clinical promise.'][scene]}</h1>
      <div role="status" className="demo-status" data-testid="demo-status">{busy ? `Live request in flight · ${elapsed.toFixed(1)}s elapsed · seeded event simulation and subset search` : run ? `${run.delivery_mode === 'ARTIFACT_REPLAY' ? 'Saved rehearsal' : 'Live computation completed'} · ${run.compute_ms.toFixed(1)} ms ${replay ? 'recorded prior compute' : 'server compute'} · ${chosen?.optimization?.status} · ${run.result.search_evaluations} candidate/policy evaluations` : error ? 'No completed live result. Reset or explicitly load saved evidence.' : bundle ? 'Baseline received from backend. Optimization has not run.' : 'Requesting the fixed baseline from the backend…'}</div>
      {error && <p role="alert" className="demo-error">{error} No silent replay. Reset, or choose the labeled saved rehearsal below.</p>}
      {bundle && req && base && <>
        {scene === 0 && <><p className="demo-lead">How should a sponsor allocate a fixed budget across competing trials to reach enrollment targets sooner <em>under explicit assumptions</em>?</p><div className="demo-metrics"><Metric label="Sponsor budget ceiling" value={usd(req.budget)} note="Modeled study scope only—not complete trial costs" /><Metric label="Planning demand" value={`${req.trials.reduce((n,t) => n+t.target-t.enrolled,0)} participants`} note="40 per trial; synthetic targets and zero initial enrollment" /><Metric label="Shared bottleneck" value="2 hospitals" note="Both trials initially use A + B; C + D remain available" /></div><Network bundle={bundle} /><p className="demo-note">Trial identifiers, titles and sponsor come from bundled registry metadata. Hospitals, targets, rates, activation delays, all costs and coverage assumptions are hypothetical.</p></>}
        {scene === 1 && <><p className="demo-lead">A + B are capacity-limited. C + D can be activated, but they cost money and take three assumed months to open.</p><div className="demo-metrics"><Metric label="Modeled portfolio completion" value={mo(base.expected_makespan)} note={`P10–P90 ${base.interval[0]}–${base.interval[2]} months; uncalibrated draws`} /><Metric label="Expected sponsor expenditure" value={usd(base.ledger.cash_expenditure)} note={`${usd(base.ledger.contingency)} additional contingency`} /><Metric label="Budget reserved" value={pct(base.ledger.budget_commitment / req.budget)} note={`${usd(base.ledger.budget_commitment)} conservative commitment`} /></div><Network bundle={bundle} plan={base} /><p className="demo-note">Baseline is {base.feasible ? 'feasible' : 'infeasible'} under the entered limits—not an observed operational failure. Travel/lodging support is preserved; potential participant cost sharing is separate and not eliminated.</p></>}
        {scene === 2 && <div className="demo-computing"><strong>{req.draws} seeded assumption draws</strong><p>The existing optimizer evaluates feasible site subsets and financial policies. No external API or AI call. No invented progress percentage.</p></div>}
        {scene === 3 && chosen && run && <><p className="demo-lead">{chosen.expected_makespan < base.expected_makespan ? `${mo(base.expected_makespan)} → ${mo(chosen.expected_makespan)} modeled completion.` : 'No modeled time improvement demonstrated.'} {chosen.ledger.cash_expenditure > base.ledger.cash_expenditure ? 'This uses more sponsor funding—not savings.' : 'Compare funding and timing without assuming a real-world benefit.'}</p><table className="demo-compare"><caption>Same targets, same budget, same seed, same assumptions</caption><thead><tr><th>Measure</th><th>Baseline</th><th>Concord allocation</th></tr></thead><tbody>{rows.map(([label, f]) => <tr key={label}><th scope="row">{label}</th><td>{f(base)}</td><td>{f(chosen)}</td></tr>)}</tbody></table><p className="demo-note"><b>{chosen.optimization?.status}</b> · {chosen.optimization?.method} · zero gap only if proven exact on this finite draw bank. Objective: expected maximum priority-weighted trial time—not the unweighted final-completion metric above.</p><p className="demo-note">Proposed P10–P90: {chosen.interval[0]}–{chosen.interval[2]} months; {chosen.censored_draws} censored draws. Independent mean-one lognormal rate shocks (spread {req.spread}); not calibrated predictive intervals. Expected per-trial no-loser constraint and {usd(req.trials[0].support)} travel/lodging per participant retained. Geography, outside-trial demand and clinical access are unmodeled.</p><p className="demo-note">Selected: {req.sites.filter(s => chosen.selected_edges.some(j => req.edges[j].site === s.id)).map(s => s.id).join(' + ')}. Administrative savings are unrealized ({usd(run.result.available_admin_savings)} usable); support/operations rate boosts are zero.</p></>}
        {scene === 4 && chosen && run && economy && <><div className="demo-metrics"><Metric label="Sponsor expenditure" value={usd(chosen.ledger.cash_expenditure)} note={`Plus ${usd(chosen.ledger.contingency)} contingency; not a saving`} /><Metric label="Hospital contribution" value={usd(economy.hospitalNet)} note={`${usd(economy.hospitalRevenue)} receipts − ${usd(economy.hospitalCost)} assumed resources`} /><Metric label="Potential routine-care payer amount" value={usd(economy.payer)} note="Coverage classification only. No payer commitment or partnership." /></div><p className="demo-note">Participant cost sharing: {usd(economy.sharing)}; travel/lodging support: {usd(economy.support)}. Separate lines—not netted. Unknown exposure remains unknown. Transfer balance: {usd(chosen.ledger.transfer_balance)}; transfers are not added again as resource costs.</p><div className="demo-evidence"><div><h2>Registry context ≠ operating evidence</h2>{bundle.registry_context.map(t => <p key={t.id}><a href={t.source} target="_blank" rel="noreferrer">{t.id}</a> · {t.sponsor}<br /><small>Bundled metadata captured {t.captured_at.slice(0, 10)}; not an historical as-of record.</small></p>)}<p>Authored illustrative protocol; trial 2 uses trial 1’s proxy schedule. Approximate placeholder procedure rates—not verified CMS prices. Real trial budgets, sites, recruitment and insurer payments are unknown.</p></div><div><h2>Trace this computation</h2><p>{replay ? 'Saved evidence replay' : 'Live computation'} · {run.computed_at}</p><code>Run {run.result.run_id}</code><code>Input {run.result.input_sha256}</code><code>Result {run.result.result_sha256}</code><p>Seed {run.result.seed} · {run.result.draws} draws · historical predictive performance UNVERIFIED.</p><a className="btn" href={replay ? '/demo/saved-report.html' : `/api/portfolio-command/runs/${run.result.run_id}/report/html`} target="_blank" rel="noreferrer">Open Evidence Report</a> <a href={replay ? '/demo/saved-result.json' : `/api/portfolio-command/runs/${run.result.run_id}/report/json`} download>Download JSON</a></div></div><details><summary>All assumptions & financial responsibility classifications</summary><ul>{run.result.limitations.map(x => <li key={x}>{x}</li>)}</ul><table><thead><tr><th>Item (trial 1 template)</th><th>Responsibility</th><th>Basis</th></tr></thead><tbody>{run.result.coverage[0].items.map(x => <tr key={x.id}><td>{x.label}</td><td>{x.status}</td><td>{x.explanation}</td></tr>)}</tbody></table></details></>}
        {scene === 5 && <div className="demo-conclusion"><p>Concord makes the allocation decision inspectable.</p><h2>One fixed budget.<br />One explicit network.<br />One reproducible comparison.</h2><p>We demonstrated an actual bounded computation and reconciled financial evidence on hypothetical operating inputs. We did <strong>not</strong> demonstrate faster real enrollment, validated forecasts, clinical efficacy, guaranteed savings or insurer participation.</p><p>Next validation: sponsor-approved site feasibility, actual resource capacity, negotiated costs, coverage review and prospective enrollment evidence.</p></div>}
      </>}
    </main>
    <footer className="demo-controls"><button disabled={scene === 0 || busy} onClick={() => setScene(previousScene(scene))}>Previous Scene</button><span>{SCENES[scene]} · {scene === 0 ? '0:00–0:25' : scene === 1 ? '0:25–0:55' : scene === 2 ? '0:55–1:25' : scene === 3 ? '1:25–2:10' : scene === 4 ? '2:10–2:45' : '2:45–3:00'}</span>{scene === 1 ? <button className="btn-primary" disabled={!bundle || busy || replay} onClick={() => void optimize()}>Optimize Portfolio</button> : <button className="btn-primary" disabled={!bundle || busy || scene === 5} onClick={() => setScene(nextScene(scene, !!run))}>Next Scene</button>}</footer>
    <div className="demo-fallback"><span>Live computation requires the backend. The saved artifact uses synthetic operational assumptions and is loaded only when you choose it.</span><button disabled={busy} onClick={() => void saved()}>Load saved rehearsal (ARTIFACT_REPLAY; not live)</button></div>
  </div>
}
