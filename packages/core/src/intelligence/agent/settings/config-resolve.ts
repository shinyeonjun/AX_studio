import { isAiBrand, type AiBrand, type AiProviderConfig, type AiProviderId } from './ai-provider-id.js';
import { CLI_PROVIDER_META } from './catalog.js';
import { DEFAULT_AI_PROVIDER } from './config-defaults.js';
import { resolveClaudeCliModelId } from './providers/claude/meta.js';

export const BRAND_CLI_PROVIDER: Record<AiBrand, AiProviderId> = {
  claude: 'claude-cli',
  gpt: 'codex-cli',
};

const PROVIDER_BRAND: Record<AiProviderId, AiBrand> = {
  'claude-cli': 'claude',
  'codex-cli': 'gpt',
};

/**
 * Saved settings from builds that still had API mode move to the brand's CLI. Removed providers
 * (Grok/Cursor, Ollama) and unknown ids return null so callers fall back to the default.
 */
const RETIRED_PROVIDERS: Record<string, AiProviderId> = {
  'gpt-cli': 'codex-cli',
  'openai-api': 'codex-cli',
  'anthropic-api': 'claude-cli',
};

function migrateProviderId(value: unknown): AiProviderId | null {
  if (typeof value !== 'string') return null;
  if (value in PROVIDER_BRAND) return value as AiProviderId;
  return RETIRED_PROVIDERS[value] ?? null;
}

export function resolveAiBrand(config: AiProviderConfig): AiBrand {
  if (config.brand) return config.brand;
  return PROVIDER_BRAND[config.provider] ?? 'claude';
}

function defaultModelFor(brand: AiBrand): string {
  return CLI_PROVIDER_META[BRAND_CLI_PROVIDER[brand]].defaultModel;
}

/** A model saved for the old Claude API (`claude-opus-5`) becomes the CLI's name for it; CLI picks stay. */
function cliModelFor(brand: AiBrand, model: string | undefined, fromApi: boolean): string {
  if (!model) return defaultModelFor(brand);
  return fromApi && brand === 'claude' ? resolveClaudeCliModelId(model) : model;
}

export function resolveAiProviderConfig(config: AiProviderConfig): AiProviderConfig {
  const brand = resolveAiBrand(config);
  return { provider: BRAND_CLI_PROVIDER[brand], brand, model: config.model?.trim() || defaultModelFor(brand) };
}

export function normalizeAiProviderConfig(raw: unknown): AiProviderConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_AI_PROVIDER;
  const rec = raw as { provider?: unknown; model?: unknown; brand?: unknown; mode?: unknown };
  const fromApi = rec.mode === 'api' || rec.provider === 'anthropic-api' || rec.provider === 'openai-api';
  const storedModel = typeof rec.model === 'string' && rec.model.trim() ? rec.model.trim() : undefined;
  // Grok (Cursor CLI / xAI API) and Ollama were removed; never reinterpret their model under another brand.
  if (rec.brand === 'grok' || rec.brand === 'ollama' || rec.provider === 'ollama-api') return DEFAULT_AI_PROVIDER;
  const brand = isAiBrand(rec.brand) ? rec.brand : null;
  const provider = brand ? BRAND_CLI_PROVIDER[brand] : migrateProviderId(rec.provider);
  if (!provider) return DEFAULT_AI_PROVIDER;
  const resolvedBrand = brand ?? resolveAiBrand({ provider });
  return { provider, brand: resolvedBrand, model: cliModelFor(resolvedBrand, storedModel, fromApi) };
}
