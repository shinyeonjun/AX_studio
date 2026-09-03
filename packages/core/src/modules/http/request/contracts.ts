import type { HttpAuthConfig } from '../connection.js';

export const HTTP_DEFAULT_TIMEOUT_MS = 30_000;
export const HTTP_DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

export interface HttpRequestInput {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  auth?: HttpAuthConfig;
}

export interface HttpRequestResult {
  ok: true;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

export interface HttpRequestError {
  ok: false;
  error: string;
  errorCode: string;
  status?: number;
}

export type PerformHttpRequestResult = HttpRequestResult | HttpRequestError;
