import { describe, expect, it } from 'vitest';
import { buildJevReadOperationIndex } from '../../../../decision/read-operation-catalog.js';
import { HOLISTIC_OUTPUT_SCHEMA, holisticInput, holisticResult, type HolisticDecision } from './holistic-llm-router.js';
import { previousOrdersTable, routingMiss, type JevRoutingCase } from './routing-eval.cases.js';
import { BASIC_CONNECTIONS } from './routing-eval.workspace.js';

const hints = buildJevReadOperationIndex(BASIC_CONNECTIONS).select('anything').hints;
const keyOf = (label: string) => hints.find((hint) => hint.label === label)!.key;
const input = { userMessage: 'x', readOperationHints: hints, httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON' }] };

const decision = (overrides: Partial<HolisticDecision>): HolisticDecision => ({
  kind: 'command', route: null, read: null, join: null, transform: null, parameters: null, clarify_reads: null, confidence: 0.9, ...overrides,
});
const scored = (expect: JevRoutingCase['expect'], made: HolisticDecision) =>
  routingMiss({ id: 't', message: 'x', expect }, holisticResult(made, input));

describe('holistic LLM baseline: its decision in the router result shape', () => {
  it('a read becomes the same capability call the router makes, with relations as joins and the transform', () => {
    const made = decision({ route: 'capability_read', read: keyOf('DB 조회: orders'), join: ['customers', 'not_a_relation'], transform: 'calculate' });
    expect(scored({ kind: ['command'], capabilityId: 'rdb.query.read', params: { table: 'orders' }, join: ['customers'], tableTransform: ['calculate'] }, made)).toBeUndefined();
    const result = holisticResult(made, input);
    expect(result.kind === 'command' && result.command.name === 'capability.invoke' && (result.command.args.params as { join: unknown[] }).join).toHaveLength(1);
    expect(scored({ kind: ['command'], capabilityId: 'rdb.query.read', params: { table: 'products' } }, made)).toBe('table "orders"');
  });

  it('an API read keeps its connection and path', () => {
    const made = decision({ route: 'capability_read', read: keyOf('DummyJSON: Users') });
    expect(scored({ kind: ['command'], capabilityId: 'http.request', params: { connectionId: 'dummyjson', path: 'users' } }, made)).toBeUndefined();
  });

  it('a read whose required parameter is stated runs; one left out asks for it as the router does', () => {
    const read = keyOf('Slack 메시지 검색');
    expect(scored({ kind: ['command'], capabilityId: 'slack.messages.search' }, decision({ route: 'capability_read', read, parameters: [{ path: 'query', value: 'deploy' }] }))).toBeUndefined();
    expect(holisticResult(decision({ route: 'capability_read', read }), input).kind).toBe('parameterized');
  });

  it('asking where to look is the source chooser the scorer checks', () => {
    const made = decision({ kind: 'clarify_source', clarify_reads: [keyOf('DB 조회: products'), keyOf('DummyJSON: Products')] });
    expect(scored({ kind: ['clarify'], sourceChooser: true }, made)).toBeUndefined();
  });

  it('other kinds map onto the router kinds and routes', () => {
    expect(scored({ kind: ['reply'] }, decision({ kind: 'reply' }))).toBeUndefined();
    expect(holisticResult(decision({ kind: 'previous_result' }), { ...input, previousReadResult: previousOrdersTable() }).kind).toBe('previous_result');
    expect(scored({ kind: ['command', 'clarify'], route: ['workflow_create'] }, decision({ kind: 'clarify_route', route: 'workflow_create' }))).toBeUndefined();
    expect(scored({ kind: ['command'], route: ['connection_list'] }, decision({ route: 'connection_list' }))).toBeUndefined();
    expect(holisticResult(decision({ kind: 'none' }), input)).toMatchObject({ kind: 'fallback', reason: 'uncertain' });
  });

  it('an unknown read or route is undecided, not guessed', () => {
    expect(holisticResult(decision({ route: 'capability_read', read: 'op_999' }), input)).toMatchObject({ kind: 'fallback', reason: 'uncertain' });
    expect(holisticResult(decision({ route: 'no_such_route' }), input)).toMatchObject({ kind: 'fallback', reason: 'uncertain' });
  });

  it('the call input carries the candidates with places and relations, the routes and the transforms', () => {
    const sent = JSON.parse(holisticInput(input)) as { reads: Array<{ key: string; place: string; relations?: unknown[] }>; routes: Record<string, unknown>; table_transforms: Record<string, unknown> };
    expect(sent.reads).toHaveLength(hints.length);
    expect(sent.reads.find((read) => read.key === keyOf('DB 조회: orders'))).toMatchObject({ place: '쇼핑몰 DB', relations: expect.any(Array) });
    expect(sent.routes).toHaveProperty('report_generate');
    expect(sent.routes).not.toHaveProperty('previous_result');
    expect(sent.table_transforms).toHaveProperty('calculate');
    expect(HOLISTIC_OUTPUT_SCHEMA.safeParse(decision({})).success).toBe(true);
  });
});
