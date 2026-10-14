import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../../../../contracts/decision.js';
import { JevDecisionEngine } from '../../../../decision/jev.js';
import { buildJevReadOperationIndex } from '../../../../decision/read-operation-catalog.js';
import { routeChatWithJev } from '../router.js';
import type { JevChatRouterResult } from '../router-contract.js';
import { CodexDecisionEngine, type CodexDecisionCall } from './codex-decision-engine.js';
import { HOLDOUT2_BASIC_CASES, HOLDOUT2_SCALE_CASES, HOLDOUT_BASIC_CASES, HOLDOUT_SCALE_CASES } from './routing-eval.holdout-cases.js';
import { HOLDOUT3_BASIC_CASES, HOLDOUT3_SCALE_CASES } from './routing-eval.holdout3-cases.js';
import { JEV_ROUTING_CASES, JEV_SCALE_ROUTING_CASES, previousOrdersTable, routingMiss, type JevRoutingCase } from './routing-eval.cases.js';
import { SCALE_CONNECTED, SCALE_CONNECTIONS, SCALE_HTTP_ENDPOINTS } from './routing-eval.scale-fixture.js';
import { BASIC_CONNECTIONS } from './routing-eval.workspace.js';

/**
 * Jev vs an LLM (Codex CLI) as the router's decision engine: the same cases, the same router,
 * the same candidate lists. Only `decisionEngine.evaluate` differs. Nothing is read or executed.
 *
 *   AX_LIVE_DECISION_COMPARE=1 AX_COMPARE_ENGINE=jev | codex:<model>:<low|medium|high>
 *   AX_COMPARE_RUN=<n> AX_COMPARE_OUT=<dir> [AX_COMPARE_PART=h2]   (Jev key: JEV_API_KEY or TYPESAFE_API_KEY)
 *
 * Writes <dir>/<engine>-run<n>.json; scripts/decision-compare-report.mjs turns the runs into tables.
 */
const enabled = process.env.AX_LIVE_DECISION_COMPARE === '1';
const engineSpec = process.env.AX_COMPARE_ENGINE?.trim() ?? 'jev';
/** Comma-separated case ids, for a quick check of the harness. */
/**
 * Cases added after the first runs are run as a part of the same run: AX_COMPARE_PART=h2 runs only
 * ids starting with h2 and writes <engine>-run<n>.h2.json (a retry part: h2-retry); h3 likewise.
 */
const part = process.env.AX_COMPARE_PART?.trim() || undefined;
const partPrefix = part?.replace(/-retry$/u, '');
const only = process.env.AX_COMPARE_ONLY?.trim() ? new Set(process.env.AX_COMPARE_ONLY.split(',').map((id) => id.trim())) : undefined;

type Workspace = {
  name: string;
  set: 'main' | 'holdout';
  cases: readonly JevRoutingCase[];
  connections: Parameters<typeof buildJevReadOperationIndex>[0];
  connectedConnectors: readonly string[];
  httpEndpoints: Array<{ id: string; label: string; usable: boolean }>;
};

const basic = { connections: BASIC_CONNECTIONS, connectedConnectors: ['rdb', 'http', 'gmail', 'slack'], httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }] };
const scale = { connections: SCALE_CONNECTIONS as Workspace['connections'], connectedConnectors: SCALE_CONNECTED, httpEndpoints: SCALE_HTTP_ENDPOINTS };
const WORKSPACES: readonly Workspace[] = [
  { name: 'basic', set: 'main', cases: JEV_ROUTING_CASES, ...basic },
  { name: 'scale', set: 'main', cases: JEV_SCALE_ROUTING_CASES, ...scale },
  { name: 'basic', set: 'holdout', cases: HOLDOUT_BASIC_CASES, ...basic },
  { name: 'scale', set: 'holdout', cases: HOLDOUT_SCALE_CASES, ...scale },
  { name: 'basic', set: 'holdout', cases: HOLDOUT2_BASIC_CASES, ...basic },
  { name: 'scale', set: 'holdout', cases: HOLDOUT2_SCALE_CASES, ...scale },
  { name: 'basic', set: 'holdout', cases: HOLDOUT3_BASIC_CASES, ...basic },
  { name: 'scale', set: 'holdout', cases: HOLDOUT3_SCALE_CASES, ...scale },
];

interface CallRecord {
  questions: number;
  requestBytes?: number;
  durationMs: number;
  providerRequests?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  model?: string;
  error?: string;
}

function decided(result: JevChatRouterResult): unknown {
  if (result.kind === 'command') {
    return result.command.name === 'capability.invoke'
      ? { id: result.command.args.id, params: result.command.args.params, tableTransform: result.tableTransform }
      : { command: result.command.name };
  }
  if (result.kind === 'clarify') return { message: result.message.slice(0, 160), chooser: result.presentation?.title };
  if (result.kind === 'fallback') return { reason: result.reason, detail: result.detail };
  return undefined;
}

