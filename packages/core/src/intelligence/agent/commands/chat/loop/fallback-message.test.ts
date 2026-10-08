import { describe, expect, it } from 'vitest';
import { JevDecisionError } from '../../../../decision/jev/errors.js';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { AgentHarness } from '../../../harness.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { scriptedModel } from '../testing/fixtures.js';
import { jevFallbackMessage } from './turn-context.js';

describe('the reply when Jev fails mid-request', () => {
  it('sends the person to settings only when the key was rejected', () => {
    expect(jevFallbackMessage('service_error', 'busy')).not.toContain('설정 > 판단 엔진');
    expect(jevFallbackMessage('service_error', 'busy')).toContain('잠시 뒤 다시 보내 주세요');
    expect(jevFallbackMessage('service_error', 'unreachable')).toContain('인터넷 연결');
    expect(jevFallbackMessage('service_error', 'key_rejected')).toContain('설정 > 판단 엔진');
  });

  it('answers a request with the busy wording when Jev returns 503, without touching settings', async () => {
    const db = await createDatabaseAsync(':memory:');
    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [], 'test-provider')),
      commandService: new AxCommandService(new WorkflowStore(db)),
      decisionEngine: { evaluate: async () => { throw new JevDecisionError('TypeSafe returned invalid JSON (503).', 503, 3); } },
      messages: [],
      userMessage: '주문 목록 보여줘',
    });
    expect(reply).toBe(jevFallbackMessage('service_error', 'busy'));
    db.close?.();
  });
});
