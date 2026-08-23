import type { ModulePackage } from '../module-package.js';
import { SlackConnector } from '../slack/index.js';
import { getSlackConnectionStatus } from '../slack/connection.js';
import { slackNewMessageHandler } from '../../triggers/slack/new-message/index.js';
import { slackChannelMatches } from '../../triggers/slack/new-message/channel-match.js';
import { SlackSocketModeListener } from '../../triggers/slack/new-message/socket-mode.js';
import { parseSlackConnectionConfig } from '../../triggers/types.js';
import type { DesignToolContext } from '../../design-tools/types.js';
import { SLACK_CAPABILITIES, SLACK_CATALOG } from '../slack/catalog.js';

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

export const slackModulePackage: ModulePackage = {
  id: 'slack',
  catalog: SLACK_CATALOG,
  capabilities: SLACK_CAPABILITIES,
  registration: {
    instantiate: (config) => {
      const parsed = parseSlackConnectionConfig(config);
      return parsed ? new SlackConnector(parsed.token) : null;
    },
  },
  triggerHandlers: [slackNewMessageHandler],
  listSources: slackSources,
  pushTriggerDriver: {
    connector: 'slack',
    triggerType: 'slack.new_message',
    skipPollWhenActive: true,
    async refresh(store, emit, configOverride, onStateChange) {
      const slackConfig = parseSlackConnectionConfig(
        configOverride ?? store.getConnections().find((entry) => entry.connector === 'slack')?.config,
      );
      if (!slackConfig?.token || !slackConfig.appToken) return undefined;

      const listener = new SlackSocketModeListener();
      await listener.start(slackConfig.token, slackConfig.appToken, emit, onStateChange);
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
