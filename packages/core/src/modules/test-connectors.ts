import type { Connector } from './types.js';
import { CONNECTOR_IDS, type ConnectorId } from '../catalog/connector-types.js';
import { instantiateRegisteredConnector } from './module-registry.js';
import {
  MockDocumentConnector,
  MockGmailConnector,
  MockLocalFolderConnector,
  MockLocalSheetConnector,
  MockRdbConnector,
  MockSlackConnector,
} from './mocks/index.js';
import './register-defaults.js';

/** Builds deterministic connectors for core tests; production bootstrap never calls this. */
export function createTestConnectors(): Record<string, Connector> {
  const connectors: Record<string, Connector> = {};
  const mockFactories: Partial<Record<ConnectorId, () => Connector>> = {
    document: () => new MockDocumentConnector(),
    gmail: () => new MockGmailConnector(),
    local_folder: () => new MockLocalFolderConnector(),
    local_sheet: () => new MockLocalSheetConnector(),
    rdb: () => new MockRdbConnector(),
    slack: () => new MockSlackConnector(),
  };
  for (const id of CONNECTOR_IDS) {
    const factory = mockFactories[id];
    const connector = factory?.() ?? instantiateRegisteredConnector(id);
    if (connector) connectors[id] = connector;
  }
  return connectors;
}

export function mockGmail(connectors: Record<string, Connector>): MockGmailConnector {
  const connector = connectors.gmail;
  if (!(connector instanceof MockGmailConnector)) throw new Error('Mock Gmail connector is not configured');
  return connector;
}

export function mockSlack(connectors: Record<string, Connector>): MockSlackConnector {
  const connector = connectors.slack;
  if (!(connector instanceof MockSlackConnector)) throw new Error('Mock Slack connector is not configured');
  return connector;
}

export function mockLocalFolder(connectors: Record<string, Connector>): MockLocalFolderConnector {
  const connector = connectors.local_folder;
  if (!(connector instanceof MockLocalFolderConnector)) {
    throw new Error('Mock local-folder connector is not configured');
  }
  return connector;
}
