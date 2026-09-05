import type { ConnectorContext } from '../modules/types.js';

function lookupTemplatePath(
  path: string,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): unknown {
  if (path.startsWith('trigger.')) {
    const key = path.slice('trigger.'.length);
    return Object.hasOwn(ctx.variables, key) ? ctx.variables[key] : undefined;
  }
  if (!path.includes('.')) {
    if (Object.hasOwn(ctx.variables, path)) return ctx.variables[path];
    if (Object.hasOwn(stepResults, path)) return stepResults[path];
  }
  const [stepId, ...rest] = path.split('.');
  let current: unknown;
  const [outputPort, ...nestedPath] = rest;
  const typedOutput = outputPort && ctx.outputs?.[stepId]?.[outputPort];
  if (typedOutput !== undefined) {
    current = typedOutput;
    for (const key of nestedPath) {
      if (Array.isArray(current)) {
        if (/^\d+$/.test(key)) {
          current = current[Number(key)];
          continue;
        }
        const item = current.find(
          (candidate) => candidate && typeof candidate === 'object'
            && Object.hasOwn(candidate as Record<string, unknown>, key),
        );
        current = item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined;
        continue;
      }
      if (!current || typeof current !== 'object') return undefined;
      current = Object.hasOwn(current as Record<string, unknown>, key)
        ? (current as Record<string, unknown>)[key]
        : undefined;
    }
    return current;
  }

  current = Object.hasOwn(stepResults, stepId) ? stepResults[stepId] : undefined;
  for (const key of rest) {
    if (Array.isArray(current)) {
      if (/^\d+$/.test(key)) {
        current = current[Number(key)];
        continue;
      }
      const item = current.find(
        (candidate) => candidate && typeof candidate === 'object'
          && Object.hasOwn(candidate as Record<string, unknown>, key),
      );
      if (item && typeof item === 'object') {
        current = (item as Record<string, unknown>)[key];
        continue;
      }
      if (key === 'messageId') {
        const message = current.find(
          (candidate) => candidate && typeof candidate === 'object'
            && Object.hasOwn(candidate as Record<string, unknown>, 'id'),
        );
        current = message && typeof message === 'object' ? (message as Record<string, unknown>).id : undefined;
        continue;
      }
      return undefined;
    }
    if (!current || typeof current !== 'object') return undefined;
    const record = current as Record<string, unknown>;
    const value = Object.hasOwn(record, key) ? record[key] : undefined;
    current = key === 'messageId' && value == null && Object.hasOwn(record, 'id') ? record.id : value;
  }
  return current;
}

function interpolateTemplates(
  value: string,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_all, rawPath: string) => {
    const reference = rawPath.trim();
    const resolved = lookupTemplatePath(reference, ctx, stepResults);
    if (resolved == null) {
      throw Object.assign(new Error(`워크플로우 참조를 해석할 수 없습니다: ${reference}`), {
        code: 'unresolved_binding',
        reference,
      });
    }
    return String(resolved);
  });
}

function resolveParamValue(
  value: unknown,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    if (exact) {
      const path = exact[1]!.trim();
      const resolved = lookupTemplatePath(path, ctx, stepResults);
      if (resolved == null) {
        throw Object.assign(new Error(`워크플로우 참조를 해석할 수 없습니다: ${path}`), {
          code: 'unresolved_binding',
          reference: path,
        });
      }
      return resolved;
    }
    return interpolateTemplates(value, ctx, stepResults);
  }
  if (Array.isArray(value)) return value.map((item) => resolveParamValue(item, ctx, stepResults));
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 1 && typeof record.ref === 'string') {
    const reference = record.ref.trim();
    const resolved = lookupTemplatePath(reference, ctx, stepResults);
    if (resolved == null) {
      throw Object.assign(new Error(`워크플로우 참조를 해석할 수 없습니다: ${reference}`), {
        code: 'unresolved_binding',
        reference,
      });
    }
    return resolved;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, resolveParamValue(item, ctx, stepResults)]),
  );
}

/** Resolve explicit workflow templates immediately before a connector call. */
export function resolveStepParams(
  params: Record<string, unknown>,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = resolveParamValue(value, ctx, stepResults);
  }
  return resolved;
}
