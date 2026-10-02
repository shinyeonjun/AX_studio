import { randomUUID } from 'node:crypto';
import { ArtifactCompletenessSchema } from '../../../contracts/artifacts/completeness.js';
import type { AuthoritativeRequestAnchor } from '../../../contracts/request-anchor.js';
import { verifyAuthoritativeRequestAnchor } from '../request-anchor.js';
import { immutableCopy, ReadControlError, sameSource, valueDigest } from './immutable.js';
import type {
  CandidateDescriptor, CoverageRecord, EvidenceRecord, JsonValue, ObservedRefDescriptor, ParameterBinding,
  ReadCallInstance, ReadCandidateSpec, ReadContext, ReadExecutionResult, ReadOperation, ReadSuccess, RefHandle,
} from './types.js';

interface Entry {
  instance: ReadCallInstance;
  operation: ReadOperation;
  label: string;
  state: 'offered' | 'running' | 'ok' | 'failed';
  result?: ReadExecutionResult;
  evidence?: EvidenceRecord;
  executionFingerprint: string;
}

interface HeldRef { descriptor: ObservedRefDescriptor; value: JsonValue }
const opaqueId = (prefix: string) => `${prefix}_${randomUUID()}`;
const FORBIDDEN_OPERATION = /(?:^|[._-])(?:send|write|create|delete|update|export|generate|report|mutate|mutation)(?:[._-]|$)/iu;

/** Local authority. No raw params, cursor values or ref values appear in descriptors. */
export class ReadRegistry {
  readonly request: AuthoritativeRequestAnchor;
  readonly context: ReadContext;
  private readonly operations = new Map<string, ReadOperation>();
  private readonly entries = new Map<string, Entry>();
  private readonly refs = new Map<string, HeldRef>();
  private readonly candidatesByFingerprint = new Map<string, string>();
  private readonly successfulCalls = new Set<string>();
  private readonly consumedCursors = new Map<string, Set<string>>();
  private readonly blockedStreams = new Set<string>();
  private disposed = false;

  constructor(request: AuthoritativeRequestAnchor, context: ReadContext,
    operations: readonly ReadOperation[], private readonly maxRetries: number) {
    this.request = verifyAuthoritativeRequestAnchor(request);
    this.context = immutableCopy(context);
    if (!this.context.workspaceSessionId || !this.context.contextRevision || !Number.isSafeInteger(this.context.catalogRevision)
      || this.context.catalogRevision < 0 || this.request.workspaceSessionId !== this.context.workspaceSessionId
      || this.request.catalogRevision !== this.context.catalogRevision || !Array.isArray(this.context.sources)
      || !Number.isSafeInteger(maxRetries) || maxRetries < 0
      || this.context.sources.some((source) => Object.keys(source).some((key) => !['connector', 'sourceId', 'connectionId'].includes(key))
        || [source.connector, source.sourceId, source.connectionId].some((value) => typeof value !== 'string' || !value))) {
      throw new ReadControlError('request_context_mismatch');
    }
    for (const original of operations) {
      if (original.kind !== 'read' || original.sideEffect !== 'NONE' || original.purpose !== 'inspect'
        || !['connector', 'http', 'external-db', 'workspace'].includes(original.backend)
        || !['metadata', 'body', 'rows', 'schema'].includes(original.coverage)
        || [original.operationId, original.connector, original.label, original.description].some((value) => typeof value !== 'string' || !value)
        || FORBIDDEN_OPERATION.test(original.operationId)
        || (original.backend === 'http' && original.method !== 'GET' && original.method !== 'HEAD')
        || (original.backend === 'external-db' && original.externalDbReadOnly !== true)
        || this.operations.has(original.operationId)) throw new ReadControlError('ineligible_read_operation');
      if (original.pagingParameter && !Object.hasOwn(original.parameters, original.pagingParameter)) {
        throw new ReadControlError('invalid_paging_contract');
      }
      const parameters = Object.fromEntries(Object.entries(original.parameters).map(([name, contract]) => {
        if (!name || ['__proto__', 'constructor', 'prototype'].includes(name) || typeof contract.validate !== 'function'
          || (contract.requireObservedRef && !contract.refKinds?.length)) {
          throw new ReadControlError('invalid_parameter_contract');
        }
        return [name, Object.freeze({ ...contract,
          ...(contract.refKinds ? { refKinds: Object.freeze([...contract.refKinds]) } : {}) })];
      }));
      this.operations.set(original.operationId, Object.freeze({ ...original, parameters: Object.freeze(parameters),
        ...(original.outputRefKinds ? { outputRefKinds: Object.freeze([...original.outputRefKinds]) } : {}) }));
    }
  }

