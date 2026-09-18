import { afterEach, describe, expect, it } from 'vitest';
import {
  abortAllWorkspaceChats,
  cancelWorkspaceChat,
  cancelWorkspaceChatSession,
  registerWorkspaceChat,
  releaseWorkspaceChat,
} from './workspace-chat-registry.js';

describe('workspace chat registry', () => {
  afterEach(() => abortAllWorkspaceChats());

  it('keeps a replacement request registered when the previous request releases', () => {
    const first = registerWorkspaceChat('request-1');
    const replacement = registerWorkspaceChat('request-1');

    expect(first.signal.aborted).toBe(true);
    expect(replacement.signal.aborted).toBe(false);

    releaseWorkspaceChat('request-1', first);

    expect(cancelWorkspaceChat('request-1')).toBe(true);
    expect(replacement.signal.aborted).toBe(true);
  });

  it('removes the current request when it releases', () => {
    const controller = registerWorkspaceChat('request-1');

    releaseWorkspaceChat('request-1', controller);

    expect(cancelWorkspaceChat('request-1')).toBe(false);
    expect(controller.signal.aborted).toBe(false);
  });

  it('cancels every request belonging to a deleted session', () => {
    const first = registerWorkspaceChat('request-1', 'session-1');
    const second = registerWorkspaceChat('request-2', 'session-1');
    const other = registerWorkspaceChat('request-3', 'session-2');

    expect(cancelWorkspaceChatSession('session-1')).toBe(2);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
  });
});
