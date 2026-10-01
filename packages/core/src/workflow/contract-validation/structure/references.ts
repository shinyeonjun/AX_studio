import type { Step } from '../../schema.js';
import { decisionOutputProperties, decisionRequiredFields } from '../../ai-output-contract.js';

export function referencePaths(value: unknown): string[] {
  if (typeof value === 'string') {
    return [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]!.trim());
  }
  if (Array.isArray(value)) return value.flatMap(referencePaths);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 1 && typeof record.ref === 'string') return [record.ref.trim()];
  return Object.values(record).flatMap(referencePaths);
}

export function conditionReferencePaths(condition: unknown): string[] {
  if (!condition || typeof condition !== 'object') return [];
  const record = condition as Record<string, unknown>;
  if (record.op === 'and' || record.op === 'or') {
    return Array.isArray(record.args) ? record.args.flatMap(conditionReferencePaths) : [];
  }
  if (record.op === 'not') return conditionReferencePaths(record.arg);
  return [record.left, record.right].flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const ref = (value as Record<string, unknown>).ref;
    return typeof ref === 'string' ? [ref] : [];
  });
}

export function outputFieldExists(step: Extract<Step, { type: 'ai_decision' }>, field: string): boolean {
  return Object.hasOwn(decisionOutputProperties(step), field);
}

export function outputFieldIsRequired(step: Extract<Step, { type: 'ai_decision' }>, field: string): boolean {
  return decisionRequiredFields(step).includes(field);
}
