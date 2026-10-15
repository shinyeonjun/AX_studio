import { isAiCliInstalled } from './cli-detect.js';
import type { AiProviderConfig } from './config-schema.js';
import { resolveAiProviderConfig } from './config-resolve.js';

export function isAiProviderReady(config: AiProviderConfig): boolean {
  return isAiCliInstalled(resolveAiProviderConfig(config).provider);
}

const PROVIDER_LABEL = { claude: 'Claude · CLI', gpt: 'GPT · Codex CLI' } as const;

export function getAiProviderDisplay(config: AiProviderConfig): string {
  const resolved = resolveAiProviderConfig(config);
  return `${PROVIDER_LABEL[resolved.brand ?? 'claude']} · ${resolved.model}`;
}
