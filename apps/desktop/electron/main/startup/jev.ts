import { createExperimentalJevDecisionEngineFromEnvironment, JevDecisionEngine, JevDecisionError, type DecisionEngine } from '@ax-studio/core';

interface JevStartupSettings {
  enabled?: boolean;
  model?: string;
  baseURL?: string;
}

/** Receives settings from the startup owner; never loads secrets itself. */
export function createStartupJevDecisionEngine(
  settings: JevStartupSettings | undefined,
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void = console.warn,
): DecisionEngine | undefined {
  try {
    const apiKey = env.TYPESAFE_API_KEY;
    return settings?.enabled && apiKey
      ? new JevDecisionEngine({ apiKey, model: settings.model?.trim() || undefined, baseURL: settings.baseURL?.trim() || undefined })
      : createExperimentalJevDecisionEngineFromEnvironment(env);
  } catch (error) {
    if (!(error instanceof JevDecisionError)) throw error;
    warn('[AX Studio] Jev is disabled because its API key or Base URL is invalid. Update Jev settings to retry.');
    return undefined;
  }
}
