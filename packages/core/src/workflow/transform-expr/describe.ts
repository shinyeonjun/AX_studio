import { describeCondition } from '../condition-expr/describe.js';
import type { TransformExpr } from './dsl.js';

const AGGREGATE_LABEL: Record<string, string> = { count: '개수', sum: '합계', avg: '평균', min: '최솟값', max: '최댓값' };

function describeStage(expr: TransformExpr): string | undefined {
  switch (expr.op) {
    case 'filter':
      return `조건: ${describeCondition(expr.where)}`;
    case 'sort':
      return `정렬: ${expr.by.map((key) => `${key.column} ${key.direction === 'asc' ? '오름차순' : '내림차순'}`).join(', ')}`;
    case 'limit':
      return `앞에서 ${expr.count}개`;
    case 'select':
      return `열: ${expr.columns.join(', ')}`;
    case 'group':
      return `${[expr.by, ...(expr.thenBy ?? []).map((entry) => entry.by)].join(' → ')}별 묶음`;
    case 'totals':
      return expr.aggregates.map((aggregate) => `${aggregate.column ? `${aggregate.column} ` : ''}${AGGREGATE_LABEL[aggregate.fn] ?? aggregate.fn}`).join(', ');
    case 'aggregate':
      return `${expr.column ? `${expr.column} ` : ''}${AGGREGATE_LABEL[expr.fn] ?? expr.fn}`;
    case 'column':
      return `${expr.name} 값`;
    case 'lookup':
      return `${expr.keyColumn}=${String(expr.keyValue)}인 행의 ${expr.valueColumn}`;
    case 'ratio':
      return '비율';
    default:
      return undefined;
  }
}

/**
 * What a table shaping does, in the order it happens: "조건: stock < 10 · 정렬: stock 오름차순 · 열: title, stock".
 * For people reviewing a job; the expression itself stays the source of truth.
 */
export function describeShaping(expr: TransformExpr): string {
  const stages: string[] = [];
  let current: TransformExpr | undefined = expr;
  while (current && current.op !== 'source') {
    const stage = describeStage(current);
    if (stage) stages.unshift(stage);
    current = current.op === 'ratio' ? undefined : current.input;
  }
  return stages.length > 0 ? stages.join(' · ') : '표 그대로';
}
