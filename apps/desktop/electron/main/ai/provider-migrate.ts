import {
  DEFAULT_AI_PROVIDER,
  normalizeAiProviderConfig,
  resolveAiBrand,
  type AiProviderConfig,
} from '@ax-studio/core';

export function migrateDesktopAiProvider(raw: unknown): AiProviderConfig {
  const config = normalizeAiProviderConfig(raw);
  const brand = resolveAiBrand(config);
  if (brand === 'grok' || config.provider === 'cursor-cli' || config.provider === 'grok-api') {
    return normalizeAiProviderConfig(DEFAULT_AI_PROVIDER);
  }
  return config;
}
