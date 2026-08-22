import type { ConnectorContext } from '../modules/types.js';

function lookupTemplatePath(
  path: string,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): unknown {
  if (path.startsWith('trigger.')) {
    return ctx.variables[path.slice('trigger.'.length)];
  }
  if (!path.includes('.')) {
    if (path in ctx.variables) return ctx.variables[path];
    if (path in stepResults) return stepResults[path];
  }
  const [stepId, ...rest] = path.split('.');
  let current: unknown = stepResults[stepId];
  for (const key of rest) {
    if (Array.isArray(current)) {
      if (/^\d+$/.test(key)) {
        current = current[Number(key)];
        continue;
      }
      const item = current.find(
        (candidate) => candidate && typeof candidate === 'object' && key in (candidate as Record<string, unknown>),
      );
      if (item && typeof item === 'object') {
        current = (item as Record<string, unknown>)[key];
        continue;
      }
      if (key === 'messageId') {
        const message = current.find(
          (candidate) => candidate && typeof candidate === 'object' && 'id' in (candidate as Record<string, unknown>),
        );
        current = message && typeof message === 'object' ? (message as Record<string, unknown>).id : undefined;
        continue;
      }
      return undefined;
    }
    if (!current || typeof current !== 'object') return undefined;
    const record = current as Record<string, unknown>;
    current = key === 'messageId' && record[key] == null ? record.id : record[key];
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
