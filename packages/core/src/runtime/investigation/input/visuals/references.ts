import { visualEntriesFromRun } from './scan.js';

interface DocumentVisualReference {
  pageIndex?: number;
  path: string;
}

export function documentVisualReferencesFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): DocumentVisualReference[] {
  const references: DocumentVisualReference[] = [];
  const seen = new Set<string>();
  const add = (pageIndex: unknown, path: unknown) => {
    if (typeof path !== 'string' || !path.trim()) return;
    const normalized = path.trim();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    references.push({
      pageIndex: Number.isInteger(pageIndex) ? Number(pageIndex) : undefined,
      path: normalized,
    });
  };

  for (const entry of visualEntriesFromRun(variables, stepResults)) {
    add(entry.pageIndex, entry.path);
  }
  return references;
}
