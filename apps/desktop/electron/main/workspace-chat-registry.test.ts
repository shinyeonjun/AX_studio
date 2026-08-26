import { afterEach, describe, expect, it } from 'vitest';
import {
  abortAllWorkspaceChats,
  cancelWorkspaceChat,
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
});
