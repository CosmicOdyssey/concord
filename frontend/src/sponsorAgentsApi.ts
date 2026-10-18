/**
 * API client for Concord Sponsor Integrations: Photon, Chalk, and Factory Droid.
 */

export interface SMSResponse {
  request_id: string;
  scenario_id: string;
  provider_status: string;
  data_mode: string;
  message_id: string;
  status: 'LOCAL_SIMULATION' | 'UNAUTHORIZED' | 'DUPLICATE' | 'ERROR' | 'ACCEPTED' | 'DELIVERY_UNKNOWN';
  reply_text: string;
  sender: string;
  action_taken: string;
  is_simulated_data: boolean;
  real_engine_data?: Record<string, any>;
  delivery_note: string;
  delivery_mode?: string;
  provider_message_id?: string | null;
  dispatched_at?: string | null;
  runtime_receipt?: Record<string, unknown> | null;
}

export interface ProviderReadiness {
  readiness: string;
  provider_status: string;
  auth_status: string;
  missing_prerequisites: string[];
  outbound_enabled?: boolean;
  live_execution_enabled?: boolean;
  remote_execution_enabled?: boolean;
  remote_requirements?: string[];
  execution_disclosure?: string;
  local_scenarios?: number;
}
export interface PhotonStatus extends ProviderReadiness {
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
  execution_mode?: string;
  provider_status?: string;
  disposition?: string;
  runtime_receipt?: {session_id?: string; status?: string; duration_ms?: number; turn_count?: number; token_usage?: unknown} | null;
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
async function readiness<T extends ProviderReadiness>(path: string): Promise<T> {
  const result = await backend<T>(path)
  if (typeof result.readiness !== 'string' || typeof result.provider_status !== 'string' || typeof result.auth_status !== 'string' || !Array.isArray(result.missing_prerequisites) || !result.missing_prerequisites.every(value => typeof value === 'string')) {
    throw new Error(`${path} returned incomplete readiness; provider connection is UNKNOWN`)
  }
  return result
}
export function fetchPhotonStatus(): Promise<PhotonStatus> {
  return readiness('/api/agents/photon/status')
}
export function fetchDroidStatus(): Promise<ProviderReadiness> {
  return readiness('/api/agents/droid/status')
}
export function fetchChalkStatus(): Promise<ProviderReadiness> {
  return readiness('/api/evals/chalk/status')
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


export interface RemoteChalkReport {
  provider_status: string; execution_mode: string; auth_status: string; readiness: string;
  dataset_version: string; dataset_sha256: string; evaluation_id: string; run_id: string;
  run_status: string; recorded_at: string; row_count: number; passed_scenarios: number;
  failed_scenarios: number; complete_and_passing: boolean; row_errors: unknown[];
  rows: Record<string, unknown>[];
}
function operatorHeaders(token: string, confirmed: boolean): Record<string, string> {
  if (!confirmed) throw new Error('Explicit remote-action confirmation is required')
  if (!token.trim()) throw new Error('Operator token is required; no provider request was made')
  if (!/^[\x20-\x7e]+$/.test(token)) throw new Error('Operator token must contain printable ASCII only; no provider request was made')
  return {'Content-Type': 'application/json', 'X-Concord-Operator-Token': token}
}
/** One explicit request; never retry a possibly accepted send automatically. */
export async function sendLivePhoton(options: {body: string; messageId: string; operatorToken: string; confirmLive: boolean}): Promise<SMSResponse> {
  const headers = operatorHeaders(options.operatorToken, options.confirmLive)
  if (!options.messageId || options.messageId.length > 128) throw new Error('A stable message ID is required')
  const result = await backend<SMSResponse>('/api/agents/photon/send', {method: 'POST', headers,
    body: JSON.stringify({body: options.body, sender: '+16175550199', message_id: options.messageId, confirm_live: true})})
  if (result.delivery_mode !== 'PHOTON_API' || !result.runtime_receipt || !['ACCEPTED', 'DELIVERY_UNKNOWN'].includes(result.status) || (result.status === 'ACCEPTED' && !result.provider_message_id)) throw new Error('Photon did not return a valid provider send receipt; delivery remains UNKNOWN')
  return result
}
export async function runLiveDroidAgent(operatorToken: string, confirmLive: boolean): Promise<DroidRecommendation> {
  const result = await backend<DroidRecommendation>('/api/agents/droid/run', {method: 'POST', headers: operatorHeaders(operatorToken, confirmLive),
    body: JSON.stringify({trial_id: 'NCT05800015', max_iterations: 3, execution_mode: 'LIVE_FACTORY'})})
  if (result.execution_mode !== 'LIVE_FACTORY_PROPOSAL_LOCAL_ENGINE_VALIDATION' || result.provider_status !== 'EXECUTED' || result.runtime_receipt?.status !== 'SUCCEEDED' || !result.runtime_receipt.session_id || result.human_approval_status !== 'PENDING_HUMAN_REVIEW') throw new Error('Factory runtime receipt is missing or invalid; no live proposal execution is claimed')
  return result
}
export async function runRemoteChalk(operatorToken: string, confirmLive: boolean): Promise<RemoteChalkReport> {
  const result = await backend<RemoteChalkReport>('/api/evals/chalk/remote-run', {method: 'POST', headers: operatorHeaders(operatorToken, confirmLive), body: JSON.stringify({confirm_live: true})})
  if (result.execution_mode !== 'REMOTE_CHALK_COMPUTE' || result.provider_status !== 'EXECUTED' || !result.evaluation_id || !result.run_id || !Array.isArray(result.rows) || typeof result.complete_and_passing !== 'boolean') throw new Error('Chalk remote result dataset receipt is missing or invalid; local results have not been substituted')
  return result
}
export function remoteChalkComplete(report: RemoteChalkReport): boolean {
  return report.complete_and_passing === true && report.row_count === 15 && report.rows.length === 15 && report.passed_scenarios === 15 && report.failed_scenarios === 0 && Array.isArray(report.row_errors) && report.row_errors.length === 0
}
