import { describe, expect, it } from 'vitest';
import { AxCommandService } from '../../service.js';
import { connectedService, commandChatContext, dailyBriefArgs } from '../fixtures.js';

describe('job.propose discovered target options', () => {
  it('populates one target-selection card from HTTP and Slack discovery results', async () => {
    const { store, chat } = await connectedService();
    store.setConnection('http', true, {
      endpoints: [
        { id: 'github', baseUrl: 'https://api.github.com/', label: '깃허브 연결' },
        { id: 'test', baseUrl: 'http://127.0.0.1:4820/', label: '테스트 HTTP 연결' },
      ],
    });
    const readCalls: string[] = [];
    const service = new AxCommandService(store, {
      readGateway: {
        execute: async (request) => {
          readCalls.push(String(request.args.id));
          return {
            tool: 'capabilities.invoke',
            ok: true,
            data: {
              data: {
                channels: [
                  { id: 'C_OPERATIONS', name: '운영', numMembers: 5 },
                  { id: 'G_PRIVATE', name: '비공개-회의', isPrivate: true },
                ],
              },
            },
          };
        },
      },
    });

    const response = await service.execute({
      name: 'job.propose',
      args: {
        ...dailyBriefArgs,
        fetch: { ...dailyBriefArgs.fetch, connectionId: undefined },
        notify: { connector: 'slack', skipIfEmpty: true },
      },
    }, {
      ...commandChatContext,
      workspaceSessionId: chat.id,
      designToolContext: { connections: [], connectedConnectorIds: ['http', 'slack'], connectors: {} },
    });

    expect(response.status).toBe('needs_input');
    expect(readCalls).toEqual(['slack.channels.list']);
    expect(response.data).toMatchObject({
      presentation: {
        title: '공유 대상 선택',
        inputs: [
          {
            id: 'job-http-connection',
            options: [
              { value: 'github', label: '깃허브 연결' },
              { value: 'test', label: '테스트 HTTP 연결' },
            ],
          },
          {
            id: 'job-slack-channel',
            options: [
              { value: 'C_OPERATIONS', label: '#운영', description: '5명 참여' },
              { value: 'G_PRIVATE', label: '비공개 · #비공개-회의' },
            ],
          },
        ],
        actions: [{ label: '선택하고 공유안 검토', tone: 'primary' }],
      },
    });
    expect(store.listWorkflows()).toHaveLength(0);
  });
});
