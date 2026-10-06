import type { AxCommand } from '../../agent/commands/schema.js';
import {
  MetadataCatalogSchema,
  REQUEST_UNDERSTANDING_FIELDS, type RequestUnderstandingField, type RequestFieldAuthority,
  type MetadataCatalog, type AcceptedMetadataCatalog, type ActiveRequestSnapshot,
  type RegisteredMetadataOperation, type RegisteredMetadataSource, type RequestUnderstanding,
  type MetadataIntent,
  type RequestUnderstandingAssessment,
} from '../../../contracts/request-understanding.js';
import type { AuthoritativeRequestAnchor } from '../../../contracts/request-anchor.js';
import { createAuthoritativeRequestAnchor } from '../request-anchor.js';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function acceptedCatalog(raw: MetadataCatalog): AcceptedMetadataCatalog {
  const catalog = MetadataCatalogSchema.parse(raw);
  const complete = (coverage: AcceptedMetadataCatalog['coverage'], count: number) =>
    coverage.knownTotal === null ? coverage.truncated || coverage.overflow
      : coverage.knownTotal >= count && (coverage.truncated || coverage.overflow || coverage.knownTotal === count);
  const ids = catalog.sources.map(source => source.id);
  if (new Set(ids).size !== ids.length || !complete(catalog.coverage, ids.length)) throw new Error('invalid_source_coverage');
  for (const source of catalog.sources) {
    const operationIds = source.operations.map(operation => operation.id);
    if (new Set(operationIds).size !== operationIds.length
      || !complete(source.operationCoverage, operationIds.length)) throw new Error('invalid_operation_coverage');
    for (const operation of source.operations) {
      const command = operation.command;
      if ((command.name === 'discovery.describe' && command.args.assetId !== source.assetId)
        || (command.name === 'capability.invoke' && command.args.params.connectionId !== source.connectionId)
        || (operation.intent === 'schema' && command.name === 'discovery.describe' && command.args.depth !== 'schema')
        || (operation.intent !== 'schema' && command.name === 'capability.invoke')) {
        throw new Error('metadata_operation_source_mismatch');
      }
    }
  }
  return freeze(catalog);
}

export class RequestUnderstandingInvalidatedError extends Error {
  constructor(readonly reason: 'superseded' | 'cancelled') {
    super(reason === 'superseded' ? '요청 또는 메타데이터 버전이 바뀌어 이전 작업을 중단했습니다.' : '요청이 취소되었습니다.');
  }
}

/** Host-owned, task-local lifecycle. This neither parses language nor changes Desktop state. */
export class RequestUnderstandingSession {
  readonly originalAnchor: AuthoritativeRequestAnchor;
  private anchor: AuthoritativeRequestAnchor;
  private requestRevision = 1;
  private controller = new AbortController();
  private catalogValue: AcceptedMetadataCatalog;
  private fieldAuthorities: Readonly<Record<RequestUnderstandingField, RequestFieldAuthority>>;
  private turns: Array<{ anchor: AuthoritativeRequestAnchor; revision: number; supersedes: readonly RequestUnderstandingField[] }>;

  constructor(input: { text: string; requestId: string; workspaceSessionId: string; catalog: MetadataCatalog;
    initialRequestRevision?: number; metadataAdapter?: LocalMetadataAdapterDescriptor; assertHostCurrent?: () => void }) {
    if (input.initialRequestRevision !== undefined) {
      if (!Number.isSafeInteger(input.initialRequestRevision) || input.initialRequestRevision < 1) throw new Error('invalid_request_revision');
      this.requestRevision = input.initialRequestRevision;
    }
    this.metadataAdapter = input.metadataAdapter && Object.freeze({ ...input.metadataAdapter });
    this.assertHostCurrent = input.assertHostCurrent;
    this.catalogValue = acceptedCatalog(input.catalog);
    this.originalAnchor = this.anchor = createAuthoritativeRequestAnchor(input.text, {
      originalRequestId: input.requestId, workspaceSessionId: input.workspaceSessionId,
      catalogRevision: this.catalogValue.revision,
    });
    this.turns = [{ anchor: this.anchor, revision: this.requestRevision, supersedes: [] }];
    const authority = Object.freeze({ anchor: this.anchor, requestRevision: this.requestRevision });
    this.fieldAuthorities = Object.freeze({ intent: authority, targetSourceRef: authority, outputKind: authority });
  }

  private readonly metadataAdapter?: LocalMetadataAdapterDescriptor;
  private readonly assertHostCurrent?: () => void;

  get catalog(): AcceptedMetadataCatalog { return this.catalogValue; }
  get userTurns() { return freeze(this.turns.map(turn => ({ ...turn, supersedes: [...turn.supersedes] }))); }

