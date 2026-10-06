import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { ENV_FILE_ALLOWED_KEYS, stripDisallowedEnvLines } from './env-file.js';
import { getAiConfigPath } from './ai/config-file/storage.js';

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/checkout/apps/desktop' } }));
vi.mock('./data-paths.js', () => ({ getDesktopAxDataPaths: () => ({ config: '/isolated/config' }) }));

afterEach(() => vi.unstubAllEnvs());

describe('development environment allowlist', () => {
  it.each(['AX_E2E', 'AX_PRODUCT_QA'])('keeps %s AI preferences in the isolated profile', (flag) => {
    vi.stubEnv('AX_E2E', '');
    vi.stubEnv('AX_PRODUCT_QA', '');
    vi.stubEnv(flag, '1');
    expect(getAiConfigPath()).toBe(join('/isolated/config', 'ai.toml'));
  });
  it('allows the optional Gmail OAuth client secret without allowing arbitrary keys', () => {
    expect(ENV_FILE_ALLOWED_KEYS.has('GOOGLE_OAUTH_CLIENT_ID')).toBe(true);
    expect(ENV_FILE_ALLOWED_KEYS.has('GOOGLE_OAUTH_CLIENT_SECRET')).toBe(true);
    expect(ENV_FILE_ALLOWED_KEYS.has('OPENAI_API_KEY')).toBe(false);
  });
});

describe('stripDisallowedEnvLines', () => {
  it('removes only disallowed assignments and keeps comments, unknown lines and line endings', () => {
    const original = [
      '# local dev only',
      'GOOGLE_OAUTH_CLIENT_ID="client.apps.googleusercontent.com"',
      '',
      'OPENAI_API_KEY=sk-synthetic',
      'not an assignment',
      '  # indented comment',
      'GOOGLE_OAUTH_CLIENT_SECRET=synthetic',
      'OPENAI_API_KEY=duplicate',
      '',
    ].join('\r\n');
    const { content, removed } = stripDisallowedEnvLines(original);
    expect(removed).toEqual(['OPENAI_API_KEY']);
    expect(content).toBe([
      '# local dev only',
      'GOOGLE_OAUTH_CLIENT_ID="client.apps.googleusercontent.com"',
      '',
      'not an assignment',
      '  # indented comment',
      'GOOGLE_OAUTH_CLIENT_SECRET=synthetic',
      '',
    ].join('\r\n'));
  });

  it('is a no-op when every assignment is allowed', () => {
    const original = '# c\nGOOGLE_OAUTH_CLIENT_ID=x';
    expect(stripDisallowedEnvLines(original)).toEqual({ content: original, removed: [] });
  });
});
