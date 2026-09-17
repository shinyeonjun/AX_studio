import type { DecisionEngine } from '../../contracts/decision.js';
import { JevDecisionEngine } from './jev.js';

export const JEV_EXPERIMENT_FLAG = 'AX_EXPERIMENT_JEV_DECISION_PLANE';

/**
 * Developer-only opt-in used by the Jev experiment branch.
 *
 * Do not put TypeSafe keys in a committed file. Production wiring should resolve
 * the key through AX Studio's credential store and inject a DecisionEngine.
 */
export function createExperimentalJevDecisionEngineFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): DecisionEngine | undefined {
  if (env[JEV_EXPERIMENT_FLAG] !== '1') return undefined;
  const apiKey = env.TYPESAFE_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(`${JEV_EXPERIMENT_FLAG}=1 requires TYPESAFE_AI_API_KEY.`);
  }
  return new JevDecisionEngine({
    apiKey,
    model: env.TYPESAFE_AI_MODEL?.trim() || undefined,
    baseURL: env.TYPESAFE_AI_BASE_URL?.trim() || undefined,
  });
}
