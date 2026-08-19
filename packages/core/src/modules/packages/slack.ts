import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ModulePackage } from '../module-package.js';
import { MockSlackConnector } from '../mocks/index.js';
import { SlackConnector } from '../slack/index.js';
import { getSlackConnectionStatus } from '../slack/connection.js';
import { slackNewMessageHandler } from '../../triggers/slack/new-message/index.js';
import { slackChannelMatches } from '../../triggers/slack/new-message/channel-match.js';
import { SlackSocketModeListener } from '../../triggers/slack/new-message/socket-mode.js';
import { parseSlackConnectionConfig } from '../../triggers/types.js';
import type { DesignToolContext } from '../../design-tools/types.js';

function slackSources(ctx: DesignToolContext) {
  const conn = ctx.connections.find((entry) => entry.connector === 'slack');
  const status = getSlackConnectionStatus(conn?.config, Boolean(conn?.connected), false);
  if (!status.connected) {
    return { connector: 'slack', connected: false, sources: [] };
  }
  return {
    connector: 'slack',
    connected: true,
    sources: [
      {
        id: status.team ?? 'slack',
        label: status.team ? `Slack · ${status.team}` : 'Slack',
        kind: 'slack_workspace',
        team: status.team,
        botUser: status.botUser,
        mode: status.mode,
      },
    ],
  };
}

const SLACK_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'slack.message.send',
    connector: 'slack',
    kind: 'write',
    label: 'Slack 메시지',
    description: 'Slack 채널에 메시지 전송',
    sideEffect: 'EXTERNAL',
    params: [
      { name: 'channel', label: 'Slack 채널', question: 'Slack 채널은 어디인가요?', required: true },
      { name: 'text', label: '메시지', question: '무슨 내용을 보낼까요?', required: false },
    ],
    io: { inputs: { text: 'TextArtifact' }, outputs: { message: 'SlackMessageRef' } },
  },
  {
    id: 'slack.new_message',
    connector: 'slack',
    kind: 'trigger',
    label: 'Slack 새 메시지',
    description: 'Slack 채널 새 메시지 도착 시 업무 시작',
    params: [{ name: 'channel', label: 'Slack 채널', question: '어떤 Slack 채널을 감시할까요?', required: true }],
    io: { inputs: {}, outputs: { message: 'SlackMessageRef' } },
  },
];

export const slackModulePackage: ModulePackage = {
  id: 'slack',
  catalog: {
    id: 'slack',
    label: 'Slack',
    description: 'Bot Token으로 메시지 전송',
    connectable: true,
    alwaysReal: false,
    connectionKind: 'token',
    emoji: '💬',
  },
  capabilities: SLACK_CAPABILITIES,
  registration: {
    createMock: () => new MockSlackConnector(),
    instantiate: (config) => (config?.token ? new SlackConnector(config.token as string) : null),
  },
  triggerHandlers: [slackNewMessageHandler],
  listSources: slackSources,
  pushTriggerDriver: {
    triggerType: 'slack.new_message',
    skipPollWhenActive: true,
    async refresh(store, emit) {
      const slackConfig = parseSlackConnectionConfig(
        store.getConnections().find((entry) => entry.connector === 'slack')?.config,
      );
      if (!slackConfig?.token || !slackConfig.appToken) return undefined;

      const listener = new SlackSocketModeListener();
      await listener.start(slackConfig.token, slackConfig.appToken, emit);
      return listener;
    },
    matchesTrigger(trigger, event) {
      if (event.type !== 'slack.new_message') return false;
      return slackChannelMatches(String(trigger.channel ?? ''), {
        channel: String(event.payload.channel ?? ''),
        channelId: String(event.payload.channelId ?? ''),
      });
    },
    dedupeKey(workflowId, event) {
      return `${workflowId}:${String(event.payload.ts ?? event.payload.messageId ?? '')}`;
    },
  },
};