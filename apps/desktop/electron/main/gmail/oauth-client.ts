import { deleteOsSecret, getOsSecret, setOsSecret } from '../credential-store.js';

const SECRET_NAME = 'google-oauth-client';
type GoogleClient = { client_id: string; client_secret?: string };
let importedClient: GoogleClient | undefined;
let loadError: string | undefined;

export function parseGoogleDesktopClient(json: string): GoogleClient {
  const invalid = () => new Error('Google에서 내려받은 데스크톱 앱 OAuth 클라이언트 JSON을 선택해 주세요.');
  if (json.length > 65_536) throw invalid();
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw invalid(); }
  const client = value && typeof value === 'object' && 'installed' in value ? value.installed : undefined;
  if (!client || typeof client !== 'object' || !('client_id' in client) ||
    typeof client.client_id !== 'string' || client.client_id.length > 512 ||
    !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(client.client_id.trim())) throw invalid();
  const secret = 'client_secret' in client ? client.client_secret : undefined;
  if (secret !== undefined && (typeof secret !== 'string' || !secret.trim() || secret.length > 4096)) throw invalid();
  // Never honor auth_uri/token_uri/redirect_uris supplied by an imported file.
  return { client_id: client.client_id.trim(), ...(typeof secret === 'string' ? { client_secret: secret.trim() } : {}) };
}

export function googleDesktopClientState() {
  return { client: importedClient, error: loadError };
}

export async function loadGoogleDesktopClient(): Promise<void> {
  importedClient = undefined;
  loadError = undefined;
  try {
    const json = await getOsSecret(SECRET_NAME);
    if (json) importedClient = parseGoogleDesktopClient(json);
  } catch {
    loadError = '저장된 Gmail OAuth 설정을 읽지 못했습니다. 설정에서 클라이언트 JSON을 다시 가져와 주세요.';
    throw new Error(loadError);
  }
}

export async function saveGoogleDesktopClient(json: string): Promise<void> {
  const client = parseGoogleDesktopClient(json);
  await setOsSecret(SECRET_NAME, JSON.stringify({ installed: client }));
  importedClient = client;
  loadError = undefined;
}

export async function clearGoogleDesktopClient(): Promise<void> {
  await deleteOsSecret(SECRET_NAME);
  importedClient = undefined;
  loadError = undefined;
}
