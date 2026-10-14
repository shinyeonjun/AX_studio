import type { JevReadOperationHint } from '../../../decision/read-operation-catalog.js';

/** Which database a read is of: its connectionId (several databases), else its label. */
function databaseOf(hint: JevReadOperationHint): string {
  return typeof hint.params.connectionId === 'string' ? `id:${hint.params.connectionId}` : `label:${hint.sourceLabel ?? ''}`;
}

function tablesRead(hint: JevReadOperationHint): Set<string> | undefined {
  if (hint.capabilityId !== 'rdb.query.read' || typeof hint.params.table !== 'string') return undefined;
  const joins = Array.isArray(hint.params.join) ? hint.params.join : [];
  const joined = joins.map((join) => (join && typeof join === 'object' ? (join as { table?: unknown }).table : undefined));
  if (joined.some((table) => typeof table !== 'string')) return undefined;
  return new Set([hint.params.table, ...(joined as string[])]);
}

/**
 * Every table the selected reads touch, base or joined, when they are all reads of one database.
 * Undefined when any read is of something else.
 */
export function rdbTablesRead(selected: readonly JevReadOperationHint[]): string[] | undefined {
  if (selected.length === 0) return undefined;
  const source = databaseOf(selected[0]!);
  const tables = new Set<string>();
  for (const hint of selected) {
    const read = tablesRead(hint);
    if (!read || databaseOf(hint) !== source) return undefined;
    for (const table of read) tables.add(table);
  }
  return [...tables];
}

/**
 * The selected reads narrowed to those returning `table`'s own rows. When only a join brought the
 * table in ("orders + customers" for a customer list), its plain read from the catalog instead.
 */
export function readsOfRowTable(
  selected: readonly JevReadOperationHint[],
  catalog: readonly JevReadOperationHint[],
  table: string,
): JevReadOperationHint[] {
  const own = selected.filter((hint) => hint.params.table === table);
  if (own.length > 0) return own;
  const source = databaseOf(selected[0]!);
  const plain = catalog.find((hint) => hint.capabilityId === 'rdb.query.read' && hint.params.table === table
    && !Array.isArray(hint.params.join) && databaseOf(hint) === source);
  return plain ? [plain] : [...selected];
}

/**
 * One database read holding everything several selected reads would: a question about orders by
 * customer region selects the orders and customers tables, and the catalog's "orders +
 * customers" read already has both, row by row. The smallest such read of the same connection
 * wins; none means the reads really are separate.
 */
export function coveringRdbRead(
  selected: readonly JevReadOperationHint[],
  catalog: readonly JevReadOperationHint[],
): JevReadOperationHint | undefined {
  if (selected.length < 2) return undefined;
  const source = databaseOf(selected[0]!);
  const needed = new Set<string>();
  const bases = new Set<string>();
  for (const hint of selected) {
    const tables = tablesRead(hint);
    if (!tables || databaseOf(hint) !== source) return undefined;
    for (const table of tables) needed.add(table);
    bases.add(String(hint.params.table));
  }
  let best: { hint: JevReadOperationHint; size: number } | undefined;
  for (const hint of [...selected, ...catalog]) {
    const tables = tablesRead(hint);
    // Its rows must be rows of a selected table: reading customers through orders counts orders.
    if (!tables || databaseOf(hint) !== source || !bases.has(String(hint.params.table))) continue;
    if (![...needed].every((table) => tables.has(table))) continue;
    if (!best || tables.size < best.size) best = { hint, size: tables.size };
  }
  return best?.hint;
}
