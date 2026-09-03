import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
describe('AxCommandService source policy', () => {
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
});
