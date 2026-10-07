import type {
  ReportPlan,
  ReportScalarExpression,
  ReportSourceSnapshot,
} from '../../plan/schema.js';
import { isRecordValue } from '../../plan/value.js';

type SourceFieldCatalog = Map<string, Set<string>>;

function sourceFieldCatalog(sources: Record<string, ReportSourceSnapshot>): SourceFieldCatalog {
  return new Map(Object.entries(sources).map(([alias, snapshot]) => [
    alias,
    new Set(snapshot.rows.flatMap((row) => Object.keys(row))),
  ]));
}

/**
 * Providers often understand the business relationship but attach a joined
 * field to the fact alias (for example `orders.customer_name`). The plan
 * schema cannot disambiguate that spelling because it intentionally has no
 * access to source rows. Once the host has captured the example snapshots we
 * can repair a field only when the requested column is absent from its alias
 * and exactly one joined alias owns that column. Ambiguous or unknown paths
 * remain unchanged and still fail closed during execution.
 */
export function repairReportFieldAliases(
  plan: ReportPlan,
  sources: Record<string, ReportSourceSnapshot>,
): ReportPlan {
  const fields = sourceFieldCatalog(sources);
  const aliasesFor = (dataset: { baseSource: string; joins: Array<{ source: string }> }): string[] => (
    [...new Set([dataset.baseSource, ...dataset.joins.map((join) => join.source)])]
      .filter((alias) => fields.has(alias))
  );
  const repairPath = (path: string, aliases: string[]): string => {
    const parts = path.split('.');
    if (parts.length === 0 || parts[0] === 'meta') return path;
    const root = parts[0]!;
    const rootFields = fields.get(root);
    if (parts.length === 1) {
      const candidates = aliases.filter((alias) => fields.get(alias)?.has(path));
      return candidates.length === 1 ? `${candidates[0]}.${path}` : path;
    }
    if (!aliases.includes(root)) return path;
    let field = parts.slice(1).join('.');
    // Accept the nested spelling `base.joined.column` even when schema
    // normalization has not collapsed it yet.
    if (parts.length > 2 && fields.has(parts[1]!)
      && fields.get(parts[1]!)?.has(parts.slice(2).join('.'))) {
      return `${parts[1]}.${parts.slice(2).join('.')}`;
    }
    if (rootFields?.has(field)) return path;
    const candidates = aliases.filter((alias) => alias !== root && fields.get(alias)?.has(field));
    return candidates.length === 1 ? `${candidates[0]}.${field}` : path;
  };
  const visit = (value: unknown, aliases: string[]): unknown => {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const repaired = visit(item, aliases);
        changed ||= repaired !== item;
        return repaired;
      });
      return changed ? next : value;
    }
    if (!isRecordValue(value)) return value;
    if (value.kind === 'field' && typeof value.path === 'string') {
      const path = repairPath(value.path, aliases);
      return path === value.path ? value : { ...value, path };
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      // Join.right is evaluated against the candidate row and can be a bare
      // field name. It is deliberately handled by the join loop below.
      const repaired = visit(child, aliases);
      changed ||= repaired !== child;
      next[key] = repaired;
    }
    return changed ? next : value;
  };
  const repairDataset = <T extends { baseSource: string; joins: Array<{ source: string; left: string; right: string; where?: unknown }>; filter?: unknown }>(dataset: T): T => {
    const allAliases = aliasesFor(dataset);
    let changed = false;
    const joins = dataset.joins.map((join, index) => {
      const previousAliases = [dataset.baseSource, ...dataset.joins.slice(0, index).map((candidate) => candidate.source)]
        .filter((alias) => fields.has(alias));
      const left = repairPath(join.left, previousAliases);
      const where = join.where === undefined ? undefined : visit(join.where, [...previousAliases, join.source]);
      const next = { ...join, left, ...(where === undefined ? {} : { where }) };
      changed ||= left !== join.left || where !== join.where;
      return next;
    });
    const filter = dataset.filter === undefined ? undefined : visit(dataset.filter, allAliases);
    changed ||= filter !== dataset.filter;
    return changed ? { ...dataset, joins, ...(filter === undefined ? {} : { filter }) } as T : dataset;
  };

  const root = repairDataset(plan);
  const datasets = new Map((root.datasets ?? []).map((dataset) => [dataset.id, repairDataset(dataset)]));
  const datasetFor = (id?: string) => (id ? datasets.get(id) : root) ?? root;
  const scalars = root.scalars.map((scalar) => {
    const dataset = datasetFor(scalar.dataset);
    const aliases = aliasesFor(dataset);
    const expression = visit(scalar.expression, aliases) as ReportScalarExpression;
    return expression === scalar.expression ? scalar : { ...scalar, expression };
  });
  const tables = root.tables.map((table) => {
    if (table.kind !== 'aggregate') return table;
    const aliases = aliasesFor(datasetFor(table.dataset));
    const groupBy = visit(table.groupBy, aliases) as typeof table.groupBy;
    const filter = table.filter === undefined ? undefined : visit(table.filter, aliases) as typeof table.filter;
    const columns = visit(table.columns, aliases) as typeof table.columns;
    if (groupBy === table.groupBy && filter === table.filter && columns === table.columns) return table;
    return { ...table, groupBy, ...(filter === undefined ? {} : { filter }), columns } as typeof table;
  });
  const changedRoot = root !== plan || scalars.some((scalar, index) => scalar !== plan.scalars[index])
    || tables.some((table, index) => table !== plan.tables[index])
    || (root.datasets ?? []).some((dataset, index) => dataset !== plan.datasets?.[index]);
  if (!changedRoot) return plan;
  return { ...root, datasets: datasets.size ? [...datasets.values()] : root.datasets, scalars, tables };
}
