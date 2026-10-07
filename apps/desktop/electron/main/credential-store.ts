import { safeStorage } from 'electron';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeSync } from 'node:fs';
import type { CredentialRef, CredentialStore, OAuthCredential } from '@ax-studio/core';
import { getCredentialPath, getCredentialsDir, getSecretPath } from './credential-paths.js';

/** Error codes for a stored credential that exists but cannot be used. */
export const CREDENTIAL_UNAVAILABLE_CODES = new Set([
  'credential_encryption_unavailable',
  'credential_decrypt_failed',
  'invalid_credential_json',
]);

export function isCredentialUnavailableError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CREDENTIAL_UNAVAILABLE_CODES.has(code);
}

/** Product names a person recognises, keyed by connector or the first segment of a secret name. */
const CREDENTIAL_DISPLAY_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  slack: 'Slack',
  http: 'HTTP API',
  rdb: '데이터베이스',
  webhook: 'Webhook',
  anthropic: 'Claude',
  openai: 'OpenAI',
  ollama: 'Ollama',
  typesafe: '판단 엔진(Jev)',
};

/** A connector or secret name as a person would say it, quoted with a trailing space (or empty); never the raw id. */
export function credentialDisplayName(connectorOrSecret: string): string {
  const key = connectorOrSecret.trim().toLowerCase().split(/[./_-]/u)[0] ?? '';
  const name = Object.hasOwn(CREDENTIAL_DISPLAY_NAMES, key) ? CREDENTIAL_DISPLAY_NAMES[key] : undefined;
  return name ? `'${name}' ` : '';
}

function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw Object.assign(new Error('이 컴퓨터에서는 연결 정보를 안전하게 저장할 수 없어요. 컴퓨터에 다시 로그인한 뒤 시도해 주세요.'), {
      code: 'credential_encryption_unavailable',
    });
  }
  warnIfPlaintextBackend();
}

let plaintextBackendWarned = false;

/**
 * Linux without a keyring falls back to Chromium's `basic_text` backend, which
 * only obfuscates secrets with a hard-coded key. Returns a warning code then.
 */
export function getCredentialStorageWarning(): 'basic_text_backend' | undefined {
  if (process.platform !== 'linux') return undefined;
  try {
    const backend = (safeStorage as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.();
    return backend === 'basic_text' ? 'basic_text_backend' : undefined;
  } catch {
    return undefined;
  }
}

function warnIfPlaintextBackend(): void {
  if (plaintextBackendWarned || !getCredentialStorageWarning()) return;
  plaintextBackendWarned = true;
  console.warn('[AX Studio] OS keyring unavailable: credentials use the basic_text backend (obfuscated, not encrypted). Install/unlock a Secret Service keyring (e.g. gnome-keyring, KWallet).');
}

function ensureCredentialsDir(): string {
  const dir = getCredentialsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Decrypts one stored file; a DPAPI/keyring change or truncated file becomes a typed error. */
function decryptStoredFile(path: string, label: string): string {
  assertEncryptionAvailable();
  try {
    const encrypted = readFileSync(path);
    if (encrypted.byteLength === 0) throw new Error('empty credential file');
    return safeStorage.decryptString(encrypted);
  } catch (cause) {
    throw Object.assign(new Error(`저장된 ${credentialDisplayName(label)}연결 정보를 읽을 수 없어요. 설정에서 다시 연결해 주세요.`, { cause }), {
      code: 'credential_decrypt_failed',
      credential: label,
    });
  }
}

export async function getOsSecret(name: string): Promise<string | null> {
  const path = getSecretPath(name);
  if (!existsSync(path)) return null;
  return decryptStoredFile(path, name);
}

/** Like getOsSecret, but an unreadable secret reads as missing (for status/summary paths). */
export async function getOsSecretOrNull(name: string): Promise<string | null> {
  try {
    return await getOsSecret(name);
  } catch (error) {
    console.warn('[AX Studio] stored secret unavailable', { name, code: (error as { code?: unknown } | null)?.code });
    return null;
  }
}

function writeEncryptedAtomic(path: string, encrypted: Buffer): void {
  const tmp = `${path}.tmp`;
  try {
    const handle = openSync(tmp, 'w');
    try {
      let offset = 0;
      while (offset < encrypted.byteLength) offset += writeSync(handle, encrypted, offset, encrypted.byteLength - offset);
      // Durable before the rename, so a crash never leaves a zero-length credential.
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(tmp, path);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* Preserve the write error. */ }
    throw error;
  }
}

export async function setOsSecret(name: string, value: string): Promise<void> {
  assertEncryptionAvailable();
  ensureCredentialsDir();
  writeEncryptedAtomic(getSecretPath(name), safeStorage.encryptString(value));
}

export async function deleteOsSecret(name: string): Promise<void> {
  const path = getSecretPath(name);
  if (existsSync(path)) unlinkSync(path);
}

export class OsCredentialStore implements CredentialStore {
  async get(ref: CredentialRef): Promise<OAuthCredential | null> {
    const path = getCredentialPath(ref.connector, ref.connectionId);
    if (!existsSync(path)) return null;
    const json = decryptStoredFile(path, `${ref.connector}/${ref.connectionId}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      // Never echo the parser message: V8 includes a snippet of the decrypted input.
      throw Object.assign(new Error(`${credentialDisplayName(ref.connector)}연결 정보가 손상됐어요. 다시 연결해 주세요.`), {
        code: 'invalid_credential_json',
        connector: ref.connector,
        connectionId: ref.connectionId,
      });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof (parsed as { refreshToken?: unknown }).refreshToken !== 'string') {
      throw Object.assign(new Error(`${credentialDisplayName(ref.connector)}연결 정보가 손상됐어요. 다시 연결해 주세요.`), {
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
    writeEncryptedAtomic(getCredentialPath(ref.connector, ref.connectionId), encrypted);
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
