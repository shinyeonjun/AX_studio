import { describe, expect, it } from 'vitest';
import { HOST_COMMAND_CONTEXT } from '../access.js';
import { commandChatContext, connectedService, dailyBriefArgs } from './fixtures.js';

describe('job command access and connection binding', () => {
  it('hides job.commit from command.list and keeps job.propose on the agent boundary', async () => {
    const { service } = await connectedService();
    const host = await service.execute({ name: 'command.list' }, { executionContext: HOST_COMMAND_CONTEXT });
    const hostNames = (host.data as { commands: Array<{ name: string }> }).commands.map((entry) => entry.name);
    expect(hostNames).not.toContain('job.propose');
    expect(hostNames).not.toContain('job.commit');

    const agent = await service.execute({ name: 'command.list' }, commandChatContext);
    const agentNames = (agent.data as { commands: Array<{ name: string }> }).commands.map((entry) => entry.name);
    expect(agentNames).toContain('job.propose');
    expect(agentNames).not.toContain('job.commit');
  });

  it('binds a job to one HTTP connection and asks when two connections both fit', async () => {
    const { store, service, chat } = await connectedService();
    store.setConnection('http', true, {
      endpoints: [
        { id: 'default', baseUrl: 'https://api.github.com/', label: 'GitHub' },
        { id: 'tickets', baseUrl: 'https://api.example.com/v1/', label: 'Tickets' },
      ],
    });

    const github = await service.execute({
      name: 'job.propose',
      args: dailyBriefArgs,
    }, { ...commandChatContext, workspaceSessionId: chat.id });
    expect(github.status).toBe('needs_input');
    expect(github.issues[0]?.path).toBe('args.fetch.connectionId');

    const bound = await service.execute({
      name: 'job.propose',
      args: {
        ...dailyBriefArgs,
        fetch: { ...dailyBriefArgs.fetch, connectionId: 'GitHub' },
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });
    expect(bound.status).toBe('ok');
    expect(bound.data).toMatchObject({
      summary: { connectionId: 'default', httpLabel: 'GitHub' },
    });

    const named = await service.execute({
      name: 'job.propose',
      args: {
        ...dailyBriefArgs,
        fetch: { method: 'GET', path: '/health', connectionId: 'Tickets' },
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });
    expect(named.status).toBe('ok');
    expect(named.data).toMatchObject({
      summary: { connectionId: 'tickets', httpLabel: 'Tickets' },
    });
  });
});
