import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { google } from 'googleapis';
import { CodeChallengeMethod } from 'google-auth-library';
import { GMAIL_OAUTH_SCOPES } from '../connection.js';
import type { GmailOAuthOptions, GmailOAuthResult } from './contracts.js';

export const GMAIL_OAUTH_TIMEOUT_MS = 5 * 60_000;

function generatePkcePair() {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function createOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export function oauthCallbackStateMatches(expected: string, received: string | null): boolean {
  if (!received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function connectGmailViaLoopback(options: GmailOAuthOptions): Promise<GmailOAuthResult> {
  const scopes = [...(options.scopes ?? GMAIL_OAUTH_SCOPES)];
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const expectedState = createOAuthState();
  const session: { client?: InstanceType<typeof google.auth.OAuth2> } = {};

  const code = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeoutMs = options.timeoutMs ?? GMAIL_OAUTH_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (result: { code: string } | { error: Error }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (server.listening) server.close();
      if ('error' in result) reject(result.error);
      else resolve(result.code);
    };

    const server = createServer((req, res) => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/oauth/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const err = url.searchParams.get('error');
      if (err) {
        res.writeHead(400);
        res.end(`OAuth error: ${err}`);
        settle({ error: new Error(err) });
        return;
      }
      if (!oauthCallbackStateMatches(expectedState, url.searchParams.get('state'))) {
        res.writeHead(400);
        res.end('Invalid OAuth state');
        settle({ error: new Error('Invalid OAuth state') });
        return;
      }
      const authCode = url.searchParams.get('code');
      if (!authCode) {
        res.writeHead(400);
        res.end('Missing code');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('Gmail 연결 완료. 이 창을 닫고 AX Studio로 돌아가세요.');
      settle({ code: authCode });
    });

    server.on('error', (error) => settle({ error }));
    timer = setTimeout(() => {
      settle({ error: Object.assign(new Error('Gmail OAuth timed out'), { code: 'oauth_timeout' }) });
    }, timeoutMs);
    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        settle({ error: new Error('Failed to bind loopback port') });
        return;
      }

      const redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
      session.client = new google.auth.OAuth2(options.clientId, options.clientSecret ?? undefined, redirectUri);
      const authUrl = session.client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes,
        state: expectedState,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
      });

      try {
        await options.onAuthUrl?.(authUrl);
      } catch (error) {
        settle({ error: error instanceof Error ? error : new Error(String(error)) });
      }
    });
  });

  if (!session.client) throw new Error('OAuth client was not initialized');

  const { tokens } = await session.client.getToken({ code, codeVerifier });
  if (!tokens.access_token) throw new Error('No access token returned');
  if (!tokens.refresh_token) {
    throw new Error('No refresh token returned. Google 계정 연결을 해제한 뒤 다시 시도하세요.');
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date ?? undefined,
    scopes,
  };
}
