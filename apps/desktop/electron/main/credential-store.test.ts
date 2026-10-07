import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return text.slice(4);
    },
  },
}));
vi.mock('./credential-paths.js', () => ({
  getCredentialsDir: () => state.dir,
  getSecretPath: (name: string) => join(state.dir, `secret-${name}.cred`),
  getCredentialPath: (connector: string, id: string) => join(state.dir, `${connector}-${id}.cred`),
}));

import { getOsSecret, getOsSecretOrNull, isCredentialUnavailableError, OsCredentialStore, setOsSecret } from './credential-store.js';

describe('credential store', () => {
  beforeEach(() => { state.dir = mkdtempSync(join(tmpdir(), 'ax-cred-')); });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(state.dir, { recursive: true, force: true });
  });

  it('round-trips a secret through an fsynced temp file without leaving it behind', async () => {
    await setOsSecret('token', 'value-1');
    await setOsSecret('token', 'value-2');
    expect(await getOsSecret('token')).toBe('value-2');
    expect(readdirSync(state.dir)).toEqual(['secret-token.cred']);
  });

  it('turns zero-length and undecryptable files into typed errors', async () => {
    writeFileSync(join(state.dir, 'secret-empty.cred'), '');
    writeFileSync(join(state.dir, 'secret-rotated.cred'), 'other-machine-ciphertext');

    await expect(getOsSecret('empty')).rejects.toMatchObject({ code: 'credential_decrypt_failed' });
    await expect(getOsSecret('rotated')).rejects.toSatisfy(isCredentialUnavailableError);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(getOsSecretOrNull('rotated')).resolves.toBeNull();
    await expect(getOsSecretOrNull('missing')).resolves.toBeNull();
  });

  it('reports corrupt OAuth credential JSON without echoing decrypted content', async () => {
    writeFileSync(join(state.dir, 'gmail-main.cred'), 'enc:{"refreshToken":"secret-refresh');
    const error = await new OsCredentialStore().get({ connector: 'gmail', connectionId: 'main' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'invalid_credential_json' });
    expect(String((error as Error).message)).not.toContain('secret-refresh');
    expect((error as Error).message).toBe("'Gmail' 연결 정보가 손상됐어요. 다시 연결해 주세요.");
    expect((error as Error).message).not.toContain('main');
  });

  it('names a stored secret the way a person would, never by its raw id', async () => {
    writeFileSync(join(state.dir, 'secret-slack.tokens.cred'), 'other-machine-ciphertext');
    await expect(getOsSecret('slack.tokens')).rejects.toThrow("저장된 'Slack' 연결 정보를 읽을 수 없어요. 설정에서 다시 연결해 주세요.");
    writeFileSync(join(state.dir, 'secret-unknown.cred'), 'other-machine-ciphertext');
    await expect(getOsSecret('unknown')).rejects.toThrow('저장된 연결 정보를 읽을 수 없어요. 설정에서 다시 연결해 주세요.');
  });
});