  capture(): ActiveRequestSnapshot {
    return Object.freeze({ anchor: this.anchor, requestRevision: this.requestRevision,
      catalogRevision: this.catalogValue.revision, policyRevision: this.catalogValue.policyRevision,
      signal: this.controller.signal, fieldAuthorities: this.fieldAuthorities });
  }

  assertCurrent(snapshot: ActiveRequestSnapshot): void {
    this.assertHostCurrent?.();
    if (snapshot.requestRevision !== this.requestRevision || snapshot.anchor.digest !== this.anchor.digest
      || snapshot.catalogRevision !== this.catalogValue.revision || snapshot.policyRevision !== this.catalogValue.policyRevision) {
      throw new RequestUnderstandingInvalidatedError('superseded');
    }
    if (snapshot.signal.aborted || this.controller.signal.aborted) throw new RequestUnderstandingInvalidatedError('cancelled');
  }

  acceptCorrection(input: { text: string; requestId: string; supersedes: readonly RequestUnderstandingField[] }): void {
    if (!Array.isArray(input.supersedes) || input.supersedes.some(field => !REQUEST_UNDERSTANDING_FIELDS.includes(field))) {
      throw new Error('invalid_request_field_supersession');
    }
    const anchor = createAuthoritativeRequestAnchor(input.text, {
      originalRequestId: input.requestId, workspaceSessionId: this.anchor.workspaceSessionId,
      catalogRevision: this.catalogValue.revision,
    });
    this.controller.abort();
    this.controller = new AbortController();
    this.anchor = anchor;
    this.requestRevision += 1;
    this.turns.push({ anchor, revision: this.requestRevision, supersedes: [...input.supersedes] });
    const authority = Object.freeze({ anchor, requestRevision: this.requestRevision });
    this.fieldAuthorities = Object.freeze({
      intent: input.supersedes.includes('intent') ? authority : this.fieldAuthorities.intent,
      targetSourceRef: input.supersedes.includes('targetSourceRef') ? authority : this.fieldAuthorities.targetSourceRef,
      outputKind: input.supersedes.includes('outputKind') ? authority : this.fieldAuthorities.outputKind,
    });
  }

  replaceCatalog(catalog: MetadataCatalog): void {
    const accepted = acceptedCatalog(catalog);
    if (accepted.revision <= this.catalogValue.revision || accepted.policyRevision < this.catalogValue.policyRevision) {
      throw new Error('metadata_revision_must_advance');
    }
    this.catalogValue = accepted;
    this.controller.abort();
    this.controller = new AbortController();
  }

  cancel(): void { this.controller.abort(); }

  /** Exact literal alias/name spans are candidates, never semantic extraction or authorization. */
  sourceCandidates(snapshot: ActiveRequestSnapshot) {
    this.assertCurrent(snapshot);
    const authority = snapshot.fieldAuthorities.targetSourceRef;
    return this.catalog.sources.map((source, index) => ({ ref: `source_${index}`, source,
      spans: [source.label, ...source.aliases].flatMap(alias => {
        // ASCII folding preserves UTF-16 offsets; unrestricted Unicode folding need not.
        const fold = (text: string) => text.replace(/[A-Z]/gu, letter => letter.toLowerCase());
        const start = fold(authority.anchor.text).indexOf(fold(alias));
        return start < 0 ? [] : [{ start, end: start + alias.length,
          text: authority.anchor.text.slice(start, start + alias.length), requestDigest: authority.anchor.digest,
          requestRevision: authority.requestRevision }];
      }),
    }));
  }

