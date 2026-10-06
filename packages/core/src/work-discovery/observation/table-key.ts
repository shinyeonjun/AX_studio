/** Whitespace-insensitive text identity used to match report rows and source values. */
export function normalizeCellText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/** The first column whose every value is distinct non-empty text: it identifies the table's rows. */
export function tableKeyColumn(table: { columns: string[]; rows: Array<Record<string, unknown>> }): string | undefined {
  return table.columns.find((column) => {
    const keys = table.rows.map((row) => (Object.hasOwn(row, column) ? row[column] : null));
    if (!keys.every((key) => typeof key === 'string' && normalizeCellText(key) !== '')) return false;
    return new Set(keys.map(normalizeCellText)).size === keys.length;
  });
}
