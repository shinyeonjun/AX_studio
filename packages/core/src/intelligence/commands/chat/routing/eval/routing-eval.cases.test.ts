import { describe, expect, it } from 'vitest';
import type { AxCommand } from '../../../schema.js';
import type { JevChatRouterResult } from '../router-contract.js';
import { JEV_ROUTING_CASES, routingMiss } from './routing-eval.cases.js';

const byId = (id: string) => JEV_ROUTING_CASES.find((testCase) => testCase.id === id)!;
const read = (id: string, params: Record<string, unknown>, tableTransform?: string) => ({
  kind: 'command', route: 'capability_read', confidence: 0.9,
  command: { name: 'capability.invoke', args: { id, params } } as AxCommand,
  ...(tableTransform ? { tableTransform } : {}),
}) as JevChatRouterResult;

describe('grading the Jev routing evaluation set', () => {
  it('has unique case ids', () => {
    expect(new Set(JEV_ROUTING_CASES.map((testCase) => testCase.id)).size).toBe(JEV_ROUTING_CASES.length);
  });

  it('passes a read on the right table with the join and shaping the question needs', () => {
    const result = read('rdb.query.read', { table: 'orders', join: [{ table: 'customers', on: 'customer_id', references: 'id' }] }, 'calculate');
    expect(routingMiss(byId('db-region-sum'), result)).toBeUndefined();
    expect(routingMiss(byId('db-region-sum'), read('rdb.query.read', { table: 'orders' }, 'calculate'))).toBe('join missing customers');
    expect(routingMiss(byId('db-region-sum'), read('rdb.query.read', { table: 'customers' }, 'calculate'))).toBe('table "customers"');
  });

  it('matches an API path without its query, and names what missed', () => {
    expect(routingMiss(byId('api-products'), read('http.request', { method: 'GET', path: 'products?limit=5' }))).toBeUndefined();
    expect(routingMiss(byId('greeting'), read('http.request', { path: 'products' }))).toBe('kind command');
    expect(routingMiss(byId('two-sources'), { kind: 'clarify', route: 'execution_enqueue_once', message: '?', confidence: 0.5 })).toBe('no source chooser');
  });
});
