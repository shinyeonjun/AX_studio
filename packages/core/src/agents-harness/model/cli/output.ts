import type { ZodType } from 'zod';
import { parseStructuredOutput } from '../cli-json.js';

export function isCursorNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return (
    trimmed.startsWith('cursor-retrieval:') ||
    trimmed.includes('cursor_retrieval.') ||
    (trimmed.startsWith('tracing to ') && trimmed.includes('.log'))
  );
}

export function readableCliError(stderr: string, fallback: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isCursorNoiseLine(line));
  return lines.join('\n') || fallback;
}

export function pickCliOutput(result: { stdout: string; stderr: string }): string {
  const stdout = result.stdout.trim();
  if (stdout) return stdout;
  const stderr = result.stderr
    .split(/\r?\n/)
    .filter((line) => !isCursorNoiseLine(line))
    .join('\n')
    .trim();
  return stderr;
}

export function parseCursorStreamLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function cursorSessionIdFromEvent(event: Record<string, unknown>): string | undefined {
  if (typeof event.session_id === 'string' && event.session_id.trim()) return event.session_id;
  return undefined;
}

export function cursorProgressFromEvent(event: Record<string, unknown>): string | undefined {
  const type = typeof event.type === 'string' ? event.type : '';
  if (type === 'system') return '에이전트를 준비하고 있습니다';
  if (type === 'tool_call' || type === 'tool_use') return '컨텍스트를 확인하고 있습니다';
  if (type === 'assistant') {
    const message = event.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
    const text = message?.content?.find((block) => block.type === 'text')?.text?.trim();
    if (text) return text.slice(0, 80);
    return '답변을 작성하고 있습니다';
  }
  if (type === 'result') return '결과를 정리하고 있습니다';
  return undefined;
}

export function cursorResultTextFromEvent(event: Record<string, unknown>): string | undefined {
  if (event.type !== 'result') return undefined;
  if (typeof event.result === 'string' && event.result.trim()) return event.result;
  if (event.result && typeof event.result === 'object') return JSON.stringify(event.result);
  return undefined;
}

export async function parseStructuredFromCliResult<T>(
  result: { stdout: string; stderr: string; exitCode: number },
  schema: ZodType<T>,
  fallbackMessage: string,
): Promise<T> {
  const raw = pickCliOutput(result);
  if (!raw) {
    throw new Error(readableCliError(result.stderr, fallbackMessage));
  }
  try {
    return parseStructuredOutput(raw, schema);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${readableCliError(result.stderr, fallbackMessage)} (${detail})`);
  }
}
