import type { ExecutionLogEntry } from '../modules/types.js';

export function parseExecutionLog(logJson: string | undefined | null): ExecutionLogEntry[] {
  if (!logJson?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(logJson);
    return Array.isArray(parsed) ? (parsed as ExecutionLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function executionLogCodes(log: ExecutionLogEntry[]): string[] {
  return log.map((entry) => entry.code).filter((code): code is string => Boolean(code));
}

export function executionLogMessages(log: ExecutionLogEntry[]): string[] {
  return log.map((entry) => entry.message).filter((message): message is string => Boolean(message));
}

export function hasExecutionLogCode(log: ExecutionLogEntry[], code: string): boolean {
  return executionLogCodes(log).includes(code);
}
