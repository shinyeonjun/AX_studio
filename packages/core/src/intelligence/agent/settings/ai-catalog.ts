import { isAiProviderId, type AiBrand, type AiConnectionMode } from './ai-provider-id.js';
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
export type { AiBrand, AiConnectionMode, AiProviderId, CliProviderId } from './ai-provider-id.js';

export function brandFromProvider(provider?: string, brand?: AiBrand): AiBrand | null {
  if (brand) return brand;
  if (!isAiProviderId(provider)) return null;
  return resolveAiBrand({ provider });
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
