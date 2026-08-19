import type { AiBrand, AiConnectionMode, AiSecretStatus, DetectedAiCli } from '../../types/ai-provider';
import { AI_PROVIDER_UI_CATALOG } from '../../constants/ai-providers';
import { modelsForBrand } from '@ax-studio/core/ai-catalog';
import { assessGrokConnection } from '../ai-connection-status';

export function resolveBrandModel(
  target: AiBrand,
  nextMode: AiConnectionMode,
  cliProviders: DetectedAiCli[],
  prefs?: { mode?: AiConnectionMode; model?: string },
  activeModel?: string,
): string {
  const meta = AI_PROVIDER_UI_CATALOG[target];
  const cli = cliProviders.find((item) => item.id === meta.cliProviderId);
  const models = modelsForBrand(target, nextMode, cli?.models);
  const preferred = prefs?.model ?? activeModel;
  if (preferred && models.some((item) => item.id === preferred)) return preferred;
  return models[0]?.id ?? meta.apiDefaultModel;
}

export function isBrandReady(
  target: AiBrand,
  mode: AiConnectionMode,
  cliProviders: DetectedAiCli[],
  brandSecrets: Record<string, AiSecretStatus>,
  verifiedCli: Partial<Record<AiBrand, boolean>>,
  verifiedApi: Partial<Record<AiBrand, boolean>>,
): boolean {
  const meta = AI_PROVIDER_UI_CATALOG[target];
  const cli = cliProviders.find((item) => item.id === meta.cliProviderId);
  const hasApi = Boolean(brandSecrets[target]?.configured || verifiedApi[target]);
  if (target === 'grok' && mode === 'cli') {
    return assessGrokConnection(cli, hasApi, Boolean(verifiedCli[target])).ready;
  }
  if (mode === 'api') return hasApi;
  const hasCliBinary = Boolean(cli?.binaryFound ?? cli?.command);
  return Boolean(cli?.installed || (hasCliBinary && verifiedCli[target]));
}
