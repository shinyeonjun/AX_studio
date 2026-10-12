import type { TableArtifact } from '../../../../contracts/artifacts/table.js';
import type { TransformExpr } from '../../../../workflow/transform-expr/dsl.js';

const STATUS_COLUMN = /(?:상태|^status$|^state$|_status$)/iu;
const MAX_STATUS_VALUES = 8;

type PlainTotal = { fn: 'sum' | 'count'; column?: string };

/** Filtering, grouping or picking rows means the person already chose which rows count. */
function narrowsRows(expr: TransformExpr): boolean {
  switch (expr.op) {
    case 'filter': case 'group': case 'lookup': case 'limit': case 'ratio':
      return true;
    case 'source':
      return false;
    default:
      return narrowsRows(expr.input);
  }
}

/** The one sum or count an expression ends in, over every row. */
function plainTotal(expr: TransformExpr): PlainTotal | undefined {
  if (expr.op === 'select' || expr.op === 'sort' || expr.op === 'column') return plainTotal(expr.input);
  if (narrowsRows(expr)) return undefined;
  if (expr.op === 'aggregate' && (expr.fn === 'sum' || expr.fn === 'count')) return { fn: expr.fn, column: expr.column };
  if (expr.op === 'totals' && expr.aggregates.length === 1) {
    const [aggregate] = expr.aggregates;
    if (aggregate!.fn === 'sum' || aggregate!.fn === 'count') return { fn: aggregate!.fn, column: aggregate!.column };
  }
  return undefined;
}

const won = (value: number) => value.toLocaleString('ko-KR');

/**
 * A total over rows that carry a status ("결제완료", "취소" …) silently mixes them. Real use: "8월
 * 총 매출" summed 31 cancelled orders into 10,479,300 while the company's own report said
 * 8,466,900. Which statuses count is the person's rule, so the total stays as asked and the split
 * is shown next to it.
 */
export function statusBreakdownNote(source: TableArtifact, expr: TransformExpr): string | undefined {
  if (source.truncated) return undefined;
  const total = plainTotal(expr);
  if (!total) return undefined;
  const status = source.columns.find((column) => STATUS_COLUMN.test(column.name) || STATUS_COLUMN.test(column.label ?? ''));
  if (!status || status.name === total.column) return undefined;

  const byStatus = new Map<string, { count: number; sum: number }>();
  for (const row of source.rows) {
    const key = row.values[status.name];
    if (typeof key !== 'string' || !key.trim()) continue;
    const entry = byStatus.get(key.trim()) ?? { count: 0, sum: 0 };
    entry.count += 1;
    const value = total.column ? row.values[total.column] : undefined;
    if (typeof value === 'number' && Number.isFinite(value)) entry.sum += value;
    byStatus.set(key.trim(), entry);
  }
  if (byStatus.size < 2 || byStatus.size > MAX_STATUS_VALUES) return undefined;

  const statusName = status.label ?? status.name;
  const parts = [...byStatus.entries()].map(([key, { count, sum }]) =>
    total.fn === 'sum' && total.column ? `${key} ${won(count)}건 ${won(sum)}` : `${key} ${won(count)}건`);
  return `이 값은 ${statusName}와 관계없이 모든 행(${won(source.rows.length)}건)을 포함합니다. ${statusName}별: ${parts.join(' · ')}`;
}
