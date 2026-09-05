import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MockDesktopPrintBridge,
  setDesktopPrintBridge,
} from '../../../../document-write/desktop-print.js';
import type { ArtifactSink, ConnectorContext } from '../../../types.js';
import { ArtifactStore } from '../../../../store/artifact-store.js';
import {
  MockDocumentEngineClient,
  setDocumentEngineClient,
} from '../../../../document-engine/engine-client.js';
import type { PdfFormFillResult } from '../../../../document-engine/types.js';
import { pdfFormFill } from './form-fill.js';
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
  setDocumentEngineClient(null);
});

describe('document.pdf.generate successful output', () => {
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
});

describe('document.pdf.form.fill successful output', () => {
  it('publishes the same bounded generated-PDF contract as HTML PDF generation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-filled-report-'));
    const templatePath = join(root, 'template.pdf');
    const outputPath = join(root, 'filled.pdf');
    writeFileSync(templatePath, '%PDF-1.7 template');

    const engine = new MockDocumentEngineClient();
    engine.pdfFormFill = async (): Promise<PdfFormFillResult> => {
      writeFileSync(outputPath, '%PDF-1.7 filled');
      return {
        sourcePath: templatePath,
        outputPath,
        sourceHash: 'source-hash',
        outputHash: 'output-hash',
        pageCount: 1,
        fieldCount: 1,
        writerEngine: 'pymupdf',
        verified: true,
        interactive: false,
        sourceUnchanged: true,
      };
    };
    setDocumentEngineClient(engine);
    const generatedStore = new ArtifactStore(join(root, 'generated'));
    const ctx: ConnectorContext = {
      executionId: 'execution-filled-pdf-test',
      variables: {},
      connections: [{
        connector: 'local_folder',
        connected: true,
        config: { folders: [{ id: 'folder-1', label: 'fixture', path: root }] },
      }],
      artifactSink: generatedStore,
      log: vi.fn(),
    };

    const result = await pdfFormFill({
      path: templatePath,
      template: {},
      values: { field_1: '한글 값' },
      outputPath,
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      data: {
        artifact: {
          id: expect.any(String),
          fileName: 'filled.pdf',
          mimeType: 'application/pdf',
          size: expect.any(Number),
        },
      },
    });
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      code: 'pdf_generated',
      data: expect.objectContaining({
        artifactId: expect.any(String),
        fileName: 'filled.pdf',
        mimeType: 'application/pdf',
      }),
    }));
  });
});
