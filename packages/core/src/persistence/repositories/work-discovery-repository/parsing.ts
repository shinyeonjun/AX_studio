import {
  DiscoverySessionStateSchema,
  type DiscoverySessionState,
} from '../../../work-discovery/schema.js';

export function parseDiscoverySessionState(stateJson: string, sessionId: string): DiscoverySessionState {
  let raw: unknown;
  try {
    raw = JSON.parse(stateJson);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`work discovery session ${sessionId} state is corrupted: ${detail}`), {
      code: 'invalid_discovery_session_json',
      sessionId,
    });
  }

  const parsed = DiscoverySessionStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(new Error(`work discovery session ${sessionId} state has an invalid shape`), {
      code: 'invalid_discovery_session_state',
      sessionId,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function parseArtifactIds(raw: unknown, exampleId: string, field: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(String(raw));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`work discovery example ${exampleId} ${field} is corrupted: ${detail}`), {
      code: 'invalid_discovery_example_json',
      exampleId,
      field,
    });
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw Object.assign(new Error(`work discovery example ${exampleId} ${field} has an invalid shape`), {
      code: 'invalid_discovery_example_artifact_ids',
      exampleId,
      field,
    });
  }
  return value;
}
