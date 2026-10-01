import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOsSecret: vi.fn(),
  setOsSecret: vi.fn(),
  readEnvFile: vi.fn(),
  readAiToml: vi.fn(),
  writeAiToml: vi.fn(),
}));

vi.mock('../../credential-store.js', () => ({
  getOsSecret: mocks.getOsSecret,
  setOsSecret: mocks.setOsSecret,
}));
vi.mock('../../env-file.js', () => ({ readEnvFile: mocks.readEnvFile }));
vi.mock('./storage.js', () => ({
  readAiToml: mocks.readAiToml,
  writeAiToml: mocks.writeAiToml,
}));

import { getJevSecret, migrateAiSecretsToOsStore } from './secrets.js';

describe('Jev credential preservation', () => {
  beforeEach(() => {
    mocks.getOsSecret.mockReset().mockResolvedValue(undefined);
    mocks.setOsSecret.mockReset().mockResolvedValue(undefined);
    mocks.readEnvFile.mockReset().mockResolvedValue({});
    mocks.readAiToml.mockReset();
    mocks.writeAiToml.mockReset().mockResolvedValue(undefined);
  });

  it('returns an existing synthetic OS credential without trimming it', async () => {
    mocks.getOsSecret.mockResolvedValueOnce(' synthetic-key ');

    await expect(getJevSecret()).resolves.toBe(' synthetic-key ');
  });

  it('preserves a synthetic legacy key exactly during migration', async () => {
    const rawKey = ' synthetic-key ';
    mocks.readAiToml.mockResolvedValue({ providers: {}, secrets: { TYPESAFE_API_KEY: rawKey } });

    await migrateAiSecretsToOsStore();

    expect(mocks.setOsSecret).toHaveBeenCalledWith('TYPESAFE_API_KEY', rawKey);
  });
});
