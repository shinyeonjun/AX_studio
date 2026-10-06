import type { TableArtifact } from './table.js';

/** What a chat bubble shows of a table; larger tables say how much was left out. */
export const MAX_DISPLAY_TABLE_ROWS = 100;
export const MAX_DISPLAY_TABLE_COLUMNS = 50;
const MAX_DISPLAY_TABLE_BYTES = 64_000;

/** The bounded, visible part of a table (undefined when even that is too large to keep). */
export function boundedDisplayTable(table: TableArtifact): TableArtifact | undefined {
  const columns = table.columns.slice(0, MAX_DISPLAY_TABLE_COLUMNS);
  const names = columns.map(({ name }) => name);
  const rows = table.rows.slice(0, MAX_DISPLAY_TABLE_ROWS).map((row) => ({
    ...row,
    values: Object.fromEntries(names.flatMap((name) =>
      Object.hasOwn(row.values, name) ? [[name, row.values[name]]] : [],
    )),
  }));
  const bounded: TableArtifact = {
    id: table.id,
    kind: 'table',
    ...(table.name ? { name: table.name } : {}),
    columns,
    rows,
    truncated: table.truncated || columns.length < table.columns.length || rows.length < table.rows.length,
    ...(table.completeness ? { completeness: table.completeness } : {}),
    ...(table.offset === undefined ? {} : { offset: table.offset }),
    ...(table.nextOffset === undefined ? {} : { nextOffset: table.nextOffset }),
    ...(table.readScope ? { readScope: table.readScope } : {}),
    ...(table.coverage ? { coverage: table.coverage } : {}),
  };
  return new TextEncoder().encode(JSON.stringify(bounded)).byteLength <= MAX_DISPLAY_TABLE_BYTES ? bounded : undefined;
}
