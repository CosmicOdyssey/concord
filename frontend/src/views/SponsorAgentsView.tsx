import React, { useState, useEffect } from 'react';
import {
  fetchPhotonStatus,
  fetchDroidStatus, fetchChalkStatus, sendLivePhoton, runLiveDroidAgent, runRemoteChalk, remoteChalkComplete,
  type ProviderReadiness, type RemoteChalkReport,
  sendSimulatedSMS,
  runDroidAgent,
  runChalkEvaluations,
  fetchLatestChalkReport,
  type SMSResponse,
  type PhotonStatus,
  type DroidRecommendation,
  type ChalkEvaluationReport,
} from '../sponsorAgentsApi';
import './sponsor-agents.css';

export function Readiness({label, status, error, gate}: {label: string; status: ProviderReadiness | null; error: string | null; gate: boolean}) {
  return <div className="provider-readiness" aria-label={`${label} provider readiness`}>
    <h3>{label}: {status?.readiness ?? 'UNKNOWN'}</h3>
    <p>Provider: {status?.provider_status ?? 'UNKNOWN'} · Authentication: {status?.auth_status ?? 'UNKNOWN'} · Server execution gate: {gate ? 'ENABLED' : 'DISABLED / UNKNOWN'}</p>
    {error && <p role="status">{error}</p>}
    {status && <p>Missing prerequisites: {status.missing_prerequisites.length ? status.missing_prerequisites.join(', ') : 'None reported; configuration alone does not verify connection or spending eligibility.'}</p>}
    {status?.remote_requirements && <p>Remote requirements: {status.remote_requirements.join('; ')}</p>}
  </div>
}
function eligible(status: ProviderReadiness | null, gate: boolean): boolean {
  return !!status && status.missing_prerequisites.length === 0 && gate
}
export default function SponsorAgentsView() {
  const [operatorToken, setOperatorToken] = useState('');
  const [remoteBusy, setRemoteBusy] = useState<'photon' | 'factory' | 'chalk' | null>(null);
  const [confirmPhoton, setConfirmPhoton] = useState(false);
  const [confirmFactory, setConfirmFactory] = useState(false);
  const [confirmChalk, setConfirmChalk] = useState(false);
  const [sendId, setSendId] = useState(() => crypto.randomUUID());
  const [sendReceipt, setSendReceipt] = useState<SMSResponse | null>(null);
  const [remoteChalk, setRemoteChalk] = useState<RemoteChalkReport | null>(null);
  const [droidStatus, setDroidStatus] = useState<ProviderReadiness | null>(null);
  const [chalkStatus, setChalkStatus] = useState<ProviderReadiness | null>(null);
  const [droidStatusError, setDroidStatusError] = useState<string | null>(null);
  const [chalkStatusError, setChalkStatusError] = useState<string | null>(null);
  const [statusRefresh, setStatusRefresh] = useState(0);
  // --- Photon SMS State ---
  const [photonError, setPhotonError] = useState<string | null>(null);
  const [photonStatus, setPhotonStatus] = useState<PhotonStatus | null>(null);
  const [smsInput, setSmsInput] = useState<string>('STATUS');
  const [smsSender] = useState<string>('+16175550199');
  const [smsHistory, setSmsHistory] = useState<Array<{ sender: string; body: string; reply: SMSResponse }>>([]);
  const [smsLoading, setSmsLoading] = useState<boolean>(false);

  // --- Factory Droid State ---
  const [droidRec, setDroidRec] = useState<DroidRecommendation | null>(null);
  const [droidLoading, setDroidLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // --- Chalk Evaluations State ---
  const [chalkReport, setChalkReport] = useState<ChalkEvaluationReport | null>(null);
  const [chalkLoading, setChalkLoading] = useState<boolean>(false);

  useEffect(() => {
    let disposed = false;
    fetchPhotonStatus().then(value => { if (!disposed) { setPhotonStatus(value); setPhotonError(null); } }).catch(() => { if (!disposed) { setPhotonStatus(null); setPhotonError('Backend status unavailable. No phone/provider connection has been verified.'); } });
    fetchDroidStatus().then(value => { if (!disposed) { setDroidStatus(value); setDroidStatusError(null); } }).catch(() => { if (!disposed) { setDroidStatus(null); setDroidStatusError('Factory backend readiness unavailable; connection UNKNOWN.'); } });
    fetchChalkStatus().then(value => { if (!disposed) { setChalkStatus(value); setChalkStatusError(null); } }).catch(() => { if (!disposed) { setChalkStatus(null); setChalkStatusError('Chalk backend readiness unavailable; connection UNKNOWN.'); } });
    fetchLatestChalkReport().then(value => { if (!disposed) setChalkReport(value); }).catch(() => {});
    return () => { disposed = true; };
  }, [statusRefresh]);

  const handleSendSMS = async (commandText?: string) => {
    const text = commandText || smsInput;
    if (!text.trim()) return;
    setError(null);
    setSmsLoading(true);
    try {
      const reply = await sendSimulatedSMS(text, smsSender);
      setSmsHistory((prev) => [...prev, { sender: smsSender, body: text, reply }]);
      if (!commandText) setSmsInput('');
    } catch (e: unknown) {
      setError(`Local messaging error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSmsLoading(false);
    }
  };

  const handleRunDroid = async () => {
    setError(null);
    setDroidLoading(true);
    setDroidRec(null);
    try {
      const rec = await runDroidAgent('NCT05800015', 3);
      setDroidRec(rec);
    } catch (e: unknown) {
      setError(`Local proposal error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDroidLoading(false);
    }
  };

  const handleRunChalk = async () => {
    setError(null);
    setChalkLoading(true);
    setChalkReport(null);
    try {
      const report = await runChalkEvaluations();
      setChalkReport(report);
    } catch (e: unknown) {
      setError(`Local evaluation error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setChalkLoading(false);
    }
  };

  const performRemote = async (kind: 'photon' | 'factory' | 'chalk') => {
    if (remoteBusy) return;
    setRemoteBusy(kind); setError(null);
    try {
      if (kind === 'photon') {
        setSendReceipt(null);
        setSendReceipt(await sendLivePhoton({body: 'STATUS', messageId: sendId, operatorToken, confirmLive: confirmPhoton}));
      } else if (kind === 'factory') {
        setDroidRec(null); setDroidLoading(true);
        setDroidRec(await runLiveDroidAgent(operatorToken, confirmFactory));
      } else {
        setRemoteChalk(null);
        setRemoteChalk(await runRemoteChalk(operatorToken, confirmChalk));
      }
    } catch (e: unknown) {
      setError(`${kind} action failed: ${e instanceof Error ? e.message : String(e)}${kind === 'photon' ? ' Outcome may be unknown. Reconcile the stable message ID before a further send; no automatic retry occurs.' : ' Local results have not been substituted.'}`);
    } finally {
      setOperatorToken(''); setConfirmPhoton(false); setConfirmFactory(false); setConfirmChalk(false);
      setRemoteBusy(null); if (kind === 'factory') setDroidLoading(false);
    }
  };

  return (
    <div className="sponsor-agents-container">
      <header className="sponsor-header">
        <div className="sponsor-badge">HACKHARVARD 2026 SPONSOR CHALLENGES</div>
        <h1>Concord Sponsor Integration Lab</h1>
        <p className="sponsor-subtitle">
          Local planning tools and separately authorized provider connections:
          <strong> Photon 2.0 SMS</strong> operations, <strong>Chalk</strong> deterministic evaluations, and the
          <strong> Droid-style</strong> proposal evaluator.
        </p>
        <div className="sponsor-disclaimer">
          Note: Exploratory operational simulations only. Modeled completion durations are not clinical trial forecasts.
          Remote adapters require server gates, provider prerequisites and explicit operator authorization. Credentials alone do not verify a connection. Carrier delivery is not established by API acceptance. Canonical clinical protocols remain immutable.
        </div>
      </header>

      {error && <p role="alert" className="sponsor-disclaimer">{error}</p>}
      <section className="sponsor-card remote-authorization" aria-label="Provider authorization">
        <h2>Provider readiness and operator authorization</h2>
        <p>Readiness requests are read-only. Remote actions below can send a message or consume provider compute; none run automatically. The server owns every execution gate and configured destination.</p>
        <button type="button" onClick={() => setStatusRefresh(value => value + 1)}>Refresh provider readiness</button>
        <label htmlFor="sponsor-operator-token">Operator token (memory only; cleared after every remote action)</label>
        <input id="sponsor-operator-token" type="password" autoComplete="off" value={operatorToken} onChange={event => setOperatorToken(event.target.value)} disabled={!!remoteBusy} />
        <button type="button" onClick={() => setOperatorToken('')} disabled={!!remoteBusy}>Clear token</button>
        <Readiness label="Photon" status={photonStatus} error={photonError} gate={photonStatus?.outbound_enabled === true} />
        <Readiness label="Factory" status={droidStatus} error={droidStatusError} gate={droidStatus?.live_execution_enabled === true} />
        <Readiness label="Chalk" status={chalkStatus} error={chalkStatusError} gate={chalkStatus?.remote_execution_enabled === true} />
      </section>
      {/* --- FRONT A: PHOTON 2.0 SMS AGENT --- */}
      <section className="sponsor-card">
        <div className="card-header">
          <div>
            <span className="card-tag">FRONT A — MOBILE OPERATIONS</span>
            <h2>Photon-style Operations Simulator</h2>
          </div>
          <div className="status-pill">
            Channel: <span>LOCAL SIMULATION</span>
          </div>
        </div>
        <p>
          Runs STATUS, DETAILS and OPTIMIZE against local synthetic planning inputs. The inbound webhook requires a configured secret, fresh signed timestamp and exact sender allowlist. This phone preview sends no carrier message.
        </p>

        <div className="sms-console-layout">
          <div className="sms-phone-frame">
            <div className="phone-screen">
              <div className="phone-header">
                <strong>Photon Ops Agent</strong>
                <span className="phone-status">Local preview · no phone connection</span>
              </div>
              <div className="messages-thread">
                <div className="msg-bubble system">
                  Local Concord planning simulator. Type <strong>STATUS</strong>, <strong>DETAILS</strong>, or <strong>OPTIMIZE</strong>.
                </div>
                {smsHistory.map((h, i) => (
                  <React.Fragment key={i}>
                    <div className="msg-bubble user">{h.body}</div>
                    <div className="msg-bubble assistant">
                      {h.reply.reply_text}
                      <span className="msg-meta">
                        {h.reply.status} · {h.reply.delivery_note}
                      </span>
                    </div>
                  </React.Fragment>
                ))}
                {smsLoading && <div className="msg-bubble assistant loading">Processing Concord query…</div>}
              </div>
              <div className="phone-input-bar">
                <input
                  type="text"
                  placeholder="Type an SMS command…"
                  value={smsInput}
                  onChange={(e) => setSmsInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendSMS()}
                />
                <button onClick={() => handleSendSMS()} disabled={smsLoading}>
                  Send
                </button>
              </div>
            </div>
          </div>

          <div className="sms-controls-panel">
            <h3>Quick Commands</h3>
            <div className="btn-group">
              <button onClick={() => handleSendSMS('STATUS')} disabled={smsLoading} className="btn-secondary">
                Send STATUS
              </button>
              <button onClick={() => handleSendSMS('DETAILS')} disabled={smsLoading} className="btn-secondary">
                Send DETAILS
              </button>
              <button onClick={() => handleSendSMS('OPTIMIZE')} disabled={smsLoading} className="btn-secondary">
                Send OPTIMIZE
              </button>
              <button onClick={() => handleSendSMS('HELP')} disabled={smsLoading} className="btn-secondary">
                Send HELP
              </button>
            </div>

            <div className="telemetry-box">
              <h4>Webhook & Security Telemetry</h4>
              {photonError && <p role="status">{photonError}</p>}
              <ul>
                <li><strong>Allowlist Active:</strong> {photonStatus ? (photonStatus.allowlist_active ? 'Yes' : 'External webhook blocked') : 'UNKNOWN — backend unavailable'}</li>
                <li><strong>Signature Auth:</strong> HMAC-SHA256 (<code>X-Photon-Signature</code>)</li>
                <li><strong>Idempotency:</strong> Sender-scoped <code>message_id</code> and payload digest</li>
                <li><strong>Processed Messages:</strong> {photonStatus?.messages_processed_count ?? 'UNKNOWN'}</li>
                <li><strong>Scope:</strong> Bundled registry context; synthetic operations</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="sponsor-card remote-action" aria-label="Explicit Photon send">
        <h2>Photon API: one configured-space STATUS reply</h2>
        <p>Computes the synthetic STATUS reply and sends it to the server-configured Photon space/user. No destination can be entered here. This is separate from the phone preview. API acceptance never proves carrier delivery.</p>
        <p>Stable message ID: <code>{sendId}</code>. Preserve this ID when reconciling an unknown outcome.</p>
        <button type="button" disabled={!!remoteBusy} onClick={() => { setSendId(crypto.randomUUID()); setSendReceipt(null); setConfirmPhoton(false); }}>Prepare new send ID</button>
        <label className="remote-confirm"><input type="checkbox" checked={confirmPhoton} disabled={!!remoteBusy} onChange={event => setConfirmPhoton(event.target.checked)} />I authorize one STATUS reply to the approved server-configured Photon space/user.</label>
        <button type="button" onClick={() => void performRemote('photon')} disabled={!!remoteBusy || !confirmPhoton || !operatorToken.trim() || !eligible(photonStatus, photonStatus?.outbound_enabled === true)}>Send approved STATUS via Photon API</button>
        {sendReceipt && <div className="receipt-card" role="status"><h3>Photon outcome: {sendReceipt.status}</h3><p>{sendReceipt.delivery_note}</p><p>Provider message: {sendReceipt.provider_message_id ?? 'UNKNOWN'} · Request: {sendReceipt.request_id}</p><p>Dispatched: {sendReceipt.dispatched_at ?? 'UNKNOWN'} · Carrier delivery: UNVERIFIED</p><p>No automatic retry. A repeated stable ID retrieves its server-side receipt.</p></div>}
      </section>

      {/* --- FRONT C: FACTORY DROID SDK PROTOCOL AGENT --- */}
      <section className="sponsor-card">
        <div className="card-header">
          <div>
            <span className="card-tag">FRONT C — PROTOCOL AGENT</span>
            <h2>Droid-style Operational Proposal Evaluator</h2>
          </div>
          <div className="status-pill">
            Runtime: <span>LOCAL DETERMINISTIC</span>
          </div>
        </div>
        <p>
          The local evaluator compares explicitly modeled operational adjustments. It does not invoke Factory SDK inference.
          Operates in an auditable <strong>recursive refinement loop</strong> with a fixed tool allowlist,
          hard clinical safety constraints, and an explicit <strong>human-in-the-loop approval gate</strong>.
        </p>

        <div className="droid-action-bar">
          <div className="trial-select-pill">
            Selected Protocol: <strong>NCT05800015 (Regeneron Cemiplimab NSCLC Study)</strong>
          </div>
          <button onClick={handleRunDroid} disabled={droidLoading} className="btn-primary">
            {droidLoading ? 'Evaluating Local Proposals…' : 'Evaluate Local Proposals'}
          </button>
        </div>

        <div className="remote-action">
          <h3>Factory SDK: explicitly run bounded proposals</h3>
          <p>Uses the configured Factory model for at most three operational proposals. Concord independently validates them against its synthetic planning engine. No proposal is applied or clinically authorized.</p>
          <label className="remote-confirm"><input type="checkbox" checked={confirmFactory} disabled={!!remoteBusy} onChange={event => setConfirmFactory(event.target.checked)} />I authorize one Factory SDK run and its provider usage under the configured budget.</label>
          <button type="button" onClick={() => void performRemote('factory')} disabled={!!remoteBusy || droidLoading || !confirmFactory || !operatorToken.trim() || !eligible(droidStatus, droidStatus?.live_execution_enabled === true)}>Run approved Factory SDK proposals</button>
        </div>

        {droidRec && (
          <div className="droid-result-container">
            <div className="summary-banner">
              <h3>Recommendation Artifact: {droidRec.recommendation_id}</h3>
              <p>{droidRec.executive_summary}</p><p>Execution mode: {droidRec.execution_mode ?? 'UNKNOWN'} · Runtime: {droidRec.runtime_agent} · Disposition: {droidRec.disposition ?? 'UNKNOWN'}</p>
              {droidRec.runtime_receipt && <p>Actual Factory receipt: session {droidRec.runtime_receipt.session_id ?? 'UNKNOWN'} · {droidRec.runtime_receipt.status ?? 'UNKNOWN'} · {droidRec.runtime_receipt.duration_ms ?? 'UNKNOWN'} ms · {droidRec.runtime_receipt.turn_count ?? 'UNKNOWN'} turns</p>}
            </div>

            <div className="metrics-grid">
              <div className="metric-card">
                <small>Baseline Makespan</small>
                <strong>{droidRec.baseline_makespan_months.toFixed(2)} mo</strong>
              </div>
              <div className="metric-card highlight">
                <small>Recommended Makespan</small>
                <strong>{droidRec.recommended_makespan_months.toFixed(2)} mo</strong>
                <span className="delta-tag">{droidRec.expected_makespan_delta_months.toFixed(2)} mo</span>
              </div>
              <div className="metric-card">
                <small>Conservative Commitment</small>
                <strong>${droidRec.budget_commitment_usd.toLocaleString()}</strong>
                <span>Ceiling: ${droidRec.budget_ceiling_usd.toLocaleString()}</span>
              </div>
              <div className="metric-card">
                <small>Local Evaluation Score</small>
                <strong>{(droidRec.chalk_evaluation_score * 100).toFixed(0)}%</strong>
                <span>Objective Scorers</span>
              </div>
            </div>

            {/* Invariant Banner */}
            <div className="safety-guardrail-banner">
              <span className="check-icon">✓</span>
              <div>
                <strong>{droidRec.clinical_safety_status === 'PASSED_NO_CLINICAL_MUTATION' ? 'Clinical criteria unchanged under local checks:' : 'Clinical safety checks rejected this proposal:'}</strong> {droidRec.clinical_safety_status}
                Automated refinements were strictly restricted to operational parameters (activation lag, outreach budget).
              </div>
            </div>

            {/* Refinement Iterations */}
            <div className="iterations-section">
              <h4>Recursive Refinement Tracing ({droidRec.iterations.length} Iterations)</h4>
              <div className="iterations-list">
                {droidRec.iterations.map((it) => (
                  <div key={it.iteration_index} className="iteration-item">
                    <div className="it-header">
                      <strong>Iteration #{it.iteration_index}</strong>
                      <span className="decision-badge">{it.decision}</span>
                    </div>
                    <div className="it-body">
                      <p><strong>Proposal:</strong> {it.proposed_amendment.description}</p>
                      <p>
                        <strong>Simulated Output:</strong> {it.simulation_metrics.simulated_makespan} mo
                        (Commitment: ${it.simulation_metrics.simulated_commitment?.toLocaleString()})
                      </p>
                      <p className="it-feedback"><strong>Local Feedback:</strong> {it.feedback}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tool Trace */}
            <details className="tool-trace-details">
              <summary>View Concord Validation Function Traces ({droidRec.tool_trace.length} tool invocations)</summary>
              <ul className="tool-trace-list">
                {droidRec.tool_trace.map((t, idx) => (
                  <li key={idx}>
                    <code>{t.tool_name}</code> — {t.output_summary}
                    <small>({t.timestamp})</small>
                  </li>
                ))}
              </ul>
            </details>

            {/* Human in the loop review gate */}
            <div className="human-approval-gate">
              <h4>Human-in-the-Loop Review Gate</h4>
              <p>Clinical trial protocol amendments require formal sponsor and institutional sign-off.</p>
              <div className="approval-status-bar">
                Current State: <strong className={`status-${droidRec.human_approval_status.toLowerCase()}`}>{droidRec.human_approval_status}</strong>
              </div>
              <p>Local review records require authenticated server-side review. This demo does not authorize or apply a protocol amendment.</p>
            </div>
          </div>
        )}
      </section>

      {/* --- FRONT B: CHALK EVALUATIONS --- */}
      <section className="sponsor-card">
        <div className="card-header">
          <div>
            <span className="card-tag">FRONT B — AGENT EVALUATIONS</span>
            <h2>Chalk-style Local Acceptance Suite</h2>
          </div>
          <div className="status-pill">
            Dataset: <span className="status-live">{chalkReport?.dataset_version || 'Not run in this session'}</span>
          </div>
        </div>
        <p>
          Concord runs its versioned local acceptance dataset using deterministic checks:
          budget compliance, shared capacity limits, exact solver agreement, missing-information handling, and
          adversarial prompt injection defense.
        </p>

        <div className="chalk-action-bar">
          <button onClick={handleRunChalk} disabled={chalkLoading} className="btn-primary">
            {chalkLoading ? 'Running Local Acceptance Suite…' : 'Run Local Acceptance Suite'}
          </button>
          {chalkReport && (
            <div className="chalk-headline">
              Passed: <strong>{chalkReport.passed_scenarios} / {chalkReport.total_scenarios}</strong> ({((chalkReport.overall_pass_rate || 0) * 100).toFixed(0)}%) ·
              Hard Violations: <strong>{chalkReport.hard_safety_violations}</strong> ·
              Mode: <em>{chalkReport.engine_mode}</em>
            </div>
          )}
        </div>

        <div className="remote-action">
          <h3>Chalk Compute: separately execute all 15 acceptance cases</h3>
          <p>This action deploys two bounded Functions, uploads the versioned dataset and reads the remote evaluation result rows. It consumes authorized remote compute, not model inference. The local table remains independent.</p>
          <label className="remote-confirm"><input type="checkbox" checked={confirmChalk} disabled={!!remoteBusy} onChange={event => setConfirmChalk(event.target.checked)} />I authorize one remote Chalk run and its compute budget.</label>
          <button type="button" onClick={() => void performRemote('chalk')} disabled={!!remoteBusy || !confirmChalk || !operatorToken.trim() || !eligible(chalkStatus, chalkStatus?.remote_execution_enabled === true)}>Run approved remote Chalk evaluation</button>
          {remoteChalk && <div className="receipt-card" role="status">
            <h4>{remoteChalkComplete(remoteChalk) ? 'Remote 15-case acceptance complete and passing' : 'Remote result incomplete or failing — no acceptance claimed'}</h4>
            <p>Mode: {remoteChalk.execution_mode} · Evaluation: {remoteChalk.evaluation_id} · Run: {remoteChalk.run_id}</p>
            <p>Dataset: {remoteChalk.dataset_version} · Digest: <code>{remoteChalk.dataset_sha256}</code></p>
            <p>Actual rows: {remoteChalk.row_count ?? 'UNKNOWN'} / 15 · Passed: {remoteChalk.passed_scenarios ?? 'UNKNOWN'} · Failed: {remoteChalk.failed_scenarios ?? 'UNKNOWN'} · Row errors: {remoteChalk.row_errors?.length ?? 'UNKNOWN'}</p>
            <p>Recorded: {remoteChalk.recorded_at ?? 'UNKNOWN'} · Provider run status: {remoteChalk.run_status ?? 'UNKNOWN'}</p>
            <ul>{remoteChalk.rows.map((row, index) => <li key={index}>{String(row.scenario_id ?? 'UNKNOWN')} · {Object.entries(row).some(([key,value]) => (key === 'output_error' || key.endsWith('_error')) && !!value) ? 'ROW ERROR' : 'No row error reported'} · Scorer values: {Object.entries(row).filter(([key]) => key.endsWith('_value') && key !== 'output_value').map(([key,value]) => `${key}: ${typeof value === 'number' || typeof value === 'boolean' ? String(value) : 'UNKNOWN'}`).join(', ') || 'UNKNOWN'}</li>)}</ul>
          </div>}
        </div>

        {chalkReport && (
          <div className="chalk-table-wrapper">
            <table className="chalk-scenarios-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Scorer Details</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {chalkReport.scenarios.map((scen) => (
                  <tr key={scen.scenario_id}>
                    <td>
                      <strong>{scen.scenario_name}</strong>
                      <small className="scen-id">{scen.scenario_id}</small>
                    </td>
                    <td>{scen.category}</td>
                    <td>
                      <span className={`eval-pill ${scen.passed ? 'pass' : 'fail'}`}>
                        {scen.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </td>
                    <td>
                      {scen.scorer_results.map((s, idx) => (
                        <div key={idx} className="scorer-line">
                          <span>{s.scorer_name}:</span> {s.details}
                        </div>
                      ))}
                    </td>
                    <td>{scen.execution_time_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
