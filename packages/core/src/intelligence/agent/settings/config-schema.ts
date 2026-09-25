import { z } from 'zod';
import type { AiProviderConfig } from './ai-provider-id.js';
export { DEFAULT_AI_PROVIDER } from './config-defaults.js';

export type { AiProviderConfig, AiProviderId, AiBrand, AiConnectionMode } from './ai-provider-id.js';
export { AI_PROVIDER_IDS, AI_BRANDS, AI_CONNECTION_MODES } from './ai-provider-id.js';

export const AiProviderIdSchema = z.enum([
  'codex-cli',
  'claude-cli',
  'cursor-cli',
  'openai-api',
  'anthropic-api',
  'grok-api',
  'ollama-api',
]);
export const AiBrandSchema = z.enum(['claude', 'gpt', 'grok', 'ollama']);
export const AiConnectionModeSchema = z.enum(['cli', 'api']);

export const AiProviderConfigSchema = z.object({
  provider: AiProviderIdSchema,
  model: z.string().optional(),
  brand: AiBrandSchema.optional(),
  mode: AiConnectionModeSchema.optional(),
}) satisfies z.ZodType<AiProviderConfig>;
