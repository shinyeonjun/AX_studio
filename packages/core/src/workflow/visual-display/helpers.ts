import type { ConnectorCapability } from '../../catalog/capabilities.js';
import type { CompletenessResult } from '../../interview/slots/requiredness.js';
import type { WorkflowVisualLine } from './types.js';

export function truncate(text: string, max = 28): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function slotFilled(slots: CompletenessResult['slots'] | undefined, slotId: string): boolean {
  return slots?.find((slot) => slot.slot === slotId)?.filled ?? false;
}

export function paramValue(params: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = params?.[name];
  return typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : undefined;
}

export function paramLine(
  capId: string,
  paramName: string,
  label: string,
  value: string | undefined,
  slots: CompletenessResult['slots'] | undefined,
): WorkflowVisualLine {
  const slotId = `${capId}.${paramName}`;
  const filled = Boolean(value) || slotFilled(slots, slotId);
  return {
    text: value ? `${label}: ${value}` : `${label}: ?`,
    complete: filled,
  };
}

export function primaryParamValue(
  cap: ConnectorCapability,
  values: Record<string, unknown> | undefined,
): string | undefined {
  for (const param of cap.params) {
    const value = paramValue(values, param.name);
    if (value) return value;
  }
  return undefined;
}

export function summaryFromGoalOrCapability(
  goal: string | undefined,
  cap: ConnectorCapability | undefined,
  params?: Record<string, unknown>,
  max = 28,
): string {
  const goalText = goal?.trim();
  if (goalText) return truncate(goalText, max);
  const paramText = cap ? primaryParamValue(cap, params) : undefined;
  if (paramText) return truncate(paramText, max);
  if (cap?.label) return truncate(cap.label, max);
  return '설정 필요';
}

export function triggerLines(
  cap: ConnectorCapability | undefined,
  values: Record<string, string | undefined>,
  slots: CompletenessResult['slots'] | undefined,
): WorkflowVisualLine[] {
  if (!cap) return [];
  return cap.params.map((param) =>
    paramLine(cap.id, param.name, param.label, values[param.name], slots),
  );
}
