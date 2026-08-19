import type { AiBrand, AiConnectionMode, AiProviderId } from './ai-provider-id.js';
import {
  getBrandApiModels,
  getBrandCliFallbackModels,
  normalizeModelOptions,
  type CliModelOption,
} from './catalog.js';
import { resolveAiBrand } from './config-resolve.js';

export {
  AI_BRAND_CATALOG,
  CLI_PROVIDER_META,
  ENABLED_AI_BRANDS,
  getBrandApiModels,
  getBrandCliFallbackModels,
  normalizeModelOptions,
  type CliModelOption,
} from './catalog.js';
export { resolveClaudeCliModelId } from './providers/claude/meta.js';
export type { AiBrand, AiConnectionMode, AiProviderId } from './ai-provider-id.js';

const KNOWN_PROVIDERS = [
  'codex-cli',
  'claude-cli',
  'cursor-cli',
  'openai-api',
  'anthropic-api',
  'grok-api',
] as const;

export function brandFromProvider(provider?: string, brand?: AiBrand): AiBrand | null {
  if (brand) return brand;
  if (!provider || !(KNOWN_PROVIDERS as readonly string[]).includes(provider)) return null;
  return resolveAiBrand({ provider: provider as AiProviderId });
}

export function modelsForBrand(
  brand: AiBrand,
  mode: AiConnectionMode,
  cliModels: CliModelOption[] | undefined,
): CliModelOption[] {
  if (mode === 'api') return getBrandApiModels(brand);
  const detected = cliModels && cliModels.length > 0 ? normalizeModelOptions(cliModels) : [];
  return detected.length > 0 ? detected : getBrandCliFallbackModels(brand);
}
