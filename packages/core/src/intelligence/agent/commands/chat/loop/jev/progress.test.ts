import { afterEach, describe, expect, it, vi } from 'vitest';
import { readProgressMessage, ROUTE_SLOW_NOTICE_MS, routeProgress } from './progress.js';

afterEach(() => { vi.useRealTimers(); });

describe('chat progress while a request is handled', () => {
  it('says it is checking the request, and that it is slow only once it is', () => {
    vi.useFakeTimers();
    const messages: string[] = [];
    const stop = routeProgress(({ message }) => { messages.push(message); });
    expect(messages).toEqual(['요청을 확인하고 있어요.']);
    vi.advanceTimersByTime(ROUTE_SLOW_NOTICE_MS);
    expect(messages[1]).toContain('평소보다 오래');
    stop();

    const quick: string[] = [];
    routeProgress(({ message }) => { quick.push(message); })();
    vi.advanceTimersByTime(ROUTE_SLOW_NOTICE_MS * 2);
    expect(quick).toHaveLength(1);
  });

  it('a turn that already ended does not crash the late notice', () => {
    vi.useFakeTimers();
    routeProgress(({ message }) => { if (message.includes('오래')) throw new Error('stale turn'); });
    expect(() => vi.advanceTimersByTime(ROUTE_SLOW_NOTICE_MS)).not.toThrow();
  });

  it('names the read being run, and nothing for other commands', () => {
    expect(readProgressMessage({ name: 'capability.invoke', args: { id: 'slack.messages.read', params: {} } }))
      .toBe('가져오고 있어요: Slack 채널 읽기');
    expect(readProgressMessage({ name: 'capability.invoke', args: { id: 'slack.message.send', params: {} } })).toBeUndefined();
  });
});
