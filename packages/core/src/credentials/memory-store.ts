import type { CredentialRef, CredentialStore, OAuthCredential } from './types.js';

export class MemoryCredentialStore implements CredentialStore {
  private store = new Map<string, OAuthCredential>();

  private key(ref: CredentialRef): string {
    return `${ref.connector}:${ref.connectionId}`;
  }

  async get(ref: CredentialRef): Promise<OAuthCredential | null> {
    return this.store.get(this.key(ref)) ?? null;
  }

  async set(ref: CredentialRef, credential: OAuthCredential): Promise<void> {
    this.store.set(this.key(ref), credential);
  }

  async delete(ref: CredentialRef): Promise<void> {
    this.store.delete(this.key(ref));
  }
}
