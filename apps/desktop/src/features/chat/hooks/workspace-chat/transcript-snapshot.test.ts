import { describe, expect, it } from 'vitest';
import type { WorkspaceChatMessage } from '@ax-studio/core';
import { transcriptSnapshot } from './transcript-snapshot';

describe('transcript snapshots', () => {
  it('keep unchanged messages as the same objects across saves, so rows do not re-render', () => {
    const first = transcriptSnapshot([
      { role: 'user', content: '재고 표' },
      { role: 'assistant', content: '| a |', presentations: [] },
    ] as WorkspaceChatMessage[], 'r1');
    // A save returns fresh objects from the host, plus one new message.
    const second = transcriptSnapshot([
      { role: 'user', content: '재고 표' },
      { role: 'assistant', content: '| a |', presentations: [] },
      { role: 'user', content: '정렬해줘' },
    ] as WorkspaceChatMessage[], 'r2', first.messages);
    expect(second.messages[0]).toBe(first.messages[0]);
    expect(second.messages[1]).toBe(first.messages[1]);
    expect(Object.isFrozen(second.messages[2])).toBe(true);
  });

  it('replaces a message whose content changed', () => {
    const first = transcriptSnapshot([{ role: 'assistant', content: '실행 중', executionStatus: 'pending_approval' }] as WorkspaceChatMessage[]);
    const second = transcriptSnapshot([{ role: 'assistant', content: '실행 중', executionStatus: 'success' }] as WorkspaceChatMessage[], undefined, first.messages);
    expect(second.messages[0]).not.toBe(first.messages[0]);
    expect(second.messages[0]).toMatchObject({ executionStatus: 'success' });
  });
});
