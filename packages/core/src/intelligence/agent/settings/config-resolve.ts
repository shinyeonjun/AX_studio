import {
  isAiBrand,
  type AiBrand,
  type AiConnectionMode,
  type AiProviderConfig,
  type AiProviderId,
  type CliProviderId,
} from './ai-provider-id.js';
import { AI_BRAND_CATALOG, CLI_PROVIDER_META } from './catalog.js';
import { DEFAULT_AI_PROVIDER } from './config-defaults.js';

export const BRAND_CLI_PROVIDER: Record<AiBrand, CliProviderId> = {
  claude: 'claude-cli',
  gpt: 'codex-cli',
  ollama: 'codex-cli',
};

const BRAND_API_PROVIDER: Record<AiBrand, AiProviderId> = {
  claude: 'anthropic-api',
  gpt: 'openai-api',
  ollama: 'ollama-api',
};

const PROVIDER_BRAND: Record<AiProviderId, AiBrand> = {
  'claude-cli': 'claude',
  'anthropic-api': 'claude',
  'codex-cli': 'gpt',
  'openai-api': 'gpt',
  'ollama-api': 'ollama',
};

const PROVIDER_MODE: Record<AiProviderId, AiConnectionMode> = {
  'claude-cli': 'cli',
  'codex-cli': 'cli',
  'openai-api': 'api',
  'anthropic-api': 'api',
  'ollama-api': 'api',
};

const API_DEFAULT_MODEL: Record<AiBrand, string> = {
  claude: AI_BRAND_CATALOG.claude.apiDefaultModel,
  gpt: AI_BRAND_CATALOG.gpt.apiDefaultModel,
  ollama: AI_BRAND_CATALOG.ollama.apiDefaultModel,
};

/** Removed providers (Grok/Cursor) and unknown ids return null so callers fall back to the default. */
function migrateProviderId(value: unknown): AiProviderId | null {
  if (value === 'gpt-cli') return 'codex-cli';
  return typeof value === 'string' && value in PROVIDER_BRAND ? value as AiProviderId : null;
}

export function resolveAiBrand(config: AiProviderConfig): AiBrand {
  if (config.brand) return config.brand;
  return PROVIDER_BRAND[config.provider] ?? 'claude';
}

export function resolveAiConnectionMode(config: AiProviderConfig): AiConnectionMode {
  if (config.mode) return config.mode;
  return PROVIDER_MODE[config.provider] ?? 'cli';
}

export function resolveProviderForBrand(brand: AiBrand, mode: AiConnectionMode): AiProviderId {
  return mode === 'api' ? BRAND_API_PROVIDER[brand] : BRAND_CLI_PROVIDER[brand];
}

function defaultModelFor(brand: AiBrand, mode: AiConnectionMode): string {
  return mode === 'api' ? API_DEFAULT_MODEL[brand] : CLI_PROVIDER_META[BRAND_CLI_PROVIDER[brand]].defaultModel;
}

export function resolveAiProviderConfig(config: AiProviderConfig): AiProviderConfig {
  const brand = resolveAiBrand(config);
  const mode = resolveAiConnectionMode(config);
  const provider = resolveProviderForBrand(brand, mode);
  const model = config.model?.trim() || defaultModelFor(brand, mode);
  return { provider, brand, mode, model };
}

export function normalizeAiProviderConfig(raw: unknown): AiProviderConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_AI_PROVIDER;
  const rec = raw as {
    provider?: unknown;
    model?: unknown;
    brand?: unknown;
    mode?: unknown;
  };
  const storedModel = typeof rec.model === 'string' && rec.model.trim() ? rec.model.trim() : undefined;
  const mode = rec.mode === 'cli' || rec.mode === 'api' ? rec.mode : null;
  // Grok (Cursor CLI / xAI API) was removed; never reinterpret its model under another brand.
  if (rec.brand === 'grok') return DEFAULT_AI_PROVIDER;
  const brand = isAiBrand(rec.brand) ? rec.brand : null;
  if (brand && mode) {
    return { provider: resolveProviderForBrand(brand, mode), brand, mode, model: storedModel ?? defaultModelFor(brand, mode) };
  }
  const provider = migrateProviderId(rec.provider);
  if (!provider) return DEFAULT_AI_PROVIDER;
  const resolvedBrand = brand ?? resolveAiBrand({ provider });
  const resolvedMode = mode ?? resolveAiConnectionMode({ provider });
  return {
    provider,
    brand: resolvedBrand,
    mode: resolvedMode,
    model: storedModel ?? defaultModelFor(resolvedBrand, resolvedMode),
  };
}
