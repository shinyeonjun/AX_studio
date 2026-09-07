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
    expect(allowsCloudPlainChatRead('http.request')).toBe(false);
    expect(allowsCloudPlainChatRead('rdb.query.read')).toBe(false);
    expect(allowsCloudPlainChatRead('local_sheet.read')).toBe(false);
    expect(allowsCloudPlainChatRead('rdb.schema.describe')).toBe(true);
  });

  it('truncates search hit snippets for cloud responses', () => {
    const longSnippet = 'x'.repeat(400);
    const envelope = sanitizeCloudReadEnvelope({
      capabilityId: 'slack.messages.search',
      data: { hits: [{ ref: { id: '1', kind: 'message', connector: 'slack' }, score: 1, snippet: longSnippet }] },
      citations: [],
      untrusted: true,
    });
    const hits = (envelope.data as { hits: Array<{ snippet?: string }> }).hits;
    expect(hits[0]?.snippet?.length).toBeLessThanOrEqual(240);
  });

  it('fails closed when sanitization is invoked directly for an unsupported data shape', () => {
    const result = sanitizeCloudReadEnvelope({
      capabilityId: 'http.request', data: { body: 'private-data' },
      citations: [], untrusted: true,
    });
    expect(result.data).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private-data');
    expect(result.evidence).toMatchObject({ truncated: true, reason: 'privacy_policy' });
  });

  it('retains known channel metadata while stripping raw provider fields', () => {
    const result = sanitizeCloudReadEnvelope({
      capabilityId: 'slack.channels.list',
      data: { channels: [{ id: 'C1', name: 'general', numMembers: 3, raw: 'private-data' }], body: 'private-data' },
      citations: [], untrusted: true,
    });
    expect(result.data).toEqual({ channels: [{ id: 'C1', name: 'general', numMembers: 3 }] });
  });

  it('retains Gmail list message identifiers without copying arbitrary body fields', () => {
    const result = sanitizeCloudReadEnvelope({
      capabilityId: 'gmail.messages.search',
      data: [{ id: 'm1', threadId: 't1', body: 'private-body' }],
      citations: [], untrusted: true,
    });
    expect(JSON.stringify(result)).toContain('"id":"m1"');
    expect(JSON.stringify(result)).toContain('"threadId":"t1"');
    expect(JSON.stringify(result)).not.toContain('private-body');
  });
});
