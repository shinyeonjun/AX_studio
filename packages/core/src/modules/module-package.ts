import type { ConnectorCapability } from '../catalog/capability-types.js';
import type { ConnectorCatalogEntry, ConnectorId } from '../catalog/connector-types.js';
import type { DiscoverySourceProvider, WorkbookMaterializer } from '../contracts/discovery-source.js';
import type { DesignToolContext } from '../design-tools/types.js';
import type { TriggerHandler } from '../triggers/types.js';
import type { ModuleRegistration } from './module-registry.js';
import type { PushTransportStateHandler } from '../triggers/push-state.js';

export interface PushTriggerDriver {
  /** Connector whose secure runtime configuration may be supplied at refresh time. */
  connector?: string;
  triggerType: string;
  /** When Socket/push transport is active, skip poll for this trigger type. */
  skipPollWhenActive?: boolean;
  refresh: (
    store: {
      getConnections(): Array<{ connector: string; connected: boolean; config?: Record<string, unknown> }>;
    },
    emit: (event: import('../triggers/types.js').TriggerEvent) => void,
    configOverride?: Record<string, unknown>,
    onStateChange?: PushTransportStateHandler,
  ) => Promise<{ stop(): Promise<void>; isRunning(): boolean } | undefined>;
  matchesTrigger: (
    trigger: { type: string; channel?: string; path?: string },
    event: import('../triggers/types.js').TriggerEvent,
  ) => boolean;
  dedupeKey: (workflowId: string, event: import('../triggers/types.js').TriggerEvent) => string;
}

export interface ModulePackage {
  id: ConnectorId;
  catalog: ConnectorCatalogEntry;
  capabilities: ConnectorCapability[];
  registration: Omit<ModuleRegistration, 'id'>;
  triggerHandlers?: TriggerHandler[];
  pushTriggerDriver?: PushTriggerDriver;
  listSources?: (ctx: DesignToolContext) => unknown;
  listSourceFiles?: (ctx: DesignToolContext, args: Record<string, unknown>) => unknown;
  discoverySource?: DiscoverySourceProvider;
  materializeWorkbook?: WorkbookMaterializer['readWorkbookFromPath'];
}

export function moduleDefinitionFromPackage(pkg: ModulePackage) {
  return {
    id: pkg.id,
    label: pkg.catalog.label,
    capabilities: pkg.capabilities.map((cap) => cap.id),
    triggers: pkg.capabilities.filter((cap) => cap.kind === 'trigger').map((cap) => cap.id),
  };
}
