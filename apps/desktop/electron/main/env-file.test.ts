import { describe, expect, it } from 'vitest';
import { ENV_FILE_ALLOWED_KEYS } from './env-file.js';

describe('development environment allowlist', () => {
  it('allows the optional Gmail OAuth client secret without allowing arbitrary keys', () => {
    expect(ENV_FILE_ALLOWED_KEYS.has('GOOGLE_OAUTH_CLIENT_ID')).toBe(true);
    expect(ENV_FILE_ALLOWED_KEYS.has('GOOGLE_OAUTH_CLIENT_SECRET')).toBe(true);
    expect(ENV_FILE_ALLOWED_KEYS.has('OPENAI_API_KEY')).toBe(false);
  });
});
