import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliProviderId } from '../../settings/ai-provider-id.js';
import { CLI_PROVIDER_META } from '../../settings/catalog.js';
import { chatMessagesFromInput, flattenChatPrompt } from '../chat.js';
import { resolveBinaryAsync } from '../cli-process.js';

export async function requiredBinary(provider: CliProviderId): Promise<string> {
  const command = await resolveBinaryAsync(CLI_PROVIDER_META[provider].binaries);
  if (!command) throw new Error(`${CLI_PROVIDER_META[provider].label}이(가) 설치되어 있지 않습니다.`);
  return command;
}

/** Every CLI run gets an owned, empty working directory instead of the app's cwd. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'ax-cli-'));
  let terminationUnconfirmed = false;
  try {
    return await fn(dir);
  } catch (error) {
    terminationUnconfirmed = Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'command_termination_failed');
    throw error;
  } finally {
    if (terminationUnconfirmed) console.error('[AX] Child exit unconfirmed; retained temporary workspace:', dir);
    else await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function composedPrompt(input: {
  system: string;
  user?: string;
  messages?: import('../chat.js').ChatMessage[];
}): string {
  return flattenChatPrompt(input.system, chatMessagesFromInput(input));
}
