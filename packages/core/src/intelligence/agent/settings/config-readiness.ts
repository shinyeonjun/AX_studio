import { isCliProviderId } from './ai-provider-id.js';
import { isAiCliInstalled } from './cli-detect.js';
import type { AiProviderConfig } from './config-schema.js';
import { resolveAiProviderConfig } from './config-resolve.js';
import { isAnthropicApiKeyConfigured } from '../model/anthropic-api.js';
import { isOpenAiApiKeyConfigured } from '../model/openai-api.js';

export function isAiProviderReady(config: AiProviderConfig): boolean {
  const resolved = resolveAiProviderConfig(config);
  if (resolved.mode === 'api') {
    if (resolved.brand === 'claude') return isAnthropicApiKeyConfigured();
    if (resolved.brand === 'gpt') return isOpenAiApiKeyConfigured();
    return resolved.brand === 'ollama';
  }
  if (!isCliProviderId(resolved.provider)) return false;
  return isAiCliInstalled(resolved.provider);
}

const BRAND_LABEL = { claude: 'Claude', gpt: 'GPT', ollama: 'Ollama' } as const;

function getAiProviderLabel(config: AiProviderConfig): string {
  const resolved = resolveAiProviderConfig(config);
  const brand = resolved.brand ?? 'claude';
  const modeLabel = resolved.mode === 'api' ? 'API' : brand === 'gpt' ? 'Codex CLI' : 'CLI';
  return `${BRAND_LABEL[brand]} · ${modeLabel}`;
}

export function getAiProviderDisplay(config: AiProviderConfig): string {
  const resolved = resolveAiProviderConfig(config);
  return `${getAiProviderLabel(resolved)} · ${resolved.model}`;
}
