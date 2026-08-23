import { describe, expect, it } from 'vitest';
import { allowsCloudPlainChatRead, sanitizeCloudReadEnvelope } from './cloud-plain-chat-read.js';

describe('cloud plain chat read policy', () => {
  it('allows metadata/search reads but blocks full body reads', () => {
    expect(allowsCloudPlainChatRead('slack.messages.search')).toBe(true);
    expect(allowsCloudPlainChatRead('slack.channels.list')).toBe(true);
    expect(allowsCloudPlainChatRead('gmail.messages.search')).toBe(true);
    expect(allowsCloudPlainChatRead('gmail.messages.read')).toBe(false);
    expect(allowsCloudPlainChatRead('slack.messages.read')).toBe(false);
    expect(allowsCloudPlainChatRead('document.ingest')).toBe(false);
  });

  it('truncates search hit snippets for cloud responses', () => {
    const longSnippet = 'x'.repeat(400);
    const envelope = sanitizeCloudReadEnvelope({
      capabilityId: 'slack.messages.search',
      data: { hits: [{ id: '1', title: 't', snippet: longSnippet, source: 'slack' }] },
      citations: [],
      untrusted: true,
    });
    const hits = (envelope.data as { hits: Array<{ snippet?: string }> }).hits;
    expect(hits[0]?.snippet?.length).toBeLessThanOrEqual(240);
  });
});
