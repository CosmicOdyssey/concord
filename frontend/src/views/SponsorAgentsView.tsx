import React, { useState, useEffect } from 'react';
import {
  fetchPhotonStatus,
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

export default function SponsorAgentsView() {
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
    fetchPhotonStatus().then(value => { if (!disposed) setPhotonStatus(value); }).catch(() => { if (!disposed) setPhotonError('Backend status unavailable. No phone/provider connection has been verified.'); });
    fetchLatestChalkReport().then(value => { if (!disposed) setChalkReport(value); }).catch(() => {});
    return () => { disposed = true; };
  }, []);

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

  return (
    <div className="sponsor-agents-container">
      <header className="sponsor-header">
        <div className="sponsor-badge">HACKHARVARD 2026 SPONSOR CHALLENGES</div>
        <h1>Concord Sponsor Integration Lab</h1>
        <p className="sponsor-subtitle">
          Three local demonstrations using Concord’s deterministic planning services:
          <strong> Photon 2.0 SMS</strong> operations, <strong>Chalk</strong> deterministic evaluations, and the
          <strong> Droid-style</strong> proposal evaluator.
        </p>
        <div className="sponsor-disclaimer">
          Note: Exploratory operational simulations only. Modeled completion durations are not clinical trial forecasts.
          Carrier dispatch, remote Chalk execution and Factory SDK inference are not implemented. Credentials alone do not enable them. Canonical clinical protocols are immutable.
        </div>
      </header>

      {error && <p role="alert" className="sponsor-disclaimer">{error}</p>}
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

        {droidRec && (
          <div className="droid-result-container">
            <div className="summary-banner">
              <h3>Recommendation Artifact: {droidRec.recommendation_id}</h3>
              <p>{droidRec.executive_summary}</p>
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
                <strong>Hard Safety Guardrail Verified:</strong> No live clinical inclusion/exclusion criteria were mutated.
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
              <summary>View Local Function Traces ({droidRec.tool_trace.length} tool invocations)</summary>
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
