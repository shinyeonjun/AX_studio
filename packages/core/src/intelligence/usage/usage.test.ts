import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync, type AppDatabase } from '../../persistence/db.js';
import { pruneHistory, DEFAULT_HISTORY_RETENTION } from '../../persistence/repositories/retention-repository.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import type { DecisionEngine } from '../../contracts/decision.js';
import { callCostUsd, priceForModel } from './prices.js';
import { withUsageRecording } from './recording-decision-engine.js';
import { buildUsageReport, summarizeUsageCalls } from './summary.js';
import { recordUsageCall, runWithUsageContext, setUsageRecorder, type StoredUsageCall } from './usage-recorder.js';

const call = (overrides: Partial<StoredUsageCall>): StoredUsageCall => ({
  engine: 'jev', purpose: 'decision', durationMs: 100, ok: true, createdAt: '2026-10-15T00:00:00.000Z', ...overrides,
});

describe('usage prices', () => {
  it('prices known models, CLI aliases and dated snapshots; unknown models have no price', () => {
    expect(priceForModel('sonnet')).toEqual(priceForModel('claude-sonnet-5-5'));
    expect(priceForModel('jev-1.14.0')).toEqual(priceForModel('jev-1.13.0'));
    expect(priceForModel('gpt-6-luna-2026-09-01')).toEqual(priceForModel('gpt-6-luna'));
    expect(priceForModel('some-local-model')).toBeUndefined();
  });

  it('bills cached input at the cache price and says nothing when no tokens were reported', () => {
    // 1M input of which 0.5M cached, 0.1M output on Sonnet 5.5: 0.5*2 + 0.5*0.2 + 0.1*10 = 2.1
    expect(callCostUsd({ model: 'claude-sonnet-5-5', inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 100_000 })).toBeCloseTo(2.1);
    expect(callCostUsd({ model: 'claude-sonnet-5-5' })).toBeUndefined();
    // A real Claude CLI reply: 2 fresh + 103,700 written to the 1-hour cache, 5 out. The CLI itself reported $0.414854.
    expect(callCostUsd({ model: 'sonnet', inputTokens: 103_702, cacheWriteInputTokens: 103_700, outputTokens: 5 })).toBeCloseTo(0.414854, 6);
  });
});

describe('usage summary', () => {
  it('adds a request\'s calls together and treats a call outside any request as its own', () => {
    const summary = summarizeUsageCalls([
      call({ requestId: 'r1', durationMs: 100, inputTokens: 10, outputTokens: 1, model: 'jev-1.13.0' }),
      call({ requestId: 'r1', durationMs: 300, inputTokens: 30, outputTokens: 3, model: 'jev-1.13.0' }),
      call({ durationMs: 50, inputTokens: 20, ok: false }),
    ])!;
    expect(summary).toMatchObject({ requests: 2, calls: 3, failedCalls: 1, totalMs: 450, callsPerRequest: 1.5, inputTokensPerRequest: 30, outputTokensPerRequest: 2, unpricedCalls: 1 });
    expect(summary.p50Ms).toBe(400);
  });

  it('splits decisions by engine and keeps generations apart', () => {
    const report = buildUsageReport([
      call({ engine: 'jev' }),
      call({ engine: 'llm', purpose: 'generation', model: 'sonnet', inputTokens: 1000, outputTokens: 100 }),
    ], 'week', new Date('2026-10-08T00:00:00.000Z'));
    expect(report.decision.jev?.calls).toBe(1);
    expect(report.decision.llm).toBeNull();
    expect(report.generation?.costUsd).toBeGreaterThan(0);
  });
});

describe('usage recording', () => {
  const recorded: StoredUsageCall[] = [];
  beforeEach(() => { recorded.length = 0; setUsageRecorder((entry) => recorded.push(entry)); });
  afterEach(() => setUsageRecorder(undefined));

  it('records each Jev evaluation with its request, and failures without breaking the error', async () => {
    let fail = false;
    const engine: DecisionEngine = {
      dataHandling: 'cloud',
      async evaluate() {
        if (fail) throw Object.assign(new Error('down'), { providerRequestCount: 2 });
        return { answers: {}, model: 'jev-1.13.0', providerRequestCount: 1, requestBytes: 900, usage: { inputTokens: 200, outputTokens: 5 } };
      },
    };
    const wrapped = withUsageRecording(engine);
    expect(wrapped.dataHandling).toBe('cloud');
    expect(withUsageRecording(wrapped)).toBe(wrapped);
    await runWithUsageContext({ requestId: 'req-1', workspaceSessionId: 'chat-1' }, () => wrapped.evaluate({ state: {}, questions: {} }));
    fail = true;
    await expect(wrapped.evaluate({ state: {}, questions: {} })).rejects.toThrow('down');
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({ engine: 'jev', purpose: 'decision', model: 'jev-1.13.0', requestId: 'req-1', workspaceSessionId: 'chat-1', inputTokens: 200, outputTokens: 5, requestBytes: 900, ok: true });
    expect(recorded[1]).toMatchObject({ ok: false, providerRequests: 2 });
    expect(recorded[1]).not.toHaveProperty('requestId');
  });

  it('a failing sink never reaches the caller', () => {
    setUsageRecorder(() => { throw new Error('disk full'); });
    expect(() => recordUsageCall({ engine: 'llm', purpose: 'generation', durationMs: 1, ok: true })).not.toThrow();
  });
});

describe('usage storage', () => {
  let db: AppDatabase;
  let store: WorkflowStore;
  beforeEach(async () => { db = await createDatabaseAsync(':memory:'); store = new WorkflowStore(db); });
  afterEach(() => { db.close?.(); });

  it('keeps every field, leaves unknown token counts unknown, and drops rows past the retention', () => {
    store.usage.recordUsageCall(call({ requestId: 'r', model: 'sonnet', engine: 'llm', purpose: 'generation', label: 'reply', provider: 'claude-cli', inputTokens: 10, cachedInputTokens: 4, cacheWriteInputTokens: 3, outputTokens: 2, reasoningTokens: 1, providerRequests: 1, createdAt: '2026-10-14T00:00:00.000Z' }));
    store.usage.recordUsageCall(call({ createdAt: '2026-06-01T00:00:00.000Z' }));
    const all = store.usage.listUsageCallsSince(new Date('2026-01-01T00:00:00.000Z'));
    expect(all).toHaveLength(2);
    expect(all[1]).toEqual(call({ requestId: 'r', model: 'sonnet', engine: 'llm', purpose: 'generation', label: 'reply', provider: 'claude-cli', inputTokens: 10, cachedInputTokens: 4, cacheWriteInputTokens: 3, outputTokens: 2, reasoningTokens: 1, providerRequests: 1, createdAt: '2026-10-14T00:00:00.000Z' }));
    expect(all[0]).not.toHaveProperty('inputTokens');
    expect(pruneHistory(db, DEFAULT_HISTORY_RETENTION, new Date('2026-10-15T00:00:00.000Z')).usageCalls).toBe(1);
    expect(store.usage.listUsageCallsSince(new Date('2026-01-01T00:00:00.000Z'))).toHaveLength(1);
  });
});
