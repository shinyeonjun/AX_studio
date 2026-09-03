import { describe, expect, it } from 'vitest';
import { resolveCapability } from '../capability-graph.js';

describe('capability graph alias resolution', () => {
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
