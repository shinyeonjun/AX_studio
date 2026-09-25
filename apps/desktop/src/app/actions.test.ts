import { describe, expect, it, vi } from 'vitest';
import { retryFailedAppSources } from './actions';

describe('retryFailedAppSources', () => {
  it('retries only the failed source', () => {
    const refresh = vi.fn(async () => {});
    const refreshSessions = vi.fn(async () => {});
    const refreshDetection = vi.fn(async () => ({}));

    retryFailedAppSources({
      stateFailed: true,
      sessionsFailed: false,
      detectionFailed: false,
      actionFailed: false,
      refresh,
      refreshSessions,
      refreshDetection,
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(refreshSessions).not.toHaveBeenCalled();
    expect(refreshDetection).not.toHaveBeenCalled();
  });

  it('retries a failed chat-session source without probing AI CLIs', () => {
    const refresh = vi.fn(async () => {});
    const refreshSessions = vi.fn(async () => {});
    const refreshDetection = vi.fn(async () => ({}));

    retryFailedAppSources({
      stateFailed: false,
      sessionsFailed: true,
      detectionFailed: false,
      actionFailed: false,
      refresh,
      refreshSessions,
      refreshDetection,
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(refreshSessions).toHaveBeenCalledOnce();
    expect(refreshDetection).not.toHaveBeenCalled();
  });

  it('retries AI detection alone and contains its rejected promise', () => {
    const refresh = vi.fn(async () => {});
    const refreshSessions = vi.fn(async () => {});
    const refreshDetection = vi.fn(async () => {
      throw new Error('detection failed');
    });

    retryFailedAppSources({
      stateFailed: false,
      sessionsFailed: false,
      detectionFailed: true,
      actionFailed: false,
      refresh,
      refreshSessions,
      refreshDetection,
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(refreshSessions).not.toHaveBeenCalled();
    expect(refreshDetection).toHaveBeenCalledOnce();
  });

  it('refreshes app state and chat list after an action failure, not AI CLIs', () => {
    const refresh = vi.fn(async () => {});
    const refreshSessions = vi.fn(async () => {});
    const refreshDetection = vi.fn(async () => ({}));

    retryFailedAppSources({
      stateFailed: false,
      sessionsFailed: false,
      detectionFailed: false,
      actionFailed: true,
      refresh,
      refreshSessions,
      refreshDetection,
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(refreshSessions).toHaveBeenCalledOnce();
    expect(refreshDetection).not.toHaveBeenCalled();
  });
});
