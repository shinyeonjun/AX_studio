/**
 * Neutral metadata contract for the unified discovery surface.
 *
 * This module deliberately knows nothing about DB drivers, HTTP clients, or
 * filesystem access. Connector-specific adapters materialize safe assets and
 * this index only ranks and hands off stable identifiers.
 */

import type {
  DiscoveryFieldMetadata,
} from '../contracts/discovery-metadata.js';

export const DISCOVERY_ASSET_KINDS = [
  'connector',
  'tool',
  'database_table',
  'http_endpoint',
  'folder',
] as const;

export type DiscoveryAssetKind = (typeof DISCOVERY_ASSET_KINDS)[number];
export type DiscoveryAssetAvailability = 'ready' | 'requires_connection' | 'blocked';
export type DiscoveryAssetAccess = 'read' | 'write' | 'trigger' | 'mixed' | 'none';
export type DiscoveryProvenanceSource = 'catalog' | 'connection' | 'capability' | 'openapi' | 'schema';

export interface DiscoveryAssetProvenance {
  source: DiscoveryProvenanceSource;
  ref: string;
}

export type DiscoveryLineageRelationship = 'provided_by' | 'derived_from' | 'described_by';

export interface DiscoveryLineageLink {
  relationship: DiscoveryLineageRelationship;
  assetId: string;
}

export interface DiscoveryAsset {
  /** Stable hand-off identifier; callers must use this instead of re-searching by label. */
  id: string;
  kind: DiscoveryAssetKind;
  name: string;
  label: string;
  description: string;
  connector?: string;
  aliases: readonly string[];
  availability: DiscoveryAssetAvailability;
  access: DiscoveryAssetAccess;
  /** Safe scalar metadata only. Secrets, raw paths, and source rows are excluded. */
  metadata: Readonly<Record<string, string | number | boolean>>;
  /** Optional bounded business dictionary supplied by a trusted host boundary. */
  fields?: readonly DiscoveryFieldMetadata[];
  /** Where this asset came from; never contains credentials or physical paths. */
  provenance?: DiscoveryAssetProvenance;
  /** Compact links to the connector or schema that supplied this asset. */
  lineage?: readonly DiscoveryLineageLink[];
}

export interface DiscoverySearchRequest {
  query: string;
  kind?: DiscoveryAssetKind;
  connector?: string;
  limit?: number;
  offset?: number;
}

export interface DiscoveryAssetCandidate {
  id: string;
  kind: DiscoveryAssetKind;
  label: string;
  description: string;
  connector?: string;
  availability: DiscoveryAssetAvailability;
  access: DiscoveryAssetAccess;
  score: number;
  matchedOn: string[];
}

