import type { AiBrand, DetectedAiCli } from '../../../../types/ai-provider';
import { AI_PROVIDER_UI_CATALOG } from '../../../../ui/constants/ai-providers';
import { modelsForBrand, resolveClaudeCliModelId } from '@ax-studio/core/ai-catalog';

export function resolveBrandModel(
  target: AiBrand,
  cliProviders: DetectedAiCli[],
  prefs?: { model?: string },
  activeModel?: string,
): string {
  const meta = AI_PROVIDER_UI_CATALOG[target];
  const cli = cliProviders.find((item) => item.id === meta.cliProviderId);
  const models = modelsForBrand(target, cli?.models);
  const rawPreferred = prefs?.model ?? activeModel;
  const preferred = target === 'claude' && rawPreferred ? resolveClaudeCliModelId(rawPreferred) : rawPreferred;
  if (preferred && models.some((item) => item.id === preferred)) return preferred;
  return models[0]?.id ?? '';
}

/** A brand is usable once its CLI is installed, or found and confirmed by the check button. */
export function isBrandReady(
  target: AiBrand,
  cliProviders: DetectedAiCli[],
  verifiedCli: Partial<Record<AiBrand, boolean>>,
): boolean {
  const cli = cliProviders.find((item) => item.id === AI_PROVIDER_UI_CATALOG[target].cliProviderId);
  return Boolean(cli?.installed || (cli?.command && verifiedCli[target]));
}
