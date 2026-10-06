/** Whitespace-insensitive text identity used to match report rows and source values. */
export function normalizeCellText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

type KeyedTable = { columns: string[]; rows: Array<Record<string, unknown>> };

/** Search bound, not semantics: report rows are identified by at most this many text columns. */
export const MAX_TABLE_KEY_COLUMNS = 3;

function cellOf(row: Record<string, unknown>, column: string): unknown {
  return Object.hasOwn(row, column) ? row[column] : null;
}

/** Identity of one row under the given key columns. */
export function tableRowKey(row: Record<string, unknown>, columns: readonly string[]): string {
  return columns.length === 1
    ? normalizeCellText(cellOf(row, columns[0]!))
    : JSON.stringify(columns.map((column) => normalizeCellText(cellOf(row, column))));
}

/** The first column whose every value is distinct non-empty text: it identifies the table's rows. */
export function tableKeyColumn(table: KeyedTable): string | undefined {
  return table.columns.find((column) => {
    const keys = table.rows.map((row) => cellOf(row, column));
    if (!keys.every((key) => typeof key === 'string' && normalizeCellText(key) !== '')) return false;
    return new Set(keys.map(normalizeCellText)).size === keys.length;
  });
}

/** Text columns that can take part in a combined key: text everywhere, blanks allowed (a total row). */
function textColumns(table: KeyedTable): string[] {
  return table.columns.filter((column) => table.rows.every((row) => {
    const value = cellOf(row, column);
    return value == null || typeof value === 'string';
  }) && table.rows.some((row) => normalizeCellText(cellOf(row, column)) !== ''));
}

function* combinations(columns: readonly string[], size: number, start = 0): Generator<string[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let index = start; index <= columns.length - size; index += 1) {
    for (const rest of combinations(columns, size - 1, index + 1)) yield [columns[index]!, ...rest];
  }
}

/**
 * Every way the table's rows are identified by text columns, simplest first: each single distinct
 * text column when there is one, otherwise every combination of the smallest size whose values are
 * distinct together (e.g. region + category for one row per category within each region). Every
 * row needs a non-empty value in at least one key column.
 */
export function keyColumnSets(table: KeyedTable): string[][] {
  const singles = table.columns.filter((column) => tableKeyColumn({ columns: [column], rows: table.rows }) === column);
  if (singles.length > 0) return singles.map((column) => [column]);
  const candidates = textColumns(table);
  for (let size = 2; size <= Math.min(MAX_TABLE_KEY_COLUMNS, candidates.length); size += 1) {
    const found = [...combinations(candidates, size)].filter((columns) => identifiesRows(table, columns));
    if (found.length > 0) return found;
  }
  return [];
}

function identifiesRows(table: KeyedTable, columns: readonly string[]): boolean {
  const keys = new Set<string>();
  for (const row of table.rows) {
    if (columns.every((column) => normalizeCellText(cellOf(row, column)) === '')) return false;
    const key = tableRowKey(row, columns);
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

/**
 * The columns a grouped report is keyed by: every column that is not numbers throughout (a
 * grouped table is key columns plus aggregates), provided together they identify the rows.
 */
export function nonNumericKeyColumns(table: KeyedTable): string[] | undefined {
  const keys = table.columns.filter((column) => !table.rows.every((row) => {
    const value = cellOf(row, column);
    return typeof value === 'number' && Number.isFinite(value);
  }));
  if (keys.length === 0 || keys.length > MAX_TABLE_KEY_COLUMNS) return undefined;
  if (!keys.every((column) => textColumns({ columns: [column], rows: table.rows }).length === 1)) return undefined;
  return identifiesRows(table, keys) ? keys : undefined;
}

/** The simplest key of the table's rows (see keyColumnSets). */
export function tableKeyColumns(table: KeyedTable): string[] | undefined {
  return keyColumnSets(table)[0];
}
