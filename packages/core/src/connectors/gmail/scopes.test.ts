import { describe, expect, it } from 'vitest';
import { GMAIL_OAUTH_SCOPES, gmailCapabilityGranted } from './scopes.js';

describe('gmail scopes', () => {
  it('requests compose (which allows sending) without the redundant send scope', () => {
    expect(GMAIL_OAUTH_SCOPES).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ]);
    for (const capability of ['read', 'compose', 'send'] as const) {
      expect(gmailCapabilityGranted(GMAIL_OAUTH_SCOPES, capability)).toBe(true);
    }
  });

  it('keeps legacy grants that include gmail.send working and detects missing scopes', () => {
    const legacy = [...GMAIL_OAUTH_SCOPES, 'https://www.googleapis.com/auth/gmail.send'];
    expect(gmailCapabilityGranted(legacy, 'send')).toBe(true);
    expect(gmailCapabilityGranted(['https://www.googleapis.com/auth/gmail.readonly'], 'send')).toBe(false);
    expect(gmailCapabilityGranted(['gmail.send'], 'compose')).toBe(false);
  });
});
