import type { DiscoveryInspectView } from '@ax-studio/core';

export type CommandResult<T> = {
  status: string;
  data?: T;
  issues?: Array<{ message?: string; code?: string }>;
};

export const TERMINAL_STATUSES = new Set(['published', 'failed', 'cancelled', 'needs_attention']);

function envelope<T>(result: unknown): CommandResult<T> | undefined {
  if (!result || typeof result !== 'object') return undefined;
  return result as CommandResult<T>;
}

export function commandError(result: unknown, fallback: string): Error {
  const value = envelope(result);
  const message = value?.issues?.find((entry) => typeof entry.message === 'string' && entry.message.trim())?.message;
  return new Error(message ?? fallback);
}

export function unwrap<T>(result: unknown): T | undefined {
  const value = envelope<T>(result);
  if (value?.status === 'ok') return value.data;
  return undefined;
}

export function assertOk(result: unknown, fallback: string): void {
  if (envelope(result)?.status !== 'ok') throw commandError(result, fallback);
}

export type RefreshDiscovery = (
  id: string,
  epoch?: number,
) => Promise<DiscoveryInspectView | null>;
