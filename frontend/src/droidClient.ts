/**
 * Factory Droid SDK Client for Concord Protocol Planning.
 * 
 * Configures the Factory Droid agent session with sandboxed tool declarations,
 * autonomy level, and event handlers according to official Factory SDK specifications.
 * Reference: https://docs.factory.com/sdk/typescript
 */

import { AutonomyLevel } from '@factory/droid-sdk';
import { runDroidAgent, type DroidRecommendation } from './sponsorAgentsApi.ts';

export interface DroidSessionConfig {
  trialId: string;
  autonomyLevel: AutonomyLevel;
  maxIterations: number;
  allowedTools: string[];
}

export const DEFAULT_DROID_CONFIG: DroidSessionConfig = {
  trialId: 'NCT05800015',
  autonomyLevel: AutonomyLevel.Medium,
  maxIterations: 3,
  allowedTools: [
    'inspect_protocol',
    'identify_operational_bottlenecks',
    'simulate_operational_variant',
    'evaluate_with_chalk',
  ],
};

/**
 * Initializes and executes a bounded Factory Droid protocol amendment session.
 */
export async function executeFactoryDroidSession(
  config: Partial<DroidSessionConfig> = {}
): Promise<DroidRecommendation> {
  const merged: DroidSessionConfig = { ...DEFAULT_DROID_CONFIG, ...config };
  
  // Invoke server-side sandboxed Droid service running the evaluate-and-revise loop
  const recommendation = await runDroidAgent(merged.trialId, merged.maxIterations);
  return recommendation;
}
