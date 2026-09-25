import { describe, expect, it } from 'vitest';
import {
  DiscoveryAssetIndex,
  type DiscoveryAsset,
} from './discovery-assets.js';

function asset(overrides: Partial<DiscoveryAsset>): DiscoveryAsset {
  return {
    id: 'asset:default',
    kind: 'tool',
    name: 'default-tool',
    label: '기본 도구',
    description: '기본 설명',
    aliases: [],
    availability: 'ready',
    access: 'read',
    metadata: { internal: 'must not be returned by search' },
    ...overrides,
  };
}

describe('DiscoveryAssetIndex', () => {
  it('keeps every match reachable through bounded pages in a large catalog', () => {
    const index = new DiscoveryAssetIndex(Array.from({ length: 105 }, (_, i) =>
      asset({ id: `tool:${String(i).padStart(4, '0')}`, name: 'ledger', label: 'ledger' })));
    const ids = new Set<string>();
    let offset = 0;
    do {
      const page = index.search({ query: 'ledger', limit: 20, offset });
      expect(page.candidates.length).toBeLessThanOrEqual(20);
      page.candidates.forEach(candidate => ids.add(candidate.id));
      if (page.nextOffset === undefined) break;
      expect(page.nextOffset).toBeGreaterThan(offset);
      offset = page.nextOffset;
    } while (offset < 120);
    expect(ids.size).toBe(105);
  });

  it('preserves distinct long identifiers for exact describe hand-off', () => {
    const prefix = `tool:${'segment'.repeat(45)}`;
    const index = new DiscoveryAssetIndex(['a', 'b'].map(suffix =>
      asset({ id: prefix + suffix, name: 'inventory', label: 'inventory' })));
    const page = index.search({ query: 'inventory' });
    expect(new Set(page.candidates.map(candidate => candidate.id)).size).toBe(2);
    expect(index.find(prefix + 'b')?.id).toBe(prefix + 'b');
  });

  it('can search a one-character business label', () => {
    const index = new DiscoveryAssetIndex([asset({ id: 'folder:spring', name: 'spring', label: '봄' })]);
    expect(index.search({ query: '봄' }).candidates[0]?.id).toBe('folder:spring');
  });

  it('never truncates exact hand-off metadata identifiers', () => {
    const capabilityId = `openapi.${'long-segment'.repeat(60)}`;
    const index = new DiscoveryAssetIndex([asset({ id: `tool:${capabilityId}`, metadata: { capabilityId } })]);
    expect(index.find(`tool:${capabilityId}`)?.metadata.capabilityId).toBe(capabilityId);
  });

  it('ranks exact labels, applies filters, and keeps search results compact', () => {
    const index = new DiscoveryAssetIndex([
      asset({
        id: 'rdb:public.orders',
        kind: 'database_table',
        name: 'public.orders',
        label: '월간 고객 매출 DB',
        aliases: ['주문', '매출'],
        connector: 'rdb',
      }),
      asset({
        id: 'http:orders',
        kind: 'http_endpoint',
        name: 'orders',
        label: '주문 API',
        aliases: ['주문'],
        connector: 'http',
      }),
    ]);

    const exact = index.search({ query: '월간 고객 매출 DB', kind: 'database_table', connector: 'rdb' });
    expect(exact.candidates).toHaveLength(1);
    expect(exact.candidates[0]).toMatchObject({
      id: 'rdb:public.orders',
      score: 1,
      matchedOn: ['label'],
    });
    expect(exact.candidates[0]).not.toHaveProperty('metadata');

    const alias = index.search({ query: '주문' });
    expect(alias.candidates.map((candidate) => candidate.id)).toEqual([
      'http:orders',
      'rdb:public.orders',
    ]);
    expect(alias.candidates.every((candidate) => candidate.kind !== 'connector')).toBe(true);
  });

  it('keeps highest-weight field ranking when matching several query terms', () => {
    const index = new DiscoveryAssetIndex([asset({
      id: 'rdb:customers',
      name: 'customers',
      label: 'Customer order table',
      description: 'Customer profile and revenue details',
      aliases: ['customer revenue'],
    })]);

    expect(index.search({ query: 'customer details' }).candidates[0]).toMatchObject({
      id: 'rdb:customers',
      score: 0.8562,
      matchedOn: ['description', 'label'],
    });
    expect(index.search({ query: 'customer customer details' }).candidates[0]).toMatchObject({
      id: 'rdb:customers',
      score: 0.7875,
      matchedOn: ['description', 'label'],
    });
  });

  it('bounds results and reports truncation without losing total match count', () => {
    const index = new DiscoveryAssetIndex([
      asset({ id: 'tool:a', name: 'report-a', label: '보고서 A' }),
      asset({ id: 'tool:b', name: 'report-b', label: '보고서 B' }),
      asset({ id: 'tool:c', name: 'report-c', label: '보고서 C' }),
    ]);

    const result = index.search({ query: 'report', limit: 1 });
    expect(result.candidates).toHaveLength(1);
    expect(result.totalMatches).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it('uses stable id ordering when scores tie', () => {
    const index = new DiscoveryAssetIndex([
      asset({ id: 'tool:z', name: 'shared', label: '공유' }),
      asset({ id: 'tool:a', name: 'shared', label: '공유' }),
    ]);

    expect(index.search({ query: 'shared' }).candidates.map((candidate) => candidate.id)).toEqual([
      'tool:a',
      'tool:z',
    ]);
  });
});
