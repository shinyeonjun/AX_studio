import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import { JevDecisionEngine } from '../../../decision/jev.js';
import { buildJevReadOperationIndex } from '../../../decision/read-operation-catalog.js';
import { routeChatWithJev } from './jev-router.js';
import { JEV_ROUTING_CASES, previousOrdersTable, routingMiss } from './jev-routing-eval.cases.js';

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

// Run with AX_LIVE_JEV_EVAL=1 and TYPESAFE_API_KEY set. Only synthetic metadata is sent to Jev;
// nothing is read or executed. AX_JEV_EVAL_REPORT=<path> writes every case's outcome as JSON.
describe.skipIf(!liveEvalEnabled)('Jev routing evaluation set', () => {
  it(`routes at least ${Math.round(MIN_ACCURACY * 100)}% of the cases where people expect`, async () => {
    const apiKey = process.env.TYPESAFE_API_KEY?.trim();
    expect(apiKey, 'Set TYPESAFE_API_KEY to run the live Jev evaluation.').toBeTruthy();
    const jev = new JevDecisionEngine({
      apiKey: apiKey!,
      model: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || undefined,
      baseURL: process.env.TYPESAFE_BASE_URL?.trim() || undefined,
    });
    // What Jev answered to the route question, so a miss shows its choice and how sure it was.
    let routeAnswer: unknown;
    const decisionEngine: DecisionEngine = {
      async evaluate(request) {
        const response = await jev.evaluate(request);
        if (request.questions.route) routeAnswer = response.answers.route;
        return response;
      },
    };
    const index = buildJevReadOperationIndex(CONNECTIONS);
    const outcomes = [];
    for (const testCase of JEV_ROUTING_CASES) {
      const selection = index.select(testCase.message);
      const startedAt = performance.now();
      let miss: string | undefined;
      let kind: string | undefined;
      let selectedRoute: string | undefined;
      routeAnswer = undefined;
      try {
        const result = await routeChatWithJev({
          decisionEngine,
          userMessage: testCase.message,
          hasWorkspaceSession: true,
          connectedConnectors: ['rdb', 'http', 'gmail', 'slack'],
          httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
          readOperationHints: selection.hints,
          readOperationCatalogSize: selection.totalCount,
          readOperationCatalogMayBeBounded: selection.catalogMayBeBounded,
          readOperationSelectionMode: selection.mode,
          readOperationLexicalMatchedOperationCount: selection.lexicalMatchedOperationCount,
          readOperationLexicalTopScore: selection.lexicalTopScore,
          ...(testCase.previous ? { previousReadResult: previousOrdersTable() } : {}),
        });
        kind = result.kind;
        selectedRoute = result.telemetry?.selectedRoute;
        miss = routingMiss(testCase, result);
      } catch (error) {
        miss = `threw ${error instanceof Error ? error.message : String(error)}`;
      }
      outcomes.push({ id: testCase.id, message: testCase.message, kind, passed: !miss, ...(miss ? { miss, selectedRoute, routeAnswer } : {}), durationMs: Math.round(performance.now() - startedAt) });
    }
    const passed = outcomes.filter((outcome) => outcome.passed).length;
    const accuracy = passed / outcomes.length;
    console.table(outcomes.map(({ id, passed: ok, miss, durationMs }) => ({ id, ok, miss: miss ?? '', durationMs })));
    console.info(`[jev-eval] ${passed}/${outcomes.length} (${Math.round(accuracy * 100)}%)`);
    for (const outcome of outcomes.filter((entry) => !entry.passed)) {
      console.info(`[jev-eval] miss ${outcome.id}: ${JSON.stringify({ selectedRoute: outcome.selectedRoute, routeAnswer: outcome.routeAnswer })}`);
    }
    const reportPath = process.env.AX_JEV_EVAL_REPORT?.trim();
    if (reportPath) {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), passed, total: outcomes.length, accuracy, outcomes }, null, 2));
    }
    expect(accuracy).toBeGreaterThanOrEqual(MIN_ACCURACY);
  }, 15 * 60_000);
});
