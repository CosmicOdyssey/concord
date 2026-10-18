import React, { useState, useEffect } from 'react';
import {
  fetchPhotonStatus,
  sendSimulatedSMS,
  runDroidAgent,
  submitHumanReview,
  runChalkEvaluations,
  fetchLatestChalkReport,
  fetchDroidStatus,
  type SMSResponse,
  type PhotonStatus,
  type DroidRecommendation,
  type DroidStatus,
  type ChalkEvaluationReport,
  type ReadinessState,
} from '../sponsorAgentsApi';
import './sponsor-agents.css';

function renderReadinessBadge(readiness?: ReadinessState) {
  const state = readiness || 'MISSING_CREDENTIALS';
  const labelMap: Record<ReadinessState, string> = {
    CONNECTED_AND_VERIFIED: 'Connected & Verified',
    CONFIGURED_UNVERIFIED: 'Configured (Unverified)',
    PENDING_PROJECT_ID: 'Pending Project ID',
    LOCAL_SIMULATION_ONLY: 'Local Simulation Only',
    MISSING_CREDENTIALS: 'Missing Credentials (Sandbox)',
    FAILED: 'Failed',
  };
  const label = labelMap[state] || state;
  const className = `readiness-pill readiness-${state.toLowerCase()}`;
  return (
    <span className={className}>
      <span className="readiness-dot">●</span> {label}
    </span>
  );
}

