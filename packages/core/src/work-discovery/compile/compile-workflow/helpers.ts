import { createHash } from 'node:crypto';
import type { TransformExpr } from '../../../workflow/transform-expr/dsl.js';

export function sanitizeStepId(value: string): string {
  const slug = value.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 8);
  return (slug || 'step') + '_' + hash;
}

export function outputPortForSourceId(sourceId: string): 'rows' | 'sheet' {
  return sourceId.startsWith('rdb:') ? 'rows' : 'sheet';
}

export function sourceIdsInExpr(expr: TransformExpr): string[] {
  if (expr.op === 'source') return [expr.sourceId];
  if (expr.op === 'ratio') {
    return [...new Set([
      ...sourceIdsInExpr(expr.numerator),
      ...sourceIdsInExpr(expr.denominator),
    ])];
  }
  return sourceIdsInExpr(expr.input);
}

export function collectSourceIds(expr: TransformExpr, bucket: Set<string>): void {
  for (const sourceId of sourceIdsInExpr(expr)) bucket.add(sourceId);
}
