/** Minimal host context exposed to connector-owned source listing handlers. */
export interface SourceListingConnection {
  connector: string;
  connected: boolean;
  config?: unknown;
}

export interface SourceListingContext {
  abortSignal?: AbortSignal;
  connections: SourceListingConnection[];
  connectedConnectorIds: string[];
}

export const CONNECTOR_FAILURE_KINDS = [
  'not_found',
  'permission_denied',
  'host_policy',
  'invalid_request',
  'transient',
  'provider_error',
  'unknown',
] as const;

/** Safe, provider-independent failure categories for agent recovery decisions. */
export type ConnectorFailureKind = (typeof CONNECTOR_FAILURE_KINDS)[number];

export interface ResolveFileRefContextResult {
  ok: boolean;
  path?: string;
  file?: import('../contracts/artifacts/file-ref.js').FileRef;
  error?: string;
  errorCode?: string;
}

/** Safe reference to a persisted output; physical storage paths stay host-owned. */
export interface ArtifactReference {
  id: string;
  sha256: string;
  fileName: string;
  mimeType?: string;
  size: number;
  createdAt: string;
}

/** Runtime seam for connectors that produce durable binary output. */
export interface ArtifactSink {
  putBytes(
    data: Uint8Array,
    options: { fileName: string; mimeType?: string; id?: string },
  ): ArtifactReference;
}

export interface ConnectorContext {
  abortSignal?: AbortSignal;
  executionId: string;
  workflowId?: string;
  /**
   * Host-owned report capture mode. This is deliberately carried out of the
   * request payload so an agent cannot use an internal pagination path to
   * bypass an interactive connector's configured preview limit.
   */
  reportCapture?: boolean;
  /** Host-owned chat/session scope used to resolve session artifacts safely. */
  workspaceSessionId?: string;
  variables: Record<string, unknown>;
  /** Validated outputs keyed by producing step and declared port. */
  outputs?: Record<string, Record<string, unknown>>;
  log: (entry: ExecutionLogEntry) => void;
  connections?: Array<{ connector: string; connected: boolean; config?: Record<string, unknown> }>;
  /** Host-approved input paths for discovery-generated, non-folder sources. */
  allowedFilePaths?: readonly string[];
  artifactSink?: ArtifactSink;
  /** Resolve a FileRef to a validated physical path inside connected sources. */
  resolveFileRef?: (file: import('../contracts/artifacts/file-ref.js').FileRef) => ResolveFileRefContextResult;
}

export interface ExecutionLogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  code?: string;
  message: string;
  data?: unknown;
}

export interface ConnectorResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
  /** Bounded provider error details that are safe for the owning boundary to inspect. */
  errorDetails?: unknown;
}

export interface Connector {
  name: string;
  execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult>;
}
