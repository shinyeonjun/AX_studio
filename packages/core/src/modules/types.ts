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
  executionId: string;
  workflowId?: string;
  /** Host-owned chat/session scope used to resolve session artifacts safely. */
  workspaceSessionId?: string;
  variables: Record<string, unknown>;
  /** Validated outputs keyed by producing step and declared port. */
  outputs?: Record<string, Record<string, unknown>>;
  log: (entry: ExecutionLogEntry) => void;
  connections?: Array<{ connector: string; connected: boolean; config?: Record<string, unknown> }>;
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
