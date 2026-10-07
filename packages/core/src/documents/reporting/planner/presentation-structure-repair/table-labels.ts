import type { ReportPlan } from '../../plan/schema.js';

/**
 * A risk table sometimes receives a fixed display label even though its
 * `having` predicate already identifies the runtime population. Turn that
 * label into a bounded case expression tied to the predicate. This preserves
 * the example exactly while preventing a copied literal from becoming the
 * reusable rule for arbitrary future groups.
 */
export function repairStaticDerivedTableLabels(plan: ReportPlan): ReportPlan {
  let changed = false;
  const tables = plan.tables.map((table) => {
    if (table.kind !== 'aggregate' || !table.having) return table;
    const columns = table.columns.map((column) => {
      if (column.value.kind !== 'derived' || column.value.expression.kind !== 'literal'
        || typeof column.value.expression.value !== 'string') return column;
      const label = column.value.expression;
      changed = true;
      return {
        ...column,
        value: {
          kind: 'derived' as const,
          expression: {
            kind: 'case' as const,
            branches: [{ when: table.having!, value: label }],
            fallback: label,
          },
        },
      };
    });
    return columns.some((column, index) => column !== table.columns[index]) ? { ...table, columns } : table;
  });
  return changed ? { ...plan, tables } : plan;
}
