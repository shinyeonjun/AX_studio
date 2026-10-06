import { afterEach, describe, expect, it } from 'vitest';
import { MockDesktopPrintBridge } from '../../../testing/desktop-print.js';
import { pdfFileName } from './generate.js';
import {
  generatePdf,
  isPdfGeneratePending,
  setDesktopPrintBridge,
} from '../index.js';

describe('generatePdf', () => {
  afterEach(() => {
    setDesktopPrintBridge(null);
  });

  it('returns pending when desktop bridge is not configured', async () => {
    const result = await generatePdf({ html: '<html><body>x</body></html>' });
    expect(isPdfGeneratePending(result)).toBe(true);
    if (isPdfGeneratePending(result)) {
      expect(result.needsDesktopPrint).toBe(true);
    }
  });

  it('returns PDF bytes when desktop bridge is configured', async () => {
    const bridge = new MockDesktopPrintBridge();
    setDesktopPrintBridge(bridge);

    const result = await generatePdf({
      html: '<html><body>report</body></html>',
      title: 'Monthly Report',
    });

    expect(isPdfGeneratePending(result)).toBe(false);
    if (!isPdfGeneratePending(result)) {
      expect(result.pdfBytes.length).toBeGreaterThan(0);
      expect(result.fileName).toBe('Monthly_Report.pdf');
      expect(result.mimeType).toBe('application/pdf');
    }
    expect(bridge.prints).toHaveLength(1);
  });

  it('normalizes NFD Hangul titles and bounds the file name length', () => {
    expect(pdfFileName('월간 보고서'.normalize('NFD'))).toBe('월간_보고서.pdf');
    expect(pdfFileName('report.pdf')).toBe('report.pdf');
    // Bounded by UTF-8 bytes (Linux/macOS limit names to 255 bytes; Hangul is 3 bytes each).
    expect(pdfFileName('가'.repeat(300))).toBe(`${'가'.repeat(58)}.pdf`);
    expect(Buffer.byteLength(pdfFileName('가'.repeat(300)), 'utf8')).toBeLessThanOrEqual(180);
    expect(pdfFileName('a'.repeat(300))).toBe(`${'a'.repeat(120)}.pdf`);
    expect(pdfFileName('   ')).toBe('report.pdf');
  });
});
