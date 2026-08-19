import { getConnectorLabel } from '../../catalog/connectors.js';
import { parseGmailConnectionConfig } from '../../modules/gmail/index.js';
import { getLocalFolderConnectionStatus } from '../../modules/local-folder/index.js';
import { getSlackConnectionStatus } from '../../modules/slack/index.js';
import type { DesignToolContext, DesignToolHandler } from '../types.js';

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function gmailSources(ctx: DesignToolContext) {
  const conn = ctx.connections.find((entry) => entry.connector === 'gmail');
  const record = parseGmailConnectionConfig(conn?.config);
  if (!conn?.connected || !record) {
    return { connector: 'gmail', connected: false, sources: [] };
  }
  return {
    connector: 'gmail',
    connected: true,
    sources: [
      {
        id: record.account,
        label: record.account,
        kind: 'gmail_account',
        account: record.account,
        scopes: record.scopes,
      },
    ],
  };
}

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

function localFolderSources(ctx: DesignToolContext) {
  const conn = ctx.connections.find((entry) => entry.connector === 'local_folder');
  const status = getLocalFolderConnectionStatus(conn?.config, Boolean(conn?.connected));
  if (!status.connected) {
    return { connector: 'local_folder', connected: false, sources: [] };
  }
  return {
    connector: 'local_folder',
    connected: true,
    sources: status.folders.map((folder) => ({
      id: folder.id,
      label: folder.label,
      kind: 'local_folder',
      path: folder.path,
      addedAt: folder.addedAt,
    })),
  };
}

const SOURCE_HANDLERS: Record<string, (ctx: DesignToolContext) => unknown> = {
  gmail: gmailSources,
  slack: slackSources,
  local_folder: localFolderSources,
};

export const sourcesList: DesignToolHandler = (ctx, args) => {
  const connector = stringArg(args, 'connector');
  if (connector) {
    const handler = SOURCE_HANDLERS[connector];
    if (!handler) {
      return {
        connector,
        connected: ctx.connectedConnectorIds.includes(connector),
        sources: [],
        note: `${getConnectorLabel(connector)}는 sources.list 대상이 아닙니다.`,
      };
    }
    return handler(ctx);
  }

  return {
    sources: Object.keys(SOURCE_HANDLERS).map((id) => SOURCE_HANDLERS[id]!(ctx)),
  };
};
