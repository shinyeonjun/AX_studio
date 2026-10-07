import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import type { ReportLayoutPlan } from '../layout/schema.js';
import type { ReportPlan } from '../plan/schema.js';

/**
 * Layout prompts expose template cell ids, while materialized tables expose
 * declarative result column ids. A model revision can therefore copy a
 * template slot id into `columnId` even though the table order is otherwise
 * unchanged. Repair only that evidence-backed shape error: the id must be a
 * slot from the same template group and the positional result column must be
 * declared by the selected aggregate table. Unknown ids remain untouched and
 * are rejected by the materializer.
 */
export function repairReportLayoutBindings(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
): ReportLayoutPlan {
  const tables = new Map(plan.tables.map((table) => [table.id, table]));
  const groups = new Map(pair.tableGroups.map((group) => [group.id, group]));
  const repairedBindings = layout.tableBindings.map((binding) => {
    const table = tables.get(binding.tableId);
    const group = groups.get(binding.groupId);
    if (!table || table.kind !== 'aggregate' || !group) return binding;
    const resultColumnIds = new Set(table.columns.map((column) => column.id));
    const templateSlotIds = new Set(group.rows.flatMap((row) => row.cells.map((cell) => cell.id)));
    const columns = binding.columns.map((column) => {
      if (resultColumnIds.has(column.columnId) || !templateSlotIds.has(column.columnId)) return column;
      const resultColumn = table.columns[column.columnIndex];
      return resultColumn ? { ...column, columnId: resultColumn.id } : column;
    });
    return { ...binding, columns };
  });
  // A revision can repeat a previously valid binding with a malformed group id
  // (for example, a copied id with one extra character). Drop that entry only
  // when an exact, known-group binding already exists. An unknown binding with
  // no verified equivalent remains untouched and is rejected by materialize,
  // so this repair cannot silently attach data to the wrong table geometry.
  const bindingShape = (binding: ReportLayoutPlan['tableBindings'][number]): string => JSON.stringify({
    tableId: binding.tableId,
    columns: binding.columns.map((column) => ({
      columnIndex: column.columnIndex,
      columnId: column.columnId,
    })),
  });
  const knownShapes = new Set(
    repairedBindings
      .filter((binding) => groups.has(binding.groupId))
      .map(bindingShape),
  );
  const tableBindings = repairedBindings.filter((binding) => (
    groups.has(binding.groupId) || !knownShapes.has(bindingShape(binding))
  ));
  return { ...layout, tableBindings };
}

function ranksByMeasure(table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>): boolean {
  const first = table.sort?.[0];
  if (!first) return false;
  const column = table.columns.find((candidate) => candidate.id === first.columnId);
  return column !== undefined && column.value.kind !== 'group_key';
}

/**
 * A completed example can fit a template while a later period contains more
 * groups. The example row count is presentation geometry, never a default
 * business limit. A model limit that exactly matches the bound capacity and
 * has no aggregate `having` predicate is therefore treated as a copied layout
 * cap and removed. Smaller limits, limits backed by an aggregate predicate and
 * limits on a ranking (first sorted by a measure, not a group key: "top 5 by
 * sales" whose example happened to fill 5 rows) remain semantic constraints;
 * they must not be widened by the host.
 */
export function repairReportTableCapacities(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
): ReportPlan {
  const groups = new Map(pair.tableGroups.map((group) => [group.id, group]));
  const capacities = new Map<string, number>();
  for (const binding of layout.tableBindings) {
    const group = groups.get(binding.groupId);
    if (!group) continue;
    const capacity = Math.max(1, group.rowCount);
    const current = capacities.get(binding.tableId);
    capacities.set(binding.tableId, current === undefined ? capacity : Math.min(current, capacity));
  }
  if (capacities.size === 0) return plan;
  let changed = false;
  const tables = plan.tables.map((table) => {
    const capacity = capacities.get(table.id);
    if (capacity === undefined) return table;
    if (table.kind !== 'aggregate' || table.limit !== capacity || table.having !== undefined) return table;
    if (ranksByMeasure(table)) return table;
    changed = true;
    const { limit: _layoutLimit, ...withoutLayoutLimit } = table;
    return withoutLayoutLimit;
  });
  return changed ? { ...plan, tables } : plan;
}

/**
 * A revision can return a near-match slot id in addition to a complete set of
 * known bindings. Remove that extra entry only when every real scalar slot is
 * already covered exactly once; if a real slot is missing, leave the layout
 * untouched so strict materialization still reports the defect.
 */
export function repairReportScalarBindings(
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
): ReportLayoutPlan {
  const knownSlotIds = new Set(pair.scalarSlots.map((slot) => slot.id));
  const knownBindings = layout.scalarBindings.filter((binding) => knownSlotIds.has(binding.slotId));
  const knownBindingIds = new Set(knownBindings.map((binding) => binding.slotId));
  const complete = knownBindings.length === knownBindingIds.size
    && knownBindingIds.size === knownSlotIds.size;
  if (!complete || knownBindings.length === layout.scalarBindings.length) return layout;
  return { ...layout, scalarBindings: knownBindings };
}
