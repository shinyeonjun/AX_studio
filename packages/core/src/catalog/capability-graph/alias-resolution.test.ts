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

  it('resolves the versioned action reference emitted by workflow plans', () => {
    expect(resolveCapability('slack', 'slack.message.send@1')?.id).toBe('slack.message.send');
    expect(resolveCapability('gmail', 'gmail.message.send@1')?.id).toBe('gmail.message.send');
  });

  it('rejects versions that the host does not implement', () => {
    expect(resolveCapability('slack', 'slack.message.send@2')).toBeUndefined();
  });
});
