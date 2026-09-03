import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MockDesktopPrintBridge,
  setDesktopPrintBridge,
} from '../../../../document-write/desktop-print.js';
import type { ArtifactSink, ConnectorContext } from '../../../types.js';
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

describe('document.pdf.generate failure modes', () => {
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
