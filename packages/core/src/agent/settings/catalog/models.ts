import type { AiBrand } from '../ai-provider-id.js';
import {
  exactModelOption,
  normalizeModelOptions,
  type CliModelOption,
  uniqueModels,
} from '../model-options.js';
import { AI_BRAND_CATALOG, CLI_PROVIDER_META } from './definitions.js';

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
