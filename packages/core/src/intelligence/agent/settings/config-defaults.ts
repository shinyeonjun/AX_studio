import type { AiProviderConfig } from './ai-provider-id.js';
import { CLI_PROVIDER_META } from './catalog.js';

/** Keep pure defaults out of the Zod module so renderer catalog imports stay lightweight. */
export const DEFAULT_AI_PROVIDER: AiProviderConfig = {
  provider: 'claude-cli',
  brand: 'claude',
  mode: 'cli',
  model: CLI_PROVIDER_META['claude-cli'].defaultModel,
};
