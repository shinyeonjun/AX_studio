interface OpenApiConnectionRecord {
  specId?: string;
  label?: string;
  baseUrl?: string;
  specJson?: unknown;
}

export interface OpenApiConnectionConfig {
  specId: string;
  label?: string;
  baseUrl: string;
  specJson: unknown;
}

export function parseOpenApiConnectionConfig(config: unknown): OpenApiConnectionConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const record = config as OpenApiConnectionRecord;
  const specId = typeof record.specId === 'string' ? record.specId.trim() : '';
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
  if (!specId || !baseUrl || record.specJson === undefined) return null;
  return {
    specId,
    label: typeof record.label === 'string' ? record.label.trim() || undefined : undefined,
    baseUrl,
    specJson: record.specJson,
  };
}
