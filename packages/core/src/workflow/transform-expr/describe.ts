import { describeCondition, type ColumnNamer } from '../condition-expr/describe.js';
import type { TransformExpr } from './dsl.js';

const AGGREGATE_LABEL: Record<string, string> = { count: '건수', sum: '합계', avg: '평균', min: '최솟값', max: '최댓값' };

function describeStage(expr: TransformExpr, name: ColumnNamer): string | undefined {
  switch (expr.op) {
    case 'filter':
      return `조건: ${describeCondition(expr.where, name)}`;
    case 'sort':
      return `정렬: ${expr.by.map((key) => `${name(key.column)} ${key.direction === 'asc' ? '오름차순' : '내림차순'}`).join(', ')}`;
    case 'limit':
      return `앞에서 ${expr.count}개`;
    case 'select':
      return `열: ${expr.columns.map(name).join(', ')}`;
    case 'group':
      return `${[expr.by, ...(expr.thenBy ?? []).map((entry) => entry.by)].map(name).join(' → ')}별 묶음`;
    case 'totals':
      return expr.aggregates.map((aggregate) => `${aggregate.column ? `${name(aggregate.column)} ` : ''}${AGGREGATE_LABEL[aggregate.fn] ?? aggregate.fn}`).join(', ');
    case 'aggregate':
      return `${expr.column ? `${name(expr.column)} ` : ''}${AGGREGATE_LABEL[expr.fn] ?? expr.fn}`;
    case 'column':
      return `${name(expr.name)} 값`;
    case 'lookup':
      return `${name(expr.keyColumn)}=${String(expr.keyValue)}인 행의 ${name(expr.valueColumn)}`;
    case 'ratio':
      return '비율';
    default:
      return undefined;
  }
}

/**
 * What a table shaping does, in the order it happens: "조건: 재고 < 10 · 정렬: 재고 오름차순 · 열: 상품명, 재고",
 * columns named by their Korean headers when `columnName` knows them. For people reviewing a job;
 * the expression itself stays the source of truth.
 */
export function describeShaping(expr: TransformExpr, columnName: ColumnNamer = (column) => column): string {
  const stages: string[] = [];
  let current: TransformExpr | undefined = expr;
  while (current && current.op !== 'source') {
    const stage = describeStage(current, columnName);
    if (stage) stages.unshift(stage);
    current = current.op === 'ratio' ? undefined : current.input;
  }
  return stages.length > 0 ? stages.join(' · ') : '표 그대로';
}
