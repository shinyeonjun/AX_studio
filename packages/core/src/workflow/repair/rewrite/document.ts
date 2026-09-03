import { TransformExprSchema } from '../../transform-expr/dsl.js';
import type { RepairCandidateOperation } from '../contract.js';
import { renameExpr } from './expression.js';

export function rewriteDocument(document: string | undefined, candidate: RepairCandidateOperation): { document?: string; changed: boolean } {
  if (!document) return { changed: false };
  let raw: unknown;
  try {
    raw = JSON.parse(document);
  } catch {
    return { document, changed: false };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { document, changed: false };
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.fields)) return { document, changed: false };
  let changed = false;
  const fields = record.fields.map((field) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return field;
    const fieldRecord = field as Record<string, unknown>;
    const parsed = TransformExprSchema.safeParse(fieldRecord.mapping);
    if (!parsed.success) return field;
    const rewritten = renameExpr(parsed.data, candidate);
    if (!rewritten.changed) return field;
    changed = true;
    return { ...fieldRecord, mapping: rewritten.expr };
  });
  return changed ? { document: JSON.stringify({ ...record, fields }), changed: true } : { document, changed: false };
}
