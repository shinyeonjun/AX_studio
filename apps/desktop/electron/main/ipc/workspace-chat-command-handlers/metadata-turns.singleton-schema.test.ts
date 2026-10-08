import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ArtifactStore, AxCommandService, createDatabaseAsync, WorkflowStore, WorkspaceSourceService, WorkflowRuntime,
  type WorkspaceChatMessage, type WorkspaceChatRecord, type SourceMetadataEvidence, type RequestUnderstandingResult,
} from '@ax-studio/core';
import { singletonSchemaFixture as frozen } from '../../../../../../packages/core/src/intelligence/agent/commands/chat/request-understanding.singleton-schema.fixture.js';
import { registerWorkspaceChatMessageHandler } from './chat.js';
import { registerWorkspaceChatPersistenceHandlers } from '../workspace-chat-persistence-handlers.js';
import { registerWorkspaceChatControlHandlers } from './controls.js';
import { abortAllWorkspaceChats } from '../../workspace-chat-registry.js';
import { installRegisteredHttpMetadataOffline } from './metadata-turns.js';

const ipc = vi.hoisted(() => {
  const frame = { url: 'app://singleton-schema-fixture' };
  return { frame, handlers: new Map<string, (...args: any[]) => Promise<any>>(), getCore: vi.fn(), outcomes: [] as unknown[],
    window: { isDestroyed: () => false, webContents: { id: 43 } } };
});
vi.mock('electron', () => ({ app: { isPackaged: true }, ipcMain: {
  removeHandler: (channel: string) => ipc.handlers.delete(channel),
  handle: (channel: string, handler: (...args: any[]) => Promise<any>) => ipc.handlers.set(channel, handler),
} }));
vi.mock('../../app-window.js', () => ({ getMainWindow: () => ipc.window, isTrustedRendererUrl: (url: string) => url === ipc.frame.url }));
vi.mock('../../core-instance.js', () => ({ getCore: ipc.getCore }));
// Observation only: run the actual chat/reader and preserve its original currentness callback.
vi.mock('@ax-studio/core', async importOriginal => {
  const core = await importOriginal<typeof import('@ax-studio/core')>();
  return { ...core, runAxCommandChat: (input: Parameters<typeof core.runAxCommandChat>[0]) => core.runAxCommandChat({ ...input,
    requestUnderstanding: input.requestUnderstanding && { ...input.requestUnderstanding, onResult: result => {
      input.requestUnderstanding!.onResult?.(result); ipc.outcomes.push(result);
    } },
  }) };
});

interface WireRequest { questions: Record<string, unknown> }
interface Options {
  flag?: boolean; initial?: Record<string, unknown>; operationBody?: unknown; operationStatus?: number;
  malformedJson?: boolean; transportFailure?: boolean; missingDictionary?: boolean;
  delayOperation?: () => Promise<void>;
}
const selected = (choice: string, probabilities = { [choice]: 1 }) => ({ type: 'choice', choice, probabilities });
const resources: Array<{ close: () => void; idle: () => Promise<void> }> = [];
const pending = new Set<Promise<unknown>>();
const releases: Array<() => void> = [];
const observations: Array<Record<string, unknown>> = [];
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(done => { release = done; });
  releases.push(release);
  return { promise, release };
}

