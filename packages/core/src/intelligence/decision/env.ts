import type { DecisionEngine } from '../../contracts/decision.js';
import { JevDecisionEngine } from './jev.js';

export const JEV_EXPERIMENT_FLAG = 'AX_EXPERIMENT_JEV_DECISION_PLANE';

/**
 * Developer-only opt-in used by the Jev experiment branch.
 *
 * TypeSafe credentials stay outside committed files. These environment names
 * mirror the official TypeSafe SDK so switching transports later does not
 * require another configuration migration.
 */
export function createExperimentalJevDecisionEngineFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): DecisionEngine | undefined {
  if (env[JEV_EXPERIMENT_FLAG] !== '1') return undefined;
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(`${JEV_EXPERIMENT_FLAG}=1 requires TYPESAFE_API_KEY.`);
  }

  // JevDecisionEngine currently stores the versioned API prefix in baseURL,
  // while the official TypeSafe SDK exposes TYPESAFE_BASE_URL as the API root.
  const apiRoot = env.TYPESAFE_BASE_URL?.trim().replace(/\/+$/, '');
  return new JevDecisionEngine({
    apiKey,
    model: env.TYPESAFE_DEFAULT_MODEL?.trim() || undefined,
    baseURL: apiRoot ? `${apiRoot}/v1` : undefined,
  });
}
