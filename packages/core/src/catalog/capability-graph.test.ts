import { describe, expect, it } from 'vitest';
import { availableCapabilities, designCapabilities, resolveCapability } from './capability-graph.js';
import { cronMatches } from '../runtime/scheduler.js';

describe('capability graph', () => {
  it('hides gmail nodes until connected, keeps builtin tools', () => {
    const none = availableCapabilities([]);
    expect(none.some((cap) => cap.connector === 'gmail')).toBe(false);
    expect(none.some((cap) => cap.id === 'local_sheet.read')).toBe(true);
    expect(none.some((cap) => cap.id === 'document.html.render')).toBe(true);

    const withGmail = availableCapabilities(['gmail']);
    expect(withGmail.some((cap) => cap.id === 'gmail.message.send')).toBe(true);
  });

  it('keeps packaged notification actions visible for design before connection', () => {
    const design = designCapabilities();
    expect(design.some((cap) => cap.id === 'gmail.message.send')).toBe(true);
    expect(design.some((cap) => cap.id === 'slack.message.send')).toBe(true);
  });

  it('resolves send aliases to gmail.message.send', () => {
    expect(resolveCapability('gmail', 'send')?.id).toBe('gmail.message.send');
    expect(resolveCapability('gmail', 'message.send')?.id).toBe('gmail.message.send');
    expect(resolveCapability('gmail', 'send_message')?.id).toBe('gmail.message.send');
  });

  it('resolves slack send aliases to slack.message.send', () => {
    expect(resolveCapability('slack', 'send')?.id).toBe('slack.message.send');
    expect(resolveCapability('slack', 'message.send')?.id).toBe('slack.message.send');
    expect(resolveCapability('slack', 'send_message')?.id).toBe('slack.message.send');
    expect(resolveCapability('slack', 'slack.message.send')?.id).toBe('slack.message.send');
  });

});

describe('cron', () => {
  it('matches a friday afternoon expression', () => {
    const friday = new Date(2026, 7, 21, 17, 0, 0);
    expect(friday.getDay()).toBe(5);
    expect(cronMatches('0 17 * * 5', friday)).toBe(true);
    expect(cronMatches('0 17 * * 5', new Date(2026, 7, 21, 17, 1, 0))).toBe(false);
  });

  it('supports ranges and steps in the workflow timezone', () => {
    const atFivePmSeoul = new Date('2026-08-21T08:00:00.000Z');
    expect(cronMatches('*/15 17 * * 1-5', atFivePmSeoul, 'Asia/Seoul')).toBe(true);
    expect(cronMatches('0 17 * * 1-5', new Date('2026-08-21T08:01:00.000Z'), 'Asia/Seoul')).toBe(false);
  });

  it('treats restricted day-of-month and weekday fields as alternatives', () => {
    const friday = new Date(2026, 7, 21, 17, 0, 0);
    expect(cronMatches('0 17 20 * 5', friday)).toBe(true);
  });
});
