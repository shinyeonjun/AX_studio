import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { StdioDocumentEngineClient } from '../read/engine-client.js';
import { defaultPythonPath } from '../read/engine-client/paths.js';

/** Runs against the real document engine only where its Python and libraries are installed. */
function engineAvailable(): boolean {
  try {
    return spawnSync(defaultPythonPath(), ['-c', 'import pypdf, pypdfium2, reportlab'], { timeout: 30_000 }).status === 0;
  } catch {
    return false;
  }
}

const root = mkdtempSync(join(tmpdir(), 'ax-single-report-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(!engineAvailable())('last month\'s report alone, through the real document engine', () => {
  it('lists its text, takes the values out, and finds them as slots against the blank it made', async () => {
    const example = join(root, 'august.pdf');
    const script = join(root, 'make.py');
    writeFileSync(script, [
      'import sys',
      'from reportlab.pdfgen import canvas',
      'from reportlab.lib.pagesizes import A4',
      'c = canvas.Canvas(sys.argv[1], pagesize=A4)',
      'c.setFont("Helvetica", 10)',
      'c.drawString(48, 790, "Monthly sales report")',
      'c.drawString(48, 760, "Period: 2026-08")',
      'c.drawString(48, 730, "Total: 1800")',
      'c.showPage()',
      'c.save()',
    ].join('\n'));
    expect(spawnSync(defaultPythonPath(), [script, example]).status).toBe(0);

    const engine = new StdioDocumentEngineClient({ artifactRoot: join(root, 'artifacts'), timeoutMs: 60_000 });
    const listed = await engine.pdfReportSpans(example);
    const texts = listed.spans.map((span) => span.text);
    expect(texts).toEqual(expect.arrayContaining(['Monthly sales report', 'Period: 2026-08', 'Total: 1800']));

    const removals = listed.spans.flatMap((span) => {
      const value = /\d[\d,-]*$/u.exec(span.text)?.[0];
      return value ? [{ pageIndex: span.pageIndex, rect: span.rect, text: value }] : [];
    });
    const blank = await engine.pdfReportBlank(example, removals, join(root, 'blank.pdf'));
    const pair = await engine.pdfReportAnalyze(blank.templatePath, example);

    expect(pair.scalarSlots.map((slot) => slot.exampleText).sort()).toEqual(['1800', '2026-08']);
  }, 120_000);
});
