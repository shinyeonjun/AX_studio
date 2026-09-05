import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { ArtifactStore } from '../artifact-store.js';
import { WorkflowStore } from '../workflow-store.js';
import { WorkspaceSourceService } from '../workspace-source-service.js';
import { setDocumentEngineClient } from '../../document-engine/engine-client.js';
import { mockEngine } from './fixtures.js';

describe('WorkspaceSourceService sessions and artifacts', () => {
  afterEach(() => setDocumentEngineClient(null));

  it('creates a session when attaching without an existing chat id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-workspace-source-new-session-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new WorkspaceSourceService(
      store,
      new ArtifactStore(join(root, 'artifacts')),
      join(root, 'sessions'),
    );
    setDocumentEngineClient(mockEngine());
    const pdfPath = join(root, 'only-source.pdf');
    writeFileSync(pdfPath, '%PDF-1.7 fixture');

    const attached = await service.attachToSession(undefined, pdfPath, 'application/pdf');
    expect(attached.source.status).toBe('processing');
    await service.waitForIdle();
    const ready = service.list(attached.sessionId)[0]!;

    expect(attached.sessionId).toMatch(/^[\w-]+$/);
    expect(attached.title).toBe('only-source.pdf');
    expect(ready).toMatchObject({ status: 'ready', fileName: 'only-source.pdf' });
    expect(store.listWorkspaceChats()).toEqual([
      expect.objectContaining({ id: attached.sessionId, title: 'only-source.pdf', sourceCount: 1 }),
    ]);
  });

  it('garbage-collects artifacts on session removal unless another session references them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-workspace-source-gc-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const artifacts = new ArtifactStore(join(root, 'artifacts'));
    const service = new WorkspaceSourceService(store, artifacts, join(root, 'sessions'));
    setDocumentEngineClient(mockEngine());
    const sharedPdf = join(root, 'shared.pdf');
    const ownPdf = join(root, 'own.pdf');
    writeFileSync(sharedPdf, '%PDF-1.7 shared fixture');
    writeFileSync(ownPdf, '%PDF-1.7 own fixture');

    const chatA = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'A' }] });
    const chatB = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'B' }] });
    const sharedA = await service.attachFile(chatA.id, sharedPdf, 'application/pdf');
    const ownA = await service.attachFile(chatA.id, ownPdf, 'application/pdf');
    await service.attachFile(chatB.id, sharedPdf, 'application/pdf');
    await service.waitForIdle();

    const sharedArtifact = artifacts.get(sharedA.artifactId)!;
    const ownArtifact = artifacts.get(ownA.artifactId)!;
    expect(existsSync(sharedArtifact.storedPath)).toBe(true);
    expect(existsSync(ownArtifact.storedPath)).toBe(true);

    service.removeSession(chatA.id);
    store.deleteWorkspaceChat(chatA.id);

    // Own artifact is gone with its sidecars; shared artifact survives for chat B.
    expect(existsSync(ownArtifact.storedPath)).toBe(false);
    expect(artifacts.get(ownA.artifactId)).toBeUndefined();
    expect(artifacts.getDocumentArtifact(ownA.artifactId)).toBeUndefined();
    expect(existsSync(sharedArtifact.storedPath)).toBe(true);
    expect(artifacts.get(sharedA.artifactId)).toBeDefined();
  });

  it('resolves a ready source only within its owning session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-workspace-source-resolve-'));
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const artifacts = new ArtifactStore(join(root, 'artifacts'));
    const service = new WorkspaceSourceService(store, artifacts, join(root, 'sessions'));
    setDocumentEngineClient(mockEngine());
    const owner = store.saveWorkspaceChat({ messages: [] });
    const other = store.saveWorkspaceChat({ messages: [] });
    const pdfPath = join(root, 'report.pdf');
    writeFileSync(pdfPath, '%PDF-1.7 report fixture');
    const source = await service.attachFile(owner.id, pdfPath, 'application/pdf');
    await service.waitForIdle();

    expect(service.resolveStoredFile(owner.id, source.id).artifact.storedPath).toMatch(/report\.pdf$/);
    expect(() => service.resolveStoredFile(other.id, source.id)).toThrow('workspace_source_not_found');
  });
});
