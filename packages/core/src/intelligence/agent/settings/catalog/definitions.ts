import type { AiBrand, CliProviderId } from '../ai-provider-id.js';
import { CLAUDE_META } from '../providers/claude/meta.js';
import { OPENAI_META } from '../providers/openai/meta.js';
import { CURSOR_META } from '../providers/cursor/meta.js';
import { GROK_META } from '../providers/grok/meta.js';
import { OLLAMA_META } from '../providers/ollama/meta.js';
import type { CliModelOption } from '../model-options.js';

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
