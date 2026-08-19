import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliProviderId } from '../../settings/ai-provider-id.js';
import { CLI_PROVIDER_META } from '../../settings/catalog.js';
import { chatMessagesFromInput, flattenChatPrompt } from '../chat.js';
import { resolveBinary } from '../cli-process.js';

export function requiredBinary(provider: CliProviderId): string {
  const command = resolveBinary(CLI_PROVIDER_META[provider].binaries);
  if (!command) {
    if (provider === 'cursor-cli') {
      throw new Error(
        'Cursor agent CLI가 설치되어 있지 않습니다. API 키는 인증용이며, Grok 실행에는 agent CLI도 필요합니다. PowerShell: irm \'https://cursor.com/install?win32=true\' | iex',
      );
    }
    throw new Error(`${CLI_PROVIDER_META[provider].label}이(가) 설치되어 있지 않습니다.`);
  }
  return command;
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'ax-cli-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function composedPrompt(
  input: {
    system: string;
    user?: string;
    messages?: import('../chat.js').ChatMessage[];
  },
  options: { resume?: boolean } = {},
): string {
  const messages = chatMessagesFromInput(input);
  if (options.resume) {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    return `${input.system}\n\nUser: ${lastUser?.content ?? ''}`.trim();
  }
  return flattenChatPrompt(input.system, messages);
}
