import type { SkillStore } from '../store/skill-store.js';
import type { Connector } from './types.js';
import {
  MockGmailConnector,
  MockLocalSheetConnector,
  MockRdbConnector,
  MockReportConnector,
  MockSlackConnector,
} from './mocks/index.js';
import { CONNECTOR_CATALOG, type ConnectorId } from './catalog.js';
import { GmailConnector, type GmailConnectorConfig, parseGmailConnectionConfig } from './gmail/index.js';
import { SlackConnector } from './slack/index.js';
import { RdbConnector, type RdbConnectionConfig } from './rdb/index.js';
import { ReportConnector } from './report/index.js';

export function createDefaultConnectors(): Record<string, Connector> {
  return {
    gmail: new MockGmailConnector(),
    slack: new MockSlackConnector(),
    local_sheet: new MockLocalSheetConnector(),
    rdb: new MockRdbConnector(),
    report: new MockReportConnector(),
  };
}

export function createAlwaysRealConnectors(): Record<string, Connector> {
  const connectors: Record<string, Connector> = {};
  for (const id of Object.keys(CONNECTOR_CATALOG) as ConnectorId[]) {
    if (CONNECTOR_CATALOG[id].alwaysReal) {
      const instance = instantiateConnector(id);
      if (instance) connectors[id] = instance;
    }
  }
  return connectors;
}

export function instantiateConnector(id: ConnectorId, config?: Record<string, unknown>): Connector | null {
  switch (id) {
    case 'report':
      return new ReportConnector();
    case 'slack':
      if (config?.token) return new SlackConnector(config.token as string);
      return null;
    case 'gmail': {
      if (!config) return null;
      if (parseGmailConnectionConfig(config)) return null;
      return new GmailConnector(config as unknown as GmailConnectorConfig);
    }
    case 'rdb':
      if (config) return new RdbConnector(config as unknown as RdbConnectionConfig);
      return null;
    default:
      return null;
  }
}

export function buildConnectorsFromStore(store: SkillStore): Record<string, Connector> {
  const connectors = createDefaultConnectors();
  Object.assign(connectors, createAlwaysRealConnectors());

  for (const conn of store.getConnections()) {
    if (!conn.connected || !conn.config) continue;
    const entry = CONNECTOR_CATALOG[conn.connector as ConnectorId];
    if (!entry) continue;
    const instance = instantiateConnector(conn.connector as ConnectorId, conn.config);
    if (instance) connectors[conn.connector] = instance;
  }

  return connectors;
}
