import { isCliProviderId } from '../settings/ai-provider-id.js';
import { resolveAiProviderConfig, type AiProviderConfig } from '../settings/config.js';
import { AnthropicApiProvider } from './anthropic-api.js';
import { createCliModelProvider } from './cli/index.js';
import { OpenAiApiProvider } from './openai-api.js';
import type { ModelProvider } from './provider.js';

export function createModelProvider(config: AiProviderConfig): ModelProvider {
  const resolved = resolveAiProviderConfig(config);
  if (resolved.provider === 'openai-api') return new OpenAiApiProvider(resolved.model!);
  if (resolved.provider === 'anthropic-api') return new AnthropicApiProvider(resolved.model!);
  if (!isCliProviderId(resolved.provider)) {
    throw new Error(`지원하지 않는 AI 제공자입니다: ${resolved.provider}`);
  }
  return createCliModelProvider(resolved.provider, resolved.model!);
}
