export interface CliModelOption {
  id: string;
  label: string;
}

export function uniqueModels(models: CliModelOption[]): CliModelOption[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

const EXCLUDED_MODEL_IDS = new Set(['auto', 'codex-auto-review']);

export function exactModelOption(id: string): CliModelOption {
  return { id, label: id };
}

export function exactModelOptions(ids: readonly string[]): CliModelOption[] {
  return ids.map(exactModelOption);
}

/** 드롭다운용 — 모델 ID 그대로 표시, auto 등 제외 */
export function mergeModelOptions(...groups: CliModelOption[][]): CliModelOption[] {
  return uniqueModels(groups.flat().filter((model) => model.id.trim()));
}

export function normalizeModelOptions(models: CliModelOption[]): CliModelOption[] {
  return uniqueModels(
    models
      .filter((model) => model.id.trim() && !EXCLUDED_MODEL_IDS.has(model.id.trim().toLowerCase()))
      .map((model) => (model.label && model.label !== model.id ? model : exactModelOption(model.id.trim()))),
  );
}