export interface DiscoverySearchResult {
  query: string;
  candidates: DiscoveryAssetCandidate[];
  totalMatches: number;
  catalogSize: number;
  truncated: boolean;
  nextOffset?: number;
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
export const DISCOVERY_MAX_ID_LENGTH = 256;
export const DISCOVERY_MAX_TEXT_LENGTH = 500;
export const DISCOVERY_MAX_ALIAS_LENGTH = 120;

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

function boundedText(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

function normalizeAsset(asset: DiscoveryAsset): DiscoveryAsset {
  return {
    ...asset,
    id: asset.id,
    name: boundedText(asset.name, DISCOVERY_MAX_TEXT_LENGTH),
    label: boundedText(asset.label, DISCOVERY_MAX_TEXT_LENGTH),
    description: boundedText(asset.description, DISCOVERY_MAX_TEXT_LENGTH),
    aliases: asset.aliases
      .map((alias) => boundedText(alias, DISCOVERY_MAX_ALIAS_LENGTH))
      .filter(Boolean),
    // Adapter-supplied scalar metadata includes exact executable references.
    // Applying presentation limits here would silently change the target.
    metadata: { ...asset.metadata },
    ...(asset.fields?.length
      ? {
          fields: asset.fields
            .map((field) => ({
              name: boundedText(field.name, 160),
              ...(field.label ? { label: boundedText(field.label, 240) } : {}),
              ...(field.description ? { description: boundedText(field.description, DISCOVERY_MAX_TEXT_LENGTH) } : {}),
              ...(field.type ? { type: boundedText(field.type, 240) } : {}),
              ...(field.required === undefined ? {} : { required: field.required }),
            }))
            .filter((field) => field.name.length > 0),
        }
      : {}),
    ...(asset.provenance
      ? {
          provenance: {
            source: asset.provenance.source,
            ref: asset.provenance.ref,
          },
        }
      : {}),
    ...(asset.lineage?.length
      ? {
          lineage: asset.lineage.map((link) => ({
            relationship: link.relationship,
            assetId: link.assetId,
          })),
        }
      : {}),
  };
}

function searchableFields(asset: DiscoveryAsset): Array<[string, string, number]> {
  return [
    ['id', asset.id, 0.9],
    ['name', asset.name, 0.95],
    ['label', asset.label, 1],
    ['description', asset.description, 0.65],
    ...asset.aliases.map((alias) => ['alias', alias, 0.85] as [string, string, number]),
    ...(asset.fields ?? []).flatMap((field) => [
      ['field.name', field.name, 0.8] as [string, string, number],
      ...(field.label ? [['field.label', field.label, 0.85] as [string, string, number]] : []),
      ...(field.description ? [['field.description', field.description, 0.75] as [string, string, number]] : []),
    ]),
    ...(asset.connector ? [['connector', asset.connector, 0.45] as [string, string, number]] : []),
  ];
}

function rankAsset(asset: DiscoveryAsset, query: string): { score: number; matchedOn: string[] } | null {
  const normalizedQuery = normalize(query.trim());
  const tokens = tokenize(normalizedQuery);
  if (!normalizedQuery || tokens.length === 0) return null;

  const fields = searchableFields(asset).map(([name, value, weight]) => [name, normalize(value), weight] as const);
  const exactField = fields.find(([name, value]) =>
    (name === 'label' || name === 'name') && value === normalizedQuery,
  );
  if (exactField) {
    return { score: 1, matchedOn: [exactField[0]] };
  }

  const matched = new Map<string, number>();
  let coveredTokenCount = 0;
  for (const token of tokens) {
    let match: (typeof fields)[number] | undefined;
    for (const field of fields) {
      if (field[1].includes(token) && (!match || field[2] > match[2])) match = field;
    }
    if (match) {
      coveredTokenCount += 1;
      const [field, , weight] = match;
      matched.set(field, Math.max(matched.get(field) ?? 0, weight));
    }
  }
  if (matched.size === 0) return null;

  const tokenCoverage = coveredTokenCount / tokens.length;
  const weightedMatch = [...matched.values()].reduce((sum, value) => sum + value, 0) / tokens.length;
  const phraseBoost = fields.some(([, value]) => value.includes(normalizedQuery)) ? 0.12 : 0;
  const score = Math.min(0.99, Math.max(0.01, tokenCoverage * 0.65 + Math.min(1, weightedMatch) * 0.25 + phraseBoost));
  return { score, matchedOn: [...matched.keys()].sort() };
}

function candidateFrom(asset: DiscoveryAsset, score: number, matchedOn: string[]): DiscoveryAssetCandidate {
  return {
    id: asset.id,
    kind: asset.kind,
    label: asset.label,
    description: asset.description,
    ...(asset.connector ? { connector: asset.connector } : {}),
    availability: asset.availability,
    access: asset.access,
    score: Number(score.toFixed(4)),
    matchedOn,
  };
}

/**
 * Searchable, immutable-in-use index for the model-facing discovery seam.
 * The index is intentionally in-memory for now; persistence and provider
 * adapters can change without changing this interface.
 */
export class DiscoveryAssetIndex {
  private readonly assets: readonly DiscoveryAsset[];

  constructor(assets: readonly DiscoveryAsset[]) {
    this.assets = assets.map(normalizeAsset);
  }

  get size(): number {
    return this.assets.length;
  }

  find(assetId: string): DiscoveryAsset | undefined {
    return this.assets.find((asset) => asset.id === assetId.trim());
  }

  search(request: DiscoverySearchRequest): DiscoverySearchResult {
    const query = request.query.trim();
    const filtered = this.assets.filter((asset) =>
      (!request.kind || asset.kind === request.kind)
      && (!request.connector || asset.connector === request.connector.trim()),
    );
    const ranked = filtered
      .flatMap((asset) => {
        const rank = rankAsset(asset, query);
        return rank ? [candidateFrom(asset, rank.score, rank.matchedOn)] : [];
      })
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    const limit = boundedLimit(request.limit);
    const offset = request.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset_invalid');
    const end = offset + limit;
    return {
      query,
      candidates: ranked.slice(offset, end),
      totalMatches: ranked.length,
      catalogSize: this.assets.length,
      truncated: ranked.length > end,
      ...(ranked.length > end ? { nextOffset: end } : {}),
    };
  }
}

export { DEFAULT_LIMIT as DISCOVERY_DEFAULT_LIMIT, MAX_LIMIT as DISCOVERY_MAX_LIMIT };
