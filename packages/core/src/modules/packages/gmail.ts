import type { ModulePackage } from '../module-package.js';
import { MockGmailConnector } from '../mocks/index.js';
import {
  GmailConnector,
  type GmailConnectorConfig,
  isLegacyGmailTokenConfig,
  parseGmailConnectionConfig,
} from '../gmail/index.js';
import { gmailNewMessageHandler } from '../../triggers/gmail/new-message/index.js';
import type { DesignToolContext } from '../../design-tools/types.js';
import { GMAIL_CAPABILITIES, GMAIL_CATALOG } from './catalog-data.js';

function gmailSources(ctx: DesignToolContext) {
  const conn = ctx.connections.find((entry) => entry.connector === 'gmail');
  const record = parseGmailConnectionConfig(
    conn?.config && typeof conn.config === 'object' && !Array.isArray(conn.config)
      ? (conn.config as Record<string, unknown>)
      : undefined,
  );
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

export const gmailModulePackage: ModulePackage = {
  id: 'gmail',
  catalog: GMAIL_CATALOG,
  capabilities: GMAIL_CAPABILITIES,
  registration: {
    createMock: () => new MockGmailConnector(),
    instantiate: (config) => {
      if (!config) return null;
      if (parseGmailConnectionConfig(config)) return null;
      if (isLegacyGmailTokenConfig(config)) {
        return new GmailConnector(config as unknown as GmailConnectorConfig);
      }
      return null;
    },
  },
  triggerHandlers: [gmailNewMessageHandler],
  listSources: gmailSources,
};
