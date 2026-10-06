import { z } from 'zod';
import type { AuthoritativeRequestAnchor } from './request-anchor.js';

export const METADATA_INTENTS = ['inventory', 'schema', 'connection_status'] as const;
export type MetadataIntent = (typeof METADATA_INTENTS)[number];
export type RequestIntent = MetadataIntent | 'retrieval' | 'action' | 'ambiguous' | 'unsupported';
export type MetadataOutputKind = 'readable_inventory' | 'readable_schema' | 'readable_status' | 'raw_debug';

const CandidateCoverageSchema = z.object({
  knownTotal: z.number().int().nonnegative().nullable(),
  truncated: z.boolean(),
  overflow: z.boolean(),
  retrievalMethod: z.enum(['configured_registry', 'saved_spec', 'host_reference']),
}).strict();

const id = z.string().min(1).max(256);
const revision = z.number().int().nonnegative();
const metadataCommand = z.union([
  z.object({ name: z.literal('discovery.describe'), args: z.object({
    assetId: id, depth: z.enum(['summary', 'schema']),
  }).strict() }).strict(),
  z.object({ name: z.literal('capability.invoke'), args: z.object({
    id: z.literal('rdb.schema.describe'), params: z.object({ connectionId: id }).strict(),
  }).strict() }).strict(),
]);

export const MetadataCatalogSchema = z.object({
  revision,
  policyRevision: revision,
  coverage: CandidateCoverageSchema,
  sources: z.array(z.object({
    id, label: z.string().min(1).max(160), revision,
    aliases: z.array(z.string().min(1).max(160)).max(16).default([]),
    /** Actual host identities for the finite describe commands; never model-generated. */
    assetId: id,
    connectionId: id.optional(),
    operationCoverage: CandidateCoverageSchema,
    operations: z.array(z.object({
      id, intent: z.enum(METADATA_INTENTS), label: z.string().min(1).max(160),
      allowed: z.boolean(),
      command: metadataCommand,
    }).strict()).max(16),
  }).strict()).max(32),
}).strict();

export type MetadataCatalog = z.input<typeof MetadataCatalogSchema>;
export type AcceptedMetadataCatalog = z.output<typeof MetadataCatalogSchema>;
export type RegisteredMetadataSource = AcceptedMetadataCatalog['sources'][number];
export type RegisteredMetadataOperation = RegisteredMetadataSource['operations'][number];

/** The approved adapter view. Unknown fields (including bodies/secrets) are removed. */
export const SourceMetadataEvidenceSchema = z.object({
  sourceId: id,
  sourceRevision: revision,
  intent: z.enum(METADATA_INTENTS),
  entries: z.array(z.object({
    id, label: z.string().max(160),
    /** Exact registered relative reference, not an inferred remote operation identifier. */
    path: z.string().min(1).max(512).optional(),
    fields: z.array(z.object({ name: z.string().min(1).max(160), type: z.string().min(1).max(80).optional(),
      required: z.boolean().optional() })).max(64).optional(),
  })).max(64),
  knownTotal: z.number().int().nonnegative().nullable(),
  truncated: z.boolean(),
  scope: z.enum(['validated_local_registration', 'registered_field_dictionary']).optional(),
  filtered: z.boolean().optional(),
  status: z.object({
    catalogExists: z.boolean(), configured: z.boolean(),
    /** Saved registration switch, not current reachability/authentication. */
    enabled: z.boolean().optional(),
    authentication: z.enum(['ready', 'not_ready', 'unknown']),
    operationPermission: z.enum(['verified', 'denied', 'unknown']),
    health: z.enum(['healthy', 'unhealthy', 'unknown']),
  }).optional(),
});
export type SourceMetadataEvidence = z.infer<typeof SourceMetadataEvidenceSchema>;

export const REQUEST_UNDERSTANDING_FIELDS = ['intent', 'targetSourceRef', 'outputKind'] as const;
export type RequestUnderstandingField = (typeof REQUEST_UNDERSTANDING_FIELDS)[number];
export interface RequestFieldAuthority {
  readonly anchor: AuthoritativeRequestAnchor;
  readonly requestRevision: number;
}
type RequestFieldProvenance = Readonly<Record<RequestUnderstandingField, {
  readonly requestDigest: string; readonly requestRevision: number;
}>>;

export interface ActiveRequestSnapshot {
  readonly anchor: AuthoritativeRequestAnchor;
  readonly requestRevision: number;
  readonly catalogRevision: number;
  readonly policyRevision: number;
  readonly signal: AbortSignal;
  readonly fieldAuthorities: Readonly<Record<RequestUnderstandingField, RequestFieldAuthority>>;
}

export interface RequestUnderstanding {
  readonly version: 1;
  readonly intent: MetadataIntent;
  readonly targetSourceRef: string;
  readonly metadataOperationRef: string;
  readonly outputKind: MetadataOutputKind;
  readonly needsGeneratedProse: boolean;
  readonly provenance: {
    readonly requestDigest: string;
    readonly requestRevision: number;
    readonly sourceRevision: number;
    readonly catalogRevision: number;
    readonly policyRevision: number;
    readonly selectedRefs: Readonly<Record<string, string>>;
    readonly fieldAuthorities: RequestFieldProvenance;
  };
}

/** Finite field assessment, including unresolved states; never an execution permit. */
export interface RequestUnderstandingAssessment {
  readonly intent: RequestIntent | 'unknown';
  readonly targetSourceRef: { readonly state: 'selected'; readonly sourceId: string; readonly sourceRevision: number }
    | { readonly state: 'none' | 'ambiguous' | 'unknown' };
  readonly metadataOperationRef: { readonly state: 'selected'; readonly operationId: string }
    | { readonly state: 'not_evaluated' | 'not_applicable' | 'none' | 'unknown' | 'unsupported' };
  readonly outputKind: MetadataOutputKind | 'not_stated' | 'ambiguous' | 'unknown';
  readonly provenance: {
    readonly requestDigest: string; readonly requestRevision: number;
    readonly catalogRevision: number; readonly policyRevision: number;
    readonly fieldAuthorities: RequestFieldProvenance;
  };
}

export type UnderstandingStop =
  | 'answered' | 'outside_slice' | 'ambiguous_intent' | 'unsupported_intent'
  | 'source_required' | 'source_ambiguous' | 'candidate_coverage_incomplete'
  | 'output_ambiguous' | 'metadata_unavailable' | 'unsupported_operation' | 'invalid_decision'
  | 'permission_denied' | 'metadata_budget_exhausted' | 'provider_failure';

export interface RequestUnderstandingResult {
  readonly stop: UnderstandingStop;
  readonly reply: string;
  readonly requestRevision: number;
  readonly understanding?: RequestUnderstanding;
  readonly assessment: RequestUnderstandingAssessment;
  /** Offline phase count, deliberately not a provider-transport call count. */
  readonly evaluationPhases: number;
}
