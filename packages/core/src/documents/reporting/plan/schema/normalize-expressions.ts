export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The model often uses the natural row-column spelling (`paid_at`) even
 * though execution stores each source row under its alias (`orders.paid_at`).
 * Canonicalize that shorthand once at the plan boundary so filters, joins,
 * aggregates, and grouped cells all see the same row shape.
 */
function normalizeFieldPath(path: unknown, source: string, aliases: Set<string>): unknown {
  if (typeof path !== 'string') return path;
  const trimmed = path.trim();
  if (!trimmed || !source) return trimmed;
  const parts = trimmed.split('.');
  const root = parts[0]!;
  // Source fields are flat paths (`alias.column`). A model can nevertheless
  // serialize a joined field as `baseAlias.joinedAlias.column`, treating the
  // row object as if joins were nested objects. If the middle segment is a
  // known source alias, collapse that structural spelling to the canonical
  // joined alias; unknown paths remain untouched and fail closed at execute.
  const nestedAliasIndex = parts.slice(1).findIndex((part) => part !== 'meta' && aliases.has(part));
  if (nestedAliasIndex >= 0) {
    const aliasIndex = nestedAliasIndex + 1;
    const fieldParts = parts.slice(aliasIndex + 1);
    if (fieldParts.length) return `${parts[aliasIndex]}.${fieldParts.join('.')}`;
  }
  return root === 'meta' || aliases.has(root) ? trimmed : `${source}.${trimmed}`;
}

/**
 * A join's left expression is evaluated before the candidate source is added
 * to the row. Models occasionally copy the candidate alias into that side
 * (`customers.customer_id` while joining `customers`). Resolve that bounded
 * spelling to the nearest source already available in the left-deep join
 * order; genuinely unknown paths remain unchanged and fail during execution.
 */
export function normalizeJoinLeftPath(
  path: unknown,
  source: string,
  baseSource: string,
  previousSources: string[],
  aliases: Set<string>,
): unknown {
  const normalized = normalizeFieldPath(path, baseSource, aliases);
  if (typeof normalized !== 'string' || previousSources.includes(source)) return normalized;
  const prefix = `${source}.`;
  if (!normalized.startsWith(prefix)) return normalized;
  const suffix = normalized.slice(prefix.length);
  const fallback = previousSources.at(-1) ?? baseSource;
  return suffix ? `${fallback}.${suffix}` : normalized;
}

export function normalizeValueExpression(value: unknown, source: string, aliases: Set<string>): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'field':
      return { ...value, path: normalizeFieldPath(value.path, source, aliases) };
    case 'literal':
      return value;
    case 'arithmetic':
      return {
        ...value,
        left: normalizeValueExpression(value.left, source, aliases),
        right: normalizeValueExpression(value.right, source, aliases),
      };
    case 'coalesce':
    case 'concat':
      return {
        ...value,
        values: Array.isArray(value.values)
          ? value.values.map((item) => normalizeValueExpression(item, source, aliases))
          : value.values,
      };
    default:
      return value;
  }
}

export function normalizePredicate(value: unknown, source: string, aliases: Set<string>): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'compare':
      return {
        ...value,
        left: normalizeValueExpression(value.left, source, aliases),
        right: normalizeValueExpression(value.right, source, aliases),
      };
    case 'in':
      return {
        ...value,
        value: normalizeValueExpression(value.value, source, aliases),
        values: Array.isArray(value.values)
          ? value.values.map((item) => normalizeValueExpression(item, source, aliases))
          : value.values,
      };
    case 'and':
    case 'or':
      return {
        ...value,
        items: Array.isArray(value.items)
          ? value.items.map((item) => normalizePredicate(item, source, aliases))
          : value.items,
      };
    case 'not':
      return { ...value, item: normalizePredicate(value.item, source, aliases) };
    case 'is_null':
      return { ...value, value: normalizeValueExpression(value.value, source, aliases) };
    default:
      return value;
  }
}

