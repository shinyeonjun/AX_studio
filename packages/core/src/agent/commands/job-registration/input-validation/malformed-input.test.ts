import { describe, expect, it } from 'vitest';
import { commandChatContext, connectedService } from '../fixtures.js';

describe('job.propose malformed input protection', () => {
  it('does not leak Zod JSON when propose arguments are unusable', async () => {
    const { service, chat } = await connectedService();
    const response = await service.execute({
      name: 'job.propose',
      args: { name: 1, goal: true },
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('invalid');
    expect(response.issues[0]?.message).toBe('업무 초안 형식이 올바르지 않습니다.');
    expect(JSON.stringify(response)).not.toContain('invalid_type');
  });
});
