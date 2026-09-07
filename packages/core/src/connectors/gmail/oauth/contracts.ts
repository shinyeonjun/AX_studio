export interface GmailOAuthOptions {
  clientId: string;
  clientSecret?: string;
  scopes?: readonly string[];
  timeoutMs?: number;
  /** OAuth URL을 브라우저 등으로 열 때 사용 */
  onAuthUrl?: (url: string) => void | Promise<void>;
}

export interface GmailOAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  scopes: string[];
}
