import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryInspectView } from '@ax-studio/core';

vi.mock('react', () => ({ useCallback: <T>(callback: T) => callback }));

import { useDiscoverySessionActions } from './session-actions';

const discoveryPublish = vi.fn();
const setWorkflowActive = vi.fn();

function actions(overrides: { refresh?: () => Promise<null>; onPublished?: (id: string) => Promise<void> } = {}) {
  const setError = vi.fn();
  const refresh = vi.fn(overrides.refresh ?? (async () => null));
  const onPublished = vi.fn(overrides.onPublished ?? (async () => undefined));
  const hook = useDiscoverySessionActions({
    operationEpochRef: { current: 0 },
    activeSessionId: 'session-1',
    activeView: { revision: 3 } as unknown as DiscoveryInspectView,
    setBusy: vi.fn(),
    setError,
    refresh,
    onPublished,
  });
  return { hook, setError, refresh, onPublished };
}

beforeEach(() => {
  discoveryPublish.mockReset().mockResolvedValue({ status: 'ok', data: { workflowId: 'wf-1' } });
  setWorkflowActive.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { ax: { discoveryPublish, setWorkflowActive } },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('publishing discovered work', () => {
  it('saves, starts the schedule and opens the work', async () => {
    const { hook, setError, onPublished } = actions();
    await expect(hook.publish(undefined, 'schedule')).resolves.toBe('wf-1');
    expect(setWorkflowActive).toHaveBeenCalledWith('wf-1', true);
    expect(onPublished).toHaveBeenCalledWith('wf-1');
    expect(setError).toHaveBeenLastCalledWith('');
  });

  it('says the work was saved but not turned on when activation fails', async () => {
    setWorkflowActive.mockRejectedValue(new Error('workflow not found'));
    const { hook, setError, onPublished } = actions();
    await expect(hook.publish(undefined, 'schedule')).resolves.toBe('wf-1');
    expect(onPublished).toHaveBeenCalledWith('wf-1');
    expect(setError).toHaveBeenLastCalledWith('업무는 저장했지만 켜지 못했습니다. 업무 목록에서 켜 주세요.');
  });

  it('does not report a failed save when only the refresh fails afterwards', async () => {
    const { hook, setError } = actions({ refresh: async () => { throw new Error('inspect failed'); } });
    await expect(hook.publish()).resolves.toBe('wf-1');
    expect(setError).toHaveBeenLastCalledWith('');
  });

  it('still reports a save that did not happen', async () => {
    discoveryPublish.mockResolvedValue({ status: 'error', issues: [{ message: '업무 이름이 필요합니다.' }] });
    const { hook, setError, onPublished } = actions();
    await expect(hook.publish(undefined, 'schedule')).resolves.toBeUndefined();
    expect(setWorkflowActive).not.toHaveBeenCalled();
    expect(onPublished).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('업무 이름이 필요합니다.');
  });
});