export default function SponsorAgentsView() {
  // --- Photon SMS State ---
  const [photonStatus, setPhotonStatus] = useState<PhotonStatus | null>(null);
  const [smsInput, setSmsInput] = useState<string>('STATUS');
  const [smsSender] = useState<string>('+16175550199');
  const [smsHistory, setSmsHistory] = useState<Array<{ sender: string; body: string; reply: SMSResponse }>>([]);
  const [smsLoading, setSmsLoading] = useState<boolean>(false);

  // --- Factory Droid State ---
  const [droidStatus, setDroidStatus] = useState<DroidStatus | null>(null);
  const [droidRec, setDroidRec] = useState<DroidRecommendation | null>(null);
  const [droidLoading, setDroidLoading] = useState<boolean>(false);
  const [approvalNotes, setApprovalNotes] = useState<string>('Operational refinement verified; clinical safety criteria preserved.');

  // --- Chalk Evaluations State ---
  const [chalkReport, setChalkReport] = useState<ChalkEvaluationReport | null>(null);
  const [chalkLoading, setChalkLoading] = useState<boolean>(false);

  useEffect(() => {
    fetchPhotonStatus().then(setPhotonStatus).catch(() => {});
    fetchDroidStatus().then(setDroidStatus).catch(() => {});
    fetchLatestChalkReport().then(setChalkReport).catch(() => {});
  }, []);

  const handleSendSMS = async (commandText?: string) => {
    const text = commandText || smsInput;
    if (!text.trim()) return;
    setSmsLoading(true);
    try {
      const reply = await sendSimulatedSMS(text, smsSender);
      setSmsHistory((prev) => [...prev, { sender: smsSender, body: text, reply }]);
      if (!commandText) setSmsInput('');
    } catch (e: any) {
      alert(`SMS error: ${e.message}`);
    } finally {
      setSmsLoading(false);
    }
  };

  const handleRunDroid = async () => {
    setDroidLoading(true);
    try {
      const rec = await runDroidAgent('NCT05800015', 3);
      setDroidRec(rec);
    } catch (e: any) {
      alert(`Factory Droid error: ${e.message}`);
    } finally {
      setDroidLoading(false);
    }
  };

  const handleReviewDecision = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!droidRec) return;
    try {
      const updated = await submitHumanReview(droidRec.recommendation_id, decision, approvalNotes);
      setDroidRec((prev) => (prev ? { ...prev, human_approval_status: updated.human_approval_status } : null));
    } catch (e: any) {
      alert(`Review submission error: ${e.message}`);
    }
  };

  const handleRunChalk = async () => {
    setChalkLoading(true);
    try {
      const report = await runChalkEvaluations();
      setChalkReport(report);
    } catch (e: any) {
      alert(`Chalk evaluation error: ${e.message}`);
    } finally {
      setChalkLoading(false);
    }
  };

  return (
    <div className="sponsor-agents-container">
      <header className="sponsor-header">
        <div className="sponsor-badge">HACKHARVARD 2026 SPONSOR CHALLENGES</div>
        <h1>Concord Autonomous Sponsor Integrations</h1>
        <p className="sponsor-subtitle">
          Three production integrations built on top of Concord’s verified scientific optimization engine:
          <strong> Photon 2.0 SMS</strong> operations, <strong>Chalk</strong> deterministic evaluations, and the
          <strong> Factory Droid SDK</strong> recursive protocol agent.
        </p>
        <div className="sponsor-disclaimer">
          Note: Exploratory operational simulations only. Modeled completion durations are not clinical trial forecasts.
          Live carrier SMS dispatch requires <code>PHOTON_API_KEY</code>. Canonical clinical protocols are immutable.
        </div>
      </header>

      {/* --- FRONT A: PHOTON 2.0 SMS AGENT --- */}
      <section className="sponsor-card">
        <div className="card-header">
          <div>
            <span className="card-tag">FRONT A — MOBILE OPERATIONS</span>
            <h2>Photon 2.0 SMS Clinical Trial Operations Agent</h2>
          </div>
          <div className="header-status-group">
            {renderReadinessBadge(photonStatus?.readiness)}
            <span className="readiness-detail-note">
              {photonStatus?.auth_status || 'Local Webhook Active · Public NCT Registry'}
            </span>
          </div>
        </div>
        <p>
          Enables trial coordinators and investigators to monitor portfolio allocations, check budget ceilings,
          and receive optimization alerts directly over SMS via Photon’s webhook infrastructure with HMAC signature verification and idempotency caching.
        </p>

        <div className="sms-console-layout">
          <div className="sms-phone-frame">
            <div className="phone-screen">
              <div className="phone-header">
                <strong>Photon Ops Agent</strong>
                <span className="phone-status">Online (+1 617-555-0200)</span>
              </div>
              <div className="messages-thread">
                <div className="msg-bubble system">
                  Connected to Concord Engine. Type <strong>STATUS</strong>, <strong>DETAILS</strong>, or <strong>OPTIMIZE</strong>.
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
              <ul>
                <li><strong>Readiness:</strong> {photonStatus?.readiness || 'MISSING_CREDENTIALS'}</li>
                <li><strong>Allowlist Active:</strong> {photonStatus?.allowlist_active ? 'Yes' : 'Permissive Local'}</li>
                <li><strong>Signature Auth:</strong> HMAC-SHA256 (<code>X-Photon-Signature</code>)</li>
                <li><strong>Idempotency:</strong> Deduplicated by <code>message_id</code></li>
                <li><strong>Processed Messages:</strong> {photonStatus?.messages_processed_count ?? 0}</li>
                <li><strong>Scope:</strong> Public NCT05800015 & NCT05286580 context</li>
              </ul>
              {photonStatus?.missing_prerequisites && photonStatus.missing_prerequisites.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <small style={{ display: 'block', marginBottom: '4px', color: '#8d4c00', fontWeight: 600 }}>
                    Missing Prerequisites for Live Carrier Dispatch:
                  </small>
                  {photonStatus.missing_prerequisites.map((p) => (
                    <span key={p} className="prereq-badge">{p}</span>
                  ))}
                </div>
              )}
              <div className="receipt-card">
                <strong>Live Delivery Receipt:</strong><br />
                {photonStatus?.last_receipt ? (
                  <>
                    Provider ID: <code>{photonStatus.last_receipt.provider_message_id}</code><br />
                    Status: {photonStatus.last_receipt.status} · Recipient: {photonStatus.last_receipt.recipient}<br />
                    Timestamp: {photonStatus.last_receipt.timestamp}
                  </>
                ) : (
                  <>Carrier dispatch sandbox active. Outbound SMS queues with status <code>QUEUED_OFFLINE</code> until <code>PHOTON_API_KEY</code> and <code>PHOTON_PHONE_NUMBER</code> are set.</>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- FRONT C: FACTORY DROID SDK PROTOCOL AGENT --- */}
      <section className="sponsor-card">
        <div className="card-header">
          <div>
            <span className="card-tag">FRONT C — PROTOCOL AGENT</span>
            <h2>Factory Droid SDK: Autonomous Protocol Amendment Agent</h2>
          </div>
          <div className="header-status-group">
            {renderReadinessBadge(droidRec?.readiness || droidStatus?.readiness)}
            <span className="readiness-detail-note">
              {droidRec?.auth_status || droidStatus?.auth_status || '@factory/droid-sdk v0.9.1 TypeScript/Node'}
            </span>
          </div>
        </div>
        <p>
          Factory Droid evaluates candidate operational adjustments to unblock clinical enrollment.
          Operates in an auditable <strong>recursive refinement loop</strong> with sandboxed tools,
          hard clinical safety constraints, and an explicit <strong>human-in-the-loop approval gate</strong>.
        </p>

        <div className="droid-action-bar">
          <div className="trial-select-pill">
            Selected Protocol: <strong>NCT05800015 (Regeneron Cemiplimab NSCLC Study)</strong>
          </div>
          <button onClick={handleRunDroid} disabled={droidLoading} className="btn-primary">
            {droidLoading ? 'Executing Droid Refinement Loop…' : 'Run Factory Droid Optimization'}
          </button>
        </div>

        {((droidRec?.missing_prerequisites && droidRec.missing_prerequisites.length > 0) ||
          (droidStatus?.missing_prerequisites && droidStatus.missing_prerequisites.length > 0)) && (
          <div style={{ marginBottom: '16px' }}>
            <small style={{ display: 'block', marginBottom: '4px', color: '#8d4c00', fontWeight: 600 }}>
              Prerequisites for Live Factory Cloud Droid Session:
            </small>
            {(droidRec?.missing_prerequisites || droidStatus?.missing_prerequisites || []).map((p) => (
              <span key={p} className="prereq-badge">{p}</span>
            ))}
          </div>
        )}

        {droidRec && (
          <div className="droid-result-container">
            <div className="summary-banner">
              <h3>Recommendation Artifact: {droidRec.recommendation_id}</h3>
              <p>{droidRec.executive_summary}</p>
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#496366' }}>
                Runtime: <code>{droidRec.runtime_agent}</code>
              </div>
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
                <small>Chalk Evaluation Score</small>
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
                      <p className="it-feedback"><strong>Chalk Feedback:</strong> {it.feedback}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tool Trace */}
            <details className="tool-trace-details">
              <summary>View Sandboxed Tool Traces ({droidRec.tool_trace.length} tool invocations)</summary>
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
              {droidRec.human_approval_status === 'PENDING_HUMAN_REVIEW' && (
                <div className="approval-actions">
                  <input
                    type="text"
                    value={approvalNotes}
                    onChange={(e) => setApprovalNotes(e.target.value)}
                    placeholder="Enter reviewer notes…"
                    className="approval-input"
                  />
                  <button onClick={() => handleReviewDecision('APPROVED')} className="btn-approve">
                    Approve Operational Amendment
                  </button>
                  <button onClick={() => handleReviewDecision('REJECTED')} className="btn-reject">
                    Reject Proposal
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* --- FRONT B: CHALK EVALUATIONS --- */}
      <section className="sponsor-card">
        <div className="card-header">
          <div>
            <span className="card-tag">FRONT B — AGENT EVALUATIONS</span>
            <h2>Chalk Evaluation Engine</h2>
          </div>
          <div className="header-status-group">
            {renderReadinessBadge(chalkReport?.readiness)}
            <span className="readiness-detail-note">
              {chalkReport?.auth_status || '12 Scenarios · Deterministic Harness'}
            </span>
          </div>
        </div>
        <p>
          Chalk provides deterministic, reproducible agent evaluation using objective multi-attribute scorers:
          budget compliance, shared capacity limits, exact solver agreement, missing-information handling, and
          adversarial prompt injection defense.
        </p>

        <div className="chalk-action-bar">
          <button onClick={handleRunChalk} disabled={chalkLoading} className="btn-primary">
            {chalkLoading ? 'Running Chalk Evaluation Suite…' : 'Run Full Chalk Evaluation Suite (12 Scenarios)'}
          </button>
          {chalkReport && (
            <div className="chalk-headline">
              Passed: <strong>{chalkReport.passed_scenarios} / {chalkReport.total_scenarios}</strong> ({((chalkReport.overall_pass_rate || 0) * 100).toFixed(0)}%) ·
              Hard Violations: <strong>{chalkReport.hard_safety_violations}</strong> ·
              Mode: <em>{chalkReport.engine_mode}</em>
            </div>
          )}
        </div>

        {chalkReport?.missing_prerequisites && chalkReport.missing_prerequisites.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <small style={{ display: 'block', marginBottom: '4px', color: '#8d4c00', fontWeight: 600 }}>
              Prerequisites for Live Chalk Cloud Runner:
            </small>
            {chalkReport.missing_prerequisites.map((p) => (
              <span key={p} className="prereq-badge">{p}</span>
            ))}
          </div>
        )}

        {chalkReport && (
          <div className="receipt-card" style={{ marginBottom: '16px' }}>
            <strong>Chalk Evaluation Receipt:</strong><br />
            Run ID: <code>{chalkReport.run_id}</code> · Evaluation ID: <code>{chalkReport.evaluation_id || 'N/A (Local Harness)'}</code><br />
            Dataset: <code>{chalkReport.dataset_version}</code> (SHA256: <code>{chalkReport.dataset_sha256.slice(0, 16)}…</code>)<br />
            Task Version: <code>{chalkReport.task_version || 'concord-task-v1.2.0'}</code>
          </div>
        )}

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
