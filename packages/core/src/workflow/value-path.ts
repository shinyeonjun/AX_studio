/**
 * Shared own-property path reader for workflow references.
 *
 * Only own properties are read, so user-chosen names such as `constructor`
 * or `__proto__` never resolve to prototype members. Numeric segments index
 * arrays (and `length` is an own array property). Returns undefined when any
 * segment is missing.
 */
export function readOwnPath(value: unknown, keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined;
    const record = current as Record<string, unknown>;
    current = Object.hasOwn(record, key) ? record[key] : undefined;
  }
  return current;
}

/**
 * Resolve `trigger.<path>` against trigger variables. An exact own key wins
 * (trigger payload keys may contain dots); otherwise the path is walked.
 */
export function readTriggerPath(variables: Record<string, unknown>, path: string): unknown {
  if (Object.hasOwn(variables, path)) return variables[path];
  return readOwnPath(variables, path.split('.'));
}
