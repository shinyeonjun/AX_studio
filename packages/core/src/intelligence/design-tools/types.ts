import type {
  Connector,
  ConnectorFailureKind,
  SourceListingConnection,
  SourceListingContext,
} from '../../connectors/types.js';
import type { DiscoveryMetadataRecord } from '../../contracts/discovery-metadata.js';

export type ConnectionRecord = SourceListingConnection;

export const DESIGN_TOOL_IDS = [
  'tools.list',
  'connections.list',
  'sources.list',
  'sources.files.list',
  'sources.file.read',
  'sources.search',
  'capabilities.list',
  'capabilities.describe',
  'capabilities.invoke',
  'discovery.search',
  'discovery.describe',
] as const;

export type DesignToolId = (typeof DESIGN_TOOL_IDS)[number];

export interface DesignToolCall {
  tool: DesignToolId;
  args?: Record<string, unknown>;
}

/** Keep one model turn bounded across structured and native tool protocols. */
export const MAX_DESIGN_TOOL_CALLS_PER_TURN = 5;

export interface DesignToolContext extends SourceListingContext {
  /**
   * Allows bounded untrusted source content to enter the current model turn.
   * The host sets this true by default because the product policy allows
   * configured providers to analyze locally extracted document evidence.
   * A caller may set it false for an explicit privacy restriction.
   */
  allowUntrustedData?: boolean;
  /** Selects whether capability reads serve a model preview or a host renderer. */
  capabilityResultMode?: 'model_evidence' | 'host_execution';
  /** Runtime connector instances for read-only capability invoke. */
  connectors?: Record<string, Connector>;
  /** Persisted, bounded business dictionary entries for discovery assets. */
  discoveryMetadata?: readonly DiscoveryMetadataRecord[];
}

export interface DesignToolResult {
  tool: DesignToolId;
  ok: boolean;
  data?: unknown;
  error?: string;
  /** Sanitized category only; never the provider's raw error code/message. */
  failureKind?: ConnectorFailureKind;
  /** Bounded, untrusted provider error details exposed only to opted-in local callers. */
  errorDetails?: unknown;
}

export type DesignToolHandler = (
  ctx: DesignToolContext,
  args: Record<string, unknown>,
) => DesignToolResult['data'] | Promise<DesignToolResult['data']>;
