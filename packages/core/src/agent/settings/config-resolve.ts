import type { AiBrand, AiConnectionMode, AiProviderId, CliProviderId } from './ai-provider-id.js';
import { AI_BRAND_CATALOG, CLI_PROVIDER_META } from './catalog.js';
import type { AiProviderConfig } from './config-schema.js';
import { DEFAULT_AI_PROVIDER } from './config-schema.js';

export const BRAND_CLI_PROVIDER: Record<AiBrand, CliProviderId> = {
  claude: 'claude-cli',
  gpt: 'codex-cli',
  grok: 'cursor-cli',
  ollama: 'codex-cli',
};

export const BRAND_API_PROVIDER: Record<AiBrand, AiProviderId> = {
  claude: 'anthropic-api',
  gpt: 'openai-api',
  grok: 'grok-api',
  ollama: 'ollama-api',
};

const PROVIDER_BRAND: Partial<Record<AiProviderId, AiBrand>> = {
  'claude-cli': 'claude',
  'anthropic-api': 'claude',
  'codex-cli': 'gpt',
  'openai-api': 'gpt',
  'cursor-cli': 'grok',
  'grok-api': 'grok',
  'ollama-api': 'ollama',
};

const PROVIDER_MODE: Partial<Record<AiProviderId, AiConnectionMode>> = {
  'claude-cli': 'cli',
  'codex-cli': 'cli',
  'cursor-cli': 'cli',
  'openai-api': 'api',
  'anthropic-api': 'api',
  'grok-api': 'api',
  'ollama-api': 'api',
};

export const API_DEFAULT_MODEL: Record<AiBrand, string> = {
  claude: AI_BRAND_CATALOG.claude.apiDefaultModel,
  gpt: AI_BRAND_CATALOG.gpt.apiDefaultModel,
  grok: AI_BRAND_CATALOG.grok.apiDefaultModel,
  ollama: AI_BRAND_CATALOG.ollama.apiDefaultModel,
};

export function migrateProviderId(value: unknown): AiProviderId | null {
  if (value === 'codex-cli' || value === 'gpt-cli') return 'codex-cli';
  if (value === 'claude-cli') return 'claude-cli';
  if (value === 'cursor-cli' || value === 'cursor') return 'cursor-cli';
  if (value === 'openai-api') return 'openai-api';
  if (value === 'anthropic-api') return 'anthropic-api';
  if (value === 'grok-api') return 'grok-api';
  if (value === 'ollama-api') return 'ollama-api';
  return null;
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

export function resolveAiProviderConfig(config: AiProviderConfig): AiProviderConfig {
  const brand = resolveAiBrand(config);
  const mode = resolveAiConnectionMode(config);
  const provider = resolveProviderForBrand(brand, mode);
  const model =
    config.model?.trim() ||
    (mode === 'api' ? API_DEFAULT_MODEL[brand] : CLI_PROVIDER_META[BRAND_CLI_PROVIDER[brand]].defaultModel);
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
  const brand =
    rec.brand === 'claude' || rec.brand === 'gpt' || rec.brand === 'grok' || rec.brand === 'ollama'
      ? rec.brand
      : null;
  const mode = rec.mode === 'cli' || rec.mode === 'api' ? rec.mode : null;
  if (brand && mode) {
    const provider = resolveProviderForBrand(brand, mode);
    const model =
      typeof rec.model === 'string' && rec.model.trim()
        ? rec.model.trim()
        : mode === 'api'
          ? API_DEFAULT_MODEL[brand]
          : CLI_PROVIDER_META[BRAND_CLI_PROVIDER[brand]].defaultModel;
    return { provider, brand, mode, model };
  }
  const provider = migrateProviderId(rec.provider);
  if (!provider) return DEFAULT_AI_PROVIDER;
  const resolvedBrand = brand ?? resolveAiBrand({ provider });
  const resolvedMode = mode ?? resolveAiConnectionMode({ provider });
  const cliDefault = CLI_PROVIDER_META[BRAND_CLI_PROVIDER[resolvedBrand]].defaultModel;
  const model =
    typeof rec.model === 'string' && rec.model.trim()
      ? rec.model.trim()
      : resolvedMode === 'api'
        ? API_DEFAULT_MODEL[resolvedBrand]
        : cliDefault;
  return { provider, brand: resolvedBrand, mode: resolvedMode, model };
}
