export interface DocumentEngineRequest {
  id: string;
  command: string;
  params?: Record<string, unknown>;
}

export interface DocumentEngineResponse<T = unknown> {
  id: string;
  ok: boolean;
  data?: T;
  error?: string;
}