  /** Eligibility only; the existing permit remains the sole dispatch authority. */
  singletonLocalSchemaOperation(snapshot: ActiveRequestSnapshot,
    assessment: RequestUnderstandingAssessment): RegisteredMetadataOperation | undefined {
    this.assertCurrent(snapshot);
    if (!this.assertHostCurrent || this.metadataAdapter?.kind !== 'registered_http_metadata'
      || snapshot.fieldAuthorities !== this.fieldAuthorities || snapshot.signal !== this.controller.signal
      || assessment.intent !== 'schema' || assessment.outputKind !== 'readable_schema'
      || assessment.targetSourceRef.state !== 'selected' || assessment.metadataOperationRef.state !== 'not_evaluated') return undefined;
    const provenance = assessment.provenance;
    if (provenance.requestDigest !== snapshot.anchor.digest || provenance.requestRevision !== snapshot.requestRevision
      || provenance.catalogRevision !== snapshot.catalogRevision || provenance.policyRevision !== snapshot.policyRevision
      || REQUEST_UNDERSTANDING_FIELDS.some(field => provenance.fieldAuthorities[field].requestDigest !== snapshot.fieldAuthorities[field].anchor.digest
        || provenance.fieldAuthorities[field].requestRevision !== snapshot.fieldAuthorities[field].requestRevision)) return undefined;
    const target = assessment.targetSourceRef;
    const selectedSource = this.catalog.sources.find(entry => entry.id === target.sourceId);
    const full = (coverage: AcceptedMetadataCatalog['coverage'], count: number) =>
      !coverage.truncated && !coverage.overflow && coverage.knownTotal === count;
    if (!selectedSource || selectedSource.revision !== assessment.targetSourceRef.sourceRevision
      || !selectedSource.id.startsWith('http:') || selectedSource.assetId !== selectedSource.id
      || !full(this.catalog.coverage, this.catalog.sources.length)
      || !full(selectedSource.operationCoverage, selectedSource.operations.length)) return undefined;
    // Count before permission filtering: one denied sibling must not create a singleton.
    const operations = selectedSource.operations.filter(operation => operation.intent === 'schema');
    const operation = operations.length === 1 ? operations[0] : undefined;
    if (!operation?.allowed || operation.command.name !== 'discovery.describe'
      || operation.command.args.assetId !== selectedSource.id || operation.command.args.depth !== 'schema') return undefined;
    return operation;
  }

  permit(snapshot: ActiveRequestSnapshot, understanding: RequestUnderstanding,
    source: RegisteredMetadataSource, operation: RegisteredMetadataOperation): MetadataDispatchPermit {
    this.assertCurrent(snapshot);
    const currentSource = this.catalog.sources.find(entry => entry.id === source.id);
    const currentOperation = currentSource?.operations.find(entry => entry.id === operation.id);
    const provenance = understanding.provenance;
    if (!currentSource || !currentOperation || currentSource !== source || currentOperation !== operation
      || !operation.allowed || understanding.targetSourceRef !== source.id || understanding.metadataOperationRef !== operation.id
      || understanding.intent !== operation.intent || provenance.requestDigest !== snapshot.anchor.digest
      || provenance.requestRevision !== snapshot.requestRevision || provenance.catalogRevision !== snapshot.catalogRevision
      || provenance.policyRevision !== snapshot.policyRevision || provenance.sourceRevision !== source.revision
      || REQUEST_UNDERSTANDING_FIELDS.some(field => provenance.fieldAuthorities?.[field]?.requestDigest !== snapshot.fieldAuthorities[field].anchor.digest
        || provenance.fieldAuthorities?.[field]?.requestRevision !== snapshot.fieldAuthorities[field].requestRevision)) {
      throw new Error('invalid_metadata_authorization');
    }
    const permit = Object.freeze({ sourceId: source.id, operationId: operation.id });
    permits.set(permit, { session: this, snapshot, command: operation.command, consumed: false,
      intent: understanding.intent, sourceId: source.id, sourceRevision: source.revision, adapter: this.metadataAdapter });
    return permit;
  }
}

/** Only host-minted objects in the private registry are recognized by the service. */
export interface MetadataDispatchPermit { readonly sourceId: string; readonly operationId: string }
/** Host-installed local adapter identity, held privately with a recognized permit. */
export interface LocalMetadataAdapterDescriptor {
  readonly kind: 'registered_http_metadata';
  readonly connectionRevision: number;
  readonly discoveryMetadataRevision: number;
}
export interface ClaimedMetadataDispatch {
  readonly intent: MetadataIntent;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly adapter?: LocalMetadataAdapterDescriptor;
}
const permits = new WeakMap<MetadataDispatchPermit, {
  session: RequestUnderstandingSession; snapshot: ActiveRequestSnapshot; command: AxCommand; consumed: boolean;
  intent: MetadataIntent; sourceId: string; sourceRevision: number; adapter?: LocalMetadataAdapterDescriptor;
}>();

export function assertMetadataDispatchPermit(permit: MetadataDispatchPermit, command: AxCommand): void {
  const held = permits.get(permit);
  if (!held) throw new Error('invalid_metadata_authorization');
  held.session.assertCurrent(held.snapshot);
  if (JSON.stringify(command) !== JSON.stringify(held.command)) throw new Error('metadata_command_mismatch');
}

export function claimMetadataDispatchPermit(permit: MetadataDispatchPermit, command: AxCommand): ClaimedMetadataDispatch {
  assertMetadataDispatchPermit(permit, command);
  const held = permits.get(permit)!;
  if (held.consumed) throw new Error('metadata_permit_consumed');
  held.consumed = true;
  return Object.freeze({ intent: held.intent, sourceId: held.sourceId, sourceRevision: held.sourceRevision, adapter: held.adapter });
}
