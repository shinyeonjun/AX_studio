import type { AxCommand } from '../schema.js';

export interface ReadParameterPlan {
  capabilityId: string;
  fixedParams: Record<string, unknown>;
  allowedParameterPaths: readonly string[];
  requiredParameterPaths: readonly string[];
}

export interface HttpReadPlan {
  connectionId: string;
}

type ReadParameterResult =
  | { ok: true; command: AxCommand }
  | { ok: false; error: 'read_capability_mismatch' | 'read_parameters_invalid' | 'read_parameters_missing'; missing?: string[] };

type HttpReadResult =
  | { ok: true; command: AxCommand }
  | { ok: false; error: 'http_read_capability_mismatch' | 'http_read_parameters_invalid' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function hasAllowedDescendant(path: string, allowed: Set<string>): boolean {
  for (const candidate of allowed) {
    if (candidate.startsWith(`${path}.`)) return true;
  }
  return false;
}

function mergeParams(
  fixed: Record<string, unknown>,
  supplied: Record<string, unknown>,
  allowed: Set<string>,
  prefix = '',
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  const merged: Record<string, unknown> = { ...fixed };
  for (const [key, value] of Object.entries(supplied)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const fixedValue = fixed[key];
    const isContainer = isRecord(value);
    if (!allowed.has(path) && !(isContainer && hasAllowedDescendant(path, allowed))) return { ok: false };
    if (!isContainer && fixedValue !== undefined && !sameValue(fixedValue, value)) return { ok: false };
    if (isContainer) {
      const base = isRecord(fixedValue) ? fixedValue : {};
      const nested = mergeParams(base, value, allowed, path);
      if (!nested.ok) return nested;
      merged[key] = nested.value;
    } else {
      merged[key] = value;
    }
  }
  return { ok: true, value: merged };
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Compiles the one LLM payload-fill turn into a host-owned read command.
 * Jev fixes the capability; the model can only supply declared parameter paths.
 */
export function compileReadParameterCommand(
  command: AxCommand,
  plan: ReadParameterPlan,
): ReadParameterResult {
  if (command.name !== 'capability.invoke' || command.args.id !== plan.capabilityId) {
    return { ok: false, error: 'read_capability_mismatch' };
  }
  const supplied = command.args.params;
  if (!isRecord(supplied)) return { ok: false, error: 'read_parameters_invalid' };

  const merged = mergeParams(plan.fixedParams, supplied, new Set(plan.allowedParameterPaths));
  if (!merged.ok) return { ok: false, error: 'read_parameters_invalid' };
  const missing = plan.requiredParameterPaths.filter((path) => {
    const value = readPath(merged.value, path);
    return value === undefined || value === null || value === '';
  });
  if (missing.length > 0) return { ok: false, error: 'read_parameters_missing', missing };
  return {
    ok: true,
    command: {
      name: 'capability.invoke',
      args: { id: plan.capabilityId, params: merged.value },
    },
  };
}

/**
 * Compiles the schema-less HTTP fallback into the one host-owned HTTP read.
 * The LLM may discover a relative path, but it cannot change the connection
 * or turn the read into another capability/method.
 */
export function compileHttpReadCommand(
  command: AxCommand,
  plan: HttpReadPlan,
): HttpReadResult {
  if (command.name !== 'capability.invoke' || command.args.id !== 'http.request') {
    return { ok: false, error: 'http_read_capability_mismatch' };
  }
  const params = command.args.params;
  if (!isRecord(params)) return { ok: false, error: 'http_read_parameters_invalid' };
  const method = typeof params.method === 'string' ? params.method.trim().toUpperCase() : 'GET';
  const path = typeof params.path === 'string' ? params.path.trim() : '';
  const connectionId = typeof params.connectionId === 'string' ? params.connectionId.trim() : '';
  if ((method !== 'GET' && method !== 'HEAD') || connectionId !== plan.connectionId || !path
    || path.length > 2_048 || path.startsWith('//')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || /[\s"'`<>]/u.test(path)) {
    return { ok: false, error: 'http_read_parameters_invalid' };
  }
  return {
    ok: true,
    command: {
      name: 'capability.invoke',
      args: {
        id: 'http.request',
        params: { method, path, connectionId: plan.connectionId },
      },
    },
  };
}
