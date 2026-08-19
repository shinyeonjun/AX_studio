import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CredentialRef, CredentialStore, OAuthCredential } from '@ax-studio/core';

function credentialsDir(): string {
  const dir = join(app.getPath('userData'), 'credentials');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 PC에서 OS 자격 증명 암호화를 사용할 수 없습니다.');
  }
}

function credentialPath(ref: CredentialRef): string {
  return join(credentialsDir(), `${ref.connector}-${ref.connectionId}.cred`);
}

function secretPath(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(credentialsDir(), `secret-${safe}.cred`);
}

export async function getOsSecret(name: string): Promise<string | null> {
  const path = secretPath(name);
  if (!existsSync(path)) return null;
  assertEncryptionAvailable();
  return safeStorage.decryptString(readFileSync(path));
}

export async function setOsSecret(name: string, value: string): Promise<void> {
  assertEncryptionAvailable();
  writeFileSync(secretPath(name), safeStorage.encryptString(value));
}

export async function deleteOsSecret(name: string): Promise<void> {
  const path = secretPath(name);
  if (existsSync(path)) unlinkSync(path);
}

export class OsCredentialStore implements CredentialStore {
  async get(ref: CredentialRef): Promise<OAuthCredential | null> {
    const path = credentialPath(ref);
    if (!existsSync(path)) return null;
    assertEncryptionAvailable();
    const encrypted = readFileSync(path);
    const json = safeStorage.decryptString(encrypted);
    return JSON.parse(json) as OAuthCredential;
  }

  async set(ref: CredentialRef, credential: OAuthCredential): Promise<void> {
    assertEncryptionAvailable();
    const payload: OAuthCredential = { refreshToken: credential.refreshToken };
    const encrypted = safeStorage.encryptString(JSON.stringify(payload));
    writeFileSync(credentialPath(ref), encrypted);
  }

  async delete(ref: CredentialRef): Promise<void> {
    const path = credentialPath(ref);
    if (existsSync(path)) unlinkSync(path);
  }
}

let credentialStore: OsCredentialStore | null = null;

export function getCredentialStore(): OsCredentialStore {
  if (!credentialStore) credentialStore = new OsCredentialStore();
  return credentialStore;
}
