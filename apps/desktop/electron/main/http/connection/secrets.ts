import { parseHttpEndpointSecrets, type HttpEndpointSecrets } from '@ax-studio/core';
import { deleteOsSecret, getOsSecret, setOsSecret } from '../../credential-store.js';

const HTTP_SECRET_NAME = 'http.auth';

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function readHttpSecrets(): Promise<HttpEndpointSecrets> {
  const value = await getOsSecret(HTTP_SECRET_NAME);
  return parseHttpEndpointSecrets(parseJson(value));
}

export async function writeHttpSecrets(secrets: HttpEndpointSecrets): Promise<void> {
  if (Object.keys(secrets).length === 0) {
    await deleteOsSecret(HTTP_SECRET_NAME);
    return;
  }
  await setOsSecret(HTTP_SECRET_NAME, JSON.stringify(secrets));
}
