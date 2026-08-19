import { z } from 'zod';
import type { ModelProvider } from './provider.js';
import type { AiBrand, AiConnectionMode, AiProviderId, CliProviderId } from './ai-provider-id.js';
import { isCliProviderId } from './ai-provider-id.js';
import { CLI_PROVIDER_META, AI_BRAND_CATALOG } from './catalog.js';
import { AnthropicApiProvider } from './anthropic-api.js';
import { OpenAiApiProvider } from './openai-api.js';
import { createCliModelProvider } from './cli-provider.js';
import { isAiCliInstalled } from './cli-detect.js';
import { isCursorApiKeyConfigured } from './cli-detect.js';
import { isAnthropicApiKeyConfigured } from './anthropic-api.js';
import { isOpenAiApiKeyConfigured } from './openai-api.js';

export type { AiProviderId, AiBrand, AiConnectionMode } from './ai-provider-id.js';
export { AI_PROVIDER_IDS, AI_BRANDS, AI_CONNECTION_MODES } from './ai-provider-id.js';

export const AiProviderIdSchema = z.enum([
  'codex-cli',
  'claude-cli',
  'cursor-cli',
  'openai-api',
  'anthropic-api',
]);
export const AiBrandSchema = z.enum(['claude', 'gpt', 'grok', 'ollama']);
export const AiConnectionModeSchema = z.enum(['cli', 'api']);

export const AiProviderConfigSchema = z.object({
  provider: AiProviderIdSchema,
  model: z.string().optional(),
  brand: AiBrandSchema.optional(),
  mode: AiConnectionModeSchema.optional(),
});

export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>;

export const DEFAULT_AI_PROVIDER: AiProviderConfig = {
  provider: 'claude-cli',
  brand: 'claude',
  mode: 'cli',
  model: CLI_PROVIDER_META['claude-cli'].defaultModel,
};

const BRAND_CLI_PROVIDER: Record<AiBrand, CliProviderId> = {
  claude: 'claude-cli',
  gpt: 'codex-cli',
  grok: 'cursor-cli',
  ollama: 'codex-cli',
};

const BRAND_API_PROVIDER: Record<AiBrand, AiProviderId> = {
  claude: 'anthropic-api',
  gpt: 'openai-api',
  grok: 'cursor-cli',
  ollama: 'openai-api',
};

const PROVIDER_BRAND: Partial<Record<AiProviderId, AiBrand>> = {
  'claude-cli': 'claude',
  'anthropic-api': 'claude',
  'codex-cli': 'gpt',
  'openai-api': 'gpt',
  'cursor-cli': 'grok',
};

const PROVIDER_MODE: Partial<Record<AiProviderId, AiConnectionMode>> = {
  'claude-cli': 'cli',
  'codex-cli': 'cli',
  'cursor-cli': 'cli',
  'openai-api': 'api',
  'anthropic-api': 'api',
};

const API_DEFAULT_MODEL: Record<AiBrand, string> = {
  claude: AI_BRAND_CATALOG.claude.apiDefaultModel,
  gpt: AI_BRAND_CATALOG.gpt.apiDefaultModel,
  grok: AI_BRAND_CATALOG.grok.apiDefaultModel,
  ollama: AI_BRAND_CATALOG.ollama.apiDefaultModel,
};

function migrateProviderId(value: unknown): AiProviderId | null {
  if (value === 'codex-cli' || value === 'gpt-cli') return 'codex-cli';
  if (value === 'claude-cli') return 'claude-cli';
  if (value === 'cursor-cli' || value === 'cursor') return 'cursor-cli';
  if (value === 'openai-api') return 'openai-api';
  if (value === 'anthropic-api') return 'anthropic-api';
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

export function resolveAiProviderConfig(config: AiProviderConfig): AiProviderConfig {
  const brand = resolveAiBrand(config);
  const mode = resolveAiConnectionMode(config);
  const provider = resolveProviderForBrand(brand, mode);
  const model =
    config.model?.trim() ||
    (mode === 'api' ? API_DEFAULT_MODEL[brand] : CLI_PROVIDER_META[BRAND_CLI_PROVIDER[brand]].defaultModel);
  return { provider, brand, mode, model };
}

export function createModelProvider(config: AiProviderConfig): ModelProvider {
  const resolved = resolveAiProviderConfig(config);
  if (resolved.provider === 'openai-api') return new OpenAiApiProvider(resolved.model!);
  if (resolved.provider === 'anthropic-api') return new AnthropicApiProvider(resolved.model!);
  if (!isCliProviderId(resolved.provider)) {
    throw new Error(`지원하지 않는 AI 제공자입니다: ${resolved.provider}`);
  }
  return createCliModelProvider(resolved.provider, resolved.model!);
}

export function isAiProviderReady(config: AiProviderConfig): boolean {
  const resolved = resolveAiProviderConfig(config);
  if (resolved.mode === 'api') {
    if (resolved.brand === 'claude') return isAnthropicApiKeyConfigured();
    if (resolved.brand === 'gpt') return isOpenAiApiKeyConfigured();
    return isCursorApiKeyConfigured() && isAiCliInstalled('cursor-cli');
  }
  if (!isCliProviderId(resolved.provider)) return false;
  return isAiCliInstalled(resolved.provider);
}

export function getAiProviderLabel(config: AiProviderConfig): string {
  const resolved = resolveAiProviderConfig(config);
  const brandLabel =
    resolved.brand === 'claude' ? 'Claude' : resolved.brand === 'gpt' ? 'GPT' : 'Grok';
  const modeLabel =
    resolved.mode === 'api'
      ? 'API'
      : resolved.brand === 'gpt'
        ? 'Codex CLI'
        : resolved.brand === 'grok'
          ? 'agent CLI'
          : 'CLI';
  return `${brandLabel} · ${modeLabel}`;
}

export function getAiProviderDisplay(config: AiProviderConfig): string {
  const resolved = resolveAiProviderConfig(config);
  return `${getAiProviderLabel(resolved)} · ${resolved.model}`;
}
