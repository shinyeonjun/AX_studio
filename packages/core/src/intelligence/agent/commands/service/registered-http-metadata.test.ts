import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { AxCommandService } from '../service.js';
import { AGENT_COMMAND_CONTEXT } from '../access.js';
import { RequestUnderstandingSession } from '../../../decision/request-understanding/session.js';
import type { RequestUnderstanding, SourceMetadataEvidence } from '../../../../contracts/request-understanding.js';
import { describeRegisteredHttpMetadata, isSafeRegisteredHttpOperationPath, snapshotRegisteredHttpMetadata } from './registered-http-metadata.js';

describe('local registered HTTP metadata bounds and permit routing', () => {
  it('retains exact 512-character relative identities and rejects nested, credential and malformed references', () => {
    expect(isSafeRegisteredHttpOperationPath('a'.repeat(512))).toBe(true);
    expect(isSafeRegisteredHttpOperationPath('v1/orders:2026')).toBe(true);
    for (const path of ['a'.repeat(513), ' safe', 'safe ', 'https:secret', 'user:password@host/orders', 'orders?secret=x',
      'orders#secret', 'orders%3Fsecret', 'user%40host/orders', 'orders%253Fsecret', 'orders%2fprivate', 'orders%ZZ',
      'orders%0Aprivate', '//authority', '../private', 'orders\\private']) expect(isSafeRegisteredHttpOperationPath(path)).toBe(false);
  });

  it('bounds actual UTF-8 bytes and entry/field counts while retaining validated local totals', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('http', false, { endpoints: [{ id: 'test', label: 'Test', baseUrl: 'https://offline.invalid',
        discoveredReadOperations: Array.from({ length: 201 }, (_, index) => ({ path: `${index}/` + 'x'.repeat(505), label: '가'.repeat(160) })) }] });
      const { adapter } = snapshotRegisteredHttpMetadata(store, { catalogRevision: 9, policyRevision: 1 });
      const inventory = describeRegisteredHttpMetadata(store, { name: 'discovery.describe', args: { assetId: 'http:test', depth: 'summary' } },
        { adapter, sourceId: 'http:test', sourceRevision: 9, intent: 'inventory' });
      const evidence = inventory.data as SourceMetadataEvidence;
      expect(inventory.status).toBe('ok'); expect(evidence.knownTotal).toBe(200); expect(evidence.truncated).toBe(true);
      expect(evidence.entries.length).toBeLessThanOrEqual(64);
      expect(evidence.entries.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(JSON.stringify(evidence), 'utf8')).toBeLessThanOrEqual(32_768);
      expect(evidence.entries[0]?.path).toBe('0/' + 'x'.repeat(505));
      store.upsertDiscoveryMetadata({ assetId: 'http:test', aliases: [], fields: Array.from({ length: 100 }, (_, index) => ({ name: `field_${index}` })) });
      const fresh = snapshotRegisteredHttpMetadata(store, { catalogRevision: 10, policyRevision: 1 });
      const schema = describeRegisteredHttpMetadata(store, { name: 'discovery.describe', args: { assetId: 'http:test', depth: 'schema' } },
        { adapter: fresh.adapter, sourceId: 'http:test', sourceRevision: 10, intent: 'schema' }).data as SourceMetadataEvidence;
      expect(schema).toMatchObject({ knownTotal: 100, truncated: true, scope: 'registered_field_dictionary' });
      expect(schema.entries).toHaveLength(64); expect(schema.entries[0]?.fields).toEqual([{ name: 'field_0' }]);
    } finally { db.close?.(); }
  });

  it('does not echo corrupt config or error text to diagnostics, and treats capped source coverage as unknown', async () => {
    const db = await createDatabaseAsync(':memory:');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const store = new WorkflowStore(db);
      store.setConnection('http', false, {});
      db.prepare('UPDATE connections SET config_json = ? WHERE connector = ?').run('{"SYNTH_CORRUPT_SECRET":', 'http');
      const corrupt = snapshotRegisteredHttpMetadata(store, { catalogRevision: 1, policyRevision: 1 });
      expect(corrupt.catalog.coverage).toMatchObject({ knownTotal: 0, truncated: true });
      expect(JSON.stringify(corrupt)).not.toContain('SYNTH_CORRUPT_SECRET'); expect(log).not.toHaveBeenCalled();
      store.setConnection('http', false, { endpoints: Array.from({ length: 129 }, (_, index) => ({ id: `id-${index}`, baseUrl: 'https://offline.invalid' })) });
      const capped = snapshotRegisteredHttpMetadata(store, { catalogRevision: 2, policyRevision: 1 });
      expect(capped.catalog.sources).toHaveLength(32);
      expect(capped.catalog.coverage).toMatchObject({ knownTotal: null, truncated: true, overflow: true });
    } finally { log.mockRestore(); db.close?.(); }
  });

  it('rejects an unsupported private adapter kind without invoking normal dispatch', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('http', true, { endpoints: [{ id: 'test', baseUrl: 'https://offline.invalid', discoveredReadOperations: [] }] });
      const normalRead = vi.fn(async () => { throw new Error('normal dispatch forbidden'); });
      const service = new AxCommandService(store, { readGateway: { execute: normalRead } });
      const { catalog, adapter } = snapshotRegisteredHttpMetadata(store, { catalogRevision: 1, policyRevision: 1 });
      const session = new RequestUnderstandingSession({ text: 'Test registered inventory', requestId: 'r', workspaceSessionId: 's', catalog,
        metadataAdapter: { ...adapter, kind: 'unsupported_adapter' } as never });
      const snapshot = session.capture(); const source = session.catalog.sources[0]!; const operation = source.operations[0]!;
      const authority = { requestDigest: snapshot.anchor.digest, requestRevision: snapshot.requestRevision };
      const understanding: RequestUnderstanding = { version: 1, intent: 'inventory', targetSourceRef: source.id,
        metadataOperationRef: operation.id, outputKind: 'readable_inventory', needsGeneratedProse: false,
        provenance: { requestDigest: snapshot.anchor.digest, requestRevision: snapshot.requestRevision,
          sourceRevision: source.revision, catalogRevision: snapshot.catalogRevision, policyRevision: snapshot.policyRevision,
          selectedRefs: {}, fieldAuthorities: { intent: authority, targetSourceRef: authority, outputKind: authority } } };
      const executed = await service.execute(operation.command, { executionContext: AGENT_COMMAND_CONTEXT,
        metadataDispatchPermit: session.permit(snapshot, understanding, source, operation) });
      expect(executed.status).toBe('forbidden'); expect(normalRead).not.toHaveBeenCalled();
    } finally { db.close?.(); }
  });
});
