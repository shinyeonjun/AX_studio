import { describe, expect, it } from 'vitest';
import { executionLogSummary } from './execution-log-summary.js';

describe('execution log summary', () => {
  it.each(['success', 'failed', 'cancelled'])('does not describe a terminal %s execution as awaiting approval in older logs', status => {
    const summary = executionLogSummary(JSON.stringify([
      { code: 'waiting_approval', message: '승인을 기다리고 있습니다.', data: { stepId: 'send' } },
      { message: 'slack.send', data: { channel: 'allowed-test-channel' } },
    ]), status);
    expect(summary.currentStepStatus).not.toBe('waiting_approval');
    expect(summary.currentStepMessage).toBeUndefined();
  });

  it('replaces approval waiting progress when the user rejects the execution', () => {
    const summary = executionLogSummary(JSON.stringify([
      { code: 'waiting_approval', message: '승인을 기다리고 있습니다.', data: { stepId: 'send' } },
      { code: 'approval_rejected', message: '승인이 거절되어 실행을 취소했습니다.' },
    ]));

    expect(summary.currentStepMessage).toBe('승인이 거절되어 실행을 취소했습니다.');
    expect(summary.currentStepStatus).not.toBe('waiting_approval');
  });

  it('shows only Korean: translates failure codes and English errors, hides other raw lines', () => {
    const failed = executionLogSummary(JSON.stringify([
      { level: 'info', message: 'http.request', data: { stepId: 'fetch' } },
      { level: 'error', message: 'http.request_failed', data: { status: 500 } },
    ]), 'failed');
    expect(failed.errorMessage).toBe('작업을 완료하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
    expect(failed.lastLogMessage).toBe(failed.errorMessage);

    const coded = executionLogSummary(JSON.stringify([
      { level: 'error', code: 'step_failed', message: 'to_required', data: { stepId: 'send' } },
      { level: 'error', code: 'action_failed', message: 'Cannot read properties of undefined' },
    ]), 'failed');
    expect(coded.currentStepMessage).toBe('받는 사람이 비어 있어요. 받는 사람을 정해 주세요.');
    expect(coded.errorMessage).toBe('작업을 완료하지 못했습니다');

    const running = executionLogSummary(JSON.stringify([
      { level: 'info', code: 'ai_decision_completed', message: 'AI 분석 완료: classify_step', data: { stepId: 'classify_step' } },
    ]), 'running');
    expect(running.lastLogMessage).toBe('AI 분석을 마쳤습니다.');
    expect(executionLogSummary(JSON.stringify([{ level: 'info', message: 'slack.send' }]), 'running').lastLogMessage).toBeUndefined();
  });

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

    expect(summary.generatedFile).toEqual({
      artifactId: 'art_pdf_1',
      fileName: 'report.pdf',
      size: 1234,
      mimeType: 'application/pdf',
      label: 'PDF',
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
    expect(summary.generatedFile).toBeUndefined();
  });

  it('shows a Word report the run wrote, named as Word', () => {
    const summary = executionLogSummary(JSON.stringify([
      {
        code: 'docx_generated',
        data: {
          artifactId: 'art_docx_1',
          fileName: '9월 보고서.docx',
          size: 2048,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      },
    ]), 'success');

    expect(summary.generatedFile).toMatchObject({ artifactId: 'art_docx_1', fileName: '9월 보고서.docx', label: 'Word' });
  });

  it('does not show an error the run recovered from as the reason a successful run failed', () => {
    const log = JSON.stringify([
      { level: 'error', message: 'http.request_failed', data: { status: 500 } },
      { level: 'info', code: 'step_completed', message: '단계 완료', data: { stepId: 'fetch' } },
    ]);

    expect(executionLogSummary(log, 'success').errorMessage).toBeUndefined();
    expect(executionLogSummary(log, 'failed').errorMessage).toBeDefined();
  });
});
