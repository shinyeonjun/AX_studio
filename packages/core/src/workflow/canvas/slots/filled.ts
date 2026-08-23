import type { Step } from '../../../workflow/schema.js';
import type { PortBinding } from '../../../workflow/bindings.js';
import { documentIngestPathSatisfied } from '../../../workflow/ingest-source.js';

export function isActionParamFilled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if ('ref' in record && typeof record.ref === 'string' && record.ref.trim()) return true;
  if ('path' in record && typeof record.path === 'string' && record.path.trim()) return true;
  const file = record.file;
  if (file && typeof file === 'object' && !Array.isArray(file) && typeof (file as Record<string, unknown>).path === 'string') return true;
  return Object.keys(record).length > 0;
}
export function isActionParamBound(binding: PortBinding | undefined): boolean {
  return Boolean(binding?.from && binding.output.trim());
}
export function actionStepParamFilled(step: Extract<Step, { type: 'action' }>, name: string): boolean {
  if (isActionParamBound(step.bindings?.[name])) return true;
  if (name === 'path' && documentIngestPathSatisfied(step)) return true;
  return isActionParamFilled(step.params[name]);
}
