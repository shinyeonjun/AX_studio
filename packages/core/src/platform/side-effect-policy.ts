import type { SideEffectLevel } from '../workflow/schema.js';
import { requiresApproval } from '../workflow/approval.js';

export function isPlainChatSideEffectAllowed(sideEffect: SideEffectLevel | undefined): boolean {
  const level = sideEffect ?? 'NONE';
  return level === 'NONE' || level === 'REVERSIBLE';
}

export function sideEffectRequiresApproval(
  sideEffect: SideEffectLevel,
  allowExternalAuto: boolean,
): boolean {
  return requiresApproval(sideEffect, allowExternalAuto);
}

/** HTTP ingest default only — catalog manifest overrides at registration time. */
export function defaultSideEffectForHttpMethod(method: string): SideEffectLevel {
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD' ? 'NONE' : 'EXTERNAL';
}
