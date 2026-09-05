import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import type { ExecutionResult } from '../../types.js';
import { publishExecutionResultToWorkspaceChat } from '../../execution-result-message.js';
import { createExecution, result } from '../fixtures.js';
describe('bounded execution result projection', () => {
  it('writes one bounded assistant result to the mapped chat without copying raw payload data', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({
      workflowId: 'workflow-1',
      messages: [{ role: 'user', content: '결제 업무를 만들어줘' }],
    });
    const executionId = createExecution(store);
    const log: ExecutionResult['log'] = [
      {
        at: '2026-08-31T00:00:00.000Z',
        level: 'info',
        code: 'ai_decision_completed',
        message: 'AI 분석 완료',
        data: { outputPreview: { conclusion: 'inv_acme_1001 결제가 완료되었습니다.', category: 'paid', body: 'raw-provider-secret-body' } },
      },
      {
        at: '2026-08-31T00:00:02.000Z',
        level: 'info',
        code: 'pdf_generated',
        message: 'PDF 보고서를 생성하고 저장했습니다.',
        data: {
          artifactId: 'art_pdf_1',
          fileName: '2026-09_customer_report.pdf',
          size: 12_345,
          mimeType: 'application/pdf',
          storedPath: 'C:/private/report.pdf',
          pdfBytes: '%PDF-raw-should-not-be-forwarded',
        },
      },
      { at: '2026-08-31T00:00:01.000Z', level: 'info', code: 'step_completed', message: '단계를 완료했습니다.', data: { stepId: 'send' } },
    ];
    store.finishExecution(executionId, 'success', undefined, log);
    const event = publishExecutionResultToWorkspaceChat(store, result(executionId, 'success', log));
    expect(event).toEqual({ sessionId: chat.id, workflowId: 'workflow-1', executionId });
    const messages = store.getWorkspaceChat(chat.id)?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ role: 'assistant', kind: 'execution_result', executionId, executionStatus: 'success' });
    expect(messages[1]?.generatedPdf).toEqual({
      artifactId: 'art_pdf_1',
      fileName: '2026-09_customer_report.pdf',
      size: 12_345,
      mimeType: 'application/pdf',
    });
    expect(JSON.stringify(messages[1])).not.toContain('storedPath');
    expect(JSON.stringify(messages[1])).not.toContain('pdfBytes');
    expect(messages[1]?.content).toContain('실행이 완료되었습니다');
    expect(messages[1]?.content).toContain('inv_acme_1001 결제가 완료되었습니다.');
    expect(messages[1]?.content).toContain('Slack 메시지 완료');
    expect(messages[1]?.content).not.toContain('raw-provider-secret-body');
    publishExecutionResultToWorkspaceChat(store, result(executionId, 'success', log));
    expect(store.getWorkspaceChat(chat.id)?.messages).toHaveLength(2);
  });
});
