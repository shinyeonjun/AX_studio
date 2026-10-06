import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { MockDocumentEngineClient, setDocumentEngineClient } from '../../../../../documents/read/engine-client.js';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { AxCommandService } from '../../service.js';
describe('AxCommandService source policy', () => {
  afterEach(() => setDocumentEngineClient(null));

  it('still blocks PDF body text when the caller explicitly denies untrusted data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-command-policy-'));
    writeFileSync(join(dir, 'report.pdf'), 'pdf');
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, { folders: [{ id: 'folder-1', label: 'Inbox', path: dir }] });
    const service = new AxCommandService(store);
    const response = await service.execute({ name: 'source.file.read', args: { folderId: 'folder-1', path: 'report.pdf' } }, {
      designToolContext: { connections: store.getConnections(), connectedConnectorIds: ['local_folder'], allowUntrustedData: false },
    });
    expect(response.status).toBe('forbidden');
    expect(response.issues[0]?.code).toBe('source_content_requires_local_ai');
  });
  it('returns only the folder-relative path of a read PDF, never the absolute host path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-command-relative-'));
    mkdirSync(join(dir, 'reports'));
    writeFileSync(join(dir, 'reports', 'q3.pdf'), 'pdf');
    setDocumentEngineClient(new MockDocumentEngineClient());
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, { folders: [{ id: 'folder-1', label: 'Inbox', path: dir }] });
    const service = new AxCommandService(store);
    const response = await service.execute({ name: 'source.file.read', args: { folderId: 'folder-1', path: 'reports/q3.pdf' } }, {
      designToolContext: { connections: store.getConnections(), connectedConnectorIds: ['local_folder'], allowUntrustedData: true },
    });
    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({ fileName: 'q3.pdf', path: 'reports/q3.pdf' });
    const serialized = JSON.stringify(response.data);
    expect(serialized).not.toContain(JSON.stringify(dir).slice(1, -1));
    expect(serialized).not.toContain('sourcePath');
  });
});
