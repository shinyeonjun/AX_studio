import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../../../../../contracts/decision.js';
import { JevDecisionEngine } from '../../../../../decision/jev.js';
import { buildJevReadOperationIndex } from '../../../../../decision/read-operation-catalog.js';
import { routeChatWithJev } from '../router.js';
import { JEV_ROUTING_CASES, JEV_SCALE_ROUTING_CASES, previousOrdersTable, routingMiss, type JevRoutingCase } from './routing-eval.cases.js';
import { SCALE_CONNECTED, SCALE_CONNECTIONS, SCALE_HTTP_ENDPOINTS } from './routing-eval.scale-fixture.js';

const liveEvalEnabled = process.env.AX_LIVE_JEV_EVAL === '1';
const MIN_ACCURACY = Number(process.env.AX_JEV_EVAL_MIN_ACCURACY ?? '0.85');

/** Synthetic sources shaped like the dogfood workspace: a shop DB, a product API, Gmail and Slack. */
const CONNECTIONS = [
  {
    connector: 'rdb',
    connected: true,
    config: {
      type: 'sqlite',
      label: '쇼핑몰 DB',
      allowedTables: ['orders', 'customers', 'products'],
      schema: {
        tables: [
          { table: 'orders', columns: ['id', 'customer_id', 'product_code', 'amount', 'status', 'ordered_at'], uniqueColumns: ['id'] },
          { table: 'customers', columns: ['id', 'name', 'region'], uniqueColumns: ['id'] },
          { table: 'products', columns: ['code', 'name', 'category', 'price'], uniqueColumns: ['code'] },
        ],
        relations: [
          { from: { table: 'orders', column: 'customer_id' }, to: { table: 'customers', column: 'id' }, declared: true },
          { from: { table: 'orders', column: 'product_code' }, to: { table: 'products', column: 'code' }, declared: true },
        ],
      },
    },
  },
  {
    connector: 'http',
    connected: true,
    config: { endpoints: [{
      id: 'dummyjson', baseUrl: 'https://dummyjson.com/', label: 'DummyJSON', authType: 'none',
      discoveredReadOperations: [{ path: 'products', label: 'Products' }, { path: 'carts', label: 'Carts' }, { path: 'users', label: 'Users' }],
    }] },
  },
  { connector: 'gmail', connected: true, config: {} },
  { connector: 'slack', connected: true, config: {} },
];

interface EvalWorkspace {
  name: string;
  cases: readonly JevRoutingCase[];
  connections: Parameters<typeof buildJevReadOperationIndex>[0];
  connectedConnectors: readonly string[];
  httpEndpoints: Array<{ id: string; label: string; usable: boolean }>;
}

const WORKSPACES: readonly EvalWorkspace[] = [
  { name: 'basic', cases: JEV_ROUTING_CASES, connections: CONNECTIONS, connectedConnectors: ['rdb', 'http', 'gmail', 'slack'],
    httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }] },
  { name: 'scale', cases: JEV_SCALE_ROUTING_CASES, connections: SCALE_CONNECTIONS as EvalWorkspace['connections'],
    connectedConnectors: SCALE_CONNECTED, httpEndpoints: SCALE_HTTP_ENDPOINTS },
];

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

