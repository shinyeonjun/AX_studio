import { describe, expect, it, vi } from 'vitest';
import { MetadataCatalogSchema, type MetadataCatalog, type RequestUnderstanding } from '../../../contracts/request-understanding.js';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { AxCommandService } from '../../agent/commands/service.js';
import type { AxCommandReadGateway } from '../../agent/commands/read-gateway.js';
import { AGENT_COMMAND_CONTEXT } from '../../agent/commands/access.js';
import { RequestUnderstandingSession } from './session.js';

function catalog(): MetadataCatalog {
  const coverage = { knownTotal: 1, truncated: false, overflow: false, retrievalMethod: 'configured_registry' as const };
  return { revision: 1, policyRevision: 1, coverage, sources: [{ id: 'a', label: 'source A', revision: 1,
    aliases: ['source A'], assetId: 'asset:a', connectionId: 'connection:a', operationCoverage: coverage,
    operations: [{ id: 'describe:a', intent: 'schema', label: 'Schema', allowed: true,
      command: { name: 'discovery.describe', args: { assetId: 'asset:a', depth: 'schema' } } }] }] };
}
function session(raw = catalog()) {
  return new RequestUnderstandingSession({ text: 'source A 스키마 알려줘', requestId: 'request:a',
    workspaceSessionId: 'synthetic-session', catalog: raw });
}
function permit(task: RequestUnderstandingSession) {
  const snapshot = task.capture();
  const source = task.catalog.sources[0]!;
  const operation = source.operations[0]!;
  const understanding: RequestUnderstanding = { version: 1, intent: 'schema', targetSourceRef: source.id,
    metadataOperationRef: operation.id, outputKind: 'readable_schema', needsGeneratedProse: false,
    provenance: { requestDigest: snapshot.anchor.digest, requestRevision: snapshot.requestRevision,
      sourceRevision: source.revision, catalogRevision: snapshot.catalogRevision, policyRevision: snapshot.policyRevision,
      fieldAuthorities: { intent: { requestDigest: snapshot.fieldAuthorities.intent.anchor.digest, requestRevision: snapshot.fieldAuthorities.intent.requestRevision },
        targetSourceRef: { requestDigest: snapshot.fieldAuthorities.targetSourceRef.anchor.digest, requestRevision: snapshot.fieldAuthorities.targetSourceRef.requestRevision },
        outputKind: { requestDigest: snapshot.fieldAuthorities.outputKind.anchor.digest, requestRevision: snapshot.fieldAuthorities.outputKind.requestRevision } },
      selectedRefs: { intent: 'schema', targetSourceRef: 'source_0', metadataOperationRef: 'metadata_0', outputKind: 'readable_schema' } } };
  return task.permit(snapshot, understanding, source, operation);
}

describe('request-understanding host and real service safety boundary', () => {
  it('rejects collection reads, writes and raw SQL mislabeled as metadata', () => {
    for (const command of [
      { name: 'capability.invoke', args: { id: 'rdb.query.read', params: { connectionId: 'connection:a', table: 'orders' } } },
      { name: 'execution.enqueue_once', args: { steps: [] } },
      { name: 'capability.invoke', args: { id: 'rdb.schema.describe', params: { connectionId: 'connection:a', sql: 'SELECT * FROM orders' } } },
    ]) {
      const raw = catalog();
      expect(MetadataCatalogSchema.safeParse({ ...raw, sources: [{ ...raw.sources[0],
        operations: [{ ...raw.sources[0]!.operations[0], command }] }] }).success).toBe(false);
    }
  });

  it('rejects cross-source registration and keeps host catalog identities immutable', () => {
    const raw = catalog();
    const task = session(raw);
    raw.sources[0]!.assetId = 'asset:b';
    expect(task.catalog.sources[0]?.assetId).toBe('asset:a');
    expect(Object.isFrozen(task.catalog.sources[0]?.operations[0]?.command.args)).toBe(true);
    expect(() => session(raw)).toThrow('metadata_operation_source_mismatch');
  });

  it('rejects forged, broadened, cross-source and replayed permits before the gateway', async () => {
    const db = await createDatabaseAsync(':memory:');
    const gateway: AxCommandReadGateway = { execute: vi.fn<AxCommandReadGateway['execute']>(async request => ({ tool: request.tool, ok: true, data: {} })) };
    const enqueue = vi.fn();
    const service = new AxCommandService(new WorkflowStore(db), { readGateway: gateway, enqueueOnce: enqueue });
    const task = session();
    const held = permit(task);
    const options = { executionContext: AGENT_COMMAND_CONTEXT, metadataDispatchPermit: held };
    try {
      for (const command of [
        { name: 'capability.invoke', args: { id: 'rdb.query.read', params: { connectionId: 'connection:a', table: 'orders' } } },
        { name: 'execution.enqueue_once', args: { steps: [] } },
        { name: 'discovery.describe', args: { assetId: 'asset:b', depth: 'schema' } },
      ]) expect((await service.execute(command, options)).status).toBe('forbidden');
      const exact = task.catalog.sources[0]!.operations[0]!.command;
      expect((await service.execute(exact, { ...options, metadataDispatchPermit: { sourceId: 'a', operationId: 'describe:a' } })).status).toBe('forbidden');
      expect(gateway.execute).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
      expect((await service.execute(exact, options)).status).toBe('ok');
      expect((await service.execute(exact, options)).status).toBe('forbidden');
      expect(gateway.execute).toHaveBeenCalledOnce();
    } finally { db.close?.(); }
  });

  it('rejects cancelled permits and late results after a source/catalog/policy change', async () => {
    const db = await createDatabaseAsync(':memory:');
    let release!: () => void;
    let entered!: () => void;
    const firstRead = new Promise<void>(resolve => { entered = resolve; });
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const gateway: AxCommandReadGateway = { execute: vi.fn<AxCommandReadGateway['execute']>(async request => {
      entered(); await delayed;
      return { tool: request.tool, ok: true, data: { sourceId: 'a', sourceRevision: 1 } };
    }) };
    const service = new AxCommandService(new WorkflowStore(db), { readGateway: gateway });
    try {
      const cancelled = session();
      const cancelledPermit = permit(cancelled);
      cancelled.cancel();
      await expect(service.execute(cancelled.catalog.sources[0]!.operations[0]!.command,
        { executionContext: AGENT_COMMAND_CONTEXT, metadataDispatchPermit: cancelledPermit })).rejects.toThrow('취소');
      expect(gateway.execute).not.toHaveBeenCalled();
      const task = session();
      const pending = service.execute(task.catalog.sources[0]!.operations[0]!.command,
        { executionContext: AGENT_COMMAND_CONTEXT, metadataDispatchPermit: permit(task) });
      const rejected = expect(pending).rejects.toThrow('버전이 바뀌어');
      await firstRead;
      const replacement = catalog();
      replacement.revision = 2; replacement.policyRevision = 2; replacement.sources[0]!.revision = 2;
      task.replaceCatalog(replacement);
      release();
      await rejected;
      expect(gateway.execute).toHaveBeenCalledOnce();
    } finally { release(); db.close?.(); }
  });

  it('accepts only the source-bound, read-only schema primitive for external DB metadata', () => {
    const raw = catalog();
    raw.sources[0]!.operations[0]!.command = { name: 'capability.invoke',
      args: { id: 'rdb.schema.describe', params: { connectionId: 'connection:a' } } };
    expect(session(raw).catalog.sources[0]?.operations[0]?.command.name).toBe('capability.invoke');
    raw.sources[0]!.connectionId = 'connection:b';
    expect(() => session(raw)).toThrow('metadata_operation_source_mismatch');
  });
});
