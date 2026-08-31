import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MockDesktopPrintBridge,
  setDesktopPrintBridge,
} from '../../../../document-write/desktop-print.js';
import type { ArtifactSink, ConnectorContext } from '../../../types.js';
import { ArtifactStore } from '../../../../store/artifact-store.js';
import { pdfGenerate } from './generate.js';

function createContext(
  artifactSink?: ArtifactSink,
): ConnectorContext {
  return {
    executionId: 'execution-pdf-test',
    variables: { documentHtml: '<html><body>report</body></html>' },
    log: vi.fn(),
    ...(artifactSink ? { artifactSink } : {}),
  };
}

afterEach(() => {
  setDesktopPrintBridge(null);
});

describe('document.pdf.generate action', () => {
  it('persists PDF bytes and returns only a safe artifact reference', async () => {
    const bridge = new MockDesktopPrintBridge();
    setDesktopPrintBridge(bridge);
    const store = new ArtifactStore(mkdtempSync(join(tmpdir(), 'ax-generated-reports-')));
    const putBytes = vi.spyOn(store, 'putBytes');
    const artifactSink: ArtifactSink = store;
    const ctx = createContext(artifactSink);

    const result = await pdfGenerate({ title: 'Q1 / report' }, ctx);
    const data = result.data as {
      artifact: { id: string; fileName: string; size: number; mimeType?: string; sha256: string; createdAt: string };
      size: number;
    };
    const stored = store.get(data.artifact.id);

    expect(result).toMatchObject({
      ok: true,
      data: {
        needsDesktopPrint: false,
        size: expect.any(Number),
        mimeType: 'application/pdf',
        fileName: 'Q1_report.pdf',
        artifact: {
          id: expect.any(String),
          fileName: 'Q1_report.pdf',
          mimeType: 'application/pdf',
          size: expect.any(Number),
          sha256: expect.any(String),
          createdAt: expect.any(String),
        },
      },
    });
    expect(putBytes).toHaveBeenCalledWith(
      expect.any(Buffer),
      { fileName: 'Q1_report.pdf', mimeType: 'application/pdf' },
    );
    expect(stored).toBeDefined();
    expect(stored && readFileSync(stored.storedPath)).toEqual(Buffer.from('mock-pdf:Q1 / report'));
    expect(data.artifact.size).toBe(data.size);
    expect(data.artifact).not.toHaveProperty('storedPath');
    expect(ctx.variables).toMatchObject({
      reportPdfArtifact: expect.objectContaining({ id: data.artifact.id }),
      reportPdfArtifactId: data.artifact.id,
      reportPdfSize: data.artifact.size,
      generatedPdfName: 'Q1_report.pdf',
    });
    expect(ctx.variables).not.toHaveProperty('reportPdfBytes');
    expect(ctx.variables).not.toHaveProperty('documentHtml');

    const serializedState = JSON.stringify({
      variables: ctx.variables,
      result,
      logs: (ctx.log as ReturnType<typeof vi.fn>).mock.calls,
    });
    expect(serializedState).not.toContain('mock-pdf:Q1 / report');
    expect(serializedState).not.toContain('<html>');
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      code: 'pdf_generated',
      data: {
        artifactId: data.artifact.id,
        fileName: 'Q1_report.pdf',
        size: data.artifact.size,
        mimeType: 'application/pdf',
      },
    }));
  });

  it('fails closed before printing when artifact persistence is unavailable', async () => {
    const bridge = new MockDesktopPrintBridge();
    setDesktopPrintBridge(bridge);
    const ctx = createContext();

    const result = await pdfGenerate({ html: '<html>no sink</html>' }, ctx);

    expect(result).toEqual({
      ok: false,
      error: 'PDF 저장소가 준비되지 않았습니다.',
      errorCode: 'pdf_artifact_store_unavailable',
    });
    expect(bridge.prints).toHaveLength(0);
  });

  it('fails closed when the desktop print bridge is unavailable', async () => {
    setDesktopPrintBridge(null);
    const ctx = createContext({ putBytes: vi.fn() });

    const result = await pdfGenerate({}, ctx);

    expect(result).toEqual({
      ok: false,
      error: '데스크톱 PDF 인쇄 브리지가 준비되지 않았습니다.',
      errorCode: 'desktop_print_unavailable',
    });
    expect(ctx.variables).not.toHaveProperty('reportPdfBytes');
  });

  it('returns a distinct error when report storage fails after printing', async () => {
    setDesktopPrintBridge(new MockDesktopPrintBridge());
    const ctx = createContext({
      putBytes: vi.fn(() => {
        throw new Error('disk full');
      }),
    });

    const result = await pdfGenerate({ html: '<html>storage failure</html>' }, ctx);

    expect(result).toEqual({
      ok: false,
      error: 'PDF 저장에 실패했습니다: disk full',
      errorCode: 'pdf_artifact_store_failed',
    });
  });
});
