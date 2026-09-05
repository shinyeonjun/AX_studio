import type { AxAiApi } from './ax-api/ai.js';
import type { AxConnectorApi } from './ax-api/connectors.js';
import type { AxDiscoveryApi } from './ax-api/discovery.js';
import type { AxRuntimeApi } from './ax-api/runtime.js';
import type { AxWorkspaceApi } from './ax-api/workspace.js';

export type { AxCommandResult } from '@ax-studio/core';
export type {
  GeneratedArtifactExportResult,
  GeneratedArtifactFolderSaveResult,
} from './ax-api/contracts.js';

export interface AxApi extends AxRuntimeApi, AxWorkspaceApi, AxConnectorApi, AxAiApi, AxDiscoveryApi {}

declare global {
  interface Window {
    ax: AxApi;
  }
}
