export interface CursorApiKeyInfo {
  configured: boolean;
  masked?: string;
  email?: string;
  apiKeyName?: string;
}

export async function verifyCursorApiKey(apiKey: string): Promise<CursorApiKeyInfo> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error('API 키를 입력하세요.');

  const basicAuth = `Basic ${Buffer.from(`${trimmed}:`).toString('base64')}`;
  let response = await fetch('https://api.cursor.com/v1/me', {
    headers: { Authorization: basicAuth },
  });

  if (!response.ok && (response.status === 401 || response.status === 403)) {
    response = await fetch('https://api.cursor.com/v1/me', {
      headers: { Authorization: `Bearer ${trimmed}` },
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Cursor API 인증 실패 (${response.status})`);
  }

  const data = (await response.json()) as {
    email?: string;
    userEmail?: string;
    apiKeyName?: string;
  };
  return {
    configured: true,
    email: data.userEmail ?? data.email,
    apiKeyName: data.apiKeyName,
  };
}
