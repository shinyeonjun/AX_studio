import { expect, it } from 'vitest';
import { formatExecutionResultMessage } from '../runtime/execution-result/format.js';

it('projects the actual planning phase and safe recovery instructions into the result', () => {
  const text = formatExecutionResultMessage({ executionId: 'execution', status: 'failed', errorCode: 'agent_timeout',
    log: [{ at: '2032-01-01', level: 'error', code: 'agent_timeout', message: 'private provider detail',
      data: { phase: 'report-layout-plan', resumeAvailable: true } }],
  });
  expect(text).toContain('양식 배치 구성');
  expect(text).toContain('AI 처리 시간이 초과');
  expect(text).not.toContain('private provider detail');
});
