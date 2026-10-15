import { z } from 'zod';
import { AI_BRANDS, CLI_PROVIDER_IDS, type AiProviderConfig } from './ai-provider-id.js';
export { DEFAULT_AI_PROVIDER } from './config-defaults.js';

export type { AiProviderConfig, AiProviderId, AiBrand } from './ai-provider-id.js';
export { AI_BRANDS } from './ai-provider-id.js';

export const AiProviderIdSchema = z.enum(CLI_PROVIDER_IDS);
export const AiBrandSchema = z.enum(AI_BRANDS);

export const AiProviderConfigSchema = z.object({
  provider: AiProviderIdSchema,
  model: z.string().optional(),
  brand: AiBrandSchema.optional(),
}) satisfies z.ZodType<AiProviderConfig>;
