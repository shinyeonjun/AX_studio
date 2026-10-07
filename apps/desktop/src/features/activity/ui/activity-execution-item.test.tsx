import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivityExecutionItem } from './activity-execution-item.js';

const actions = { deleting: false, clearing: false, exporting: false, isExporting: false, exported: false,
  savingToFolder: false, isSavingToFolder: false, savedToFolder: false,
  onDelete: vi.fn(), onExportPdf: vi.fn(), onSavePdfToFolder: vi.fn() };

describe('historical calculated output entry', () => {
  it('restores the existing on-demand result button only for successful records with stored output', () => {
    const execution = { id: 'synthetic', status: 'success', startedAt: '2026-09-01T00:00:00Z', hasOutput: true };
    const markup = renderToStaticMarkup(<ActivityExecutionItem {...actions} execution={execution} />);
    expect(markup).toContain('계산 결과 보기');
    expect(markup).not.toContain('<pre>');
    for (const status of ['running', 'pending_approval', 'failed', 'cancelled']) {
      expect(renderToStaticMarkup(<ActivityExecutionItem {...actions} execution={{ ...execution, status }} />)).not.toContain('계산 결과 보기');
    }
    expect(renderToStaticMarkup(<ActivityExecutionItem {...actions} execution={{ ...execution, hasOutput: false }} />)).not.toContain('계산 결과 보기');
  });

  it('renders the diagnostic separately from stored execution status and result evidence', () => {
    const markup = renderToStaticMarkup(<ActivityExecutionItem {...actions} execution={{ id: 'synthetic', status: 'running',
      startedAt: '2026-09-01T00:00:00Z', historyDiagnostics: [{ source: 'log_tail', code: 'invalid_log_entry', sequence: 12 }] }} />);
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('invalid_log_entry');
    expect(markup).toContain('원본은 보존되어 있습니다.');
  });

  it('says a result check is needed instead of quality jargon and numbers steps', () => {
    const markup = renderToStaticMarkup(<ActivityExecutionItem {...actions} execution={{ id: 'synthetic', status: 'failed',
      resultStatus: 'failed', startedAt: '2026-09-01T00:00:00Z', currentStepId: 'jev_step_2' }} />);
    expect(markup).toContain('실행은 끝났지만 결과를 확인해야 해요');
    expect(markup).not.toContain('결과 품질');
    expect(markup).toContain('현재 단계 · 2단계');
    expect(markup).not.toContain('jev_step_2');
  });
});
