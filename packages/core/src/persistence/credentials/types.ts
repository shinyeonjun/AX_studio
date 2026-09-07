export interface CredentialRef {
  connector: string;
  connectionId: string;
}

export interface OAuthCredential {
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
}

export interface CredentialStore {
  get(ref: CredentialRef): Promise<OAuthCredential | null>;
  set(ref: CredentialRef, credential: OAuthCredential): Promise<void>;
  delete(ref: CredentialRef): Promise<void>;
}
