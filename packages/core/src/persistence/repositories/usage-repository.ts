import type { AppDatabase } from '../db.js';
import { readRows } from '../db/types.js';
import type { StoredUsageCall, UsageEngine, UsagePurpose } from '../../intelligence/usage/usage-recorder.js';

interface UsageCallRow {
  created_at: string;
  request_id: string | null;
  workspace_session_id: string | null;
  engine: string;
  purpose: string;
  label: string | null;
  provider: string | null;
  model: string | null;
  duration_ms: number;
  provider_requests: number | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  cache_write_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  request_bytes: number | null;
  ok: number;
}

const count = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value) ? null : Math.max(0, Math.round(value));

export function insertUsageCall(db: AppDatabase, call: StoredUsageCall): void {
  db.prepare(
    `INSERT INTO usage_calls
     (created_at, request_id, workspace_session_id, engine, purpose, label, provider, model, duration_ms,
      provider_requests, input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_tokens, request_bytes, ok)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    call.createdAt, call.requestId ?? null, call.workspaceSessionId ?? null, call.engine, call.purpose,
    call.label ?? null, call.provider ?? null, call.model ?? null, count(call.durationMs) ?? 0,
    count(call.providerRequests), count(call.inputTokens), count(call.cachedInputTokens), count(call.cacheWriteInputTokens), count(call.outputTokens),
    count(call.reasoningTokens), count(call.requestBytes), call.ok ? 1 : 0,
  );
}

export function listUsageCallsSince(db: AppDatabase, sinceIso: string): StoredUsageCall[] {
  return readRows<UsageCallRow>(
    db.prepare('SELECT * FROM usage_calls WHERE created_at >= ? ORDER BY created_at'),
    sinceIso,
  ).map((row) => {
    const call: StoredUsageCall = {
      createdAt: row.created_at,
      engine: row.engine as UsageEngine,
      purpose: row.purpose as UsagePurpose,
      durationMs: row.duration_ms,
      ok: row.ok === 1,
    };
    if (row.request_id !== null) call.requestId = row.request_id;
    if (row.workspace_session_id !== null) call.workspaceSessionId = row.workspace_session_id;
    if (row.label !== null) call.label = row.label;
    if (row.provider !== null) call.provider = row.provider;
    if (row.model !== null) call.model = row.model;
    if (row.provider_requests !== null) call.providerRequests = row.provider_requests;
    if (row.input_tokens !== null) call.inputTokens = row.input_tokens;
    if (row.cached_input_tokens !== null) call.cachedInputTokens = row.cached_input_tokens;
    if (row.cache_write_input_tokens !== null) call.cacheWriteInputTokens = row.cache_write_input_tokens;
    if (row.output_tokens !== null) call.outputTokens = row.output_tokens;
    if (row.reasoning_tokens !== null) call.reasoningTokens = row.reasoning_tokens;
    if (row.request_bytes !== null) call.requestBytes = row.request_bytes;
    return call;
  });
}
