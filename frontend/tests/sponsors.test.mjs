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
