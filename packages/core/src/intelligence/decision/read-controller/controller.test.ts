import { describe, expect, it, vi } from 'vitest';
import type { DecisionEngine, DecisionEvaluationRequest, DecisionEvaluationResult } from '../../../contracts/decision.js';
import { createAuthoritativeRequestAnchor } from '../request-anchor.js';
import { GMAIL_BODY_READ, GMAIL_SEARCH_READ, SLACK_CURSOR_SEARCH_READ, normalizeGmailBody,
  normalizeGmailSearchPage, normalizeSlackCursorSearchPage, offerGmailBody, offerSearchSpan } from './adapters.js';
import { runReadController } from './controller.js';
import { ReadRegistry } from './registry.js';
import type { ReadControllerOptions } from './callback-options.js';
import type { CandidateDescriptor, DecisionView, JsonValue, ReadCallInstance,
  ReadExecutionResult, ReadOperation, ReadSuccess } from './types.js';

const gmail = { connector: 'gmail', sourceId: 'mail-source', connectionId: 'mail-connection' };
const otherGmail = { connector: 'gmail', sourceId: 'other-mail', connectionId: 'other-connection' };
const slack = { connector: 'slack', sourceId: 'slack-source', connectionId: 'slack-connection' };
const context = { workspaceSessionId: 'synthetic-session', catalogRevision: 7, contextRevision: 'policy-v3', sources: [gmail, otherGmail, slack] };
const anchor = (text = 'Inspect "alpha" and "beta"') => createAuthoritativeRequestAnchor(text,
  { workspaceSessionId: context.workspaceSessionId, catalogRevision: context.catalogRevision, originalRequestId: 'synthetic-turn' });
const view = (value: JsonValue = []): DecisionView => ({ value, complete: true, omittedRows: 0, omittedFields: [] });
const success = (count = 1): ReadSuccess => ({ status: 'ok', data: { count }, decisionView: view({ count }),
  upstream: { status: 'complete', hasMore: false, observedCount: count } });
const defer = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

function span(registry: ReadRegistry, word: string) {
  const start = registry.request.text.indexOf(word);
  return registry.requestSpan(start, start + word.length, word);
}

function seed(registry: ReadRegistry, word = 'alpha', key = 'query', source = gmail) {
  return offerSearchSpan(registry, source, source.connector === 'gmail' ? GMAIL_SEARCH_READ.operationId : SLACK_CURSOR_SEARCH_READ.operationId,
    span(registry, word), key);
}

function candidates(request: DecisionEvaluationRequest): readonly CandidateDescriptor[] {
  return (request.state as { candidates: readonly CandidateDescriptor[] }).candidates;
}

function choose(request: DecisionEvaluationRequest, action: string, select: (candidate: CandidateDescriptor) => boolean = () => true): DecisionEvaluationResult {
  const next = request.questions.next!;
  if (next.type !== 'choice') throw new Error('Expected host choice');
  const answers: DecisionEvaluationResult['answers'] = {
    next: { type: 'choice', choice: action, probabilities: Object.fromEntries(Object.keys(next.criteria).map((key) => [key, key === action ? 0.99 : 0.001])) },
  };
  if (!['finish', 'clarify'].includes(action)) for (const candidate of candidates(request)) {
    const selected = candidate.action === action && select(candidate);
    answers[`select:${candidate.instanceId}`] = { type: 'choice', choice: selected ? 'yes' : 'no',
      probabilities: { yes: selected ? 0.99 : 0.01, no: selected ? 0.01 : 0.99 } };
  }
  return { answers };
}

function options(overrides: Partial<ReadControllerOptions> = {}): ReadControllerOptions {
  let seeded = false;
  return { request: anchor(), context, operations: [GMAIL_SEARCH_READ, GMAIL_BODY_READ, SLACK_CURSOR_SEARCH_READ],
    requirements: [{ coverageKey: 'query', level: 'observed' }],
    providerBudget: { enforcement: 'external', explanation: 'Scripted local evaluator and fake connector; no network dispatches.' },
    authorize: async () => ({ allowed: true, catalogRevision: context.catalogRevision, contextRevision: context.contextRevision }),
    discover: ({ registry }) => { if (!seeded) { seed(registry); seeded = true; } },
    decide: async (request) => choose(request, candidates(request).length ? 'read' : 'finish'),
    executeRead: async () => success(), ...overrides };
}

