import { deleteOsSecret, getOsSecret, setOsSecret } from '../../credential-store.js';
import { SLACK_SECRET_READ_ERROR, type SlackSecret } from './contracts.js';

const SLACK_SECRET_NAME = 'slack.tokens';

function parseSlackSecret(value: string | null): SlackSecret | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.token !== 'string' || !record.token.trim()) return null;
    return {
      token: record.token.trim(),
      appToken: typeof record.appToken === 'string' && record.appToken.trim() ? record.appToken.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export async function getSlackSecret(): Promise<SlackSecret | null> {
  return parseSlackSecret(await getOsSecret(SLACK_SECRET_NAME));
}

/** Allow a replacement token to recover from an unreadable persisted secret. */
export async function getSlackSecretForConnect(inputToken?: string): Promise<SlackSecret | null> {
  try {
    return await getSlackSecret();
  } catch {
    if (inputToken?.trim()) return null;
    throw new Error(SLACK_SECRET_READ_ERROR);
  }
}

export async function saveSlackSecret(secret: SlackSecret): Promise<void> {
  await setOsSecret(SLACK_SECRET_NAME, JSON.stringify(secret));
}

export async function deleteSlackSecret(): Promise<void> {
  await deleteOsSecret(SLACK_SECRET_NAME);
}
