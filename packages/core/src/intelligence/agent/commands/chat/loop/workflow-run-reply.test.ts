import { describe, expect, it } from 'vitest';
import type { AxCommandResult } from '../../schema.js';
import { workflowRunReply } from './loop-shared.js';

const run = (status: AxCommandResult['status'], extra: Partial<AxCommandResult> = {}): AxCommandResult =>
  ({ command: 'workflow.run', status, data: { executionId: 'exec-1' }, issues: [], ...extra }) as AxCommandResult;

describe('reply to a confirmed run', () => {
  it.each(['ok', 'queued'] as const)('says the run started when the runner accepted it (%s)', (status) => {
    const reply = workflowRunReply(run(status));
    expect(reply).toContain('실행을 시작했습니다');
    expect(reply).not.toMatch(/못했습니다|실패/u);
  });

  it('explains a refused run with the runner\'s reason', () => {
    const reply = workflowRunReply(run('error', { data: undefined, issues: [{ code: 'workflow_runner_unavailable', message: '실행기가 연결되지 않았습니다.' }] } as never));
    expect(reply).toBe('실행기가 연결되지 않았습니다.');
  });
});
