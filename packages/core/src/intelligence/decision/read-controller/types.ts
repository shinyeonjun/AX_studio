import type { ArtifactCompleteness } from '../../../contracts/artifacts/completeness.js';
import type { AuthoritativeRequestAnchor } from '../../../contracts/request-anchor.js';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ReadAction = 'read' | 'continue' | 'retry';
export type RefKind = 'request-span' | 'EmailMessageRef' | 'SlackMessageRef' | 'paging-token';

export interface SourceScope {
  connector: string;
  sourceId: string;
  connectionId: string;
}

export interface ReadContext {
  workspaceSessionId: string;
  catalogRevision: number;
  /** Includes data-policy/body-scope changes, independently of catalog changes. */
  contextRevision: string;
  sources: readonly SourceScope[];
}

export interface ParameterContract {
  type: string;
  required?: boolean;
  /** Host-owned, non-coercing validation. Never sent to Jev. */
  validate(value: JsonValue): boolean;
  refKinds?: readonly RefKind[];
  requireObservedRef?: boolean;
}

/** Host registration is an allowlist, not a capability name supplied by a model. */
export interface ReadOperation {
  operationId: string;
  connector: string;
  kind: 'read';
  sideEffect: 'NONE';
  purpose: 'inspect';
  backend: 'connector' | 'http' | 'external-db' | 'workspace';
  method?: 'GET' | 'HEAD';
  externalDbReadOnly?: true;
  label: string;
  description: string;
  coverage: 'metadata' | 'body' | 'rows' | 'schema';
  parameters: Readonly<Record<string, ParameterContract>>;
  outputRefKinds?: readonly Exclude<RefKind, 'request-span'>[];
  pagingParameter?: string;
  /** Only a provider with an explicit stable full-traversal guarantee may opt in. */
  completeOnExhaustion?: boolean;
}

export interface RefHandle {
  refId: string;
  snapshotDigest: string;
}

export type ParameterBinding =
  | { origin: 'host-fixed'; value: JsonValue }
  | { origin: 'observed-ref'; ref: RefHandle };

export interface ReadCandidateSpec {
  operationId: string;
  source: SourceScope;
  bindings: Readonly<Record<string, ParameterBinding>>;
  /** A host-defined requirement group; models cannot add one or change its scope. */
  coverageKey: string;
  label: string;
  dependencies?: readonly string[];
}

export interface ReadCallInstance {
  instanceId: string;
  operationId: string;
  source: Readonly<SourceScope>;
  workspaceSessionId: string;
  catalogRevision: number;
  contextRevision: string;
  action: ReadAction;
  attempt: number;
  fingerprint: string;
  coverageKey: string;
  params: Readonly<Record<string, JsonValue>>;
  parameterOrigins: Readonly<Record<string, ParameterBinding>>;
  dependencies: readonly string[];
  continuationOf?: string;
  retryOf?: string;
  streamId: string;
}

export interface ObservedRefDescriptor extends RefHandle {
  kind: RefKind;
  label: string;
  originInstanceId?: string;
  source?: Readonly<SourceScope>;
  workspaceSessionId: string;
  catalogRevision: number;
  contextRevision: string;
  resultDigest: string;
  /** Fixed, adapter-owned extraction description, never a free JSONPath. */
  extraction: string;
}

export interface ObservedRefInput {
  key: string;
  kind: Exclude<RefKind, 'request-span'>;
  label: string;
  value: JsonValue;
  extraction: string;
}

export interface DecisionView {
  value: JsonValue;
  /** Explicit even for an empty preview; raw data is not a fallback view. */
  complete: boolean;
  omittedRows: number;
  omittedFields: readonly string[];
}

export interface ReadSuccess {
  status: 'ok';
  data: JsonValue;
  decisionView: DecisionView;
  upstream: ArtifactCompleteness;
  references?: readonly ObservedRefInput[];
  pagination?: { hasMore: boolean; nextRefKey?: string };
  /** Provider estimates are preserved, never promoted to exact totals. */
  total?: { value: number; isEstimate: boolean };
}

export type ReadFailureKind = 'transient' | 'not-found' | 'permission' | 'policy' | 'invalid-input' | 'provider';
export interface ReadFailure {
  status: 'failed';
  kind: ReadFailureKind;
  code: string;
}
export type ReadExecutionResult = ReadSuccess | ReadFailure;

export interface EvidenceRecord {
  instanceId: string;
  operationId: string;
  source: Readonly<SourceScope>;
  coverageKey: string;
  status: ReadExecutionResult['status'];
  resultDigest: string;
  failure?: ReadFailure;
  upstream?: ArtifactCompleteness;
  decisionView?: DecisionView;
  refIds: readonly string[];
  pagination?: { hasMore: boolean; nextRefId?: string };
  total?: ReadSuccess['total'];
}

export interface CoverageRecord {
  coverageKey: string;
  successfulReads: number;
  failedReads: number;
  upstreamStatus: 'complete' | 'partial' | 'unknown';
  decisionViewComplete: boolean;
  pagination: 'none' | 'more' | 'exhausted' | 'blocked';
  observedCount?: number;
  /** Count is not an exact total unless the whole host coverage is complete. */
  exactTotal?: number;
  limitations: readonly string[];
}

export interface CoverageRequirement {
  coverageKey: string;
  level: 'observed' | 'complete';
  minimumSuccessfulReads?: number;
}

export interface CandidateDescriptor {
  instanceId: string;
  operationId: string;
  action: ReadAction;
  label: string;
  source: Readonly<SourceScope>;
  coverageKey: string;
  coverage: ReadOperation['coverage'];
  description: string;
  attempt: number;
  dependencies: readonly string[];
  parameters: Readonly<Record<string, { type: string; origin: ParameterBinding['origin']; refId?: string }>>;
}

export interface ReadLimits {
  maxReadAttempts: number;
  maxDecisionPhases: number;
  maxConcurrentReads: number;
  maxRetries: number;
  maxDecisionPacketBytes: number;
  deadlineMs: number;
  minimumConfidence: number;
}

export type ProviderBudgetPolicy =
  | { enforcement: 'dispatch-guard'; maxCalls: number; maxRequestBytes: number }
  | { enforcement: 'external'; explanation: string };

export interface BudgetSnapshot {
  readAttempts: number;
  decisionPhases: number;
  providerDispatches: number;
  providerRequestBytes: number;
  providerEnforcement: ProviderBudgetPolicy['enforcement'];
}

export type ReadControllerOutcome = Readonly<{
  status: 'finished' | 'clarify' | 'cancelled';
  code: string;
  request: AuthoritativeRequestAnchor;
  evidence: readonly EvidenceRecord[];
  coverage: readonly CoverageRecord[];
  budgets: BudgetSnapshot;
  /** Authorized raw data is returned to the host only, and only at accepted finish. */
  localResults?: Readonly<Record<string, ReadSuccess>>;
}>;
