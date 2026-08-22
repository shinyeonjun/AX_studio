import type { SideEffectLevel } from '../workflow/schema.js';
import { defaultSideEffectForHttpMethod } from '../platform/side-effect-policy.js';
import type { ActionDefinition } from './action-definition.js';

/** Runtime side-effect when catalog entry omits a fixed level (e.g. http.request by method). */
export function resolveEffectiveSideEffect(
  definition: ActionDefinition,
  params: Record<string, unknown>,
  stepSideEffect?: SideEffectLevel,
): SideEffectLevel {
  if (definition.sideEffect) return definition.sideEffect;
  if (definition.id === 'http.request') {
    const method = typeof params.method === 'string' ? params.method : 'GET';
    return defaultSideEffectForHttpMethod(method);
  }
  return stepSideEffect ?? 'NONE';
}
