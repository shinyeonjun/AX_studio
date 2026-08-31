import { describe, expect, it } from 'vitest';
import { executionLogSummary } from './execution-log-summary.js';

describe('execution log summary', () => {
  it('exposes generated PDF metadata without stored paths or raw bytes', () => {
    const summary = executionLogSummary(JSON.stringify([
      {
        code: 'pdf_generated',
        message: 'PDF 보고서를 생성하고 저장했습니다.',
        data: {
          artifactId: 'art_pdf_1',
          fileName: '..\\reports/report.pdf',
          size: 1234,
          mimeType: 'application/pdf',
          storedPath: 'C:/Users/user/AppData/Local/AXStudio/generated/reports/art_pdf_1_report.pdf',
          pdfBytes: '%PDF-raw-should-not-be-forwarded',
        },
      },
    ]));

    expect(summary.generatedPdf).toEqual({
      artifactId: 'art_pdf_1',
      fileName: 'report.pdf',
      size: 1234,
      mimeType: 'application/pdf',
    });
    expect(summary).not.toHaveProperty('storedPath');
    expect(summary).not.toHaveProperty('pdfBytes');
    expect(JSON.stringify(summary)).not.toContain('AXStudio');
    expect(JSON.stringify(summary)).not.toContain('%PDF-raw');
  });

  it('ignores malformed or non-PDF generated entries while retaining ordinary summaries', () => {
    const summary = executionLogSummary(JSON.stringify([
      { code: 'step_completed', message: '단계 완료', data: { stepId: 'step-1' } },
      { code: 'pdf_generated', data: { artifactId: 'art_bad', fileName: 'report.pdf', size: -1 } },
      {
        code: 'pdf_generated',
        data: { artifactId: 'art_text', fileName: 'report.txt', size: 4, mimeType: 'text/plain' },
      },
    ]));

    expect(summary.currentStepId).toBe('step-1');
    expect(summary.generatedPdf).toBeUndefined();
  });
});
