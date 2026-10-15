import type { AiBrand } from '../../types/ai-provider';
import type { CliModelOption } from '../../types/ai-provider';
import type { CliProviderId } from '@ax-studio/core/ai-catalog';
import {
  AI_BRAND_CATALOG,
  ENABLED_AI_BRANDS,
  brandFromProvider as coreBrandFromProvider,
  getBrandCliFallbackModels,
  modelsForBrand as coreModelsForBrand,
} from '@ax-studio/core/ai-catalog';

import claudeIcon from '../images/ai/claude.png';
import openaiIcon from '../images/ai/gpt.webp';

export interface AiProviderUiMeta {
  id: AiBrand;
  title: string;
  description: string;
  icon: string;
  cliProviderId: CliProviderId;
  cliLabel: string;
  cliFallbackModels: CliModelOption[];
  enabled: boolean;
}

const UI_OVERLAY: Record<AiBrand, Pick<AiProviderUiMeta, 'icon' | 'cliLabel' | 'description'>> = {
  claude: {
    icon: claudeIcon,
    cliLabel: 'Claude CLI',
    description: 'Anthropic Claude · Claude CLI',
  },
  gpt: {
    icon: openaiIcon,
    cliLabel: 'Codex CLI',
    description: 'OpenAI GPT · Codex CLI',
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
        description: ui.description,
        icon: ui.icon,
        cliProviderId: core.cliProviderId,
        cliLabel: ui.cliLabel,
        cliFallbackModels: getBrandCliFallbackModels(brand),
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

export function modelsForBrand(brand: AiBrand, cliModels: CliModelOption[] | undefined): CliModelOption[] {
  return coreModelsForBrand(brand, cliModels);
}
