import { ArtifactStore } from '../store/artifact-store.js';
import { getAxDataPaths } from '../paths/ax-data.js';
import { ALL_MODULE_PACKAGES } from '../modules/packages/catalog.js';
import { join } from 'node:path';
import { createDefaultDiscoverySourceRegistry } from './sources/index.js';
import type { DiscoverySourceRegistry } from './sources/registry.js';
import type { WorkbookMaterializer } from '../contracts/discovery-source.js';
import { createWorkDiscoveryRuntime } from './service/lifecycle.js';
import {
  answerDiscovery,
  cancelDiscovery,
  retryDiscovery,
  startDiscovery,
  waitForTerminal,
} from './service/commands.js';
import { inspectDiscovery } from './service/inspection.js';
import { publishDiscovery } from './service/publish.js';
import type {
  DiscoveryRevisionConflict,
  WorkDiscoveryRuntime,
  WorkDiscoveryServiceOptions,
} from './service/contracts.js';

export type { DiscoveryRevisionConflict, WorkDiscoveryServiceOptions } from './service/contracts.js';

export class WorkDiscoveryService {
  private readonly runtime: WorkDiscoveryRuntime;

  constructor(options: WorkDiscoveryServiceOptions) {
    const paths = getAxDataPaths();
    const artifactStore = options.artifactStore ?? new ArtifactStore(paths.artifacts);
    const snapshotDir = options.snapshotDir ?? join(paths.root, 'discovery', 'snapshots');
    const sourceRegistry: DiscoverySourceRegistry =
      options.sourceRegistry ?? createDefaultDiscoverySourceRegistry(options.store, artifactStore);
    const sourceReadsMax = options.sourceReadsMax ?? 12;
    const materializeWorkbook = ALL_MODULE_PACKAGES.find((pkg) => pkg.id === 'local_sheet')?.materializeWorkbook
      ?? (() => { throw new Error('local_sheet module must register materializeWorkbook'); });

    this.runtime = createWorkDiscoveryRuntime({
      store: options.store,
      artifactStore,
      snapshotDir,
      sourceRegistry,
      sourceReadsMax,
      materializeWorkbook,
      resolveConnectionConfig: options.resolveConnectionConfig,
    });
    if (options.autoResume) this.runtime.resumePendingSessions();
  }

  start(args: import('./schema.js').DiscoveryStartArgs): { id: string; state: import('./schema.js').DiscoverySessionState['status'] } {
    return startDiscovery(this.runtime, args);
  }

  inspect(sessionId: string): import('./schema.js').DiscoveryInspectView | undefined {
    return inspectDiscovery(this.runtime, sessionId);
  }

  waitForTerminal(
    sessionId: string,
    timeoutMs = 15_000,
  ): Promise<import('./schema.js').DiscoverySessionState | undefined> {
    return waitForTerminal(this.runtime, sessionId, timeoutMs);
  }

  cancel(sessionId: string): import('./schema.js').DiscoverySessionState | undefined {
    return cancelDiscovery(this.runtime, sessionId);
  }

  retry(
    sessionId: string,
    expectedRevision: number,
  ): import('./schema.js').DiscoverySessionState | DiscoveryRevisionConflict | { error: string } {
    return retryDiscovery(this.runtime, sessionId, expectedRevision);
  }

  answer(
    sessionId: string,
    questionId: string,
    optionId: string,
    expectedRevision?: number,
  ): import('./schema.js').DiscoverySessionState | DiscoveryRevisionConflict | undefined {
    return answerDiscovery(this.runtime, sessionId, questionId, optionId, expectedRevision);
  }

  publish(
    sessionId: string,
    name?: string,
    expectedRevision?: number,
  ): { workflowId: string } | DiscoveryRevisionConflict | { error: string } {
    return publishDiscovery(this.runtime, sessionId, name, expectedRevision);
  }
}

export type WorkDiscoveryExplorationConfig = {
  sourceReadsMax?: number;
};
