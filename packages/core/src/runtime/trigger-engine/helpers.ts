import type {
  TriggerCursor,
  TriggerCursorStore,
  TriggerEvent,
} from '../../triggers/types.js';
import type { ExecutionResult } from '../types.js';

export const TIME_TRIGGER_TYPES = new Set(['manual', 'once', 'schedule']);
export const MAX_RECENT_EVENTS = 2000;

export interface ActivePushTransport {
  stop(): Promise<void>;
  isRunning(): boolean;
}

export type PushTriggerConfigOverrides = Readonly<Record<string, Record<string, unknown> | undefined>>;

function isTriggerCursor(value: unknown): value is TriggerCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cursor = value as Record<string, unknown>;
  const optionalBooleanFields = ['initialized'] as const;
  const optionalStringFields = [
    'historyId',
    'lastMessageTs',
    'channel',
    'channelId',
    'folderId',
    'folderConfigKey',
  ] as const;
  const optionalStringArrayFields = ['seenMessageIds', 'seenFileKeys'] as const;

  return optionalBooleanFields.every((key) => cursor[key] === undefined || typeof cursor[key] === 'boolean')
    && optionalStringFields.every((key) => cursor[key] === undefined || typeof cursor[key] === 'string')
    && optionalStringArrayFields.every(
      (key) => cursor[key] === undefined
        || (Array.isArray(cursor[key]) && cursor[key].every((entry) => typeof entry === 'string')),
    );
}

export function parseTriggerCursorStore(value: unknown): TriggerCursorStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).map(([workflowId, cursor]) => [workflowId, isTriggerCursor(cursor) ? cursor : {}]),
  );
}

export function triggerInputFromEvent(event: TriggerEvent): Record<string, unknown> {
  const { body: bodyField, ...payload } = event.payload;
  const input: Record<string, unknown> = {
    ...payload,
    sender: event.payload.sender ?? event.payload.from ?? event.payload.user,
  };
  if (event.type === 'webhook.inbound' && typeof bodyField === 'string') {
    input.body = bodyField;
  }
  return input;
}

export function triggerRunWasAccepted(result: unknown): boolean {
  const status = (result as Partial<ExecutionResult> | null)?.status;
  return status === 'success' || status === 'pending_approval';
}

export function eventDedupeKey(workflowId: string, event: TriggerEvent): string | undefined {
  const payload = event.payload;
  const eventId = [payload.messageId, payload.filePath, payload.ts].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return eventId ? `${workflowId}:${event.type}:${eventId}` : undefined;
}

export function cursorAfterEvent(
  cursor: TriggerCursor,
  event: TriggerEvent,
): TriggerCursor {
  const next = { ...cursor };
  const payload = event.payload;

  if (typeof payload.messageId === 'string') {
    const seen = new Set(cursor.seenMessageIds ?? []);
    seen.add(payload.messageId);
    next.seenMessageIds = [...seen].slice(-500);
  }
  if (typeof payload.filePath === 'string') {
    const seen = new Set(cursor.seenFileKeys ?? []);
    seen.add(payload.filePath);
    next.seenFileKeys = [...seen].slice(-5_000);
  }
  if (typeof payload.ts === 'string') {
    next.lastMessageTs = payload.ts;
  }

  return next;
}
