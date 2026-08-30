import type { ExecutionLogEntry } from '../modules/types.js';

export function validateExecutionLog(value: unknown): ExecutionLogEntry[] {
  if (!Array.isArray(value)) throw new Error('실행 로그가 배열이 아닙니다.');
  for (const entry of value) {
    if (
      !entry
      || typeof entry !== 'object'
      || typeof entry.at !== 'string'
      || !['info', 'warn', 'error'].includes(String(entry.level))
      || typeof entry.message !== 'string'
      || (entry.code !== undefined && typeof entry.code !== 'string')
    ) {
      throw new Error('실행 로그 항목의 구조가 잘못되었습니다.');
    }
  }
  return value as ExecutionLogEntry[];
}

export function parseExecutionLog(logJson: string | undefined | null): ExecutionLogEntry[] {
  if (!logJson?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(logJson);
    return validateExecutionLog(parsed);
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
