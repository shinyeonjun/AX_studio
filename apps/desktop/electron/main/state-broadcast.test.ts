import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('./app-window.js', () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { send } }),
}));

const { notifyStateChanged, STATE_CHANGED_THROTTLE_MS } = await import('./state-broadcast.js');

function stateSends(): number {
  return send.mock.calls.filter(([channel]) => channel === 'ax:state-changed').length;
}

describe('state change broadcast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    send.mockClear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('sends the first change at once and collapses a burst into one trailing send', () => {
    for (let step = 0; step < 30; step += 1) notifyStateChanged();
    expect(stateSends()).toBe(1);
    vi.advanceTimersByTime(STATE_CHANGED_THROTTLE_MS);
    expect(stateSends()).toBe(2);
    vi.advanceTimersByTime(STATE_CHANGED_THROTTLE_MS * 5);
    expect(stateSends()).toBe(2);
  });

  it('never drops the last change of a long-running stream', () => {
    for (let tick = 0; tick < 25; tick += 1) {
      notifyStateChanged();
      vi.advanceTimersByTime(STATE_CHANGED_THROTTLE_MS / 4);
    }
    const duringStream = stateSends();
    expect(duringStream).toBeLessThanOrEqual(8);
    vi.advanceTimersByTime(STATE_CHANGED_THROTTLE_MS * 3);
    // After the stream stops, exactly one more send carries the final state.
    expect(stateSends()).toBe(duringStream + 1);
  });

  it('sends a lone change immediately once the window has passed', () => {
    notifyStateChanged();
    vi.advanceTimersByTime(STATE_CHANGED_THROTTLE_MS * 2);
    notifyStateChanged();
    expect(stateSends()).toBe(2);
  });
});
