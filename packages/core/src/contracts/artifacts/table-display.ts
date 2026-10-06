const TABLE_PRUNED_COLUMNS = new Set([
  'images', 'thumbnail', 'photo', 'avatar', 'picture', 'icon',
  'reviews', 'dimensions', 'meta',
  'warrantyinformation', 'shippinginformation', 'returnpolicy',
  'minimumorderquantity', 'sku', 'barcode', 'qrcode', 'weight',
  'depth', 'width', 'height', 'createdat', 'updatedat', 'deletedat',
  'tags', 'slug', 'description',
]);

const HIGH_PRIORITY_COLUMNS = [
  'id', 'title', 'name', 'label', 'category', 'type', 'rating', 'score',
  'price', 'cost', 'amount', 'stock', 'quantity', 'brand', 'status', 'state',
];

/**
 * Which columns a person sees when a table is shown in chat: the requested ones, otherwise every
 * column of a narrow table, otherwise the main columns of a wide API record (ids, names, amounts)
 * without media, nested blobs and bookkeeping fields. The data keeps every column.
 */
export function displayColumns(
  headers: readonly string[],
  requested?: readonly string[],
): string[] {
  const selected = [...new Set(requested ?? [])].filter((header) => headers.includes(header));
  if (selected.length > 0) return selected;
  if (headers.length <= 6) return [...headers];

  const hasHighPriority = headers.some((h) => HIGH_PRIORITY_COLUMNS.includes(h.toLowerCase()));
  const hasPruned = headers.some((h) => TABLE_PRUNED_COLUMNS.has(h.toLowerCase().replace(/[-_]/g, '')));

  if (hasHighPriority || hasPruned) {
    const filtered = headers.filter((h) => {
      const norm = h.toLowerCase().replace(/[-_]/g, '');
      return !TABLE_PRUNED_COLUMNS.has(norm);
    });

    const base = filtered.length >= 3 ? filtered : headers;
    const prioritized = base.slice().sort((a, b) => {
      const idxA = HIGH_PRIORITY_COLUMNS.indexOf(a.toLowerCase());
      const idxB = HIGH_PRIORITY_COLUMNS.indexOf(b.toLowerCase());
      const rankA = idxA >= 0 ? idxA : 99;
      const rankB = idxB >= 0 ? idxB : 99;
      return rankA - rankB;
    });

    return prioritized.slice(0, 6);
  }

  return [...headers];
}

/** The table narrowed to its display columns (see displayColumns); rows keep their order. */
export function displayTable<T extends { columns: Array<{ name: string }>; rows: Array<{ values: Record<string, unknown> }> }>(table: T): T {
  const names = displayColumns(table.columns.map((column) => column.name));
  if (names.length === table.columns.length) return table;
  const keep = new Set(names);
  return {
    ...table,
    columns: table.columns.filter((column) => keep.has(column.name)),
    rows: table.rows.map((row) => ({
      ...row,
      values: Object.fromEntries(Object.entries(row.values).filter(([name]) => keep.has(name))),
    })),
  };
}
