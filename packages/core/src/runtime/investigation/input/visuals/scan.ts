export interface VisualEntry {
  pageIndex: unknown;
  path: unknown;
  ocrText: unknown;
  hasVisual: boolean;
}

function scanArtifact(value: unknown, entries: VisualEntry[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.images)) {
    for (const image of record.images) {
      if (!image || typeof image !== 'object' || Array.isArray(image)) continue;
      const item = image as Record<string, unknown>;
      entries.push({
        pageIndex: item.pageIndex,
        path: item.path,
        ocrText: item.ocrText,
        hasVisual: false,
      });
    }
  }
  if (Array.isArray(record.pages)) {
    for (const page of record.pages) {
      if (!page || typeof page !== 'object' || Array.isArray(page)) continue;
      const item = page as Record<string, unknown>;
      if (item.hasVisual !== true) continue;
      entries.push({
        pageIndex: item.index,
        path: item.imagePath,
        ocrText: item.text,
        hasVisual: true,
      });
    }
  }
}

export function visualEntriesFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): VisualEntry[] {
  const entries: VisualEntry[] = [];
  Object.values(variables).forEach((value) => scanArtifact(value, entries));
  Object.values(stepResults).forEach((value) => scanArtifact(value, entries));
  return entries;
}