  private assertLive(): void { if (this.disposed) throw new ReadControlError('registry_disposed'); }

  private entry(instanceId: string): Entry {
    this.assertLive();
    const entry = this.entries.get(instanceId);
    if (!entry) throw new ReadControlError('unknown_instance');
    return entry;
  }

  /** Exact host-selected span. Indices never come from a decision answer. */
  requestSpan(start: number, end: number, label: string): RefHandle {
    this.assertLive();
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start
      || end > this.request.text.length) throw new ReadControlError('invalid_request_span');
    const value = this.request.text.slice(start, end);
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
      throw new ReadControlError('invalid_request_span');
    }
    const snapshotDigest = valueDigest({ requestDigest: this.request.digest, start, end, value });
    const existing = [...this.refs.values()].find((ref) => ref.descriptor.snapshotDigest === snapshotDigest);
    if (existing) return immutableCopy({ refId: existing.descriptor.refId, snapshotDigest });
    const refId = opaqueId('ref');
    this.refs.set(refId, { value, descriptor: immutableCopy({ refId, snapshotDigest, kind: 'request-span', label,
      workspaceSessionId: this.context.workspaceSessionId, catalogRevision: this.context.catalogRevision,
      contextRevision: this.context.contextRevision, resultDigest: this.request.digest,
      extraction: `request-span:${start}:${end}` }) });
    return immutableCopy({ refId, snapshotDigest });
  }

  observedRefs(): readonly ObservedRefDescriptor[] {
    this.assertLive();
    return immutableCopy([...this.refs.values()].map((ref) => ref.descriptor));
  }

  private resolveBinding(binding: ParameterBinding, operation: ReadOperation, name: string,
    source: ReadCandidateSpec['source'], dependencies: Set<string>): JsonValue {
    const contract = operation.parameters[name];
    if (!contract) throw new ReadControlError('unknown_parameter');
    let value: JsonValue;
    if (binding.origin === 'host-fixed') {
      if (contract.requireObservedRef) throw new ReadControlError('reference_origin_required');
      value = immutableCopy(binding.value);
    }
    else if (binding.origin === 'observed-ref') {
      const held = this.refs.get(binding.ref.refId);
      if (!held) throw new ReadControlError('unknown_ref');
      const ref = held.descriptor;
      if (ref.snapshotDigest !== binding.ref.snapshotDigest || ref.workspaceSessionId !== this.context.workspaceSessionId
        || ref.catalogRevision !== this.context.catalogRevision || ref.contextRevision !== this.context.contextRevision) {
        throw new ReadControlError('stale_ref');
      }
      if (ref.source && !sameSource(ref.source, source)) throw new ReadControlError('cross_source_ref');
      if (!contract.refKinds?.includes(ref.kind)) throw new ReadControlError('wrong_ref_contract');
      if (ref.originInstanceId) {
        if (this.entry(ref.originInstanceId).state !== 'ok') throw new ReadControlError('unavailable_dependency');
        dependencies.add(ref.originInstanceId);
      }
      value = held.value;
    } else throw new ReadControlError('invalid_parameter_origin');
    if (!contract.validate(value)) throw new ReadControlError('invalid_parameter');
    return value;
  }

  offer(spec: ReadCandidateSpec): string {
    return this.offerInternal(spec, 'read', 1);
  }

  private offerInternal(spec: ReadCandidateSpec, action: ReadCallInstance['action'], attempt: number,
    predecessor?: Entry): string {
    this.assertLive();
    const operation = this.operations.get(spec.operationId);
    if (!operation || spec.source.connector !== operation.connector
      || Object.keys(spec.source).some((key) => !['connector', 'sourceId', 'connectionId'].includes(key))
      || !this.context.sources.some((source) => sameSource(source, spec.source))) throw new ReadControlError('source_scope_denied');
    if (action === 'read' && operation.pagingParameter && Object.hasOwn(spec.bindings, operation.pagingParameter)) {
      throw new ReadControlError('paging_requires_continuation');
    }
    if (!spec.coverageKey || !spec.label) throw new ReadControlError('invalid_candidate');
    const dependencies = new Set(spec.dependencies ?? []);
    for (const dependency of dependencies) {
      if (this.entry(dependency).state !== 'ok') throw new ReadControlError('unavailable_dependency');
    }
    const params: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const [name, binding] of Object.entries(spec.bindings)) {
      params[name] = this.resolveBinding(binding, operation, name, spec.source, dependencies);
    }
    for (const [name, contract] of Object.entries(operation.parameters)) {
      if (contract.required && !Object.hasOwn(params, name)) throw new ReadControlError('missing_parameter');
    }
    const executionFingerprint = valueDigest({ operationId: operation.operationId, source: spec.source, params });
    const fingerprint = valueDigest({ operationId: operation.operationId, source: spec.source, params,
      origins: spec.bindings, workspaceSessionId: this.context.workspaceSessionId,
      catalogRevision: this.context.catalogRevision, contextRevision: this.context.contextRevision });
    const offerKey = `${fingerprint}:${action}:${attempt}`;
    const held = this.candidatesByFingerprint.get(offerKey);
    if (held) return held;
    if (this.successfulCalls.has(executionFingerprint)) throw new ReadControlError('successful_duplicate');
    const instanceId = opaqueId('call');
    const instance: ReadCallInstance = immutableCopy({ instanceId, operationId: operation.operationId,
      source: spec.source, workspaceSessionId: this.context.workspaceSessionId,
      catalogRevision: this.context.catalogRevision, contextRevision: this.context.contextRevision,
      action, attempt, fingerprint, coverageKey: spec.coverageKey, params, parameterOrigins: spec.bindings,
      dependencies: [...dependencies], streamId: predecessor?.instance.streamId ?? instanceId,
      ...(action === 'continue' && predecessor ? { continuationOf: predecessor.instance.instanceId } : {}),
      ...(action === 'retry' && predecessor ? { retryOf: predecessor.instance.instanceId } : {}) });
    this.entries.set(instanceId, { instance, label: spec.label, operation, state: 'offered', executionFingerprint });
    this.candidatesByFingerprint.set(offerKey, instanceId);
    return instanceId;
  }

  continue(instanceId: string): string {
    const entry = this.entry(instanceId);
    const paging = entry.operation.pagingParameter;
    const nextId = entry.evidence?.pagination?.nextRefId;
    if (entry.state !== 'ok' || !paging || !entry.evidence?.pagination?.hasMore || !nextId) {
      throw new ReadControlError('no_continuation');
    }
    const alreadyOffered = [...this.entries.values()].find((held) => held.instance.continuationOf === instanceId);
    if (alreadyOffered) return alreadyOffered.instance.instanceId;
    if (this.blockedStreams.has(entry.instance.streamId)) throw new ReadControlError('cursor_cycle');
    const next = this.refs.get(nextId)!;
    const cursorDigest = valueDigest(next.value);
    if (this.consumedCursors.get(entry.instance.streamId)?.has(cursorDigest)) throw new ReadControlError('cursor_cycle');
    return this.offerInternal({ operationId: entry.instance.operationId, source: entry.instance.source,
      bindings: { ...entry.instance.parameterOrigins, [paging]: { origin: 'observed-ref', ref: {
        refId: nextId, snapshotDigest: next.descriptor.snapshotDigest } } },
      coverageKey: entry.instance.coverageKey, label: `${entry.label} (next page)`,
      dependencies: [instanceId] }, 'continue', 1, entry);
  }

  retry(instanceId: string): string {
    const entry = this.entry(instanceId);
    if (entry.state !== 'failed' || entry.result?.status !== 'failed' || entry.result.kind !== 'transient') {
      throw new ReadControlError('retry_not_eligible');
    }
    if (entry.instance.attempt > this.maxRetries) throw new ReadControlError('retry_budget_exhausted');
    return this.offerInternal({ operationId: entry.instance.operationId, source: entry.instance.source,
      bindings: entry.instance.parameterOrigins, coverageKey: entry.instance.coverageKey, label: `${entry.label} (retry)`,
      dependencies: entry.instance.dependencies }, 'retry', entry.instance.attempt + 1, entry);
  }

  candidates(): readonly CandidateDescriptor[] {
    this.assertLive();
    return immutableCopy([...this.entries.values()].filter((entry) => entry.state === 'offered'
      && !this.successfulCalls.has(entry.executionFingerprint) && !this.blockedStreams.has(entry.instance.streamId))
      .map((entry) => ({ instanceId: entry.instance.instanceId, operationId: entry.instance.operationId,
        action: entry.instance.action, label: entry.label, source: entry.instance.source,
        coverageKey: entry.instance.coverageKey, coverage: entry.operation.coverage, description: entry.operation.description,
        attempt: entry.instance.attempt, dependencies: entry.instance.dependencies,
        parameters: Object.fromEntries(Object.entries(entry.instance.parameterOrigins).map(([name, binding]) => [name, {
          type: entry.operation.parameters[name]!.type, origin: binding.origin,
          ...(binding.origin === 'observed-ref' ? { refId: binding.ref.refId } : {}),
        }])) })));
  }

  begin(instanceId: string): ReadCallInstance {
    const entry = this.entry(instanceId);
    if (entry.state !== 'offered') throw new ReadControlError('instance_already_attempted');
    if (this.successfulCalls.has(entry.executionFingerprint)) throw new ReadControlError('successful_duplicate');
    if ([...this.entries.values()].some((held) => held.state === 'running' && held.executionFingerprint === entry.executionFingerprint)) {
      throw new ReadControlError('duplicate_in_flight');
    }
    // Revalidate every ref/dependency at the execution boundary.
    const dependencies = new Set<string>();
    for (const [name, binding] of Object.entries(entry.instance.parameterOrigins)) {
      this.resolveBinding(binding, entry.operation, name, entry.instance.source, dependencies);
    }
    if (entry.instance.action === 'continue') {
      const paging = entry.operation.pagingParameter!;
      const cursor = valueDigest(entry.instance.params[paging]);
      const seen = this.consumedCursors.get(entry.instance.streamId) ?? new Set<string>();
      if (seen.has(cursor)) throw new ReadControlError('cursor_cycle');
      seen.add(cursor);
      this.consumedCursors.set(entry.instance.streamId, seen);
    }
    entry.state = 'running';
    return entry.instance;
  }

  validateBatch(ids: readonly string[]): void {
    const entries = ids.map((id) => this.entry(id));
    if (new Set(ids).size !== ids.length || entries.some((entry) => entry.state !== 'offered')) {
      throw new ReadControlError('invalid_read_batch');
    }
    if (new Set(entries.map((entry) => entry.executionFingerprint)).size !== entries.length) {
      throw new ReadControlError('duplicate_read_batch');
    }
  }

  /** Validate into private scratch first; publish the whole joined batch atomically. */
  commitBatch(batch: readonly { instanceId: string; result: ReadExecutionResult }[], signal: AbortSignal): void {
    this.assertLive();
    signal.throwIfAborted();
    if (new Set(batch.map((entry) => entry.instanceId)).size !== batch.length) throw new ReadControlError('duplicate_result_origin');
    const staged = batch.map(({ instanceId, result: original }) => {
      const entry = this.entry(instanceId);
      if (entry.state !== 'running') throw new ReadControlError('invalid_result_origin');
      const result = immutableCopy(original);
      const resultDigest = valueDigest(result);
      const refs: HeldRef[] = [];
      let evidence: EvidenceRecord;
      if (result.status === 'failed') {
        if (!['transient', 'not-found', 'permission', 'policy', 'invalid-input', 'provider'].includes(result.kind)
          || typeof result.code !== 'string' || !result.code) throw new ReadControlError('invalid_read_failure');
        evidence = { instanceId, operationId: entry.instance.operationId, source: entry.instance.source,
          coverageKey: entry.instance.coverageKey, status: 'failed', resultDigest, failure: result, refIds: [] };
      } else if (result.status === 'ok') {
        if (!ArtifactCompletenessSchema.safeParse(result.upstream).success
          || (result.upstream.observedCount !== undefined && !Number.isSafeInteger(result.upstream.observedCount))
          || (result.upstream.limit !== undefined && !Number.isSafeInteger(result.upstream.limit))) {
          throw new ReadControlError('invalid_upstream_coverage');
        }
        if (typeof result.decisionView?.complete !== 'boolean' || !Number.isSafeInteger(result.decisionView.omittedRows)
          || result.decisionView.omittedRows < 0 || !Array.isArray(result.decisionView.omittedFields)
          || result.decisionView.omittedFields.some((field) => typeof field !== 'string')
          || (result.decisionView.complete && (result.decisionView.omittedRows > 0 || result.decisionView.omittedFields.length > 0))) {
          throw new ReadControlError('invalid_decision_view');
        }
        const keys = new Map<string, string>();
        for (const ref of result.references ?? []) {
          if (!ref.key || keys.has(ref.key) || !entry.operation.outputRefKinds?.includes(ref.kind)
            || typeof ref.extraction !== 'string' || !ref.extraction || typeof ref.label !== 'string') {
            throw new ReadControlError('invalid_observed_ref');
          }
          if (ref.kind === 'paging-token' && !(typeof ref.value === 'string' && ref.value.length > 0)
            && !(typeof ref.value === 'number' && Number.isSafeInteger(ref.value) && ref.value > 0)) {
            throw new ReadControlError('invalid_paging_ref');
          }
          if (ref.kind === 'EmailMessageRef' || ref.kind === 'SlackMessageRef') {
            if (typeof ref.value !== 'object' || ref.value === null || Array.isArray(ref.value)
              || ref.value.connector !== entry.instance.source.connector) throw new ReadControlError('cross_source_ref');
          }
          const refId = opaqueId('ref');
          const snapshotDigest = valueDigest({ resultDigest, instanceId, key: ref.key, value: ref.value });
          keys.set(ref.key, refId);
          refs.push({ value: ref.value, descriptor: immutableCopy({ refId, snapshotDigest, kind: ref.kind,
            label: ref.label, originInstanceId: instanceId, source: entry.instance.source,
            workspaceSessionId: this.context.workspaceSessionId, catalogRevision: this.context.catalogRevision,
            contextRevision: this.context.contextRevision, resultDigest, extraction: ref.extraction }) });
        }
        if (result.upstream.hasMore === true && !result.pagination?.hasMore) throw new ReadControlError('invalid_atomic_pagination');
        if (result.pagination) {
          const next = refs.find((ref) => ref.descriptor.refId === keys.get(result.pagination!.nextRefKey ?? ''));
          if (typeof result.pagination.hasMore !== 'boolean'
            || (result.pagination.hasMore && (!next || next.descriptor.kind !== 'paging-token'))
            || (!result.pagination.hasMore && result.pagination.nextRefKey !== undefined)
            || (result.upstream.hasMore !== undefined && result.upstream.hasMore !== result.pagination.hasMore)
            || (result.upstream.status === 'complete' && result.pagination.hasMore)) {
            throw new ReadControlError('invalid_atomic_pagination');
          }
        }
        if (result.total && (!Number.isSafeInteger(result.total.value) || result.total.value < 0
          || typeof result.total.isEstimate !== 'boolean')) throw new ReadControlError('invalid_total');
        evidence = { instanceId, operationId: entry.instance.operationId, source: entry.instance.source,
          coverageKey: entry.instance.coverageKey, status: 'ok', resultDigest, upstream: result.upstream,
          decisionView: result.decisionView, refIds: refs.map((ref) => ref.descriptor.refId),
          ...(result.pagination ? { pagination: { hasMore: result.pagination.hasMore,
            ...(result.pagination.nextRefKey ? { nextRefId: keys.get(result.pagination.nextRefKey)! } : {}) } } : {}),
          ...(result.total ? { total: result.total } : {}) };
      } else throw new ReadControlError('invalid_read_result');
      return { entry, result, evidence: immutableCopy(evidence), refs };
    });
    signal.throwIfAborted();
    for (const { entry, result, evidence, refs } of staged) {
      entry.result = result;
      entry.evidence = evidence;
      entry.state = result.status;
      refs.forEach((ref) => this.refs.set(ref.descriptor.refId, ref));
      if (result.status === 'ok') {
        this.successfulCalls.add(entry.executionFingerprint);
        if (result.pagination?.hasMore) {
          const next = refs.find((ref) => ref.descriptor.refId === evidence.pagination?.nextRefId)!;
          if (this.consumedCursors.get(entry.instance.streamId)?.has(valueDigest(next.value))) {
            this.blockedStreams.add(entry.instance.streamId);
          }
        }
      }
    }
  }

  evidence(): readonly EvidenceRecord[] {
    this.assertLive();
    return immutableCopy([...this.entries.values()].flatMap((entry) => entry.evidence ? [entry.evidence] : []));
  }

  coverage(): readonly CoverageRecord[] {
    this.assertLive();
    const groups = new Map<string, Entry[]>();
    for (const entry of this.entries.values()) {
      if (!entry.evidence) continue;
      const group = groups.get(entry.instance.coverageKey) ?? [];
      group.push(entry);
      groups.set(entry.instance.coverageKey, group);
    }
    return immutableCopy([...groups].map(([coverageKey, entries]) => {
      const successes = entries.filter((entry) => entry.state === 'ok');
      const streams = new Map<string, Entry[]>();
      for (const entry of entries) {
        const stream = streams.get(entry.instance.streamId) ?? [];
        stream.push(entry);
        streams.set(entry.instance.streamId, stream);
      }
      let complete = successes.length > 0;
      let hasMore = false;
      let hasPaging = false;
      let blocked = false;
      const limitations = new Set<string>();
      for (const [streamId, stream] of streams) {
        const valid = stream.filter((entry) => entry.state === 'ok');
        const last = valid.at(-1);
        const lastAttempt = stream.at(-1)!;
        const root = stream[0]!;
        const pageRecords = valid.filter((entry) => entry.evidence?.pagination);
        const streamBlocked = this.blockedStreams.has(streamId);
        hasPaging ||= pageRecords.length > 0;
        hasMore ||= last?.evidence?.pagination?.hasMore === true;
        blocked ||= streamBlocked;
        const chainComplete = root.operation.completeOnExhaustion === true && valid[0]?.instance.streamId === streamId
          && pageRecords.length === valid.length && last?.evidence?.pagination?.hasMore === false
          && lastAttempt.state === 'ok' && !streamBlocked
          && valid.every((entry) => entry.evidence?.upstream?.status === 'complete'
            || (entry.evidence?.upstream?.status === 'partial' && entry.evidence.upstream.reason === 'provider_limit'));
        const directlyComplete = valid.length > 0 && valid.every((entry) => entry.evidence?.upstream?.status === 'complete')
          && lastAttempt.state === 'ok' && !streamBlocked;
        if (!chainComplete && !directlyComplete) complete = false;
        if (streamBlocked) limitations.add('cursor_cycle');
        if (lastAttempt.state === 'failed') limitations.add(`read_failed:${lastAttempt.result?.status === 'failed' ? lastAttempt.result.kind : 'unknown'}`);
      }
      const decisionViewComplete = successes.length > 0 && successes.every((entry) => entry.evidence!.decisionView!.complete);
      if (!decisionViewComplete) limitations.add('decision_view_incomplete');
      if (hasMore) limitations.add('more_pages_available');
      if (!complete) limitations.add('upstream_not_complete');
      if (successes.some((entry) => entry.evidence?.total?.isEstimate)) limitations.add('provider_total_is_estimate');
      const observedCount = successes.reduce((sum, entry) => sum + (entry.evidence?.upstream?.observedCount ?? 0), 0);
      const countKnown = successes.length > 0 && Number.isSafeInteger(observedCount)
        && successes.every((entry) => entry.evidence?.upstream?.observedCount !== undefined);
      if (!Number.isSafeInteger(observedCount)) limitations.add('count_overflow');
      return { coverageKey, successfulReads: successes.length, failedReads: entries.length - successes.length,
        upstreamStatus: complete ? 'complete' as const : successes.length ? 'partial' as const : 'unknown' as const,
        decisionViewComplete, pagination: blocked ? 'blocked' as const : hasMore ? 'more' as const : hasPaging ? 'exhausted' as const : 'none' as const,
        ...(countKnown ? { observedCount } : {}), ...(complete && streams.size === 1 && countKnown ? { exactTotal: observedCount } : {}), limitations: [...limitations] };
    }));
  }

  localResults(): Readonly<Record<string, ReadSuccess>> {
    this.assertLive();
    return immutableCopy(Object.fromEntries([...this.entries.values()].flatMap((entry) =>
      entry.result?.status === 'ok' ? [[entry.instance.instanceId, entry.result]] : [])));
  }

  dispose(): void {
    this.disposed = true;
    this.entries.clear(); this.refs.clear(); this.operations.clear(); this.candidatesByFingerprint.clear();
    this.successfulCalls.clear(); this.consumedCursors.clear(); this.blockedStreams.clear();
  }
}