function gmailPage(id: string, next?: string, continuation = false): JsonValue {
  return { messages: [{ id }], hits: [{ ref: { connector: 'gmail', kind: 'email', id }, score: 1 }],
    truncated: Boolean(next), limit: 20,
    completeness: { status: next || continuation ? 'partial' : 'complete', hasMore: Boolean(next), observedCount: 1,
      ...(next || continuation ? { reason: 'provider_limit' } : {}) },
    ...(next ? { nextPageToken: next } : {}), total: 999, totalIsEstimate: true };
}

describe('connector-neutral Jev read controller (synthetic, not production wiring)', () => {
  it('joins repeated search calls, selects an observed body ref, continues host cursor, then permits prose', async () => {
    const text = `Inspect "alpha" and "beta" ${'context '.repeat(320)}Do not inspect other sources or send anything`;
    const packets: DecisionEvaluationRequest[] = [];
    const reads: ReadCallInstance[] = [];
    let round = 0;
    const scriptedJev: DecisionEngine = { evaluate: async (packet) => {
      packets.push(packet);
      round++;
      if (round === 1) return choose(packet, 'read', (candidate) => candidate.operationId === GMAIL_SEARCH_READ.operationId);
      if (round === 2) return choose(packet, 'read', (candidate) => candidate.coverageKey === 'chosen-body');
      if (round === 3) return choose(packet, 'continue');
      return choose(packet, 'finish');
    } };
    let seeded = false;
    const result = await runReadController(options({ request: anchor(text),
      requirements: [{ coverageKey: 'alpha-query', level: 'observed' }, { coverageKey: 'beta-query', level: 'observed' }, { coverageKey: 'chosen-body', level: 'observed' }],
      providerBudget: { enforcement: 'dispatch-guard', maxCalls: 12, maxRequestBytes: 20_000 },
      discover: ({ registry }) => {
        if (!seeded) { seed(registry, 'alpha', 'alpha-query'); seed(registry, 'beta', 'beta-query'); seeded = true; }
        const firstAlpha = registry.evidence().find((entry) => entry.coverageKey === 'alpha-query' && entry.pagination?.hasMore);
        if (firstAlpha) registry.continue(firstAlpha.instanceId);
        const ref = registry.observedRefs().find((entry) => entry.kind === 'EmailMessageRef' && entry.originInstanceId === firstAlpha?.instanceId);
        if (ref) offerGmailBody(registry, gmail, ref, 'chosen-body');
      },
      decide: (packet, callback) => callback.budget.dispatch(200, callback.signal, () => scriptedJev.evaluate(packet)),
      executeRead: (instance, callback) => callback.budget.dispatch(100, callback.signal, async () => {
        reads.push(instance);
        if (instance.operationId === GMAIL_BODY_READ.operationId) {
          expect(instance.params.message).toEqual({ connector: 'gmail', kind: 'email', id: 'private-message-A' });
          return normalizeGmailBody({ id: 'private-message-A', body: 'Selected authorized body' }, view('Selected authorized body'));
        }
        if (instance.params.pageToken) {
          expect(instance.params.query).toBe('alpha');
          expect(instance.params.pageToken).toBe('private-cursor-A');
          return normalizeGmailSearchPage(gmailPage('private-message-C', undefined, true), view([{ subject: 'Alpha second page' }]));
        }
        const alpha = instance.params.query === 'alpha';
        return normalizeGmailSearchPage(gmailPage(alpha ? 'private-message-A' : 'private-message-B', alpha ? 'private-cursor-A' : undefined),
          view([{ subject: alpha ? 'Alpha hit' : 'Beta hit' }]));
      }) }));
    expect(result).toMatchObject({ status: 'finished', code: 'evidence_sufficient' });
    expect(reads.map((read) => read.operationId)).toEqual(['gmail.messages.search', 'gmail.messages.search', 'gmail.messages.read', 'gmail.messages.search']);
    expect(new Set(reads.map((read) => read.instanceId)).size).toBe(4);
    expect(reads.every((read) => read.instanceId !== read.operationId)).toBe(true);
    expect(result.budgets).toMatchObject({ decisionPhases: 4, readAttempts: 4, providerDispatches: 8, providerEnforcement: 'dispatch-guard' });
    expect(result.coverage.find((record) => record.coverageKey === 'alpha-query')).toMatchObject({ upstreamStatus: 'partial', pagination: 'exhausted' });
    expect(result.coverage.find((record) => record.coverageKey === 'alpha-query')?.exactTotal).toBeUndefined();
    for (const packet of packets) {
      expect((packet.state as { request: string }).request).toBe(text);
      expect(JSON.stringify(packet.state)).not.toContain('private-cursor-A');
      expect(JSON.stringify(packet.state)).not.toContain('private-message-A');
    }
    const prose = vi.fn();
    if (result.status === 'finished') prose(result.localResults, result.coverage);
    expect(prose).toHaveBeenCalledOnce();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidence[0]!.upstream)).toBe(true);
  });

  it.each(['missing', 'tied', 'invalid-type', 'unknown-choice', 'invented-argument'])('fails closed on %s decisions', async (kind) => {
    const execute = vi.fn(async () => success());
    const result = await runReadController(options({ executeRead: execute, decide: async (request): Promise<DecisionEvaluationResult> => {
      if (kind === 'missing') return { answers: {} };
      if (kind === 'tied') return { answers: { next: { type: 'choice', choice: 'read', probabilities: { read: 0.5, finish: 0.5, clarify: 0 } } } };
      if (kind === 'invalid-type') return { answers: { next: { type: 'boolean', probability: 1 } } };
      if (kind === 'unknown-choice') return { answers: { next: { type: 'choice', choice: 'SELECT * FROM secrets', probabilities: {} } } };
      const selected = choose(request, 'read');
      return { answers: { ...selected.answers, rawMessageId: { type: 'choice', choice: 'forged', probabilities: { forged: 1 } } } };
    } }));
    expect(result.status).toBe('clarify');
    expect(execute).not.toHaveBeenCalled();
    expect(result.localResults).toBeUndefined();
  });

  it('does not turn an empty read choice into completion', async () => {
    const result = await runReadController(options({ decide: async (request) => choose(request, 'read', () => false) }));
    expect(result).toMatchObject({ status: 'clarify', code: 'no_progress_decision' });
    expect(result.budgets.readAttempts).toBe(0);
  });

  it('denies selected body scope before connector dispatch, retaining metadata only', async () => {
    let seeded = false;
    const calls: string[] = [];
    const result = await runReadController(options({ requirements: [{ coverageKey: 'body', level: 'observed' }],
      discover: ({ registry }) => {
        if (!seeded) { seed(registry); seeded = true; }
        const ref = registry.observedRefs().find((entry) => entry.kind === 'EmailMessageRef');
        if (ref) offerGmailBody(registry, gmail, ref, 'body');
      },
      authorize: async (instance) => ({ allowed: instance.operationId !== GMAIL_BODY_READ.operationId,
        catalogRevision: context.catalogRevision, contextRevision: context.contextRevision }),
      executeRead: async (instance) => { calls.push(instance.operationId); return normalizeGmailSearchPage(gmailPage('private-message'), view([])); } }));
    expect(calls).toEqual([GMAIL_SEARCH_READ.operationId]);
    expect(result).toMatchObject({ status: 'clarify', code: 'coverage_requirement_not_met' });
    expect(result.evidence.find((record) => record.coverageKey === 'body')?.failure?.kind).toBe('permission');
  });

  it('drops results and refs when authorization revision changes during IO', async () => {
    let checks = 0;
    const result = await runReadController(options({ authorize: async () => ({ allowed: true,
      catalogRevision: ++checks === 1 ? context.catalogRevision : context.catalogRevision + 1, contextRevision: context.contextRevision }),
      executeRead: async () => normalizeGmailSearchPage(gmailPage('private-message'), view([])) }));
    expect(result.status).toBe('clarify');
    expect(result.evidence[0]).toMatchObject({ status: 'failed', refIds: [], failure: { code: 'read_scope_changed' } });
  });

  it('permits exactly one scope-preserving transient retry, then stops', async () => {
    let seeded = false;
    const calls: ReadCallInstance[] = [];
    const result = await runReadController(options({ discover: ({ registry }) => {
      if (!seeded) { seed(registry); seeded = true; }
      const failure = registry.evidence().at(-1);
      if (failure?.failure?.kind === 'transient') registry.retry(failure.instanceId);
    }, decide: async (request) => choose(request, candidates(request)[0]!.action),
    executeRead: async (instance) => { calls.push(instance); return { status: 'failed', kind: 'transient', code: 'synthetic_busy' }; } }));
    expect(result).toMatchObject({ status: 'clarify', code: 'retry_budget_exhausted' });
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.attempt)).toEqual([1, 2]);
    expect(calls[0]!.params).toEqual(calls[1]!.params);
    expect(calls[0]!.fingerprint).toBe(calls[1]!.fingerprint);
    expect(calls[1]!.retryOf).toBe(calls[0]!.instanceId);
  });

  it('read attempts and retries share one hard dispatch-attempt budget', async () => {
    let seeded = false;
    const execute = vi.fn(async (): Promise<ReadExecutionResult> => ({ status: 'failed', kind: 'transient', code: 'busy' }));
    const result = await runReadController(options({ limits: { maxReadAttempts: 1 }, executeRead: execute,
      discover: ({ registry }) => {
        if (!seeded) { seed(registry); seeded = true; }
        const failure = registry.evidence().at(-1);
        if (failure) registry.retry(failure.instanceId);
      }, decide: async (request) => choose(request, candidates(request)[0]!.action) }));
    expect(result.code).toBe('read_attempt_budget_exhausted');
    expect(execute).toHaveBeenCalledOnce();
    expect(result.budgets.readAttempts).toBe(1);
  });

  it.each([['A', 'A'], ['A', 'B', 'A']])('detects cursor cycles across rounds: %j', async (...tokens) => {
    let seeded = false;
    let page = 0;
    const result = await runReadController(options({ discover: ({ registry }) => {
      if (!seeded) { seed(registry); seeded = true; }
      const last = registry.evidence().at(-1);
      if (last?.pagination?.hasMore) registry.continue(last.instanceId);
    }, decide: async (request) => choose(request, candidates(request)[0]!.action),
    executeRead: async () => normalizeGmailSearchPage(gmailPage(`message-${page}`, tokens[page++] as string, page > 1), view([])) }));
    expect(result).toMatchObject({ status: 'clarify', code: 'cursor_cycle' });
    expect(result.budgets.readAttempts).toBe(tokens.length);
    expect(result.coverage[0]).toMatchObject({ upstreamStatus: 'partial', pagination: 'blocked' });
  });

  it.each(['observed', 'complete'] as const)('preserves partial history after terminal page for %s requirements', async (level) => {
    let seeded = false;
    let page = 0;
    const result = await runReadController(options({ requirements: [{ coverageKey: 'query', level }],
      discover: ({ registry }) => {
        if (!seeded) { seed(registry); seeded = true; }
        const last = registry.evidence().at(-1);
        if (last?.pagination?.hasMore) registry.continue(last.instanceId);
      }, decide: async (request) => choose(request, candidates(request)[0]?.action ?? 'finish'),
      executeRead: async () => normalizeGmailSearchPage(gmailPage(`message-${++page}`, page === 1 ? 'next' : undefined, page > 1), view([])) }));
    expect(result.status).toBe(level === 'observed' ? 'finished' : 'clarify');
    expect(result.evidence.map((record) => record.upstream?.status)).toEqual(['partial', 'partial']);
    expect(result.coverage[0]).toMatchObject({ upstreamStatus: 'partial', pagination: 'exhausted', observedCount: 2 });
    expect(result.coverage[0]!.exactTotal).toBeUndefined();
    expect(result.coverage[0]!.limitations).toContain('provider_total_is_estimate');
  });

  it('joins a stable complete traversal only with an explicit host/provider guarantee', async () => {
    let seeded = false;
    let page = 0;
    const result = await runReadController(options({ operations: [{ ...GMAIL_SEARCH_READ, completeOnExhaustion: true }],
      requirements: [{ coverageKey: 'query', level: 'complete' }],
      discover: ({ registry }) => {
        if (!seeded) { seed(registry); seeded = true; }
        const last = registry.evidence().at(-1);
        if (last?.pagination?.hasMore) registry.continue(last.instanceId);
      }, decide: async (request) => choose(request, candidates(request)[0]?.action ?? 'finish'),
      executeRead: async () => normalizeGmailSearchPage(gmailPage(`message-${++page}`, page === 1 ? 'next' : undefined, page > 1), view([])) }));
    expect(result.status).toBe('finished');
    expect(result.coverage[0]).toMatchObject({ upstreamStatus: 'complete', pagination: 'exhausted', exactTotal: 2 });
    expect(result.evidence[1]!.upstream!.status).toBe('partial');
  });

  it('continues an empty filtered Slack cursor page through the same controller', async () => {
    let seeded = false;
    let page = 0;
    const result = await runReadController(options({ discover: ({ registry }) => {
      if (!seeded) { seed(registry, 'alpha', 'query', slack); seeded = true; }
      const last = registry.evidence().at(-1);
      if (last?.pagination?.hasMore) registry.continue(last.instanceId);
    }, decide: async (request) => choose(request, candidates(request)[0]?.action ?? 'finish'),
    executeRead: async (instance) => {
      const first = ++page === 1;
      if (!first) expect(instance.params.cursor).toBe('private-slack-cursor');
      return normalizeSlackCursorSearchPage({ matches: first ? [] : [{ text: 'One observed row' }], truncated: first,
        completeness: { status: 'partial', reason: 'provider_limit', observedCount: first ? 0 : 1, hasMore: first },
        ...(first ? { nextCursor: 'private-slack-cursor' } : {}) }, view(first ? [] : ['One observed row']));
    } }));
    expect(result.status).toBe('finished');
    expect(result.evidence).toHaveLength(2);
    expect(result.coverage[0]).toMatchObject({ upstreamStatus: 'partial', observedCount: 1, pagination: 'exhausted' });
  });

  it('does not treat a truncated decision preview as complete evidence', async () => {
    const result = await runReadController(options({ requirements: [{ coverageKey: 'query', level: 'complete' }],
      executeRead: async () => ({ ...success(50), decisionView: { value: ['one preview'], complete: false, omittedRows: 49, omittedFields: ['body'] } }) }));
    expect(result).toMatchObject({ status: 'clarify', code: 'coverage_requirement_not_met' });
    expect(result.coverage[0]).toMatchObject({ upstreamStatus: 'complete', decisionViewComplete: false });
  });

  it('bounds actual internal provider dispatches, not just evaluate() phases', async () => {
    let sends = 0;
    const execute = vi.fn(async () => success());
    const result = await runReadController(options({ providerBudget: { enforcement: 'dispatch-guard', maxCalls: 2, maxRequestBytes: 1000 },
      executeRead: execute, decide: async (request, callback) => {
        for (let batch = 0; batch < 3; batch++) await callback.budget.dispatch(100, callback.signal, async () => { sends++; });
        return choose(request, 'read');
      } }));
    expect(result).toMatchObject({ status: 'clarify', code: 'provider_call_budget_exhausted' });
    expect(sends).toBe(2);
    expect(result.budgets).toMatchObject({ decisionPhases: 1, providerDispatches: 2, providerRequestBytes: 200 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a provider request-byte reservation before send', async () => {
    const send = vi.fn(async () => ({}));
    const result = await runReadController(options({ providerBudget: { enforcement: 'dispatch-guard', maxCalls: 2, maxRequestBytes: 99 },
      decide: async (request, callback) => { await callback.budget.dispatch(100, callback.signal, send); return choose(request, 'read'); } }));
    expect(result.code).toBe('provider_byte_budget_exhausted');
    expect(send).not.toHaveBeenCalled();
    expect(result.budgets.providerDispatches).toBe(0);
  });

  it('shares the real guarded provider cap across evaluator and connector fan-out', async () => {
    const sends: string[] = [];
    const result = await runReadController(options({ providerBudget: { enforcement: 'dispatch-guard', maxCalls: 2, maxRequestBytes: 1000 },
      decide: (packet, callback) => callback.budget.dispatch(10, callback.signal, async () => { sends.push('jev'); return choose(packet, 'read'); }),
      executeRead: async (_instance, callback) => {
        for (let fanout = 0; fanout < 2; fanout++) await callback.budget.dispatch(10, callback.signal, async () => { sends.push('connector'); });
        return success();
      } }));
    expect(result).toMatchObject({ status: 'clarify', code: 'provider_call_budget_exhausted', evidence: [] });
    expect(sends).toEqual(['jev', 'connector']);
    expect(result.budgets).toMatchObject({ decisionPhases: 1, readAttempts: 1, providerDispatches: 2 });
  });

  it('exhausted evaluator budget yields incomplete outcome rather than invented finish', async () => {
    const result = await runReadController(options({ limits: { maxDecisionPhases: 1 } }));
    expect(result).toMatchObject({ status: 'clarify', code: 'decision_phase_budget_exhausted' });
    expect(result.evidence).toHaveLength(1);
    expect(result.localResults).toBeUndefined();
  });

  it('refuses packet overflow before any decision or read', async () => {
    const decide = vi.fn(async (request: DecisionEvaluationRequest) => choose(request, 'read'));
    const execute = vi.fn(async () => success());
    const result = await runReadController(options({ limits: { maxDecisionPacketBytes: 100 }, decide, executeRead: execute }));
    expect(result.code).toBe('decision_packet_budget_exceeded');
    expect(decide).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it('rejects an over-budget authoritative request without prefixing it', async () => {
    const request = createAuthoritativeRequestAnchor('a'.repeat(8193), { workspaceSessionId: context.workspaceSessionId,
      catalogRevision: context.catalogRevision }, { maxUtf8Bytes: 9000 });
    const decide = vi.fn(async (packet: DecisionEvaluationRequest) => choose(packet, 'read'));
    const result = await runReadController(options({ request, decide }));
    expect(result.code).toBe('request_utf8_budget_exceeded');
    expect(decide).not.toHaveBeenCalled();
    expect(result.budgets.readAttempts).toBe(0);
  });

  it('cancels a parallel joined batch promptly; queued and late results never publish', async () => {
    const abort = new AbortController();
    const gates = [defer<ReadExecutionResult>(), defer<ReadExecutionResult>()];
    const started = defer<void>();
    let calls = 0;
    let heldRegistry!: ReadRegistry;
    const running = runReadController(options({ signal: abort.signal, limits: { maxConcurrentReads: 2 },
      request: anchor('Inspect "alpha", "beta" and "gamma"'),
      discover: ({ registry }) => { heldRegistry = registry; seed(registry, 'alpha'); seed(registry, 'beta'); seed(registry, 'gamma'); },
      executeRead: async () => { const index = calls++; if (calls === 2) started.resolve(); return gates[index]!.promise; } }));
    await started.promise;
    abort.abort();
    const result = await running;
    expect(result.status).toBe('cancelled'); expect(result.evidence).toEqual([]); expect(calls).toBe(2);
    gates.forEach((gate) => gate.resolve(normalizeGmailSearchPage(gmailPage('late-private-id'), view([]))));
    await new Promise((done) => setTimeout(done, 0));
    expect(calls).toBe(2);
    expect(() => heldRegistry.observedRefs()).toThrow('registry_disposed');
  });

  it('cancels during Jev without waiting for or executing a late choice', async () => {
    const abort = new AbortController();
    const gate = defer<DecisionEvaluationResult>();
    const entered = defer<DecisionEvaluationRequest>();
    const execute = vi.fn(async () => success());
    const running = runReadController(options({ signal: abort.signal, executeRead: execute,
      decide: (packet) => { entered.resolve(packet); return gate.promise; } }));
    const packet = await entered.promise;
    abort.abort();
    expect((await running).status).toBe('cancelled');
    gate.resolve(choose(packet, 'read'));
    await new Promise((done) => setTimeout(done, 0));
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancellation between policy check and connector dispatch performs no read', async () => {
    const abort = new AbortController();
    const execute = vi.fn(async () => success());
    const result = await runReadController(options({ signal: abort.signal, executeRead: execute,
      authorize: async () => { abort.abort(); return { allowed: true, catalogRevision: context.catalogRevision, contextRevision: context.contextRevision }; } }));
    expect(result.status).toBe('cancelled'); expect(execute).not.toHaveBeenCalled();
  });

  it('the task deadline owns and cancels a hanging evaluator', async () => {
    const execute = vi.fn(async () => success());
    const result = await runReadController(options({ limits: { deadlineMs: 5 }, executeRead: execute,
      decide: async () => new Promise<DecisionEvaluationResult>(() => undefined) }));
    expect(result).toMatchObject({ status: 'cancelled', code: 'deadline_exceeded' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('caller mutation cannot relax in-flight coverage requirements', async () => {
    const requirements: ReadControllerOptions['requirements'] = [{ coverageKey: 'query', level: 'complete' }];
    const result = await runReadController(options({ requirements, executeRead: async () => {
      (requirements[0] as { level: string }).level = 'observed';
      return { ...success(), upstream: { status: 'partial', hasMore: false, observedCount: 1 } };
    } }));
    expect(result).toMatchObject({ status: 'clarify', code: 'coverage_requirement_not_met' });
  });

  it('rejects duplicate effective reads in a batch before any connector dispatch', async () => {
    const execute = vi.fn(async () => success());
    const result = await runReadController(options({ request: anchor('Inspect "alpha" and "alpha"'), executeRead: execute,
      discover: ({ registry }) => {
        seed(registry);
        const start = registry.request.text.lastIndexOf('alpha');
        offerSearchSpan(registry, gmail, GMAIL_SEARCH_READ.operationId, registry.requestSpan(start, start + 5, 'second literal'), 'query');
      } }));
    expect(result).toMatchObject({ status: 'clarify', code: 'duplicate_read_batch' });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('host call/ref registry', () => {
  const registry = (operations: readonly ReadOperation[] = [GMAIL_SEARCH_READ, GMAIL_BODY_READ]) => new ReadRegistry(anchor(), context, operations, 1);
  const observe = (held: ReadRegistry) => {
    const id = seed(held);
    held.begin(id);
    held.commitBatch([{ instanceId: id, result: normalizeGmailSearchPage(gmailPage('actual-host-id'), view([])) }], new AbortController().signal);
    return held.observedRefs().find((ref) => ref.kind === 'EmailMessageRef')!;
  };

  it('refuses fake/stale/cross-source refs before creating body calls', () => {
    const held = registry();
    const ref = observe(held);
    expect(() => offerGmailBody(held, gmail, { ...ref, refId: 'made-up-message-id' }, 'body')).toThrow('unknown_ref');
    expect(() => offerGmailBody(held, gmail, { ...ref, snapshotDigest: 'stale-digest' }, 'body')).toThrow('stale_ref');
    expect(() => offerGmailBody(held, otherGmail, ref, 'body')).toThrow('cross_source_ref');
    expect(held.candidates()).toHaveLength(0);
    expect(ref).toMatchObject({ source: gmail, workspaceSessionId: context.workspaceSessionId, catalogRevision: context.catalogRevision,
      contextRevision: context.contextRevision });
    expect(ref.resultDigest).toBe(held.evidence()[0]!.resultDigest);
    expect(JSON.stringify(ref)).not.toContain('actual-host-id');
  });

  it('keeps repeated operation IDs distinct but successful identical calls ineligible', () => {
    const held = new ReadRegistry(anchor('Inspect "alpha", "beta" and "alpha"'), context, [GMAIL_SEARCH_READ], 1);
    const first = seed(held, 'alpha');
    const second = seed(held, 'beta');
    expect(first).not.toBe(second);
    expect(seed(held, 'alpha')).toBe(first);
    held.begin(first); held.commitBatch([{ instanceId: first, result: success() }], new AbortController().signal);
    expect(seed(held, 'alpha')).toBe(first);
    expect(held.candidates().map((candidate) => candidate.instanceId)).toEqual([second]);
    expect(() => held.begin(first)).toThrow('instance_already_attempted');
    const start = held.request.text.lastIndexOf('alpha');
    const repeated = held.requestSpan(start, start + 5, 'same exact query');
    expect(() => offerSearchSpan(held, gmail, GMAIL_SEARCH_READ.operationId, repeated, 'other')).toThrow('successful_duplicate');
  });

  it.each(['gmail.message.send', 'gmail.draft.create', 'document.pdf.report.generate', 'table.export'])('refuses forbidden operation %s even if mislabeled as read', (operationId) => {
    expect(() => registry([{ ...GMAIL_SEARCH_READ, operationId }])).toThrow('ineligible_read_operation');
  });

  it('refuses HTTP writes and non-read-only external DB registrations', () => {
    expect(() => registry([{ ...GMAIL_SEARCH_READ, backend: 'http', method: 'POST' as 'GET' }])).toThrow('ineligible_read_operation');
    expect(() => registry([{ ...GMAIL_SEARCH_READ, backend: 'external-db' }])).toThrow('ineligible_read_operation');
    const held = registry([{ ...GMAIL_SEARCH_READ, backend: 'external-db', externalDbReadOnly: true }]);
    expect(held.candidates()).toEqual([]);
  });

  it('validates typed params and successful dependencies before offering', () => {
    const held = registry();
    const bad = { operationId: GMAIL_SEARCH_READ.operationId, source: gmail, coverageKey: 'query', label: 'query',
      bindings: { query: { origin: 'host-fixed' as const, value: 42 } } };
    expect(() => held.offer(bad)).toThrow('reference_origin_required');
    expect(() => held.offer({ ...bad, bindings: { query: { origin: 'observed-ref', ref: span(held, 'alpha') },
      limit: { origin: 'host-fixed', value: '20' } } })).toThrow('invalid_parameter');
    const pending = seed(held);
    expect(() => held.offer({ ...bad, dependencies: [pending] })).toThrow('unavailable_dependency');
    expect(() => held.offer({ ...bad, source: { ...gmail, connectionId: 'invented' } })).toThrow('source_scope_denied');
  });

  it('does not offer retries for policy, permission or generic provider failures', () => {
    const held = registry();
    const id = seed(held); held.begin(id);
    held.commitBatch([{ instanceId: id, result: { status: 'failed', kind: 'policy', code: 'body_denied' } }], new AbortController().signal);
    expect(() => held.retry(id)).toThrow('retry_not_eligible');
  });

  it('joins result, refs and coverage atomically or publishes none', () => {
    const held = registry();
    const first = seed(held, 'alpha'); const second = seed(held, 'beta');
    held.begin(first); held.begin(second);
    expect(() => held.commitBatch([{ instanceId: first, result: success() }, { instanceId: second, result: {
      ...success(), pagination: { hasMore: true }, upstream: { status: 'partial', hasMore: true } } }], new AbortController().signal)).toThrow('invalid_atomic_pagination');
    expect(held.evidence()).toEqual([]); expect(held.coverage()).toEqual([]);
    expect(held.observedRefs().every((ref) => ref.kind === 'request-span')).toBe(true);
  });

  it('refuses changing ref kind or raw cursor input through a model selection', () => {
    const held = registry();
    const id = seed(held); held.begin(id);
    held.commitBatch([{ instanceId: id, result: normalizeGmailSearchPage(gmailPage('id', 'cursor'), view([])) }], new AbortController().signal);
    const ref = held.observedRefs().find((entry) => entry.kind === 'paging-token')!;
    expect(() => offerGmailBody(held, gmail, { ...ref, kind: 'EmailMessageRef' }, 'body')).toThrow('wrong_ref_contract');
  });

  it('keeps exact Unicode spans and immutable snapshots', () => {
    const held = new ReadRegistry(anchor('Inspect "가😀"'), context, [GMAIL_SEARCH_READ], 1);
    const start = held.request.text.indexOf('가');
    const ref = held.requestSpan(start, start + 3, 'exact Unicode');
    expect(Object.isFrozen(ref)).toBe(true);
    expect(() => held.requestSpan(start + 1, start + 2, 'split surrogate')).toThrow('invalid_request_span');
    const refs = held.observedRefs();
    expect(Object.isFrozen(refs[0])).toBe(true);
  });

  it('fails closed on Slack page-number fallback and mismatched paging metadata', () => {
    expect(() => normalizeSlackCursorSearchPage({ matches: [], truncated: true, nextPage: 2,
      completeness: { status: 'partial', hasMore: true } }, view())).toThrow('slack_page_mode_not_supported');
    expect(() => normalizeGmailSearchPage({ hits: [], messages: [], truncated: true,
      completeness: { status: 'partial', hasMore: true } }, view())).toThrow('invalid_atomic_pagination');
  });

  it('does not allow bare guessed body values or a cross-query cursor rebind', () => {
    const held = registry();
    const id = seed(held); held.begin(id);
    held.commitBatch([{ instanceId: id, result: normalizeGmailSearchPage(gmailPage('id', 'cursor'), view([])) }], new AbortController().signal);
    expect(() => held.offer({ operationId: GMAIL_BODY_READ.operationId, source: gmail, coverageKey: 'body', label: 'guessed',
      bindings: { message: { origin: 'host-fixed', value: { connector: 'gmail', kind: 'email', id: 'id' } } } })).toThrow('reference_origin_required');
    const cursor = held.observedRefs().find((entry) => entry.kind === 'paging-token')!;
    expect(() => held.offer({ operationId: GMAIL_SEARCH_READ.operationId, source: gmail, coverageKey: 'beta', label: 'rebound cursor',
      bindings: { query: { origin: 'observed-ref', ref: span(held, 'beta') },
        pageToken: { origin: 'observed-ref', ref: cursor } } })).toThrow('paging_requires_continuation');
  });

  it('does not invent an exact count when upstream omitted count metadata', () => {
    const held = registry(); const id = seed(held); held.begin(id);
    held.commitBatch([{ instanceId: id, result: { ...success(), upstream: { status: 'complete', hasMore: false } } }], new AbortController().signal);
    expect(held.coverage()[0]!.observedCount).toBeUndefined();
    expect(held.coverage()[0]!.exactTotal).toBeUndefined();
  });

  it('cannot promote row/byte-limited pages using a stable provider traversal guarantee', () => {
    const held = registry([{ ...GMAIL_SEARCH_READ, completeOnExhaustion: true }]);
    const id = seed(held); held.begin(id);
    held.commitBatch([{ instanceId: id, result: { ...success(), upstream: { status: 'partial', reason: 'response_byte_limit', hasMore: false, observedCount: 1 },
      pagination: { hasMore: false } } }], new AbortController().signal);
    expect(held.coverage()[0]!.upstreamStatus).toBe('partial');
    expect(held.coverage()[0]!.exactTotal).toBeUndefined();
  });

  it('rejects unsafe count metadata instead of making a rounded exact-total claim', () => {
    const held = registry(); const id = seed(held); held.begin(id);
    expect(() => held.commitBatch([{ instanceId: id, result: success(Number.MAX_SAFE_INTEGER + 1) }], new AbortController().signal)).toThrow('invalid_upstream_coverage');
    expect(held.evidence()).toEqual([]);
  });
});
