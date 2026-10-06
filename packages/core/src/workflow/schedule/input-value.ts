import { describeRecurrence } from './describe.js';
import { validateRecurrence } from './occurrences.js';
import type { Recurrence } from './recurrence.js';

/*
 * The host schedule form answers through the ordinary chat input line
 * ("실행 일정: <value>"). The value is the plain-Korean description followed by
 * a compact machine token that the host decodes and the chat bubble hides, so
 * users only ever read the description.
 */
const TOKEN = /\s*⟦일정:([A-Za-z0-9_-]+)⟧/u;
const TOKENS = /\s*⟦일정:[A-Za-z0-9_-]+⟧/gu;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function fromBase64Url(text: string): string | undefined {
  try {
    const padded = text.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

export function encodeScheduleInputValue(recurrence: Recurrence): string {
  return `${describeRecurrence(recurrence)} ⟦일정:${toBase64Url(JSON.stringify(recurrence))}⟧`;
}

/** The validated recurrence carried by a submitted schedule input, or undefined. */
export function decodeScheduleInputValue(value: string): Recurrence | undefined {
  const token = TOKEN.exec(value)?.[1];
  const json = token ? fromBase64Url(token) : undefined;
  if (!json) return undefined;
  try {
    const result = validateRecurrence(JSON.parse(json));
    return result.ok ? result.recurrence : undefined;
  } catch {
    return undefined;
  }
}

/** Chat text as users should read it: schedule tokens removed. */
export function withoutScheduleTokens(text: string): string {
  return text.replace(TOKENS, '');
}
