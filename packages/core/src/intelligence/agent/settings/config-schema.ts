import { z } from 'zod';
import { AI_BRANDS, AI_CONNECTION_MODES, AI_PROVIDER_IDS, type AiProviderConfig } from './ai-provider-id.js';
export { DEFAULT_AI_PROVIDER } from './config-defaults.js';

export type { AiProviderConfig, AiProviderId, AiBrand, AiConnectionMode } from './ai-provider-id.js';
export { AI_PROVIDER_IDS, AI_BRANDS, AI_CONNECTION_MODES } from './ai-provider-id.js';

export const AiProviderIdSchema = z.enum(AI_PROVIDER_IDS);
export const AiBrandSchema = z.enum(AI_BRANDS);
export const AiConnectionModeSchema = z.enum(AI_CONNECTION_MODES);

export const AiProviderConfigSchema = z.object({
  provider: AiProviderIdSchema,
  model: z.string().optional(),
  brand: AiBrandSchema.optional(),
  mode: AiConnectionModeSchema.optional(),
}) satisfies z.ZodType<AiProviderConfig>;
