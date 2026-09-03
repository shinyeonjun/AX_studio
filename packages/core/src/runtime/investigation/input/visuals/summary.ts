import { visualEntriesFromRun } from './scan.js';

export function documentVisualsFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): string | undefined {
  const lines: string[] = [];
  const seen = new Set<string>();

  const addVisual = (pageIndex: unknown, path: unknown, ocrText: unknown, hasVisual = false) => {
    const page = Number.isInteger(pageIndex) ? String(pageIndex) : '?';
    const imagePath = typeof path === 'string' && path.trim() ? path.trim() : '';
    const ocr = typeof ocrText === 'string' && ocrText.trim() ? ocrText.trim() : '';
    const key = `${page}|${imagePath}|${ocr}`;
    if (!imagePath && !ocr && !hasVisual) return;
    if (seen.has(key)) return;
    seen.add(key);
    const availability = ocr ? 'ocr_only' : 'visual_content_unavailable';
    lines.push(
      `- page=${page}${imagePath ? ` path=${imagePath}` : ''}${ocr ? ` OCR=${ocr}` : ''} visualContent=${availability}`,
    );
  };

  for (const entry of visualEntriesFromRun(variables, stepResults)) {
    addVisual(entry.pageIndex, entry.path, entry.ocrText, entry.hasVisual);
  }
  return lines.length > 0 ? lines.join('\n').slice(0, 8_000) : undefined;
}
