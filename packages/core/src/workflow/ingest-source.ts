import type { PortBinding } from './bindings.js';
import type { Step } from './schema.js';

export function hasDocumentIngestFileRef(params: Record<string, unknown>): boolean {
  const file = params.file;
  if (!file || typeof file !== 'object' || Array.isArray(file)) return false;
  const path = (file as Record<string, unknown>).path;
  return typeof path === 'string' && path.trim().length > 0;
}

export function hasConcreteDocumentIngestPath(params: Record<string, unknown>): boolean {
  const path = params.path;
  if (typeof path !== 'string' || !path.trim()) return false;
  if (path.includes('{{')) return false;
  return true;
}

export function hasDocumentIngestBinding(bindings?: Record<string, PortBinding>): boolean {
  const source = bindings?.source ?? bindings?.path;
  return Boolean(source?.from && source.output.trim());
}

export function isDocumentIngestSourceConfigured(
  params: Record<string, unknown>,
  bindings?: Record<string, PortBinding>,
): boolean {
  return (
    hasConcreteDocumentIngestPath(params) ||
    hasDocumentIngestFileRef(params) ||
    hasDocumentIngestBinding(bindings)
  );
}

export function documentIngestPathSatisfied(step: Extract<Step, { type: 'action' }>): boolean {
  if (step.connector !== 'document' || step.action !== 'ingest') return false;
  return isDocumentIngestSourceConfigured(step.params, step.bindings);
}
