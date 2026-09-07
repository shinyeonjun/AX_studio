/**
 * Safe, user-maintained metadata that enriches the model-facing discovery
 * catalog. It is intentionally independent from connector credentials and
 * from source rows.
 */

export const DISCOVERY_METADATA_MAX_ASSET_ID_LENGTH = 4096;
export const DISCOVERY_METADATA_MAX_DESCRIPTION_LENGTH = 500;
export const DISCOVERY_METADATA_MAX_ALIAS_LENGTH = 120;
export const DISCOVERY_METADATA_MAX_ALIASES = 32;
export const DISCOVERY_METADATA_MAX_FIELDS = 100;
export const DISCOVERY_METADATA_MAX_FIELD_NAME_LENGTH = 160;
export const DISCOVERY_METADATA_MAX_FIELD_LABEL_LENGTH = 240;

export interface DiscoveryFieldMetadata {
  name: string;
  label?: string;
  description?: string;
  type?: string;
  required?: boolean;
}

export interface DiscoveryMetadataRecord {
  assetId: string;
  description?: string;
  aliases: string[];
  fields: DiscoveryFieldMetadata[];
  updatedAt: string;
}

export type DiscoveryMetadataInput = Omit<DiscoveryMetadataRecord, 'updatedAt'> & {
  updatedAt?: string;
};

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function boundedBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeField(value: unknown): DiscoveryFieldMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const name = boundedText(record.name, DISCOVERY_METADATA_MAX_FIELD_NAME_LENGTH);
  if (!name) return undefined;
  return {
    name,
    ...(boundedText(record.label, DISCOVERY_METADATA_MAX_FIELD_LABEL_LENGTH)
      ? { label: boundedText(record.label, DISCOVERY_METADATA_MAX_FIELD_LABEL_LENGTH) }
      : {}),
    ...(boundedText(record.description, DISCOVERY_METADATA_MAX_DESCRIPTION_LENGTH)
      ? { description: boundedText(record.description, DISCOVERY_METADATA_MAX_DESCRIPTION_LENGTH) }
      : {}),
    ...(boundedText(record.type, DISCOVERY_METADATA_MAX_FIELD_LABEL_LENGTH)
      ? { type: boundedText(record.type, DISCOVERY_METADATA_MAX_FIELD_LABEL_LENGTH) }
      : {}),
    ...(boundedBoolean(record.required) === undefined ? {} : { required: record.required as boolean }),
  };
}

/**
 * Normalize untrusted persisted metadata into a small deterministic record.
 * Invalid records are ignored by readers and rejected by writers.
 */
export function normalizeDiscoveryMetadata(
  value: unknown,
  now = new Date().toISOString(),
): DiscoveryMetadataRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  // Identity is never presentation text: reject oversized keys rather than
  // merging distinct assets into the same truncated persistence key.
  const assetId = typeof record.assetId === 'string' ? record.assetId.trim() : '';
  if (!assetId || assetId.length > DISCOVERY_METADATA_MAX_ASSET_ID_LENGTH) return undefined;

  const aliases = Array.isArray(record.aliases)
    ? [...new Set(record.aliases
      .map((alias) => boundedText(alias, DISCOVERY_METADATA_MAX_ALIAS_LENGTH))
      .filter((alias): alias is string => Boolean(alias)))]
        .slice(0, DISCOVERY_METADATA_MAX_ALIASES)
    : [];
  const fields: DiscoveryFieldMetadata[] = [];
  if (Array.isArray(record.fields)) {
    for (const rawField of record.fields) {
      const field = normalizeField(rawField);
      if (!field || fields.some((entry) => entry.name === field.name)) continue;
      fields.push(field);
      if (fields.length >= DISCOVERY_METADATA_MAX_FIELDS) break;
    }
  }

  return {
    assetId,
    ...(boundedText(record.description, DISCOVERY_METADATA_MAX_DESCRIPTION_LENGTH)
      ? { description: boundedText(record.description, DISCOVERY_METADATA_MAX_DESCRIPTION_LENGTH) }
      : {}),
    aliases,
    fields,
    updatedAt: boundedText(record.updatedAt, 64) ?? now,
  };
}

export function normalizeDiscoveryMetadataInput(
  value: DiscoveryMetadataInput,
  now = new Date().toISOString(),
): DiscoveryMetadataRecord {
  const normalized = normalizeDiscoveryMetadata(value, now);
  if (!normalized) throw new Error('discovery_metadata_invalid');
  return normalized;
}
