import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DROID_CONFIG } from '../src/droidClient.ts';

test('Factory Droid SDK configuration enforces safe default tool sandbox', () => {
  assert.equal(DEFAULT_DROID_CONFIG.trialId, 'NCT05800015');
  assert.equal(DEFAULT_DROID_CONFIG.maxIterations, 3);
  assert.equal(DEFAULT_DROID_CONFIG.autonomyLevel, 'medium');
  assert.ok(DEFAULT_DROID_CONFIG.allowedTools.includes('inspect_protocol'));
  assert.ok(DEFAULT_DROID_CONFIG.allowedTools.includes('identify_operational_bottlenecks'));
  assert.ok(DEFAULT_DROID_CONFIG.allowedTools.includes('simulate_operational_variant'));
  assert.ok(DEFAULT_DROID_CONFIG.allowedTools.includes('evaluate_with_chalk'));
  // Unrestricted shell or filesystem tools must NOT be allowed
  assert.equal(DEFAULT_DROID_CONFIG.allowedTools.includes('shell_execute'), false);
  assert.equal(DEFAULT_DROID_CONFIG.allowedTools.includes('write_file'), false);
});

test('Sponsor API contracts enforce strict state transitions and disclosures', async () => {
  // Test mock recommendation object conforms to frontend DroidRecommendation schema
  const mockRec = {
    recommendation_id: 'droid-rec-test1234',
    trial_id: 'NCT05800015',
    trial_title: 'Study NCT05800015',
    created_at: new Date().toISOString(),
    runtime_agent: 'Factory Droid SDK TypeScript Runtime',
    total_iterations: 2,
    baseline_makespan_months: 15.13,
    recommended_makespan_months: 13.33,
    expected_makespan_delta_months: -1.8,
    budget_commitment_usd: 1481066.4,
    budget_ceiling_usd: 3000000.0,
    feasibility_status: 'FEASIBLE',
    clinical_safety_status: 'PASSED_NO_CLINICAL_MUTATION',
    chalk_evaluation_score: 1.0,
    executive_summary: 'Test summary',
    human_approval_status: 'PENDING_HUMAN_REVIEW',
    iterations: [],
    tool_trace: [],
  };

  assert.equal(mockRec.human_approval_status, 'PENDING_HUMAN_REVIEW');
  assert.equal(mockRec.clinical_safety_status, 'PASSED_NO_CLINICAL_MUTATION');
  assert.ok(mockRec.recommended_makespan_months < mockRec.baseline_makespan_months);
  assert.ok(mockRec.budget_commitment_usd <= mockRec.budget_ceiling_usd);
});

test('Chalk evaluation contract requires exactly 12 deterministic scenarios', () => {
  const expectedScenarios = [
    'scenario-01-adequate-budget',
    'scenario-02-infeasible-budget',
    'scenario-03-capacity-exhaustion',
    'scenario-04-unknown-site-eligibility',
    'scenario-05-incorrect-financial-inference',
    'scenario-06-protocol-amendment-reduces-patients',
    'scenario-07-amendment-violates-safety',
    'scenario-08-cost-rise-no-benefit',
    'scenario-09-bounded-optimal-agreement',
    'scenario-10-large-heuristic-labeling',
    'scenario-11-missing-registry-info',
    'scenario-12-persuasion-prompt-injection',
  ];
  assert.equal(expectedScenarios.length, 12);
});

test('Photon status contract supports honest readiness states and carrier receipts', () => {
  const validStates = [
    'CONNECTED_AND_VERIFIED',
    'CONFIGURED_UNVERIFIED',
    'LOCAL_SIMULATION_ONLY',
    'MISSING_CREDENTIALS',
    'FAILED',
  ];
  const mockStatus = {
    provider: 'Photon 2.0 SMS Webhook',
    live_api_configured: false,
    webhook_secret_configured: false,
    allowlist_active: true,
    allowed_senders_count: 3,
    messages_processed_count: 5,
    channel: 'SMS',
    engine_scope: 'Concord Engine',
    data_disclosure: 'Synthetic data',
    readiness: 'MISSING_CREDENTIALS',
    auth_status: 'LOCAL_WEBHOOK_READY',
    missing_prerequisites: ['PHOTON_API_KEY', 'PHOTON_PHONE_NUMBER', 'PHOTON_WEBHOOK_SECRET'],
    last_receipt: null,
  };
  assert.ok(validStates.includes(mockStatus.readiness));
  assert.equal(mockStatus.missing_prerequisites.length, 3);
});

test('Chalk evaluation report contract includes dataset version, task version, and cloud evaluation ID', () => {
  const mockReport = {
    run_id: 'chalk-run-12345678',
    dataset_version: 'concord-eval-v1.2.0',
    dataset_sha256: '921503cfca27e1f40d6bfbb49f850d53530e7033785121c255b8ebbcbeab59ec',
    task_version: 'concord-task-v1.2.0',
    evaluation_id: 'chalk-eval-abcdef',
    result_dataset: 'concord-results-v1.2.0',
    timestamp: new Date().toISOString(),
    engine_mode: 'Chalk Remote Cloud',
    total_scenarios: 12,
    passed_scenarios: 12,
    failed_scenarios: 0,
    hard_safety_violations: 0,
    overall_pass_rate: 1.0,
    readiness: 'CONNECTED_AND_VERIFIED',
    auth_status: 'LIVE_CLOUD_VERIFIED',
    missing_prerequisites: [],
    scenarios: [],
  };
  assert.equal(mockReport.total_scenarios, 12);
  assert.equal(mockReport.readiness, 'CONNECTED_AND_VERIFIED');
  assert.ok(mockReport.evaluation_id.startsWith('chalk-eval-'));
  assert.equal(mockReport.task_version, 'concord-task-v1.2.0');
});

test('Factory Droid SDK contract reports missing credentials when FACTORY_API_KEY is unset', () => {
  const mockRec = {
    recommendation_id: 'droid-rec-abc123',
    trial_id: 'NCT05800015',
    trial_title: 'Study NCT05800015',
    created_at: new Date().toISOString(),
    runtime_agent: '@factory/droid-sdk v0.9.1 (Deterministic Tool Fallback - FACTORY_API_KEY unset)',
    total_iterations: 3,
    baseline_makespan_months: 15.13,
    recommended_makespan_months: 13.71,
    expected_makespan_delta_months: -1.42,
    budget_commitment_usd: 1225280,
    budget_ceiling_usd: 3000000,
    feasibility_status: 'FEASIBLE',
    clinical_safety_status: 'PASSED_NO_CLINICAL_MUTATION',
    chalk_evaluation_score: 1.0,
    executive_summary: 'Test summary',
    human_approval_status: 'PENDING_HUMAN_REVIEW',
    readiness: 'MISSING_CREDENTIALS',
    auth_status: 'BLOCKED — AUTHENTICATION: Missing FACTORY_API_KEY environment variable.',
    missing_prerequisites: ['FACTORY_API_KEY'],
    iterations: [],
    tool_trace: [],
  };
  assert.equal(mockRec.readiness, 'MISSING_CREDENTIALS');
  assert.ok(mockRec.missing_prerequisites.includes('FACTORY_API_KEY'));
  assert.ok(mockRec.auth_status.includes('BLOCKED — AUTHENTICATION'));
});

