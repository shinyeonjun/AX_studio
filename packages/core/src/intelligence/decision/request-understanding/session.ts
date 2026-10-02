import type { AxCommand } from '../../agent/commands/schema.js';
import {
  MetadataCatalogSchema,
  type MetadataCatalog, type AcceptedMetadataCatalog, type ActiveRequestSnapshot,
  type RegisteredMetadataOperation, type RegisteredMetadataSource, type RequestUnderstanding,
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
  private turns: Array<{ anchor: AuthoritativeRequestAnchor; revision: number; supersedes: readonly string[] }>;

  constructor(input: { text: string; requestId: string; workspaceSessionId: string; catalog: MetadataCatalog }) {
    this.catalogValue = acceptedCatalog(input.catalog);
    this.originalAnchor = this.anchor = createAuthoritativeRequestAnchor(input.text, {
      originalRequestId: input.requestId, workspaceSessionId: input.workspaceSessionId,
      catalogRevision: this.catalogValue.revision,
    });
    this.turns = [{ anchor: this.anchor, revision: this.requestRevision, supersedes: [] }];
  }

  get catalog(): AcceptedMetadataCatalog { return this.catalogValue; }
  get userTurns() { return freeze(this.turns.map(turn => ({ ...turn, supersedes: [...turn.supersedes] }))); }

  capture(): ActiveRequestSnapshot {
    return Object.freeze({ anchor: this.anchor, requestRevision: this.requestRevision,
      catalogRevision: this.catalogValue.revision, policyRevision: this.catalogValue.policyRevision,
      signal: this.controller.signal });
  }

  assertCurrent(snapshot: ActiveRequestSnapshot): void {
    if (snapshot.requestRevision !== this.requestRevision || snapshot.anchor.digest !== this.anchor.digest
      || snapshot.catalogRevision !== this.catalogValue.revision || snapshot.policyRevision !== this.catalogValue.policyRevision) {
      throw new RequestUnderstandingInvalidatedError('superseded');
    }
    if (snapshot.signal.aborted || this.controller.signal.aborted) throw new RequestUnderstandingInvalidatedError('cancelled');
  }

  acceptCorrection(input: { text: string; requestId: string; supersedes: readonly ('intent' | 'targetSourceRef' | 'outputKind')[] }): void {
    const anchor = createAuthoritativeRequestAnchor(input.text, {
      originalRequestId: input.requestId, workspaceSessionId: this.anchor.workspaceSessionId,
      catalogRevision: this.catalogValue.revision,
    });
    this.controller.abort();
    this.controller = new AbortController();
    this.anchor = anchor;
    this.requestRevision += 1;
    this.turns.push({ anchor, revision: this.requestRevision, supersedes: [...input.supersedes] });
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
    return this.catalog.sources.map((source, index) => ({ ref: `source_${index}`, source,
      spans: [source.label, ...source.aliases].flatMap(alias => {
        // ASCII folding preserves UTF-16 offsets; unrestricted Unicode folding need not.
        const fold = (text: string) => text.replace(/[A-Z]/gu, letter => letter.toLowerCase());
        const start = fold(snapshot.anchor.text).indexOf(fold(alias));
        return start < 0 ? [] : [{ start, end: start + alias.length,
          text: snapshot.anchor.text.slice(start, start + alias.length), requestDigest: snapshot.anchor.digest }];
      }),
    }));
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
      || provenance.policyRevision !== snapshot.policyRevision || provenance.sourceRevision !== source.revision) {
      throw new Error('invalid_metadata_authorization');
    }
    const permit = Object.freeze({ sourceId: source.id, operationId: operation.id });
    permits.set(permit, { session: this, snapshot, command: operation.command, consumed: false });
    return permit;
  }
}

/** Only host-minted objects in the private registry are recognized by the service. */
export interface MetadataDispatchPermit { readonly sourceId: string; readonly operationId: string }
const permits = new WeakMap<MetadataDispatchPermit, {
  session: RequestUnderstandingSession; snapshot: ActiveRequestSnapshot; command: AxCommand; consumed: boolean;
}>();

export function assertMetadataDispatchPermit(permit: MetadataDispatchPermit, command: AxCommand): void {
  const held = permits.get(permit);
  if (!held) throw new Error('invalid_metadata_authorization');
  held.session.assertCurrent(held.snapshot);
  if (JSON.stringify(command) !== JSON.stringify(held.command)) throw new Error('metadata_command_mismatch');
}

export function claimMetadataDispatchPermit(permit: MetadataDispatchPermit, command: AxCommand): void {
  assertMetadataDispatchPermit(permit, command);
  const held = permits.get(permit)!;
  if (held.consumed) throw new Error('metadata_permit_consumed');
  held.consumed = true;
}
