import {
  isRecord,
  normalizeJoinLeftPath,
  normalizeValueExpression,
  normalizePredicate,
  normalizeScalarExpression,
  normalizeDerivedExpression,
} from './normalize-expressions.js';

function normalizeReportTemplate(value: string, scalarIds: ReadonlySet<string> = new Set()): string {
  const namespace = (value: string): string => {
    if (value === 'scalar' || value === 'scalars') return 'scalar';
    if (value === 'table' || value === 'tables') return 'table';
    if (value === 'meta' || value === 'metadata') return 'meta';
    return value;
  };
  const canonicalDouble = value.replace(/\{\{\s*(scalar|scalars|table|tables|meta|metadata)[:.]([^{}]+?)\s*\}\}/g,
    (_match, name: string, token: string) => `{{${namespace(name)}.${token.trim()}}}`);
  const canonicalNamespaced = canonicalDouble.replace(/(?<!\{)\{\s*(scalar|scalars|table|tables|meta|metadata)[:.]([^{}]+?)\s*\}(?!\})/g,
    (_match, name: string, token: string) => `{{${namespace(name)}.${token.trim()}}}`);
  const normalizeBare = (match: string, token: string): string => {
    const trimmed = token.trim();
    return scalarIds.has(trimmed) ? `{{scalar.${trimmed}}}` : match;
  };
  const withDoubleBare = canonicalNamespaced.replace(/(?<!\{)\{\{\s*([^{}]+?)\s*\}\}(?!\})/g, normalizeBare);
  return withDoubleBare.replace(/(?<!\{)\{\s*([^{}]+?)\s*\}(?!\})/g, normalizeBare);
}

interface ReportPlanDatasetContext {
  baseSource: string;
  aliases: Set<string>;
}

function datasetContext(value: unknown, fallbackBaseSource: string): ReportPlanDatasetContext {
  const record = isRecord(value) ? value : {};
  const baseSource = typeof record.baseSource === 'string' && record.baseSource.length > 0
    ? record.baseSource : fallbackBaseSource;
  const aliases = new Set<string>(['meta', baseSource]);
  if (Array.isArray(record.joins)) {
    for (const join of record.joins) {
      if (isRecord(join) && typeof join.source === 'string' && join.source.length > 0) aliases.add(join.source);
    }
  }
  return { baseSource, aliases };
}

function normalizeDataset(value: unknown, fallbackBaseSource: string): unknown {
  if (!isRecord(value)) return value;
  const context = datasetContext(value, fallbackBaseSource);
  const previousSources = [context.baseSource];
  const joins = Array.isArray(value.joins) ? value.joins.map((join) => {
    if (!isRecord(join)) return join;
    const source = typeof join.source === 'string' && join.source.length > 0 ? join.source : context.baseSource;
    const normalizedJoin = {
      ...join,
      left: normalizeJoinLeftPath(join.left, source, context.baseSource, previousSources, context.aliases),
      // The right side is evaluated against the candidate row itself, so a
      // bare path is already canonical for that source.
      right: typeof join.right === 'string' ? join.right.trim() : join.right,
      ...(join.where ? { where: normalizePredicate(join.where, source, context.aliases) } : {}),
    };
    previousSources.push(source);
    return normalizedJoin;
  }) : value.joins;
  return {
    ...value,
    joins,
    ...(value.filter ? { filter: normalizePredicate(value.filter, context.baseSource, context.aliases) } : {}),
  };
}

