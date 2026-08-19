export interface ResolveFileRefContextResult {
  ok: boolean;
  path?: string;
  file?: import('../contracts/artifacts/file-ref.js').FileRef;
  error?: string;
  errorCode?: string;
}

export interface ConnectorContext {
  executionId: string;
  workflowId?: string;
  variables: Record<string, unknown>;
  log: (entry: ExecutionLogEntry) => void;
  connections?: Array<{ connector: string; connected: boolean; config?: Record<string, unknown> }>;
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
}

export interface Connector {
  name: string;
  execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult>;
}
