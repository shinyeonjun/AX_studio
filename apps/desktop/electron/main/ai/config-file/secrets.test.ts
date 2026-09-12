import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSecretForBrand, inspectSecretByEnvKey, loadAiSecretsIntoEnv, migrateAiSecretsToOsStore, setBrandSecret } from './secrets.js';

const fixtures = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), readConfig: vi.fn(), writeConfig: vi.fn(),
}));
vi.mock('../../credential-store.js', () => ({ getOsSecret: fixtures.read, setOsSecret: fixtures.write }));
vi.mock('../../env-file.js', () => ({ readEnvFile: async () => ({}) }));
vi.mock('./storage.js', () => ({ readAiToml: fixtures.readConfig, writeAiToml: fixtures.writeConfig }));

describe('AI credential recovery at startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.read.mockImplementation(async (key: string) => {
      if (key === 'OPENAI_API_KEY') throw new Error('synthetic DPAPI decryption failure');
      return key === 'ANTHROPIC_API_KEY' ? 'synthetic-working-key' : null;
    });
    fixtures.readConfig.mockResolvedValue({ providers: {}, secrets: {} });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('does not abort startup or overwrite an unreadable stored key during migration', async () => {
    await expect(migrateAiSecretsToOsStore()).resolves.toBeUndefined();
    expect(fixtures.write).not.toHaveBeenCalled();
  });

  it('loads independent working keys and clears an inherited fallback for an unreadable key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-stale-inherited-key');
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    await expect(loadAiSecretsIntoEnv()).resolves.toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(process.env.ANTHROPIC_API_KEY).toBe('synthetic-working-key');
  });

  it('keeps explicit key reads strict but permits an explicit replacement without reading the broken key', async () => {
    vi.stubEnv('OPENAI_API_KEY', undefined);
    await expect(getSecretForBrand('gpt')).rejects.toThrow('decryption failure');
    await expect(setBrandSecret('gpt', 'synthetic-replacement')).resolves.toBeUndefined();
    expect(fixtures.write).toHaveBeenCalledWith('OPENAI_API_KEY', 'synthetic-replacement');
    expect(process.env.OPENAI_API_KEY).toBe('synthetic-replacement');
  });

  it('returns an actionable status without exposing the underlying decryption error', async () => {
    const status = await inspectSecretByEnvKey('OPENAI_API_KEY');
    expect(status.value).toBe('');
    expect(status.error).toContain('다시 입력');
    expect(status.error).not.toContain('synthetic DPAPI');
  });

  it('does not swallow a failure to persist a newly migrated credential', async () => {
    fixtures.read.mockResolvedValue(null);
    fixtures.readConfig.mockResolvedValue({ providers: {}, secrets: { openai_api_key: 'synthetic-new-key' } });
    fixtures.write.mockRejectedValueOnce(new Error('synthetic disk failure'));
    await expect(migrateAiSecretsToOsStore()).rejects.toThrow('disk failure');
    expect(fixtures.writeConfig).not.toHaveBeenCalled();
  });
});