async function fixture(options: Options = {}) {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  store.setConnection('http', true, { endpoints: [{ id: 'orders', label: frozen.label,
    baseUrl: 'https://synthetic.invalid', authType: 'none', discoveredReadOperations: [{ path: 'orders', label: 'Orders' }] }] });
  if (!options.missingDictionary) store.upsertDiscoveryMetadata({ assetId: frozen.sourceId, aliases: [], fields: frozen.fields.map(field => ({ ...field })) });
  const forbidden = vi.fn(async () => { throw new Error('Forbidden offline network/connector/body/queue/prose call'); });
  const commandService = new AxCommandService(store, { readGateway: { execute: forbidden }, resolveConnectionConfig: forbidden,
    enqueueOnce: forbidden, runWorkflow: forbidden, removeWorkflow: forbidden });
  const execute = vi.spyOn(commandService, 'execute');
  const root = resolve(process.env.AX_DATA_ROOT ?? '../../build-evidence/singleton-schema/scratch-desktop');
  const sources = new WorkspaceSourceService(store, new ArtifactStore(join(root, 'artifacts')), join(root, 'sessions'));
  const runtime = new WorkflowRuntime({ store, connectors: {}, globalActive: false, });
  await sources.waitForIdle();
  resources.push({ close: () => db.close?.(), idle: async () => {
    runtime.stopAccepting(); await Promise.all([sources.waitForIdle(), runtime.waitForIdle()]);
  } });
  const event = { sender: { id: 43, mainFrame: ipc.frame, send: vi.fn() }, senderFrame: ipc.frame };
  ipc.getCore.mockReturnValue({ store, runtime, workspaceSources: sources, commandService,
    agentHarness: { providerName: 'offline-prose', modelName: 'fixture-model', runText: forbidden },
    decisionEngine: { evaluate: forbidden } });
  registerWorkspaceChatPersistenceHandlers(); registerWorkspaceChatControlHandlers(); registerWorkspaceChatMessageHandler();
  const requests: WireRequest[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  const evidence: SourceMetadataEvidence[] = [];
  let requestBytes = 0;
  const fetchImpl: typeof fetch = vi.fn(async (url, init) => {
    expect(String(url)).toBe('https://offline.invalid/v1/systemone');
    const request = JSON.parse(String(init?.body)) as WireRequest;
    requests.push(request); signals.push(init?.signal ?? undefined);
    requestBytes += Buffer.byteLength(String(init?.body), 'utf8');
    if (request.questions.intent) return Response.json({ answers: { intent: selected('schema'),
      targetSourceRef: selected('source_0'), outputKind: selected('not_stated'), ...options.initial } });
    await options.delayOperation?.(); // Intentionally ignores abort; host fences must discard late responses.
    if (options.transportFailure) throw new Error('synthetic transport failure');
    if (options.malformedJson) return new Response('{broken');
    return Response.json(options.operationBody ?? { answers: {} }, { status: options.operationStatus ?? 200 });
  });
  let installedFlag = options.flag;
  const install = (flag = installedFlag) => {
    installedFlag = flag;
    installRegisteredHttpMetadataOffline({ mode: 'offline_test', fetch: fetchImpl,
      ...(flag === undefined ? {} : { singletonSchemaSelectionRecovery: flag }), onApprovedEvidence: approved => evidence.push(approved) });
  };
  install(); vi.stubGlobal('fetch', forbidden);
  const invoke = (channel: string, ...args: unknown[]) => ipc.handlers.get(channel)!(event, ...args);
  const save = (messages: WorkspaceChatMessage[], before?: WorkspaceChatRecord) => invoke('ax:saveWorkspaceChat', before?.id, messages,
    undefined, { ...(before?.transcriptRevision ? { expectedTranscriptRevision: before.transcriptRevision } : {}), metadataLane: 'registered_http_metadata' }) as Promise<WorkspaceChatRecord>;
  const start = async (text: string = frozen.paraphrases[0].text, turnId = 'schema-turn', before?: WorkspaceChatRecord) => {
    const saved = await save([...(before?.messages ?? []), { role: 'user', content: text, turnId }], before);
    const baseline = { calls: requests.length, bytes: requestBytes, reads: execute.mock.calls.length, evidence: evidence.length, outcomes: ipc.outcomes.length };
    const flag = installedFlag ?? 'absent';
    const began = performance.now();
    const promise = invoke('ax:sendCommandChat', text, turnId, undefined, saved.id, { metadataLane: 'registered_http_metadata' }).then(reply => {
      observations.push({ case: expect.getState().currentTestName, flag, turnId, stop: reply.metadataStop,
        taskCompleted: reply.metadataStop === 'answered' && Boolean(reply.persistedReply),
        scriptedFetches: requests.length - baseline.calls, requestBytes: requestBytes - baseline.bytes,
        metadataServiceAttempts: execute.mock.calls.length - baseline.reads, approvedEvidence: evidence.length - baseline.evidence,
        readerResults: ipc.outcomes.slice(baseline.outcomes), forbiddenCalls: forbidden.mock.calls.length, elapsedMs: performance.now() - began });
      return reply;
    });
    pending.add(promise); promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return { saved, pending: promise };
  };
  return { store, execute, event, invoke, save, start, requests, signals, evidence, forbidden, install,
    outcome: () => ipc.outcomes.at(-1) as RequestUnderstandingResult | undefined };
}

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  abortAllWorkspaceChats(); installRegisteredHttpMetadataOffline();
  await Promise.allSettled([...pending]);
  for (const resource of resources.splice(0)) { await resource.idle(); resource.close(); }
  ipc.outcomes.length = 0;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
afterAll(() => {
  if (!process.env.AX_SINGLETON_SCHEMA_EVIDENCE_DIR) return;
  const root = resolve(process.env.AX_SINGLETON_SCHEMA_EVIDENCE_DIR);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'ipc-schema-observations.json'), JSON.stringify({ fixtureKind: 'synthetic_scripted_offline_integration',
    liveProviderCalls: 0, episodes: observations.length, completions: observations.filter(row => row.taskCompleted).length,
    noncompletions: observations.filter(row => !row.taskCompleted).length, observations }, null, 2));
});

