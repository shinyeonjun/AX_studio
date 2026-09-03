import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { commandChatContext } from '../fixtures.js';

describe('AxCommandService command lifecycle', () => {
  it('exposes command lifecycle instead of requiring a user-selected execution mode', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const commands = await service.execute({ name: 'command.list' }, commandChatContext);
    const entries = (commands.data as { commands: Array<{ name: string; lifecycle: string }> }).commands;
    expect(entries.find((entry) => entry.name === 'execution.enqueue_once')).toMatchObject({ lifecycle: 'ephemeral' });
    expect(entries.find((entry) => entry.name === 'workflow.create')).toMatchObject({ lifecycle: 'workflow' });
    expect(entries.find((entry) => entry.name === 'job.propose')).toMatchObject({ lifecycle: 'workflow' });
    expect(entries.find((entry) => entry.name === 'workflow.run')).toMatchObject({ lifecycle: 'run' });
    expect(entries.find((entry) => entry.name === 'discovery.retry')).toMatchObject({ lifecycle: 'workflow' });
    expect(entries.find((entry) => entry.name === 'job.commit')).toBeUndefined();
  });
});
