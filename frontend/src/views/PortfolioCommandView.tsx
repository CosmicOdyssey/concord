import { useCallback, useEffect, useRef, useState } from 'react'
import { encodeRequest, portfolioApi, type PortfolioDemo, type PortfolioRequest, type PortfolioResult, type PortfolioTrial } from '../portfolioCommandApi'
import './portfolio-command.css'

const SECTIONS = ['Executive Overview', 'Trial Portfolio', 'Site Capacity', 'Financial Allocation', 'Scenario Lab', 'Evidence and Reports'] as const
const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const pct = (v: number) => `${(v * 100).toFixed(0)}%`
function NumberInput({ label, value, onChange, min = 0, max = 1e9, step = 'any' }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: string }) {
  return <label className="pc-field"><span>{label}</span><input aria-label={label} type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? value : ''} onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))} /></label>
}

export default function PortfolioCommandView() {
  const [demo, setDemo] = useState<PortfolioDemo | null>(null)
  const [request, setRequest] = useState<PortfolioRequest | null>(null)
  const [result, setResult] = useState<PortfolioResult | null>(null)
  const [restored, setRestored] = useState(false)
  const [section, setSection] = useState<typeof SECTIONS[number]>('Executive Overview')
  const [selected, setSelected] = useState('F')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedId, setSavedId] = useState('')
  const [jsonEdit, setJsonEdit] = useState('')
  const [newId, setNewId] = useState('SIM-NEW')
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController | null>(null)
  const epoch = useRef(0)
  const cancelPending = useCallback(() => { active.current?.abort(); epoch.current++ }, [])
  useEffect(() => {
    const controller = new AbortController()
    portfolioApi.demo(controller.signal).then(d => { setDemo(d); setRequest(d.request) }).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    return () => { controller.abort(); cancelPending() }
  }, [cancelPending])
  function edit(next: PortfolioRequest) {
    active.current?.abort(); epoch.current++; setBusy(false); setRequest(next); setError(''); setNotice('Inputs changed. Run comparison to compute compatible results.')
  }
  function field<K extends keyof PortfolioRequest>(key: K, value: PortfolioRequest[K]) { if (request) edit({ ...request, [key]: value }) }
  function trialField(index: number, key: keyof PortfolioTrial, value: string | number) {
    if (request) edit({ ...request, trials: request.trials.map((t, i) => i === index ? { ...t, [key]: value } : t) })
  }
  async function compute(load = false) {
    if (!request) return
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    const token = ++epoch.current
    setBusy(true); setError(''); setNotice('')
    try {
      const r = load ? await portfolioApi.load(savedId.trim(), controller.signal) : await portfolioApi.compare(request, controller.signal)
      if (epoch.current !== token) return
      setResult(r); setRestored(load); setRequest(r.request); setSavedId(r.run_id); setSelected(r.recommended_scenario_id ?? 'A')
      setNotice(load ? 'Loaded immutable saved evidence; original inputs restored.' : 'Comparison computed and saved. Report links export this exact result.')
    } catch (e) { if (epoch.current === token && !controller.signal.aborted) setError(String(e)) }
    finally { if (epoch.current === token) setBusy(false) }
  }
  function createTrial() {
    if (!request || !demo) return
    const id = newId.trim()
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || request.trials.some(t => t.id === id)) { setError('Use a unique trial identifier (letters, digits, underscores or hyphens).'); return }
    if (request.trials.length >= 4 || request.edges.length >= 12) { setError('Bounded demo supports at most four trials and twelve trial/site edges.'); return }
    const context = demo.registry_context.find(t => t.id === id)
    if (id.startsWith('NCT') && !context) { setError('Only the two source-backed bundled registry records can be imported here. Use SIM- for a hypothetical custom trial.'); return }
    const template = request.trials[0]
    const trial: PortfolioTrial = { ...template, id, title: context?.title ?? 'Hypothetical custom trial', sponsor: context?.sponsor ?? 'Hypothetical sponsor', target: 30, enrolled: 0 }
    const edge = { ...request.edges[0], trial: id, site: request.sites[0].id, baseline: true, feasibility: 'UNKNOWN' as const, rate_basis: 'UNKNOWN' as const, rate: null }
    edit({ ...request, trials: [...request.trials, trial], edges: [...request.edges, edge] })
    setNotice('Trial created. New site feasibility and rate are UNKNOWN; supply explicit assumptions before it can be used.')
  }
  async function applyJson() {
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    const token = ++epoch.current
    setBusy(true); setError('')
    try {
      const next = await portfolioApi.validate(JSON.parse(jsonEdit) as PortfolioRequest, controller.signal)
      if (token === epoch.current) edit(next)
    } catch (e) { if (token === epoch.current && !controller.signal.aborted) setError(String(e)) }
    finally { if (token === epoch.current) setBusy(false) }
  }
  if (!request || !demo) return <div className="pc"><h1>Portfolio Command</h1><p role={error ? 'alert' : 'status'}>{error || 'Loading source context and synthetic planning fixture…'}</p></div>
  let stale = true
  try { stale = !result || encodeRequest(request) !== encodeRequest(result.request) } catch { /* invalid numeric edit is stale */ }
  const scenario = result?.scenarios.find(s => s.id === selected) ?? result?.scenarios[0]
  const baseline = result?.scenarios[0]
  const viewing = result?.request ?? request
  const table = (headers: string[], rows: React.ReactNode[][]) => <div className="pc-scroll"><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
  return <div className="pc">
    <header className="pc-hero"><div><p className="pc-eyebrow">CONCORD / SPONSOR PLANNING</p><h1>Portfolio Command</h1><p>Where should the next dollar go?</p></div><span className="pc-badge">{restored ? 'SAVED EVIDENCE REPLAY' : 'LIVE COMPUTATION'}<br />SYNTHETIC OPERATIONS</span></header>
    <p className="pc-context">Regeneron registry context · hypothetical hospitals, enrollment progress, financial inputs and recruitment effects. Planning tool; no live sponsor or payer relationship.</p>
    <div className="pc-controls">
      <NumberInput label="Sponsor budget (USD)" value={request.budget} min={0} onChange={v => field('budget', v)} />
      <label className="pc-field"><span>Portfolio objective</span><select aria-label="Portfolio objective" value={request.objective} onChange={e => field('objective', e.target.value as PortfolioRequest['objective'])}><option value="weighted_makespan">Minimize maximum weighted completion</option><option value="sum_duration">Minimize sum of weighted durations</option><option value="min_cost_deadline">Minimize cost within expected deadlines</option></select></label>
      <NumberInput label="Planning horizon (months)" value={request.horizon} min={1} max={60} onChange={v => field('horizon', v)} />
      <button className="pc-primary" disabled={busy} onClick={() => void compute()}>{busy ? 'Computing…' : 'Run portfolio comparison'}</button>
    </div>
    <div className="pc-status" aria-live="polite">{error ? <p role="alert">{error}</p> : notice || 'Start with a fixed baseline, then compare six calculated strategies.'}{stale && result && <strong> Displayed evidence belongs to the previous inputs.</strong>}</div>
    <nav className="pc-nav" aria-label="Portfolio sections">{SECTIONS.map((s, i) => <button key={s} aria-current={section === s ? 'page' : undefined} className={section === s ? 'active' : ''} onClick={() => setSection(s)}><span>0{i + 1}</span>{s}</button>)}</nav>

    {section === 'Executive Overview' && <section aria-label="Executive Overview"><h2>A fixed budget. A shared network.</h2><p>Maximum weighted completion minimizes E[max(priority × completion months)]. Sum of weighted durations minimizes E[Σ priority × months]. Actual final completion is shown separately. These objectives can choose different networks.</p>
      <div className="pc-metrics"><article><small>Concurrent trials</small><strong>{request.trials.length}</strong><span>{request.trials.reduce((n, t) => n + t.target - t.enrolled, 0)} remaining participants · assumed</span></article><article><small>Fixed sponsor budget</small><strong>{money(request.budget)}</strong><span>Modeled costs only; finite horizon</span></article><article><small>Available administrative savings</small><strong>{money(result && !stale ? result.available_admin_savings : 0)}</strong><span>{request.savings_realized ? 'Explicit realization assumption' : 'Unrealized savings unavailable'}</span></article></div>
      {!scenario ? <p className="pc-empty">Run the comparison to calculate the enrollment schedule and financial allocation.</p> : <>
        <div className="pc-result-head"><h2>{scenario.label}</h2><span className={scenario.feasible ? 'pc-good' : 'pc-bad'}>{scenario.feasible ? 'Feasible under assumptions' : 'Ineligible for recommendation'}</span></div>
        <div className="pc-metrics"><article><small>Expected final completion</small><strong>{scenario.expected_makespan} mo</strong><span>P10–P90: {scenario.interval[0]}–{scenario.interval[2]} months · assumption-based</span></article><article><small>Expected sponsor costs + reserve</small><strong>{money(scenario.ledger.expected_commitment)}</strong><span>Conservative commitment {money(scenario.ledger.budget_commitment)}</span></article><article><small>Paired change vs baseline</small><strong>{scenario.paired_months_saved} mo</strong><span>Months saved under the assumed rate model</span></article></div>
        <p className="pc-note">Search: {scenario.optimization?.status ?? 'LEGACY_UNVERIFIED'} · objective gap: {scenario.optimization?.absolute_gap ?? 'UNKNOWN'} · termination: {scenario.optimization?.termination ?? 'unrecorded'}. Exactness applies only to the entered model and finite draws.</p>
        <p className="pc-note">Additional support: {scenario.policy.additional_support ? 'included' : 'not selected'} · operations investment: {scenario.policy.operations_investment ? 'included with explicit assumed rate effect' : 'not selected'}</p>
        {scenario.violations.map(v => <p key={v} className="pc-bad">{v}</p>)}
        <h3>Enrollment completion schedule</h3><div className="pc-timeline">{scenario.trials.map(t => <div key={t.id}><span>{t.id}</span><div><i style={{ width: `${Math.min(100, 100 * t.expected_months / viewing.horizon)}%` }} /></div><b>{t.expected_months} mo</b></div>)}</div>
        {table(['Trial', 'P10 / median / P90 months', 'Critical path share of draws', 'Draw fraction within deadline'], scenario.trials.map(t => [t.id, t.interval.join(' / '), pct(t.critical_path_draw_fraction), pct(t.deadline_draw_fraction)]))}
        <p className="pc-note">Draw fractions describe this uncalibrated simulation, not clinical success probabilities. {scenario.censored_draws} draws censored at the horizon. Model results do not establish trial acceleration.</p>
      </>}
    </section>}

    {section === 'Trial Portfolio' && <section aria-label="Trial Portfolio"><h2>Trial portfolio</h2><p>Progress below is simulated. Financial templates are illustrative fixed schedules. NCT05785767 uses an explicitly assumed NCT05800015 proxy.</p>
      {request.trials.map((t, i) => <article className="pc-card" key={t.id}><h3>{t.id} <span className="pc-tag">SIMULATED OPERATIONS</span></h3><p>{t.title}</p><p className="pc-note">{t.sponsor}</p><div className="pc-grid">
        <NumberInput label={`${t.id} enrollment target`} value={t.target} min={1} max={1000} step="1" onChange={v => trialField(i, 'target', v)} />
        <NumberInput label={`${t.id} simulated enrolled`} value={t.enrolled} max={999} step="1" onChange={v => trialField(i, 'enrolled', v)} />
        <NumberInput label={`${t.id} priority`} value={t.priority} min={.1} max={10} onChange={v => trialField(i, 'priority', v)} />
        <NumberInput label={`${t.id} deadline months`} value={t.deadline} min={1} max={60} onChange={v => trialField(i, 'deadline', v)} />
        <NumberInput label={`${t.id} administration USD`} value={t.admin} onChange={v => trialField(i, 'admin', v)} />
        <NumberInput label={`${t.id} support per participant USD`} value={t.support} min={200} onChange={v => trialField(i, 'support', v)} />
        <label className="pc-field"><span>Illustrative financial template</span><select aria-label={`${t.id} financial template`} value={t.financial_template} onChange={e => trialField(i, 'financial_template', e.target.value)}><option>NCT05800015</option><option>NCT06627647</option></select></label>
      </div>{request.trials.length > 1 && <button onClick={() => edit({ ...request, trials: request.trials.filter(x => x.id !== t.id), edges: request.edges.filter(e => e.trial !== t.id) })}>Remove trial</button>}</article>)}
      <div className="pc-card"><h3>Create or import a trial</h3><p>Use a bundled registry ID to import its sourced metadata, or a SIM- identifier for a custom assumption. New operational feasibility starts UNKNOWN.</p><label className="pc-field"><span>New trial ID</span><input aria-label="New trial ID" value={newId} onChange={e => setNewId(e.target.value)} list="registry-trials" /><datalist id="registry-trials">{demo.registry_context.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</datalist></label><button onClick={createTrial}>Create / import trial</button></div>
    </section>}

    {section === 'Site Capacity' && <section aria-label="Site Capacity"><h2>Shared capacity, explicit feasibility</h2><p>A hospital's monthly capacity is shared proportionally between activated unfinished trials. Capacity is released at completion. Static trial slots limit the selected network; UNKNOWN edges cannot be used.</p>
      <div className="pc-grid">{request.sites.map((s, i) => <article className="pc-card" key={s.id}><h3>{s.name}</h3><label className="pc-field"><span>Capacity basis</span><select aria-label={`${s.id} capacity basis`} value={s.capacity_basis} onChange={e => field('sites', request.sites.map((x, j) => j === i ? { ...x, capacity_basis: e.target.value as 'UNKNOWN' | 'ASSUMED' } : x))}><option>UNKNOWN</option><option>ASSUMED</option></select></label><NumberInput label={`${s.id} monthly capacity`} value={s.capacity ?? NaN} min={.1} max={100} onChange={v => field('sites', request.sites.map((x, j) => j === i ? { ...x, capacity: v } : x))} /><NumberInput label={`${s.id} trial slots`} value={s.slots} min={1} max={4} step="1" onChange={v => field('sites', request.sites.map((x, j) => j === i ? { ...x, slots: v } : x))} /></article>)}</div>
      {table(['Trial / site', 'Baseline', 'Clinical feasibility', 'Rate basis', 'Rate / month', 'Activation delay (mo)'], request.edges.map((e, i) => {
        const patch = (p: Partial<typeof e>) => field('edges', request.edges.map((x, j) => i === j ? { ...x, ...p } : x))
        return [`${e.trial} / ${e.site}`, <input key="baseline" aria-label={`${e.trial} ${e.site} baseline`} type="checkbox" checked={e.baseline} onChange={v => patch({ baseline: v.target.checked })} />, <select key="feasibility" aria-label={`${e.trial} ${e.site} feasibility`} value={e.feasibility} onChange={v => patch({ feasibility: v.target.value as typeof e.feasibility })}><option>UNKNOWN</option><option>ASSUMED_FEASIBLE</option><option>INFEASIBLE</option></select>, <select key="ratebasis" aria-label={`${e.trial} ${e.site} rate basis`} value={e.rate_basis} onChange={v => patch({ rate_basis: v.target.value as typeof e.rate_basis })}><option>UNKNOWN</option><option>ASSUMED</option></select>, <NumberInput key="rate" label={`${e.trial} ${e.site} rate`} value={e.rate ?? NaN} min={.1} max={100} onChange={v => patch({ rate: v })} />, <NumberInput key="delay" label={`${e.trial} ${e.site} delay`} value={e.lag} max={60} onChange={v => patch({ lag: v })} />]
      }))}
      {scenario && <><h3>Computed site limits · {scenario.label}</h3>{table(['Hospital', 'Reserved trial slots', 'Peak modeled enrollment / mo', 'Shared monthly cap'], scenario.sites.map(s => [s.id, s.reserved_slots, s.peak_rate.toFixed(3), s.capacity ?? 'UNKNOWN']))}<h3>Selected allocation</h3>{table(['Trial / site', 'Expected enrolled', 'Expected active months', 'Activation USD', 'Expected site payments USD'], scenario.edge_flows.map(e => [`${viewing.edges[e.edge].trial} / ${viewing.edges[e.edge].site}`, e.expected_enrolled, e.expected_active_months, money(e.activation_cost), money(e.expected_site_payments)]))}<p className="pc-note">Site payments include activation, operations, monitoring, screening and variable recruitment costs; procedures, support and central administration appear in the trial ledger.</p></>}
    </section>}

    {section === 'Financial Allocation' && <section aria-label="Financial Allocation"><h2>Financial allocation</h2><div className="pc-grid"><NumberInput label="Administrative reduction fraction" value={request.admin_reduction} max={1} onChange={v => field('admin_reduction', v)} /><label className="pc-check"><input type="checkbox" checked={request.savings_realized} onChange={e => field('savings_realized', e.target.checked)} />Assume administrative savings are realizable</label><NumberInput label="Minimum hospital contribution per trial USD" value={request.hospital_floor} onChange={v => field('hospital_floor', v)} /></div>
      <p>Financial efficiency uses reduced administration only under the realization assumption. Sponsor-to-hospital payments and insurer payments are transfers. The resource total is calculated separately.</p>
      {scenario ? <><h3>{scenario.label}</h3><div className="pc-metrics"><article><small>Expected sponsor cash</small><strong>{money(scenario.ledger.cash_expenditure)}</strong></article><article><small>Unknown responsibility reserve</small><strong>{money(scenario.ledger.contingency)}</strong></article><article><small>Modeled resource consumption</small><strong>{money(scenario.ledger.resource_cost)}</strong></article></div>
        {table(['Trial', 'Expected incl. reserve', 'Conservative commitment', 'Hospital contribution', 'Potential payer', 'Potential cost sharing', 'Access support'], scenario.ledger.trials.map(t => [t.trial, money(t.expected_commitment), money(t.budget_commitment), money(t.economics.hospital.net_contribution), money(t.economics.insurer.payments), money(t.economics.patient.cost_sharing), money(t.economics.patient.access_support)]))}
        {scenario.ledger.trials.map(t => <details key={t.trial}><summary>{t.trial} cost components and transfers</summary>{table(['Component', 'Expected USD'], Object.entries(t.breakdown).map(([k,v]) => [k, money(v)]))}{table(['From', 'To', 'Transfer USD'], t.economics.transfers.map(x => [x.from, x.to, money(x.amount)]))}<p>Transfer balance: {money(t.economics.transfer_balance)}</p></details>)}
        <p className="pc-note">Expected sponsor cost plus reserve per required remaining participant: {money(scenario.expected_cost_per_required_participant)}. All amounts are hypothetical USD. Full-horizon commitment includes maximum selected per-participant cost; expected costs use simulated edge flows. Potential coverage is subject to payer and beneficiary review. Unknown responsibility is reserved. Actual drug costs and costs beyond the fixed authored schedule remain unknown.</p>
        <h3>Marginal investments against the fixed baseline</h3>{table(['Intervention', 'Extra expected cost', 'Additional reserve commitment', 'Months saved', 'Enrollment gain at 12 mo or horizon', 'Break-even USD / month saved', 'Assessment'], result!.marginal.map(m => [m.label, money(m.additional_expected_cost), money(m.additional_budget_reserve), `${m.expected_months_saved} (${m.paired_savings_interval.join('–')})`, `${m.additional_expected_enrollment} / ${m.expected_enrollment_gain_per_dollar?.toExponential(2) ?? '—'} per dollar`, m.break_even_value_per_month === null ? (m.expected_months_saved > 0 ? 'No extra modeled cost' : 'No positive time gain') : money(m.break_even_value_per_month), m.recommendation]))}
        <p className="pc-note">Break-even is the assumed sponsor value of one month saved required to cover the incremental modeled cost, not a clinical benefit valuation. Individual investments are evaluated without presuming administrative savings.</p>
      </> : <p>Run comparison to calculate party ledgers.</p>}
    </section>}

    {section === 'Scenario Lab' && <section aria-label="Scenario Lab"><h2>Six strategies, one paired draw bank</h2><div className="pc-grid">
      <NumberInput label="Reproducible seed" value={request.seed} max={2 ** 32 - 1} step="1" onChange={v => field('seed', v)} />
      <NumberInput label="Simulation draws" value={request.draws} min={32} max={256} step="1" onChange={v => field('draws', v)} />
      <NumberInput label="Lognormal rate spread" value={request.spread} max={1} onChange={v => field('spread', v)} />
      <NumberInput label="Additional support per participant USD" value={request.extra_support} onChange={v => field('extra_support', v)} />
      <NumberInput label="Assumed support rate effect fraction" value={request.support_rate_effect} max={1} onChange={v => field('support_rate_effect', v)} />
      <NumberInput label="Assumed operations rate effect fraction" value={request.operations_rate_effect} max={1} onChange={v => field('operations_rate_effect', v)} />
      <NumberInput label="Operations investment per trial USD" value={request.operations_cost} onChange={v => field('operations_cost', v)} />
      <label className="pc-check"><input type="checkbox" checked={request.no_loser} onChange={e => field('no_loser', e.target.checked)} />Require no increase in each trial's expected duration</label>
    </div><p>Support rate effect defaults to zero. The operations effect is an explicit hypothetical assumption, not an observed effect. Optimization and evaluation use the same common draws; uncertainty describes assumptions in-sample.</p>
      {result && <>{table(['Strategy', 'Search status', 'Feasible', 'Final months', 'Weighted maximum', 'Weighted sum', 'Expected USD + reserve', 'Months saved vs A', 'Pareto'], result.scenarios.map(s => [<button key={s.id} className={selected === s.id ? 'active' : ''} onClick={() => setSelected(s.id)}>{s.id} · {s.label}</button>, s.optimization?.status ?? 'LEGACY_UNVERIFIED', s.feasible ? 'Yes' : 'No', s.expected_makespan, s.weighted_makespan, s.weighted_sum_duration, money(s.ledger.expected_commitment), s.paired_months_saved, result.pareto_scenario_ids.includes(s.id) ? 'Nondominated' : '—']))}
        <p>{result.feasible_additional_site_assignments} individually feasible additional trial/site assignments. Selected: <b>{scenario?.label}</b> · recommendation: {result.recommended_scenario_id ?? 'None: no eligible scenario'} · {result.search_evaluations} unique evaluations.</p>
        {baseline && <p className="pc-note">Baseline: {baseline.expected_makespan} months. Financial efficiency and support at zero assumed rate effect preserve the baseline schedule. More spending can produce no time gain.</p>}
      </>}
    </section>}

    {section === 'Evidence and Reports' && <section aria-label="Evidence and Reports"><h2>Reproduce every planning decision</h2><p>Each completed comparison is saved as immutable evidence, including its request, source hashes, coverage ledger and all six strategies. Editing inputs marks old results stale. Exports retain the exact saved result.</p>
      {result && <div className="pc-card"><p>Run <code>{result.run_id}</code></p><p>Result SHA-256 <code>{result.result_sha256}</code></p><div className="pc-actions"><a href={portfolioApi.reportUrl(result.run_id, 'json')} download>Download evidence JSON</a><a href={portfolioApi.reportUrl(result.run_id, 'html')} download>Download evidence HTML</a></div><p>Seed {result.seed} · {result.draws} draws · {result.execution_mode}</p></div>}
      <div className="pc-controls"><label className="pc-field"><span>Saved run ID</span><input aria-label="Saved run ID" value={savedId} onChange={e => setSavedId(e.target.value)} /></label><button disabled={busy} onClick={() => void compute(true)}>Load saved scenario</button><button onClick={() => { edit(structuredClone(demo.request)); setResult(null); setSavedId('') }}>Reset bundled portfolio</button></div>
      <details><summary>Full request editor · import / edit all site costs and constraints</summary><p>Use a previously exported report's request object, or edit the current request. Validation runs on the backend; unknown inputs remain ineligible.</p><button onClick={() => setJsonEdit(JSON.stringify(request, null, 2))}>Copy current request into editor</button><textarea aria-label="Portfolio request JSON" rows={18} value={jsonEdit} onChange={e => setJsonEdit(e.target.value)} /><button disabled={busy} onClick={() => void applyJson()}>Apply JSON request</button></details>
      <h3>Source-backed registry context</h3>{(result?.registry_context ?? demo.registry_context).map(c => <article className="pc-card" key={c.id}><a href={c.source} target="_blank" rel="noreferrer">{c.id} · {c.title}</a><p>{c.sponsor} · captured {c.captured_at.slice(0,10)}</p><p>{c.use}</p></article>)}
      <h3>Assumptions and limitations</h3><ul>{(result?.limitations ?? demo.limitations).map(l => <li key={l}>{l}</li>)}</ul>
      {result && <><h3>Financial policy references</h3>{result.sources.map(s => <p key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> · {s.scope}</p>)}<details><summary>Coverage responsibility detail (fixed across scenarios)</summary>{result.coverage.map((c,i) => <div key={i}><h4>{viewing.trials[i].id}</h4>{table(['Item', 'Responsibility', 'Source'], c.items.map(x => [x.label, x.status, x.source]))}</div>)}</details><details><summary>Execution provenance</summary><pre>{JSON.stringify(result.evidence, null, 2)}</pre></details></>}
    </section>}
    <footer className="pc-note">Concord · Portfolio Command · reproducible planning, explicitly bounded evidence.</footer>
  </div>
}