export function normalizeReportPlan(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const root = normalizeDataset(record, typeof record.baseSource === 'string' ? record.baseSource : '') as Record<string, unknown>;
  const normalizedDatasets = Array.isArray(record.datasets)
    ? record.datasets.map((dataset) => normalizeDataset(dataset, root.baseSource as string))
    : record.datasets;
  const contexts = new Map<string, ReportPlanDatasetContext>();
  contexts.set('__root__', datasetContext(root, root.baseSource as string));
  if (Array.isArray(normalizedDatasets)) {
    for (const dataset of normalizedDatasets) {
      if (isRecord(dataset) && typeof dataset.id === 'string') contexts.set(dataset.id, datasetContext(dataset, root.baseSource as string));
    }
  }
  const contextFor = (id: unknown): ReportPlanDatasetContext => (
    typeof id === 'string' && contexts.get(id) ? contexts.get(id)! : contexts.get('__root__')!
  );
  const datasetSelector = (id: unknown): string | undefined => {
    if (typeof id !== 'string') return undefined;
    const trimmed = id.trim();
    return trimmed && trimmed !== root.baseSource ? trimmed : undefined;
  };
  const scalars = Array.isArray(record.scalars) ? record.scalars.map((scalar) => {
    if (!isRecord(scalar)) return scalar;
    const context = contextFor(scalar.dataset);
    const dataset = datasetSelector(scalar.dataset);
    return {
      ...scalar,
      dataset,
      expression: normalizeScalarExpression(scalar.expression, context.baseSource, context.aliases),
    };
  }) : record.scalars;
  const tables = Array.isArray(record.tables) ? record.tables.map((table) => {
    if (!table || typeof table !== 'object' || Array.isArray(table)) return table;
    const candidate = table as Record<string, unknown>;
    if (candidate.kind !== 'aggregate' || !Array.isArray(candidate.groupBy) || !Array.isArray(candidate.columns)) {
      return table;
    }
    const context = contextFor(candidate.dataset);
    const dataset = datasetSelector(candidate.dataset);
    const groupKeyIds = new Set(candidate.groupBy.flatMap((group) => (
      group && typeof group === 'object' && !Array.isArray(group) && typeof (group as Record<string, unknown>).id === 'string'
        ? [(group as Record<string, unknown>).id as string] : []
    )));
    return {
      ...candidate,
      dataset,
      ...(candidate.filter ? { filter: normalizePredicate(candidate.filter, context.baseSource, context.aliases) } : {}),
      groupBy: candidate.groupBy.map((group) => isRecord(group)
        ? { ...group, value: normalizeValueExpression(group.value, context.baseSource, context.aliases) }
        : group),
      columns: candidate.columns.map((column) => {
        if (!column || typeof column !== 'object' || Array.isArray(column)) return column;
        const columnRecord = column as Record<string, unknown>;
        const columnValue = columnRecord.value;
        if (!columnValue || typeof columnValue !== 'object' || Array.isArray(columnValue)) return column;
        const normalizedValue = normalizeDerivedExpression(columnValue, context.baseSource, context.aliases, true);
        const valueRecord = columnValue as Record<string, unknown>;
        const normalizedColumn = { ...columnRecord, value: normalizedValue };
        const normalizedRecord = isRecord(normalizedValue) ? normalizedValue : valueRecord;
        return normalizedRecord.kind === 'group_key'
          && (typeof valueRecord.keyId !== 'string' || valueRecord.keyId.length === 0)
          && typeof columnRecord.id === 'string'
          && groupKeyIds.has(columnRecord.id)
          ? { ...normalizedColumn, value: { ...normalizedRecord, keyId: columnRecord.id } }
          : normalizedColumn;
      }),
    };
  }) : record.tables;
  const declaredScalarIds = new Set(
    (Array.isArray(scalars) ? scalars : [])
      .filter((scalar): scalar is Record<string, unknown> => isRecord(scalar) && typeof scalar.id === 'string')
      .map((scalar) => scalar.id as string),
  );
  const texts = Array.isArray(record.texts) ? record.texts.map((text) => {
    if (!text || typeof text !== 'object' || Array.isArray(text)) return text;
    const candidate = text as Record<string, unknown>;
    if (candidate.kind !== 'computed' || typeof candidate.template !== 'string') return text;
    const template = normalizeReportTemplate(candidate.template, declaredScalarIds);
    // A model can label visibly static prose as computed. Treat only
    // nonnumeric, tokenless text as invariant; numeric/date text remains
    // rejected by the reusable-plan validator instead of being frozen.
    if (!/[{}]/u.test(template) && !/\d/u.test(template)) {
      return { id: candidate.id, kind: 'invariant', value: template };
    }
    return { ...candidate, template };
  }) : record.texts;
  return {
    ...root,
    ...(normalizedDatasets === undefined ? {} : { datasets: normalizedDatasets }),
    ...(scalars === undefined ? {} : { scalars }),
    ...(tables === undefined ? {} : { tables }),
    ...(texts === undefined ? {} : { texts }),
  };
}
