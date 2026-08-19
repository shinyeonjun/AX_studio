import type { AiBrand, CliProviderId } from './ai-provider-id.js';
import { CLAUDE_META } from './providers/claude/meta.js';
import { OPENAI_META } from './providers/openai/meta.js';
import { CURSOR_META } from './providers/cursor/meta.js';
import { GROK_META } from './providers/grok/meta.js';
import { OLLAMA_META } from './providers/ollama/meta.js';
import {
  exactModelOption,
  normalizeModelOptions,
  type CliModelOption,
  uniqueModels,
} from './model-options.js';

export interface CliProviderMeta {
  label: string;
  description: string;
  binaries: readonly string[];
  defaultModel: string;
  models: CliModelOption[];
}

export const CLI_PROVIDER_META: Record<CliProviderId, CliProviderMeta> = {
  'claude-cli': {
    label: CLAUDE_META.label,
    description: CLAUDE_META.description,
    binaries: CLAUDE_META.binaries,
    defaultModel: CLAUDE_META.defaultModel,
    models: CLAUDE_META.cliModels,
  },
  'codex-cli': {
    label: OPENAI_META.label,
    description: OPENAI_META.description,
    binaries: OPENAI_META.binaries,
    defaultModel: OPENAI_META.defaultModel,
    models: OPENAI_META.cliModels,
  },
  'cursor-cli': {
    label: CURSOR_META.label,
    description: CURSOR_META.description,
    binaries: CURSOR_META.binaries,
    defaultModel: CURSOR_META.defaultModel,
    models: CURSOR_META.models,
  },
};

export interface AiBrandCatalogEntry {
  id: AiBrand;
  title: string;
  description: string;
  cliProviderId: CliProviderId;
  envKey: string;
  apiModels: CliModelOption[];
  apiDefaultModel: string;
  enabled: boolean;
}

export const AI_BRAND_CATALOG: Record<AiBrand, AiBrandCatalogEntry> = {
  claude: {
    id: 'claude',
    title: 'Claude',
    description: 'Anthropic Claude · 인터뷰·판단',
    cliProviderId: 'claude-cli',
    envKey: CLAUDE_META.envKey,
    apiModels: CLAUDE_META.apiModels,
    apiDefaultModel: CLAUDE_META.apiDefaultModel,
    enabled: true,
  },
  gpt: {
    id: 'gpt',
    title: 'GPT',
    description: 'OpenAI GPT · Codex CLI 또는 API',
    cliProviderId: 'codex-cli',
    envKey: OPENAI_META.envKey,
    apiModels: OPENAI_META.apiModels,
    apiDefaultModel: OPENAI_META.apiDefaultModel,
    enabled: true,
  },
  grok: {
    id: 'grok',
    title: 'Grok',
    description: GROK_META.description,
    cliProviderId: 'cursor-cli',
    envKey: GROK_META.envKey,
    apiModels: GROK_META.apiModels,
    apiDefaultModel: GROK_META.apiDefaultModel,
    enabled: false,
  },
  ollama: {
    id: 'ollama',
    title: 'Ollama',
    description: OLLAMA_META.description,
    cliProviderId: 'codex-cli',
    envKey: OLLAMA_META.envKey,
    apiModels: OLLAMA_META.apiModels,
    apiDefaultModel: OLLAMA_META.apiDefaultModel,
    enabled: OLLAMA_META.enabled,
  },
};

export const ENABLED_AI_BRANDS = (Object.keys(AI_BRAND_CATALOG) as AiBrand[]).filter(
  (brand) => AI_BRAND_CATALOG[brand].enabled,
);

export type { CliModelOption } from './model-options.js';
export {
  exactModelOption,
  exactModelOptions,
  mergeModelOptions,
  normalizeModelOptions,
  uniqueModels,
} from './model-options.js';

export function getBrandCliFallbackModels(brand: AiBrand): CliModelOption[] {
  const cliId = AI_BRAND_CATALOG[brand].cliProviderId;
  return normalizeModelOptions(CLI_PROVIDER_META[cliId].models);
}

export function getBrandApiModels(brand: AiBrand): CliModelOption[] {
  return normalizeModelOptions(AI_BRAND_CATALOG[brand].apiModels);
}

export function parseCodexModelsOutput(raw: string): CliModelOption[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { models?: unknown }).models)
        ? (parsed as { models: unknown[] }).models
        : [];
    const models = rows.flatMap((row) => {
      if (typeof row === 'string') return [exactModelOption(row)];
      if (row && typeof row === 'object') {
        const rec = row as { id?: string; slug?: string; name?: string };
        const id = rec.id ?? rec.slug ?? rec.name;
        if (id) return [exactModelOption(id)];
      }
      return [];
    });
    if (models.length > 0) return uniqueModels(models);
  } catch {
    /* text fallback */
  }
  const ids = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(gpt-|o[0-9]|codex-)/i.test(line.split(/\s+/)[0] ?? ''));
  return normalizeModelOptions(ids.map((id) => exactModelOption(id.split(/\s+/)[0]!)));
}
