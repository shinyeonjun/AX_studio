import type { JevReadOperationHint } from '../../../../decision/read-operation-catalog.js';
import { AxCapabilityInvokeArgsSchema, type AxCommand } from '../../schema.js';
import { explicitHttpPath } from '../shared/jev-http-endpoint.js';

export interface ChatReadAuthorization {
  capabilityId: string;
  params: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/** Flatten plain-object params into dotted leaf paths; arrays and scalars are leaves. */
function leaves(value: Record<string, unknown>, prefix = ''): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(entry)) {
      for (const [nested, leaf] of leaves(entry, path)) result.set(nested, leaf);
    } else {
      result.set(path, entry);
    }
  }
  return result;
}

/** Split an HTTP path into its base and query leaves (`query.<name>`). */
function httpPathLeaves(params: Map<string, unknown>): Map<string, unknown> | undefined {
  const rawPath = params.get('path');
  if (typeof rawPath !== 'string') return params;
  const [pathAndQuery] = rawPath.split('#', 1);
  const queryStart = pathAndQuery!.indexOf('?');
  const result = new Map(params);
  result.set('path', queryStart < 0 ? pathAndQuery : pathAndQuery!.slice(0, queryStart));
  if (queryStart >= 0) {
    for (const [name, value] of new URLSearchParams(pathAndQuery!.slice(queryStart + 1))) {
      const key = `query.${name}`;
      if (result.has(key) && result.get(key) !== value) return undefined;
      result.set(key, value);
    }
  }
  return result;
}

function normalizedLeaves(hint: { connector: string }, params: Record<string, unknown>): Map<string, unknown> | undefined {
  const flat = leaves(params);
  if (hint.connector !== 'http') return flat;
  const split = httpPathLeaves(flat);
  if (!split) return undefined;
  // Query values compiled into a path are strings; compare them as strings.
  for (const [key, value] of split) {
    if (key.startsWith('query.') && (typeof value === 'number' || typeof value === 'boolean')) split.set(key, String(value));
  }
  return split;
}

/**
 * True when the command's params are the hint's host-resolved params plus only the
 * schema-declared parameter paths the hint lets Jev or the user fill.
 */
function commandMatchesHint(hint: JevReadOperationHint, params: Record<string, unknown>): boolean {
  const expected = normalizedLeaves(hint, hint.params);
  const actual = normalizedLeaves(hint, params);
  if (!expected || !actual) return false;
  const fillable = new Set((hint.parameterHints ?? []).map(({ path }) => path));
  for (const [path, value] of expected) {
    if (!actual.has(path) || !sameJson(actual.get(path), value)) return false;
  }
  for (const path of actual.keys()) {
    if (!expected.has(path) && !fillable.has(path)) return false;
  }
  return true;
}

/**
 * Issue a read authorization only for a capability read that the host can trace to
 * a cataloged operation hint, or to an HTTP GET/HEAD path the user typed explicitly.
 * A command that merely names itself is never authorized by its own params.
 */
export function chatReadAuthorizationFor(
  command: AxCommand,
  evidence: { hints?: readonly JevReadOperationHint[]; userText?: string },
): ChatReadAuthorization | undefined {
  if (command.name !== 'capability.invoke') return undefined;
  const parsed = AxCapabilityInvokeArgsSchema.safeParse(command.args);
  if (!parsed.success) return undefined;
  const authorization = { capabilityId: parsed.data.id, params: parsed.data.params };
  if (parsed.data.id === 'http.request' && evidence.userText) {
    const method = String(parsed.data.params.method ?? 'GET').toUpperCase();
    const typedPath = explicitHttpPath(evidence.userText);
    const commandPath = typeof parsed.data.params.path === 'string' ? parsed.data.params.path.split('?', 1)[0] : undefined;
    if ((method === 'GET' || method === 'HEAD') && typedPath && commandPath !== undefined
      && commandPath === typedPath.split('?', 1)[0]) {
      return authorization;
    }
  }
  const matched = (evidence.hints ?? []).some((hint) =>
    hint.capabilityId === parsed.data.id && commandMatchesHint(hint, parsed.data.params));
  return matched ? authorization : undefined;
}
