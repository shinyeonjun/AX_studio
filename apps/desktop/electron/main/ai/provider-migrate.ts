import { normalizeAiProviderConfig, type AiProviderConfig } from '@ax-studio/core';

/**
 * Stored settings may still name removed providers (Grok via Cursor CLI or the xAI API);
 * normalization maps those, and anything else unknown, to the default provider.
 */
export function migrateDesktopAiProvider(raw: unknown): AiProviderConfig {
  return normalizeAiProviderConfig(raw);
}
