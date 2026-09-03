import type { FileRef } from '../../contracts/artifacts/file-ref.js';

export interface SourceConnection {
  connector: string;
  connected: boolean;
  config?: Record<string, unknown>;
}

export interface ResolveFileRefResult {
  ok: true;
  path: string;
  file: FileRef;
}

export interface ResolveFileRefError {
  ok: false;
  error: string;
  errorCode: string;
}

export type ResolveFileRefOutcome = ResolveFileRefResult | ResolveFileRefError;
