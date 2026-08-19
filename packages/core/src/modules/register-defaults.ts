import { registerModule } from './module-registry.js';
import {
  MockGmailConnector,
  MockLocalSheetConnector,
  MockRdbConnector,
  MockDocumentConnector,
  MockLocalFolderConnector,
  MockSlackConnector,
} from './mocks/index.js';
import {
  GmailConnector,
  type GmailConnectorConfig,
  isLegacyGmailTokenConfig,
  parseGmailConnectionConfig,
} from './gmail/index.js';
import { SlackConnector } from './slack/index.js';
import { RdbConnector, type RdbConnectionConfig } from './rdb/index.js';
import { DocumentConnector } from './document/index.js';
import { LocalFolderConnector, parseLocalFolderConnectionConfig } from './local-folder/index.js';
import { TransformConnector } from './transform/index.js';

registerModule({
  id: 'gmail',
  createMock: () => new MockGmailConnector(),
  instantiate: (config) => {
    if (!config) return null;
    if (parseGmailConnectionConfig(config)) return null;
    if (isLegacyGmailTokenConfig(config)) {
      return new GmailConnector(config as unknown as GmailConnectorConfig);
    }
    return null;
  },
});

registerModule({
  id: 'slack',
  createMock: () => new MockSlackConnector(),
  instantiate: (config) => (config?.token ? new SlackConnector(config.token as string) : null),
});

registerModule({
  id: 'local_sheet',
  createMock: () => new MockLocalSheetConnector(),
});

registerModule({
  id: 'rdb',
  createMock: () => new MockRdbConnector(),
  instantiate: (config) => (config ? new RdbConnector(config as unknown as RdbConnectionConfig) : null),
});

registerModule({
  id: 'document',
  createMock: () => new MockDocumentConnector(),
  instantiate: () => new DocumentConnector(),
});

registerModule({
  id: 'local_folder',
  createMock: () => new MockLocalFolderConnector(),
  instantiate: (config) => {
    const parsed = parseLocalFolderConnectionConfig(config);
    if (parsed && parsed.folders.length > 0) return new LocalFolderConnector(parsed);
    return null;
  },
});

registerModule({
  id: 'transform',
  createMock: () => new TransformConnector(),
  instantiate: () => new TransformConnector(),
});