function normalizeAggregateExpression(value: unknown, source: string, aliases: Set<string>): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'arithmetic':
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
      return {
        ...value,
        left: normalizeAggregateExpression(value.left, source, aliases),
        right: normalizeAggregateExpression(value.right, source, aliases),
      };
    case 'count':
      return { ...value, ...(value.where ? { where: normalizePredicate(value.where, source, aliases) } : {}) };
    case 'count_distinct':
    case 'sum':
    case 'average':
    case 'min':
    case 'max':
    case 'first':
      return {
        ...value,
        value: normalizeValueExpression(value.value, source, aliases),
        ...(value.where ? { where: normalizePredicate(value.where, source, aliases) } : {}),
      };
    case 'sum_distinct':
      return {
        ...value,
        value: normalizeValueExpression(value.value, source, aliases),
        distinctBy: normalizeValueExpression(value.distinctBy, source, aliases),
        ...(value.where ? { where: normalizePredicate(value.where, source, aliases) } : {}),
      };
    default:
      return value;
  }
}

export function normalizeScalarExpression(value: unknown, source: string, aliases: Set<string>): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'field':
    case 'literal':
      return normalizeValueExpression(value, source, aliases);
    case 'count':
    case 'count_distinct':
    case 'sum':
    case 'average':
    case 'min':
    case 'max':
    case 'sum_distinct':
    case 'first':
      return normalizeAggregateExpression(value, source, aliases);
    case 'arithmetic':
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
      return {
        ...value,
        left: normalizeScalarExpression(value.left, source, aliases),
        right: normalizeScalarExpression(value.right, source, aliases),
      };
    case 'coalesce':
    case 'concat':
      return {
        ...value,
        values: Array.isArray(value.values)
          ? value.values.map((item) => normalizeScalarExpression(item, source, aliases))
          : value.values,
      };
    default:
      return value;
  }
}

function normalizeDerivedPredicate(value: unknown, source: string, aliases: Set<string>): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'compare':
      return {
        ...value,
        left: normalizeDerivedExpression(value.left, source, aliases),
        right: normalizeDerivedExpression(value.right, source, aliases),
      };
    case 'in':
      return {
        ...value,
        value: normalizeDerivedExpression(value.value, source, aliases),
        values: Array.isArray(value.values)
          ? value.values.map((item) => normalizeDerivedExpression(item, source, aliases))
          : value.values,
      };
    case 'and':
    case 'or':
      return {
        ...value,
        items: Array.isArray(value.items)
          ? value.items.map((item) => normalizeDerivedPredicate(item, source, aliases))
          : value.items,
      };
    case 'not':
      return { ...value, item: normalizeDerivedPredicate(value.item, source, aliases) };
    case 'is_null':
      return { ...value, value: normalizeDerivedExpression(value.value, source, aliases) };
    default:
      return value;
  }
}

export function normalizeDerivedExpression(
  value: unknown,
  source: string,
  aliases: Set<string>,
  preserveColumnWrapper = false,
): unknown {
  if (!isRecord(value)) return value;
  switch (value.kind) {
    case 'group_key':
    case 'row_number':
      return value;
    case 'aggregate':
      // `aggregate` and `derived` are column-value wrappers. Models can also
      // repeat them inside a derived arithmetic/case expression, where the
      // runtime grammar expects the expression itself. Preserve the outer
      // column wrapper but unwrap nested wrappers at expression boundaries.
      return preserveColumnWrapper
        ? { ...value, expression: normalizeAggregateExpression(value.expression, source, aliases) }
        : normalizeAggregateExpression(value.expression, source, aliases);
    case 'derived':
      return preserveColumnWrapper
        ? { ...value, expression: normalizeDerivedExpression(value.expression, source, aliases) }
        : normalizeDerivedExpression(value.expression, source, aliases);
    case 'field':
      return normalizeValueExpression(value, source, aliases);
    case 'count':
    case 'count_distinct':
    case 'sum':
    case 'average':
    case 'min':
    case 'max':
    case 'sum_distinct':
    case 'first':
      return normalizeAggregateExpression(value, source, aliases);
    case 'arithmetic':
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
      return {
        ...value,
        left: normalizeDerivedExpression(value.left, source, aliases),
        right: normalizeDerivedExpression(value.right, source, aliases),
      };
    case 'coalesce':
    case 'concat':
      return {
        ...value,
        values: Array.isArray(value.values)
          ? value.values.map((item) => normalizeDerivedExpression(item, source, aliases))
          : value.values,
      };
    case 'case':
      return {
        ...value,
        branches: Array.isArray(value.branches)
          ? value.branches.map((branch) => isRecord(branch)
            ? { ...branch, when: normalizeDerivedPredicate(branch.when, source, aliases), value: normalizeDerivedExpression(branch.value, source, aliases) }
            : branch)
          : value.branches,
        fallback: normalizeDerivedExpression(value.fallback, source, aliases),
      };
    default:
      return value;
  }
}