describe.skipIf(!enabled)('decision engine comparison', () => {
  it(`routes every case with ${engineSpec}`, async () => {
    let calls: CallRecord[] = [];
    let engine: DecisionEngine;
    if (engineSpec === 'jev') {
      const apiKey = (process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY)?.trim();
      expect(apiKey, 'Set JEV_API_KEY or TYPESAFE_API_KEY.').toBeTruthy();
      const jev = new JevDecisionEngine({ apiKey: apiKey!, model: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || undefined });
      engine = {
        async evaluate(request) {
          const startedAt = performance.now();
          const questions = Object.keys(request.questions).length;
          try {
            const response = await jev.evaluate(request);
            calls.push({
              questions, durationMs: performance.now() - startedAt, requestBytes: response.requestBytes,
              providerRequests: response.providerRequestCount, model: response.model,
              inputTokens: response.usage?.inputTokens, outputTokens: response.usage?.outputTokens,
            });
            return response;
          } catch (error) {
            calls.push({ questions, durationMs: performance.now() - startedAt, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
            throw error;
          }
        },
      };
    } else {
      const [, model, effort] = engineSpec.split(':');
      expect(model && ['low', 'medium', 'high'].includes(effort ?? ''), 'AX_COMPARE_ENGINE=codex:<model>:<low|medium|high>').toBeTruthy();
      engine = new CodexDecisionEngine(model!, effort as 'low' | 'medium' | 'high', (call: CodexDecisionCall) => calls.push({
        questions: call.questions, durationMs: call.durationMs, requestBytes: call.promptChars, providerRequests: 1, model,
        inputTokens: call.usage?.inputTokens, cachedInputTokens: call.usage?.cachedInputTokens,
        outputTokens: call.usage?.outputTokens, reasoningTokens: call.usage?.reasoningTokens,
        ...(call.error ? { error: call.error } : {}),
      }));
    }

    const outcomes: Array<Record<string, unknown>> = [];
    for (const workspace of WORKSPACES) {
      const index = buildJevReadOperationIndex(workspace.connections);
      for (const testCase of workspace.cases) {
        if (only && !only.has(testCase.id)) continue;
        if (partPrefix ? !testCase.id.startsWith(partPrefix) : /^h[23]/u.test(testCase.id)) continue;
        calls = [];
        const selection = index.select(testCase.message);
        const startedAt = performance.now();
        let result: JevChatRouterResult | undefined;
        let miss: string | undefined;
        try {
          result = await routeChatWithJev({
            decisionEngine: engine,
            userMessage: testCase.message,
            hasWorkspaceSession: true,
            connectedConnectors: workspace.connectedConnectors,
            httpEndpoints: workspace.httpEndpoints,
            readOperationHints: selection.hints,
            readOperationCatalogSize: selection.totalCount,
            readOperationCatalogMayBeBounded: selection.catalogMayBeBounded,
            readOperationSelectionMode: selection.mode,
            readOperationLexicalMatchedOperationCount: selection.lexicalMatchedOperationCount,
            readOperationLexicalTopScore: selection.lexicalTopScore,
            ...(testCase.previous ? { previousReadResult: previousOrdersTable() } : {}),
            ...(testCase.pastChoices ? { pastSourceChoices: testCase.pastChoices } : {}),
          });
          miss = routingMiss(testCase, result);
        } catch (error) {
          miss = `threw ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
        }
        const outcome = {
          set: workspace.set, workspace: workspace.name, id: testCase.id, message: testCase.message,
          expected: testCase.expect, passed: !miss, ...(miss ? { miss } : {}),
          kind: result?.kind, route: result && 'route' in result ? result.route : undefined,
          serviceError: result?.kind === 'fallback' && result.reason === 'service_error',
          decided: result ? decided(result) : undefined,
          durationMs: Math.round(performance.now() - startedAt),
          calls,
        };
        outcomes.push(outcome);
        console.info(`[compare:${engineSpec}] ${workspace.set}/${workspace.name} ${testCase.id} ${miss ? `MISS ${miss}` : 'ok'} ${outcome.durationMs}ms calls=${calls.length}`);
      }
    }

    const out = process.env.AX_COMPARE_OUT?.trim();
    if (out) {
      mkdirSync(out, { recursive: true });
      const file = join(out, `${engineSpec.replace(/[:]/g, '_')}-run${process.env.AX_COMPARE_RUN ?? '1'}${part ? `.${part}` : ''}.json`);
      writeFileSync(file, JSON.stringify({ engine: engineSpec, at: new Date().toISOString(), outcomes }, null, 2));
    }
    expect(outcomes.length).toBeGreaterThan(0);
  }, 6 * 60 * 60_000);
});

/**
 * The fixed cost of one decision call, apart from the request: one boolean question about one
 * sentence, five times (AX_COMPARE_OVERHEAD=1, same engine and output settings as above).
 */
describe.skipIf(!enabled || process.env.AX_COMPARE_OVERHEAD !== '1')('decision engine fixed overhead', () => {
  it(`answers a one-sentence question with ${engineSpec}`, async () => {
    const records: CallRecord[] = [];
    const request = {
      state: { request: '안녕' },
      questions: { greeting: { type: 'boolean' as const, instructions: 'The request is a greeting.' } },
    };
    for (let index = 0; index < 5; index += 1) {
      const startedAt = performance.now();
      if (engineSpec === 'jev') {
        const jev = new JevDecisionEngine({ apiKey: (process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY)!.trim() });
        const response = await jev.evaluate(request);
        records.push({ questions: 1, durationMs: performance.now() - startedAt, inputTokens: response.usage?.inputTokens, outputTokens: response.usage?.outputTokens, model: response.model });
      } else {
        const [, model, effort] = engineSpec.split(':');
        let call: CodexDecisionCall | undefined;
        await new CodexDecisionEngine(model!, effort as 'low', (reported) => { call = reported; }).evaluate(request);
        records.push({ questions: 1, durationMs: call!.durationMs, inputTokens: call!.usage?.inputTokens, cachedInputTokens: call!.usage?.cachedInputTokens, outputTokens: call!.usage?.outputTokens, reasoningTokens: call!.usage?.reasoningTokens, model });
      }
    }
    const out = process.env.AX_COMPARE_OUT?.trim();
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `overhead-${engineSpec.replace(/[:]/g, '_')}.json`), JSON.stringify({ engine: engineSpec, records }, null, 2));
    }
    expect(records).toHaveLength(5);
  }, 30 * 60_000);
});
