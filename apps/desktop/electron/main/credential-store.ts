import { safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import type { CredentialRef, CredentialStore, OAuthCredential } from '@ax-studio/core';
import { getCredentialPath, getCredentialsDir, getSecretPath } from './credential-paths.js';

function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 PC에서 OS 자격 증명 암호화를 사용할 수 없습니다.');
  }
}

function ensureCredentialsDir(): string {
  const dir = getCredentialsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function getOsSecret(name: string): Promise<string | null> {
  const path = getSecretPath(name);
  if (!existsSync(path)) return null;
  assertEncryptionAvailable();
  return safeStorage.decryptString(readFileSync(path));
}

export async function setOsSecret(name: string, value: string): Promise<void> {
  assertEncryptionAvailable();
  ensureCredentialsDir();
  writeFileSync(getSecretPath(name), safeStorage.encryptString(value));
}

export async function deleteOsSecret(name: string): Promise<void> {
  const path = getSecretPath(name);
  if (existsSync(path)) unlinkSync(path);
}

export class OsCredentialStore implements CredentialStore {
  async get(ref: CredentialRef): Promise<OAuthCredential | null> {
    const path = getCredentialPath(ref.connector, ref.connectionId);
    if (!existsSync(path)) return null;
    assertEncryptionAvailable();
    const encrypted = readFileSync(path);
    const json = safeStorage.decryptString(encrypted);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`자격 증명 ${ref.connector}/${ref.connectionId}의 저장 데이터가 손상되었습니다: ${detail}`), {
        code: 'invalid_credential_json',
        connector: ref.connector,
        connectionId: ref.connectionId,
      });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof (parsed as { refreshToken?: unknown }).refreshToken !== 'string') {
      throw Object.assign(new Error(`자격 증명 ${ref.connector}/${ref.connectionId}의 형식이 올바르지 않습니다.`), {
        code: 'invalid_credential_json',
        connector: ref.connector,
        connectionId: ref.connectionId,
      });
    }
    return parsed as OAuthCredential;
  }

  async set(ref: CredentialRef, credential: OAuthCredential): Promise<void> {
    assertEncryptionAvailable();
    ensureCredentialsDir();
    const payload: OAuthCredential = { refreshToken: credential.refreshToken };
    const encrypted = safeStorage.encryptString(JSON.stringify(payload));
    writeFileSync(getCredentialPath(ref.connector, ref.connectionId), encrypted);
  }

  async delete(ref: CredentialRef): Promise<void> {
    const path = getCredentialPath(ref.connector, ref.connectionId);
    if (existsSync(path)) unlinkSync(path);
  }
}

let credentialStore: OsCredentialStore | null = null;

export function getCredentialStore(): OsCredentialStore {
  if (!credentialStore) credentialStore = new OsCredentialStore();
  return credentialStore;
}
