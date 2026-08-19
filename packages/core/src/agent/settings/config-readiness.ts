import { isCliProviderId } from './ai-provider-id.js';
import { CLI_PROVIDER_META } from './catalog.js';
import { isAiCliInstalled, isCursorApiKeyConfigured } from './cli-detect.js';
import type { AiProviderConfig } from './config-schema.js';
import { resolveAiProviderConfig } from './config-resolve.js';
import { resolveBinary } from '../model/cli-process.js';
import { isAnthropicApiKeyConfigured } from '../model/anthropic-api.js';
import { isOpenAiApiKeyConfigured } from '../model/openai-api.js';
import { isXaiApiKeyConfigured } from '../model/grok-api.js';

export function isAiProviderReady(config: AiProviderConfig): boolean {
  const resolved = resolveAiProviderConfig(config);
  if (resolved.mode === 'api') {
    if (resolved.brand === 'claude') return isAnthropicApiKeyConfigured();
    if (resolved.brand === 'gpt') return isOpenAiApiKeyConfigured();
    if (resolved.brand === 'grok') return isXaiApiKeyConfigured();
    return false;
  }
  if (resolved.brand === 'grok') {
    return isCursorApiKeyConfigured() && Boolean(resolveBinary(CLI_PROVIDER_META['cursor-cli'].binaries));
  }
  if (!isCliProviderId(resolved.provider)) return false;
  return isAiCliInstalled(resolved.provider);
}

export function getAiProviderLabel(config: AiProviderConfig): string {
  const resolved = resolveAiProviderConfig(config);
  const brandLabel =
    resolved.brand === 'claude' ? 'Claude' : resolved.brand === 'gpt' ? 'GPT' : 'Grok';
  const modeLabel =
    resolved.mode === 'api'
      ? 'API'
      : resolved.brand === 'gpt'
        ? 'Codex CLI'
        : resolved.brand === 'grok'
          ? 'agent CLI'
          : 'CLI';
  return `${brandLabel} · ${modeLabel}`;
}

export function getAiProviderDisplay(config: AiProviderConfig): string {
  const resolved = resolveAiProviderConfig(config);
  return `${getAiProviderLabel(resolved)} · ${resolved.model}`;
}
