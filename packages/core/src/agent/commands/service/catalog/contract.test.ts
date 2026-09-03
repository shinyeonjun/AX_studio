import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';

describe('AxCommandService bounded command contract', () => {
  it('exposes a bounded command contract instead of a shell surface', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const response = await service.execute({ name: 'command.list' });

    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({
      commands: expect.arrayContaining([
        expect.objectContaining({ name: 'resource.list', mutates: false }),
        expect.objectContaining({ name: 'http.list', lifecycle: 'read', mutates: false }),
        expect.objectContaining({ name: 'workflow.validate', mutates: false }),
        expect.objectContaining({ name: 'ui.present', mutates: false }),
      ]),
    });
    const commandNames = (response.data as { commands: Array<{ name: string }> }).commands.map((entry) => entry.name);
    expect(commandNames).not.toContain('execution.enqueue_once');
    expect(commandNames).not.toContain('workflow.create');
    expect(commandNames).not.toContain('workflow.run');
    expect(JSON.stringify(response.data)).not.toContain('powershell');
  });
});
