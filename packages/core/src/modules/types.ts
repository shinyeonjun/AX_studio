export interface ConnectorContext {
  executionId: string;
  workflowId?: string;
  variables: Record<string, unknown>;
  log: (entry: ExecutionLogEntry) => void;
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
