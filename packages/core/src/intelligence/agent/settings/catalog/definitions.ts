import type { AiBrand, CliProviderId } from '../ai-provider-id.js';
import { CLAUDE_META } from '../providers/claude/meta.js';
import { OPENAI_META } from '../providers/openai/meta.js';
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
};

export interface AiBrandCatalogEntry {
  id: AiBrand;
  title: string;
  description: string;
  cliProviderId: CliProviderId;
  enabled: boolean;
}

export const AI_BRAND_CATALOG: Record<AiBrand, AiBrandCatalogEntry> = {
  claude: {
    id: 'claude',
    title: 'Claude',
    description: 'Anthropic Claude · 인터뷰·판단',
    cliProviderId: 'claude-cli',
    enabled: true,
  },
  gpt: {
    id: 'gpt',
    title: 'GPT',
    description: 'OpenAI GPT · Codex CLI',
    cliProviderId: 'codex-cli',
    enabled: true,
  },
};

export const ENABLED_AI_BRANDS = (Object.keys(AI_BRAND_CATALOG) as AiBrand[]).filter(
  (brand) => AI_BRAND_CATALOG[brand].enabled,
);
