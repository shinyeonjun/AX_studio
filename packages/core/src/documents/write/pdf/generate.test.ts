import { afterEach, describe, expect, it } from 'vitest';
import {
  generatePdf,
  isPdfGeneratePending,
  MockDesktopPrintBridge,
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
});
