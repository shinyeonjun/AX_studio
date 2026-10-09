import type { ReportPlan } from '../../plan/schema.js';
import { reportFileSources, type ReportSourceCapturePlan } from '../../source/schema.js';

/**
 * Providers sometimes combine the connector kind and source alias in a
 * metadata token (for example `source.http-orders.path`) even though the
 * runtime contract uses the captured alias directly. Normalize only tokens
 * whose alias is present in the host capture plan; unknown aliases remain
 * untouched and are rejected by normal validation.
 */
export function repairReportMetadataReferences(
  plan: ReportPlan,
  capture: Pick<{ capturePlan: ReportSourceCapturePlan }, 'capturePlan'>,
): ReportPlan {
  const periodRepaired = repairLegacyPeriodEndAliases(plan);
  const aliases = {
    http: new Set(capture.capturePlan.http.map((source) => source.alias)),
    rdb: new Set(capture.capturePlan.rdb.map((source) => source.alias)),
    file: new Set(reportFileSources(capture.capturePlan).map((source) => source.alias)),
  };
  const texts = periodRepaired.texts.map((text) => {
    if (text.kind !== 'computed') return text;
    const template = text.template.replace(
      /\{\{\s*meta\.source\.(http|rdb|file)-([^\s{}]+)\.(path|tableName|table|fileName)\s*\}\}/gu,
      (match, connector: 'http' | 'rdb' | 'file', alias: string, field: 'path' | 'tableName' | 'table' | 'fileName') => (
        aliases[connector].has(alias) ? `{{meta.source.${alias}.${field}}}` : match
      ),
    );
    return template === text.template ? text : { ...text, template };
  });
  return texts.some((text, index) => text !== periodRepaired.texts[index])
    ? { ...periodRepaired, texts }
    : periodRepaired;
}

function sourceAliasKey(alias: string): string {
  return alias.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
}

/** Normalize a provider's shorthand period-end field before execution. A
 * strict less-than bound needs the exclusive end; all other comparisons use
 * the inclusive end so contract overlap checks keep the final report day. */
function repairLegacyPeriodEndAliases<T>(value: T, comparisonOperation?: string): T {
  if (Array.isArray(value)) {
    return value.map((item) => repairLegacyPeriodEndAliases(item, comparisonOperation)) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const operation = record.kind === 'compare' && typeof record.operation === 'string'
    ? record.operation : comparisonOperation;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === 'path' && item === 'meta.periodEnd') {
      changed = true;
      next[key] = operation === 'lt' ? 'meta.periodEndExclusive' : 'meta.periodEndInclusive';
      continue;
    }
    if (key === 'template' && typeof item === 'string') {
      const template = item.replace(/\{\{\s*meta\.periodEnd\s*\}\}/gu, '{{meta.periodEndInclusive}}');
      changed ||= template !== item;
      next[key] = template;
      continue;
    }
    const repaired = repairLegacyPeriodEndAliases(item, operation);
    changed ||= repaired !== item;
    next[key] = repaired;
  }
  return changed ? next as T : value;
}

/**
 * Models occasionally change an authorized alias's punctuation while editing
 * a plan (for example `team-roster` vs `team_roster`). Repair only a unique
 * match from the capture contract; ambiguous or invented aliases remain
 * untouched and still fail closed at validation.
 */
export function repairReportSourceAliases(
  plan: ReportPlan,
  capture: Pick<{ capturePlan: ReportSourceCapturePlan }, 'capturePlan'>,
): ReportPlan {
  const aliases = [
    ...capture.capturePlan.http.map((source) => source.alias),
    ...capture.capturePlan.rdb.map((source) => source.alias),
    ...reportFileSources(capture.capturePlan).map((source) => source.alias),
  ];
  const byKey = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const alias of aliases) {
    const key = sourceAliasKey(alias);
    const previous = byKey.get(key);
    if (previous && previous !== alias) {
      byKey.delete(key);
      ambiguous.add(key);
    } else if (!ambiguous.has(key)) {
      byKey.set(key, alias);
    }
  }
  const resolve = (alias: string): string => {
    if (aliases.includes(alias)) return alias;
    const key = sourceAliasKey(alias);
    return ambiguous.has(key) ? alias : (byKey.get(key) ?? alias);
  };
  const rewritePath = (path: string): string => {
    const separator = path.indexOf('.');
    if (separator <= 0) return path;
    const alias = path.slice(0, separator);
    const canonical = resolve(alias);
    return canonical === alias ? path : `${canonical}${path.slice(separator)}`;
  };
  const visit = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') {
      if (key === 'baseSource' || key === 'source') return resolve(value);
      if (key === 'path' || key === 'left' || key === 'right') return rewritePath(value);
      return value;
    }
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const rewritten = visit(item, key);
        changed ||= rewritten !== item;
        return rewritten;
      });
      return changed ? next : value;
    }
    if (!value || typeof value !== 'object') return value;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) {
      const rewritten = visit(child, childKey);
      changed ||= rewritten !== child;
      next[childKey] = rewritten;
    }
    return changed ? next : value;
  };
  const repaired = visit(plan);
  return repaired === plan ? plan : repaired as ReportPlan;
}

/** Providers sometimes call the implicit root dataset "default". The
 * executable contract represents that dataset by an omitted reference; only
 * remove the shorthand when no real dataset with that id was declared. */
export function repairReportDatasetReferences(plan: ReportPlan): ReportPlan {
  const declared = new Set((plan.datasets ?? []).map((dataset) => dataset.id));
  if (declared.has('default')) return plan;
  const normalize = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || !('dataset' in value)
      || value.dataset !== 'default') return value;
    const { dataset: _dataset, ...rest } = value as Record<string, unknown>;
    return rest as T;
  };
  const scalars = plan.scalars.map(normalize);
  const tables = plan.tables.map(normalize);
  if (scalars.every((scalar, index) => scalar === plan.scalars[index])
    && tables.every((table, index) => table === plan.tables[index])) return plan;
  return { ...plan, scalars, tables };
}
