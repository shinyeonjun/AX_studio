import type { AiBrand, AiConnectionMode, AiSecretStatus, DetectedAiCli } from '../../types/ai-provider';
import { AI_PROVIDER_UI_CATALOG } from '../../constants/ai-providers';
import { modelsForBrand, resolveClaudeCliModelId } from '@ax-studio/core/ai-catalog';

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
  const rawPreferred = prefs?.model ?? activeModel;
  const preferred =
    target === 'claude' && nextMode === 'cli' && rawPreferred
      ? resolveClaudeCliModelId(rawPreferred)
      : rawPreferred;
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
  if (mode === 'api') return hasApi;
  const hasCliBinary = Boolean(cli?.binaryFound ?? cli?.command);
  return Boolean(cli?.installed || (hasCliBinary && verifiedCli[target]));
}