function noRead(f: Awaited<ReturnType<typeof fixture>>, stop: string, phases = 2) {
  expect(f.outcome()).toMatchObject({ stop, evaluationPhases: phases, metadataReadAttempts: 0 });
  expect(f.outcome()?.metadataOperationResolution).toBeUndefined();
  expect(f.execute).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(phases);
  expect(f.evidence).toEqual([]); expect(f.forbidden).not.toHaveBeenCalled();
}

describe('singleton schema recovery through real trusted IPC/store/service/adapter', () => {
  it.each(frozen.paraphrases)('$id pairs the same two guarded evaluations off/on', async ({ text }) => {
    for (const flag of [false, true]) {
      const f = await fixture({ flag }); const { saved, pending } = await f.start(text); const reply = await pending;
      if (!flag) { expect(reply.metadataStop).toBe('provider_failure'); noRead(f, 'provider_failure'); continue; }
      expect(reply).toMatchObject({ metadataStop: 'answered', persistedReply: { sessionId: saved.id, turnId: 'schema-turn' } });
      for (const fact of ['orderId', 'string', 'quantity', '저장된 항목 구성', '알 수 없음']) expect(reply.content).toContain(fact);
      expect(f.evidence[0]).toMatchObject({ sourceId: frozen.sourceId, intent: 'schema', scope: frozen.expectedScope, knownTotal: 2, truncated: false });
      expect(f.evidence[0]?.entries.map(entry => entry.fields?.[0])).toEqual(frozen.fields);
      expect(f.store.getWorkspaceChat(saved.id)?.messages.at(-1)?.content).toBe(reply.content);
      expect(f.outcome()).toMatchObject({ metadataReadAttempts: 1, evaluationPhases: 2,
        metadataOperationResolution: { producer: 'host_singleton', cause: 'missing_metadata_operation_answer' } });
      expect(f.execute).toHaveBeenCalledOnce(); expect(f.requests).toHaveLength(2); expect(f.forbidden).not.toHaveBeenCalled();
      expect(f.execute.mock.calls[0]![1]?.metadataDispatchPermit).toMatchObject({ sourceId: frozen.sourceId, operationId: 'http:orders:schema' });
    }
  });

  it('absent flag retains omission; a normal answered selection remains unchanged off/on', async () => {
    const absent = await fixture(); expect((await (await absent.start()).pending).metadataStop).toBe('provider_failure'); noRead(absent, 'provider_failure');
    for (const flag of [false, true]) {
      const f = await fixture({ flag, operationBody: { answers: { metadataOperationRef: selected('metadata_0') } } });
      expect((await (await f.start()).pending).metadataStop).toBe('answered');
      expect(f.outcome()?.metadataOperationResolution).toBeUndefined(); expect(f.requests).toHaveLength(2); expect(f.execute).toHaveBeenCalledOnce();
      expect(f.forbidden).not.toHaveBeenCalled();
    }
  });

  it.each([
    { id: 'wrong_question', options: { operationBody: { answers: { wrong_question: selected('metadata_0') } } }, stop: 'provider_failure' },
    { id: 'provider_error_with_http_200', options: { operationBody: { answers: {}, error: { type: 'permission_denied' } } }, stop: 'provider_failure' },
    { id: 'missing_container', options: { operationBody: {} }, stop: 'provider_failure' },
    { id: 'array_container', options: { operationBody: { answers: [] } }, stop: 'provider_failure' },
    { id: 'malformed_answer', options: { operationBody: { answers: { metadataOperationRef: { type: 'choice' } } } }, stop: 'provider_failure' },
    { id: 'malformed_envelope', options: { operationBody: { answers: {}, usage: { input_tokens: 'bad' } } }, stop: 'provider_failure' },
    { id: 'malformed_json', options: { malformedJson: true }, stop: 'provider_failure' },
    // A refused request (400); a 503 is retried by the Jev engine before it fails.
    { id: 'http_failure', options: { operationStatus: 400 }, stop: 'provider_failure' },
    { id: 'transport_failure', options: { transportFailure: true }, stop: 'provider_failure' },
    { id: 'tie', options: { operationBody: { answers: { metadataOperationRef: selected('metadata_0', { metadata_0: 0.5, unknown: 0.5 }) } } }, stop: 'invalid_decision' },
    { id: 'none', options: { operationBody: { answers: { metadataOperationRef: selected('none') } } }, stop: 'metadata_unavailable' },
    { id: 'unknown', options: { operationBody: { answers: { metadataOperationRef: selected('unknown') } } }, stop: 'metadata_unavailable' },
    { id: 'unsupported', options: { operationBody: { answers: { metadataOperationRef: selected('unsupported') } } }, stop: 'unsupported_operation' },
  ])('$id retains its original stop off/on, with no dispatch', async ({ options, stop }) => {
    for (const flag of [false, true]) {
      const f = await fixture({ ...options, flag }); expect((await (await f.start()).pending).metadataStop).toBe(stop); noRead(f, stop);
    }
  });

  it.each([
    { id: 'goal_absent', text: 'OrdersAPI', initial: { intent: selected('ambiguous') }, stop: 'ambiguous_intent' },
    { id: 'target_absent', text: '필드 알려줘', initial: { targetSourceRef: selected('none') }, stop: 'source_required' },
    { id: 'unresolved_pronoun', text: '그거 필드 알려줘', initial: { targetSourceRef: selected('ambiguous') }, stop: 'source_ambiguous' },
    { id: 'unknown_source', text: 'OtherAPI 필드 알려줘', initial: { targetSourceRef: selected('unknown') }, stop: 'candidate_coverage_incomplete' },
    { id: 'unsupported_goal', text: 'OrdersAPI 매출 예측해줘', initial: { intent: selected('unsupported') }, stop: 'unsupported_intent' },
    { id: 'action', text: 'OrdersAPI 주문 삭제해줘', initial: { intent: selected('action') }, stop: 'outside_slice' },
  ])('$id cannot inherit a metadata goal/target from the sole source off/on', async ({ text, initial, stop }) => {
    for (const flag of [false, true]) {
      const f = await fixture({ flag, initial }); expect((await (await f.start(text)).pending).metadataStop).toBe(stop); noRead(f, stop, 1);
    }
  });

  it('missing dictionary remains noncompletion after one charged read on, zero reads off', async () => {
    for (const flag of [false, true]) {
      const f = await fixture({ flag, missingDictionary: true }); const reply = await (await f.start()).pending;
      if (!flag) { expect(reply.metadataStop).toBe('provider_failure'); noRead(f, 'provider_failure'); continue; }
      expect(reply.metadataStop).toBe('metadata_unavailable'); expect(reply.content).toContain('저장된 항목 구성이 없습니다');
      expect(f.outcome()).toMatchObject({ metadataReadAttempts: 1, evaluationPhases: 2,
        metadataOperationResolution: { cause: 'missing_metadata_operation_answer' } });
      expect(f.execute).toHaveBeenCalledOnce(); expect(f.requests).toHaveLength(2); expect(f.evidence).toEqual([]); expect(f.forbidden).not.toHaveBeenCalled();
    }
  });

  it.each(['cancel', 'new_turn', 'connection', 'dictionary', 'policy_off'] as const)('%s fences the delayed clean omission even when transport ignores abort', async mode => {
    for (const flag of [false, true]) {
      const wait = gate(); const f = await fixture({ flag, delayOperation: () => wait.promise });
      const started = await f.start(); await vi.waitFor(() => expect(f.requests).toHaveLength(2));
      if (mode === 'cancel') expect(await f.invoke('ax:cancelChat', 'schema-turn')).toMatchObject({ ok: true });
      if (mode === 'new_turn') await f.save([...started.saved.messages, { role: 'user', content: '아니 취소해', turnId: 'new-turn' }], started.saved);
      if (mode === 'connection') f.store.setConnection('http', false, { endpoints: [] });
      if (mode === 'dictionary') f.store.deleteDiscoveryMetadata(frozen.sourceId);
      if (mode === 'policy_off') f.install(false);
      wait.release(); expect((await started.pending).metadataStop).toBe('cancelled');
      // Store counters are checked on return; explicit lifecycle invalidation aborts during fetch.
      if (mode !== 'connection' && mode !== 'dictionary') expect(f.signals[1]?.aborted).toBe(true);
      expect(f.execute).not.toHaveBeenCalled(); expect(f.evidence).toEqual([]);
      expect(f.store.getWorkspaceChat(started.saved.id)?.messages.filter(message => message.role === 'assistant')).toEqual([]);
      expect(f.forbidden).not.toHaveBeenCalled();
      if (mode === 'policy_off') {
        const fresh = await f.start(frozen.paraphrases[0].text, 'fresh-off');
        expect((await fresh.pending).metadataStop).toBe('provider_failure'); expect(f.execute).not.toHaveBeenCalled();
      }
    }
  });

  it('final real CAS conflict preserves the other writer and does not publish a metadata reply off/on', async () => {
    for (const flag of [false, true]) {
      const f = await fixture({ flag });
      const append = f.store.appendWorkspaceChatMetadataReply.bind(f.store);
      vi.spyOn(f.store, 'appendWorkspaceChatMetadataReply').mockImplementation(input => {
        f.store.upsertWorkspaceChatExecutionResult(input.sessionId, { role: 'assistant', content: 'Independent background result',
          kind: 'execution_result', executionId: 'synthetic-background' });
        return append(input);
      });
      const { saved, pending } = await f.start(); const reply = await pending;
      expect(reply.metadataStop).toBe('conflict'); expect(reply.persistedReply).toBeUndefined();
      expect(f.store.getWorkspaceChat(saved.id)?.messages.filter(message => message.role === 'assistant').map(message => message.content))
        .toEqual(['Independent background result']);
      expect(f.requests).toHaveLength(2); expect(f.execute).toHaveBeenCalledTimes(flag ? 1 : 0);
      // Evidence was valid before the later CAS race; it is not a completed persisted task.
      expect(f.evidence).toHaveLength(flag ? 1 : 0); expect(f.forbidden).not.toHaveBeenCalled();
    }
  });
});
