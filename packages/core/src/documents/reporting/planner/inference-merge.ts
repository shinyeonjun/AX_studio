import type { ReportLayoutPlan } from '../layout/schema.js';
import type { ReportPlan } from '../plan/schema.js';
import type { ReportBusinessInference } from './schema.js';

/** Replay revisions are allowed to change formulas and source selection, but
 * omitting a presentation format must not silently turn a currency/percent
 * column into a raw number. Carry formats forward only for the same stable
 * scalar or table-column id, and let an explicitly supplied format win. */
function mergeReportPlanFormats(previous: ReportPlan, next: ReportPlan): ReportPlan {
  const previousScalarFormats = new Map(
    previous.scalars.map((scalar) => [scalar.id, scalar.format]),
  );
  const scalars = next.scalars.map((scalar) => (
    scalar.format === undefined && previousScalarFormats.get(scalar.id) !== undefined
      ? { ...scalar, format: previousScalarFormats.get(scalar.id) }
      : scalar
  ));
  const previousTables = new Map(
    previous.tables
      .filter((table): table is Extract<typeof table, { kind: 'aggregate' }> => table.kind === 'aggregate')
      .map((table) => [table.id, table]),
  );
  const tables = next.tables.map((table) => {
    if (table.kind !== 'aggregate') return table;
    const previousTable = previousTables.get(table.id);
    if (!previousTable) return table;
    const previousFormats = new Map(previousTable.columns.map((column) => [column.id, column.format]));
    return {
      ...table,
      columns: table.columns.map((column) => (
        column.format === undefined && previousFormats.get(column.id) !== undefined
          ? { ...column, format: previousFormats.get(column.id) }
          : column
      )),
    };
  });
  return { ...next, scalars, tables };
}

function mergeOmittedTableOptions(
  previous: ReportPlan['tables'][number] | undefined,
  next: ReportPlan['tables'][number],
): ReportPlan['tables'][number] {
  if (!previous || previous.kind !== next.kind) return next;
  if (next.kind === 'aggregate' && previous.kind === 'aggregate') {
    return {
      ...next,
      ...(next.dataset === undefined && previous.dataset !== undefined ? { dataset: previous.dataset } : {}),
      ...(next.filter === undefined && previous.filter !== undefined ? { filter: previous.filter } : {}),
      ...(next.having === undefined && previous.having !== undefined ? { having: previous.having } : {}),
      ...(next.sort === undefined && previous.sort !== undefined ? { sort: previous.sort } : {}),
      ...(next.limit === undefined && previous.limit !== undefined ? { limit: previous.limit } : {}),
    };
  }
  if (next.kind === 'view' && previous.kind === 'view') {
    return {
      ...next,
      ...(next.filter === undefined && previous.filter !== undefined ? { filter: previous.filter } : {}),
      ...(next.columns === undefined && previous.columns !== undefined ? { columns: previous.columns } : {}),
      ...(next.sort === undefined && previous.sort !== undefined ? { sort: previous.sort } : {}),
      ...(next.limit === undefined && previous.limit !== undefined ? { limit: previous.limit } : {}),
    };
  }
  return next;
}

export function mergeReportPlan(previous: ReportPlan, next: ReportPlan): ReportPlan {
  const scalarIds = new Set(next.scalars.map((scalar) => scalar.id));
  const tableIds = new Set(next.tables.map((table) => table.id));
  const textIds = new Set(next.texts.map((text) => text.id));
  const nextDatasets = next.datasets ?? [];
  const previousDatasets = previous.datasets ?? [];
  const datasetIds = new Set(nextDatasets.map((dataset) => dataset.id));
  const datasets = [...nextDatasets, ...previousDatasets.filter((dataset) => !datasetIds.has(dataset.id))];
  const previousTables = new Map(previous.tables.map((table) => [table.id, table]));
  return mergeReportPlanFormats(previous, {
    ...next,
    ...(datasets.length > 0 ? { datasets } : {}),
    scalars: [...next.scalars, ...previous.scalars.filter((scalar) => !scalarIds.has(scalar.id))],
    tables: [
      ...next.tables.map((table) => mergeOmittedTableOptions(previousTables.get(table.id), table)),
      ...previous.tables.filter((table) => !tableIds.has(table.id)),
    ],
    texts: [...next.texts, ...previous.texts.filter((text) => !textIds.has(text.id))],
  });
}

export function mergeReportLayoutBindings(previous: ReportLayoutPlan, next: ReportLayoutPlan): ReportLayoutPlan {
  const scalarSlots = new Set(next.scalarBindings.map((binding) => binding.slotId));
  const tableGroups = new Set(next.tableBindings.map((binding) => binding.groupId));
  return {
    ...next,
    scalarBindings: [
      ...next.scalarBindings,
      ...previous.scalarBindings.filter((binding) => !scalarSlots.has(binding.slotId)),
    ],
    tableBindings: [
      ...next.tableBindings,
      ...previous.tableBindings.filter((binding) => !tableGroups.has(binding.groupId)),
    ],
  };
}

/** A revision may omit unchanged plan entries or template slots while it
 * focuses on one replay mismatch. Preserve those stable entries and let any
 * explicitly returned id/value replace the prior one. */
export function mergeReportBusinessInference(
  previous: ReportBusinessInference,
  next: ReportBusinessInference,
): ReportBusinessInference {
  return {
    ...next,
    reportPlan: mergeReportPlan(previous.reportPlan, next.reportPlan),
    layout: mergeReportLayoutBindings(previous.layout, next.layout),
  };
}