// Run with AX_LIVE_JEV_EVAL=1 and TYPESAFE_API_KEY set. Only synthetic metadata is sent to Jev;
// nothing is read or executed. AX_JEV_EVAL_REPORT=<path> writes every case's outcome as JSON
// (one file per workspace: <path> becomes <name>-<file>).
describe.skipIf(!liveEvalEnabled)('Jev routing evaluation set', () => {
  for (const workspace of WORKSPACES) {
    it(`[${workspace.name}] routes at least ${Math.round(MIN_ACCURACY * 100)}% of the cases where people expect`, async () => {
      const apiKey = process.env.TYPESAFE_API_KEY?.trim();
      expect(apiKey, 'Set TYPESAFE_API_KEY to run the live Jev evaluation.').toBeTruthy();
      const jev = new JevDecisionEngine({
        apiKey: apiKey!,
        model: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || undefined,
        baseURL: process.env.TYPESAFE_BASE_URL?.trim() || undefined,
      });
      // What Jev answered to the route question, so a miss shows its choice and how sure it was.
      let routeAnswer: unknown;
      let serviceError: string | undefined;
      let selectedTools: string[] = [];
      const models = new Set<string>();
      const decisionEngine: DecisionEngine = {
        async evaluate(request) {
          try {
            const response = await jev.evaluate(request);
            if (response.model) models.add(response.model);
            if (request.questions.route) routeAnswer = response.answers.route;
            // Which candidates the first pass judged necessary (tool_N answered true).
            for (const [id, question] of Object.entries(request.questions)) {
              const answer = response.answers[id];
              const candidate = (question.instructions as { candidate?: { id?: string; label?: string } } | undefined)?.candidate;
              if (/^tool_\d+$/u.test(id) && candidate && answer?.type === 'boolean' && answer.probability > 0.5) {
                selectedTools.push(`${candidate.label ?? candidate.id} (${answer.probability.toFixed(2)})`);
              }
            }
            return response;
          } catch (error) {
            // The router turns provider failures into a fallback; keep why for the report.
            const status = (error as { status?: unknown } | null)?.status;
            serviceError = `${status ?? ''} ${error instanceof Error ? error.message : String(error)}`.trim().slice(0, 300);
            throw error;
          }
        },
      };
      const index = buildJevReadOperationIndex(workspace.connections);
      const outcomes: Array<Record<string, unknown> & { id: string; passed: boolean; durationMs: number; requestKb?: number; evaluationCalls?: number; miss?: string; selectedRoute?: string; chose?: unknown; serviceError?: string; selectedTools?: string[] }> = [];
      for (const testCase of workspace.cases) {
        const selection = index.select(testCase.message);
        const startedAt = performance.now();
        let miss: string | undefined;
        let kind: string | undefined;
        let selectedRoute: string | undefined;
        let telemetry: Record<string, unknown> | undefined;
        let chose: unknown;
        routeAnswer = undefined;
        serviceError = undefined;
        selectedTools = [];
        try {
          const result = await routeChatWithJev({
            decisionEngine,
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
          kind = result.kind;
          selectedRoute = result.telemetry?.selectedRoute;
          const t = result.telemetry;
          telemetry = t ? {
            requestKb: Math.round((t.estimatedRequestBytes + (t.planningEstimatedRequestBytes ?? 0)) / 1024),
            evaluationCalls: (t.evaluationCalls ?? 0) + (t.planningCalls ?? 0),
            providerRequests: (t.providerRequestCount ?? 0) + (t.planningProviderRequestCount ?? 0),
            inputTokens: (t.inputTokens ?? 0) + (t.planningInputTokens ?? 0),
            operationCandidates: t.operationCandidateCount,
          } : undefined;
          miss = routingMiss(testCase, result);
          chose = result.kind === 'command' && result.command.name === 'capability.invoke'
            ? { id: result.command.args.id, params: result.command.args.params, tableTransform: result.tableTransform }
            : result.kind === 'clarify' ? { message: result.message.slice(0, 200), chooser: result.presentation?.title }
              : result.kind === 'fallback' ? { reason: result.reason, detail: result.detail } : undefined;
        } catch (error) {
          miss = `threw ${error instanceof Error ? error.message : String(error)}`;
        }
        outcomes.push({
          id: testCase.id, message: testCase.message, kind, passed: !miss,
          ...(miss ? { miss, selectedRoute, routeAnswer, chose, serviceError, selectedTools } : {}),
          durationMs: Math.round(performance.now() - startedAt), ...telemetry,
        });
      }
      const passed = outcomes.filter((outcome) => outcome.passed).length;
      const accuracy = passed / outcomes.length;
      const durations = outcomes.map((outcome) => outcome.durationMs);
      const requestKb = outcomes.map((outcome) => Number(outcome.requestKb ?? 0));
      const summary = {
        workspace: workspace.name, models: [...models], passed, total: outcomes.length, accuracy,
        catalogSize: index.select('').totalCount,
        durationMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95) },
        requestKb: { p50: percentile(requestKb, 0.5), max: Math.max(...requestKb) },
      };
      console.table(outcomes.map(({ id, passed: ok, miss, durationMs, requestKb: kb, evaluationCalls }) => ({ id, ok, miss: miss ?? '', durationMs, kb, calls: evaluationCalls })));
      console.info(`[jev-eval:${workspace.name}] ${passed}/${outcomes.length} (${Math.round(accuracy * 100)}%) ${JSON.stringify(summary)}`);
      for (const outcome of outcomes.filter((entry) => !entry.passed)) {
        console.info(`[jev-eval:${workspace.name}] miss ${outcome.id}: ${JSON.stringify({ selectedRoute: outcome.selectedRoute, chose: outcome.chose, serviceError: outcome.serviceError, selectedTools: outcome.selectedTools })}`);
      }
      const reportPath = process.env.AX_JEV_EVAL_REPORT?.trim();
      if (reportPath) {
        const path = join(dirname(reportPath), `${workspace.name}-${basename(reportPath)}`);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...summary, outcomes }, null, 2));
      }
      expect(accuracy).toBeGreaterThanOrEqual(MIN_ACCURACY);
    }, 20 * 60_000);
  }
});
