/**
 * API client for Concord Sponsor Integrations: Photon, Chalk, and Factory Droid.
 */

export interface SMSResponse {
  request_id: string;
  scenario_id: string;
  provider_status: string;
  data_mode: string;
  message_id: string;
  status: 'LOCAL_SIMULATION' | 'UNAUTHORIZED' | 'DUPLICATE' | 'ERROR';
  reply_text: string;
  sender: string;
  action_taken: string;
  is_simulated_data: boolean;
  real_engine_data?: Record<string, any>;
  delivery_note: string;
}

export interface PhotonStatus {
  provider: string;
  live_api_configured: boolean;
  webhook_secret_configured: boolean;
  allowlist_active: boolean;
  allowed_senders_count: number;
  messages_processed_count: number;
  channel: string;
  engine_scope: string;
  data_disclosure: string;
}

export interface DroidToolAction {
  tool_name: string;
  arguments: Record<string, any>;
  output_summary: string;
  timestamp: string;
}

export interface RefinementIteration {
  iteration_index: number;
  proposed_amendment: Record<string, any>;
  simulation_metrics: {
    baseline_makespan?: number;
    simulated_makespan?: number;
    makespan_delta?: number;
    simulated_commitment?: number;
    feasible?: boolean;
  };
  chalk_score: number;
  feedback: string;
  decision: string;
}

export interface DroidRecommendation {
  recommendation_id: string;
  trial_id: string;
  trial_title: string;
  created_at: string;
  runtime_agent: string;
  total_iterations: number;
  baseline_makespan_months: number;
  recommended_makespan_months: number;
  expected_makespan_delta_months: number;
  budget_commitment_usd: number;
  budget_ceiling_usd: number;
  feasibility_status: string;
  clinical_safety_status: string;
  chalk_evaluation_score: number;
  executive_summary: string;
  human_approval_status: 'PENDING_HUMAN_REVIEW' | 'APPROVED' | 'REJECTED';
  iterations: RefinementIteration[];
  tool_trace: DroidToolAction[];
}

export interface ChalkScenarioResult {
  scenario_id: string;
  scenario_name: string;
  category: string;
  passed: boolean;
  hard_safety_violation: boolean;
  execution_time_ms: number;
  scorer_results: Array<{
    scorer_name: string;
    passed: boolean;
    score: number;
    details: string;
  }>;
}

export interface ChalkEvaluationReport {
  run_id: string;
  dataset_version: string;
  dataset_sha256: string;
  timestamp: string;
  engine_mode: string;
  total_scenarios: number;
  passed_scenarios: number;
  failed_scenarios: number;
  hard_safety_violations: number;
  overall_pass_rate: number;
  scenarios: ChalkScenarioResult[];
}

const API_BASE = '';

export async function fetchPhotonStatus(): Promise<PhotonStatus> {
  try {
    const res = await fetch(`${API_BASE}/api/agents/photon/status`);
    if (res.ok) return await res.json();
  } catch {
    /* fallback to static json below */
  }
  const fallback = await fetch('/api/agents/photon/status.json');
  if (fallback.ok) return await fallback.json();
  return {
    provider: 'Photon local SMS command adapter',
    live_api_configured: false,
    webhook_secret_configured: false,
    allowlist_active: true,
    allowed_senders_count: 2,
    messages_processed_count: 0,
    channel: 'LOCAL_SIMULATION; optional authenticated Concord JSON webhook, not verified Photon compatibility',
    engine_scope: 'Concord synthetic portfolio computation',
    data_disclosure: 'Synthetic operations; no carrier delivery or validated clinical forecast.',
  };
}

export async function sendSimulatedSMS(body: string, sender: string = '+16175550199'): Promise<SMSResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/agents/photon/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, sender }),
    });
    if (res.ok) return await res.json();
  } catch {
    /* static fallback */
  }

  // Client-side simulation fallback when static hosting does not support live backend
  const cmd = body.trim().toUpperCase();
  let replyText = `CONCORD ACK: Received "${body}". Local simulation active; no carrier delivery.`;
  if (cmd === 'STATUS') {
    replyText = 'CONCORD STATUS: 2 trials active, 4 hospital sites enrolled. Operational load: 84% capacity. Simulation mode.';
  } else if (cmd === 'BUDGET') {
    replyText = 'CONCORD BUDGET: Target $3.0M ceiling; $1,133,866 committed across 4 active hospitals. Solvency: SAFE.';
  } else if (cmd === 'SITES') {
    replyText = 'CONCORD SITES: SYN-A (cap 4/mo), SYN-B (cap 4/mo), SYN-C (cap 3/mo), SYN-D (cap 2/mo). All online.';
  }

  return {
    request_id: `sms-${Date.now()}`,
    scenario_id: 'hackharvard-bundled-portfolio',
    provider_status: 'NOT_IMPLEMENTED',
    data_mode: 'SYNTHETIC_OPERATIONAL_ASSUMPTIONS',
    message_id: `sim-${Date.now()}`,
    status: 'LOCAL_SIMULATION',
    reply_text: replyText,
    sender,
    action_taken: 'SIMULATION_ACK',
    is_simulated_data: true,
    delivery_note: 'Local simulated response for demonstration purposes.',
  };
}

export async function runDroidAgent(trialId: string = 'NCT05800015', maxIterations: number = 3): Promise<DroidRecommendation> {
  try {
    const res = await fetch(`${API_BASE}/api/agents/droid/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trial_id: trialId, max_iterations: maxIterations }),
    });
    if (res.ok) return await res.json();
  } catch {
    /* static fallback */
  }

  try {
    const fallback = await fetch('/api/agents/droid/run.json');
    if (fallback.ok) return await fallback.json();
  } catch {
    /* ignore */
  }

  throw new Error('Droid proposal service unavailable');
}

export async function submitHumanReview(recommendationId: string, decision: 'APPROVED' | 'REJECTED', notes: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/agents/droid/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recommendation_id: recommendationId,
      decision,
      reviewer_notes: notes,
    }),
  });
  if (!res.ok) throw new Error(`Droid review HTTP ${res.status}`);
  return res.json();
}

export async function runChalkEvaluations(): Promise<ChalkEvaluationReport> {
  const res = await fetch(`${API_BASE}/api/evals/chalk/run`, { method: 'POST' });
  if (res.ok) return await res.json();
  if (res.status === 405 || res.status === 404) {
    try {
      const fallback = await fetch('/api/evals/chalk/run.json');
      if (fallback.ok) return await fallback.json();
    } catch {
      /* ignore */
    }
  }
  throw new Error(`Chalk run HTTP ${res.status}`);
}

export async function fetchLatestChalkReport(): Promise<ChalkEvaluationReport> {
  try {
    const res = await fetch(`${API_BASE}/api/evals/chalk/latest`);
    if (res.ok) return await res.json();
  } catch {
    /* static fallback */
  }
  try {
    const fallback = await fetch('/api/evals/chalk/latest.json');
    if (fallback.ok) return await fallback.json();
  } catch {
    /* ignore */
  }
  throw new Error('Chalk latest report unavailable');
}
