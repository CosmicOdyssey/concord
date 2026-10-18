/** Local proposal helper. The server enforces tool and clinical boundaries.
 * This client does not invoke Factory SDK or establish a sandbox. */

import { runDroidAgent, type DroidRecommendation } from './sponsorAgentsApi.ts';

export interface DroidSessionConfig {
  trialId: string;
  autonomyLevel: 'medium';
  maxIterations: number;
  allowedTools: string[];
}

export const DEFAULT_DROID_CONFIG: DroidSessionConfig = {
  trialId: 'NCT05800015',
  autonomyLevel: 'medium',
  maxIterations: 3,
  allowedTools: [
    'inspect_protocol',
    'identify_operational_bottlenecks',
    'simulate_operational_variant',
    'evaluate_with_chalk',
  ],
};

/**
 * Calls the bounded local Python proposal evaluator. No SDK inference or protocol mutation.
 */
export async function executeFactoryDroidSession(
  config: Partial<DroidSessionConfig> = {}
): Promise<DroidRecommendation> {
  const merged: DroidSessionConfig = { ...DEFAULT_DROID_CONFIG, ...config };
  
  // Invoke server-side local service running the evaluate-and-revise loop
  const recommendation = await runDroidAgent(merged.trialId, merged.maxIterations);
  return recommendation;
}
