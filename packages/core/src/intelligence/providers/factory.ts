import { resolveAiProviderConfig, type AiProviderConfig } from '../agent/settings/config.js';
import { createCliModelProvider } from './cli/index.js';
import type { ModelProvider } from './provider.js';

/** AI runs through the installed Claude or Codex CLI. */
export function createModelProvider(config: AiProviderConfig): ModelProvider {
  const resolved = resolveAiProviderConfig(config);
  return createCliModelProvider(resolved.provider, resolved.model!);
}
