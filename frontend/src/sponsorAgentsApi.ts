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

/** Never turn a transport/auth/provider failure into a fixture success. */
async function backend<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: 'no-store' })
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}; backend action failed. No saved or synthetic response has been substituted.`)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`${path} returned an invalid backend response`)
  const envelope = body as Record<string, unknown>
  if (envelope.artifact_disclosure || envelope.delivery_mode === 'ARTIFACT_REPLAY' || envelope.delivery_mode === 'SAVED_RESULT_REPLAY') {
    throw new Error(`${path} returned archived evidence, not a new backend action. Explicit replay is not supported for sponsor actions.`)
  }
  return body as T
}
export function fetchPhotonStatus(): Promise<PhotonStatus> {
  return backend('/api/agents/photon/status')
}
export function sendSimulatedSMS(body: string, sender: string = '+16175550199'): Promise<SMSResponse> {
  return backend('/api/agents/photon/simulate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, sender }),
  })
}
export function runDroidAgent(trialId: string = 'NCT05800015', maxIterations: number = 3): Promise<DroidRecommendation> {
  return backend('/api/agents/droid/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trial_id: trialId, max_iterations: maxIterations }),
  })
}
export function submitHumanReview(recommendationId: string, decision: 'APPROVED' | 'REJECTED', notes: string): Promise<unknown> {
  return backend('/api/agents/droid/review', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recommendation_id: recommendationId, decision, reviewer_notes: notes }),
  })
}
export function runChalkEvaluations(): Promise<ChalkEvaluationReport> {
  return backend('/api/evals/chalk/run', { method: 'POST' })
}
export function fetchLatestChalkReport(): Promise<ChalkEvaluationReport> {
  return backend('/api/evals/chalk/latest')
}
