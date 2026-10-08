import { createExperimentalJevDecisionEngineFromEnvironment, JEV_DEFAULT_BASE_URL, JevDecisionEngine, JevDecisionError, resolveJevModel, type DecisionEngine } from '@ax-studio/core';

interface JevStartupSettings {
  enabled?: boolean;
  model?: string;
  baseURL?: string;
  /** Origin the stored API key was entered for (see ipc/ai-handlers/decision-plane.ts). */
  keyOrigin?: string;
}


function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * A stored key is bound to the origin it was entered for. Keys saved before origin
 * binding (no keyOrigin) are bound to the Base URL they were saved with, so they match.
 */
function keyOriginMatches(settings: JevStartupSettings): boolean {
  const target = originOf(settings.baseURL?.trim() || JEV_DEFAULT_BASE_URL);
  if (!target) return false;
  const keyOrigin = settings.keyOrigin?.trim();
  return !keyOrigin || keyOrigin === target;
}

/** Receives settings from the startup owner; never loads secrets itself. */
export function createStartupJevDecisionEngine(
  settings: JevStartupSettings | undefined,
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void = console.warn,
): DecisionEngine | undefined {
  try {
    const apiKey = env.TYPESAFE_API_KEY;
    if (settings?.enabled && apiKey) {
      if (!keyOriginMatches(settings)) {
        // Never send the key to an origin it was not entered for (e.g. a hand-edited ai.toml).
        warn('[AX Studio] Jev is disabled because its Base URL differs from the address the API key was registered for. Re-enter the API key in Jev settings.');
        return undefined;
      }
      return new JevDecisionEngine({ apiKey, model: resolveJevModel(settings.model), baseURL: settings.baseURL?.trim() || undefined });
    }
    return createExperimentalJevDecisionEngineFromEnvironment(env);
  } catch (error) {
    if (!(error instanceof JevDecisionError)) throw error;
    warn('[AX Studio] Jev is disabled because its API key or Base URL is invalid. Update Jev settings to retry.');
    return undefined;
  }
}
