import type { AiBrand, AiConnectionMode } from '../types/ai-provider';
import type { CliModelOption } from '../types/ai-provider';
import {
  AI_BRAND_CATALOG,
  ENABLED_AI_BRANDS,
  brandFromProvider as coreBrandFromProvider,
  getBrandCliFallbackModels,
  modelsForBrand as coreModelsForBrand,
} from '@ax-studio/core/ai-catalog';

import claudeIcon from '../images/ai/claude.png';
import openaiIcon from '../images/ai/gpt.webp';
import grokIcon from '../images/ai/grok.webp';

export interface AiProviderUiMeta {
  id: AiBrand;
  title: string;
  description: string;
  icon: string;
  envKey: string;
  cliProviderId: 'claude-cli' | 'codex-cli' | 'cursor-cli';
  cliModeLabel: string;
  cliLabel: string;
  apiModels: CliModelOption[];
  cliFallbackModels: CliModelOption[];
  apiDefaultModel: string;
  enabled: boolean;
}

const UI_OVERLAY: Record<
  AiBrand,
  Pick<AiProviderUiMeta, 'icon' | 'cliModeLabel' | 'cliLabel'> & { description?: string }
> = {
  claude: {
    icon: claudeIcon,
    cliModeLabel: 'CLI',
    cliLabel: 'Claude CLI',
    description: 'Anthropic Claude · Claude CLI 또는 API',
  },
  gpt: {
    icon: openaiIcon,
    cliModeLabel: 'Codex',
    cliLabel: 'Codex CLI',
    description: 'OpenAI GPT · Codex CLI 또는 API',
  },
  grok: {
    icon: grokIcon,
    cliModeLabel: 'CLI',
    cliLabel: 'agent CLI',
    description: 'xAI Grok · Cursor agent CLI 또는 xAI API',
  },
  ollama: {
    icon: openaiIcon,
    cliModeLabel: 'CLI',
    cliLabel: 'Ollama CLI',
    description: '로컬 Ollama (준비 중)',
  },
};

function buildUiCatalog(): Record<AiBrand, AiProviderUiMeta> {
  return (Object.keys(AI_BRAND_CATALOG) as AiBrand[]).reduce(
    (acc, brand) => {
      const core = AI_BRAND_CATALOG[brand];
      const ui = UI_OVERLAY[brand];
      acc[brand] = {
        id: brand,
        title: core.title,
        description: ui.description ?? core.description,
        icon: ui.icon,
        envKey: core.envKey,
        cliProviderId: core.cliProviderId,
        cliModeLabel: ui.cliModeLabel,
        cliLabel: ui.cliLabel,
        apiModels: core.apiModels,
        cliFallbackModels: getBrandCliFallbackModels(brand),
        apiDefaultModel: core.apiDefaultModel,
        enabled: core.enabled,
      };
      return acc;
    },
    {} as Record<AiBrand, AiProviderUiMeta>,
  );
}

export const AI_PROVIDER_UI_CATALOG = buildUiCatalog();

export const ENABLED_AI_PROVIDER_IDS = ENABLED_AI_BRANDS;

export function brandFromProvider(provider?: string, brand?: AiBrand): AiBrand | null {
  return coreBrandFromProvider(provider, brand);
}

export function modeLabel(mode: AiConnectionMode): string {
  return mode === 'api' ? 'API' : 'CLI';
}

export function modelsForBrand(
  brand: AiBrand,
  mode: AiConnectionMode,
  cliModels: CliModelOption[] | undefined,
): CliModelOption[] {
  return coreModelsForBrand(brand, mode, cliModels);
}
