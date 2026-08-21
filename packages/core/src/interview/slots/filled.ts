import type { Step } from '../../workflow/schema.js';

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
  if (file && typeof file === 'object' && !Array.isArray(file)) {
    const filePath = (file as Record<string, unknown>).path;
    if (typeof filePath === 'string' && filePath.trim()) return true;
  }

  return Object.keys(record).length > 0;
}

export function actionStepParamFilled(step: Extract<Step, { type: 'action' }>, name: string): boolean {
  if (
    step.connector === 'document' &&
    step.action === 'ingest' &&
    name === 'path' &&
    step.params.file &&
    typeof step.params.file === 'object' &&
    !Array.isArray(step.params.file)
  ) {
    return isActionParamFilled((step.params.file as Record<string, unknown>).path);
  }
  return isActionParamFilled(step.params[name]);
}
