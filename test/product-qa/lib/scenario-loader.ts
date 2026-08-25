import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_SURFACES } from '../catalog/product-surface.js';
import { defaultMaxForTier, generateScenarios } from './generator.js';
import type { ProductQaMode, ProductQaTier, ProductScenario } from './types.js';

const scenariosDir = join(dirname(fileURLToPath(import.meta.url)), '../scenarios');

export interface LoadScenarioOptions {
  ids?: string[];
  tags?: string[];
  mode?: ProductQaMode;
  tier?: ProductQaTier;
  max?: number;
  allowSideEffects?: boolean;
  seed?: number;
}

function readManifest(): string[] {
  const manifestPath = join(scenariosDir, 'manifest.json');
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as { scenarios?: string[] };
  if (Array.isArray(raw.scenarios) && raw.scenarios.length > 0) return raw.scenarios;
  return readdirSync(scenariosDir)
    .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
    .sort();
}

function loadHandwritten(): ProductScenario[] {
  const files = readManifest();
  const scenarios: ProductScenario[] = [];
  for (const file of files) {
    const path = join(scenariosDir, file.endsWith('.json') ? file : `${file}.json`);
    const scenario = JSON.parse(readFileSync(path, 'utf8')) as ProductScenario;
    if (!scenario.id || !scenario.name || !Array.isArray(scenario.steps)) {
      throw new Error(`Invalid scenario file: ${path}`);
    }
    scenario.generated = false;
    scenario.tier = scenario.tier ?? 'handwritten';
    scenarios.push(scenario);
  }
  return scenarios;
}

function applyFilters(
  scenarios: ProductScenario[],
  filters?: { ids?: string[]; tags?: string[]; mode?: ProductQaMode },
): ProductScenario[] {
  return scenarios.filter((scenario) => {
    if (filters?.mode && (scenario.mode ?? 'live') !== filters.mode) return false;
    if (filters?.ids?.length && !filters.ids.includes(scenario.id)) return false;
    if (filters?.tags?.length) {
      const tags = scenario.tags ?? [];
      if (!filters.tags.some((tag) => tags.includes(tag))) return false;
    }
    return true;
  });
}

export function loadScenarios(filters?: LoadScenarioOptions): ProductScenario[] {
  const mode = filters?.mode;
  const requestedTier = filters?.tier ?? 'handwritten';
  const tier =
    requestedTier === 'handwritten' && filters?.ids?.length ? 'core' : requestedTier;
  const handwritten = applyFilters(loadHandwritten(), { ids: filters?.ids, tags: filters?.tags, mode });
  if (tier === 'handwritten') {
    return handwritten;
  }

  const generated = applyFilters(
    generateScenarios({
      mode: mode ?? 'live',
      tier,
      max: filters?.max ?? defaultMaxForTier(tier),
      allowSideEffects: filters?.allowSideEffects === true,
      seed: filters?.seed,
    }),
    { ids: filters?.ids, tags: filters?.tags, mode },
  );

  const seen = new Set(handwritten.map((s) => s.id));
  const merged = [...handwritten];
  for (const scenario of generated) {
    if (seen.has(scenario.id)) continue;
    seen.add(scenario.id);
    merged.push(scenario);
  }
  return merged;
}

export function coverageFor(scenarios: ProductScenario[]): {
  total: number;
  covered: number;
  missing: string[];
} {
  const coveredIds = new Set(scenarios.flatMap((scenario) => scenario.covers ?? []));
  const missing = PRODUCT_SURFACES.filter((surface) => surface.productReady && !coveredIds.has(surface.id)).map(
    (surface) => surface.id,
  );
  const ready = PRODUCT_SURFACES.filter((surface) => surface.productReady);
  return {
    total: ready.length,
    covered: ready.length - missing.length,
    missing,
  };
}
