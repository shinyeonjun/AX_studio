import type { ConnectorCapability } from '../catalog/capability-types.js';
import type { ConnectorCatalogEntry, ConnectorId } from '../catalog/connector-types.js';
import type { DiscoverySourceProvider, WorkbookMaterializer } from '../contracts/discovery-source.js';
import type { SourceListingContext } from './types.js';
import type { TriggerEvent, TriggerHandler } from '../triggers/types.js';
import type { ModuleRegistration } from './module-registry.js';
import type { PushTransportStateHandler } from '../triggers/push-state.js';

/** Lazy factory defers Slack channel lookup until the event has queue capacity. */
export type PushTriggerEvent = TriggerEvent | (() => Promise<TriggerEvent>);

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
    /** Return false when backpressured so the provider can retry instead of ACKing a lost event. */
    emit: (event: PushTriggerEvent) => void | boolean | Promise<void | boolean>,
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
  listSources?: (ctx: SourceListingContext) => unknown;
  listSourceFiles?: (ctx: SourceListingContext, args: Record<string, unknown>) => unknown;
  discoverySource?: DiscoverySourceProvider;
  materializeWorkbook?: WorkbookMaterializer['readWorkbookFromPath'];
}
