import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('discovery metadata repository', () => {
  it('does not merge metadata belonging to distinct long asset IDs', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const prefix = `tool:${'segment'.repeat(50)}`;
      for (const suffix of ['a', 'b']) store.upsertDiscoveryMetadata({
        assetId: prefix + suffix, description: suffix, aliases: [], fields: [],
      });
      expect(store.listDiscoveryMetadata()).toHaveLength(2);
      expect(store.getDiscoveryMetadata(prefix + 'b')?.description).toBe('b');
      expect(() => store.upsertDiscoveryMetadata({ assetId: 'x'.repeat(4097), aliases: [], fields: [] }))
        .toThrow('discovery_metadata_invalid');
    } finally { db.close?.(); }
  });

  it('round-trips bounded business metadata without touching connection records', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      store.setConnection('rdb', true, {
        type: 'postgres',
        connectionStringStored: true,
        allowedTables: ['public.orders'],
      });
      const saved = store.upsertDiscoveryMetadata({
        assetId: 'rdb:public.orders',
        description: '결제 완료 주문의 월별 매출 원장',
        aliases: ['주문', '매출'],
        fields: [
          { name: 'amount', label: '결제 금액', type: 'numeric', description: '주문 총액' },
        ],
      });

      expect(saved).toMatchObject({
        assetId: 'rdb:public.orders',
        description: '결제 완료 주문의 월별 매출 원장',
        fields: [{ name: 'amount', description: '주문 총액' }],
      });
      expect(new WorkflowStore(db).getDiscoveryMetadata('rdb:public.orders')).toEqual(saved);
      expect(new WorkflowStore(db).listDiscoveryMetadata()).toEqual([saved]);
      expect(new WorkflowStore(db).getConnections()).toEqual([{
        connector: 'rdb',
        connected: true,
        config: {
          type: 'postgres',
          connectionStringStored: true,
          allowedTables: ['public.orders'],
        },
      }]);
      expect(store.deleteDiscoveryMetadata('rdb:public.orders')).toBe(true);
      expect(store.getDiscoveryMetadata('rdb:public.orders')).toBeUndefined();
      expect(store.deleteDiscoveryMetadata('rdb:public.orders')).toBe(false);
    } finally {
      db.close?.();
    }
  });

  it('rejects invalid records and bounds untrusted field metadata', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      expect(() => store.upsertDiscoveryMetadata({
        assetId: ' ',
        aliases: [],
        fields: [],
      })).toThrow('discovery_metadata_invalid');

      const saved = store.upsertDiscoveryMetadata({
        assetId: 'tool:report',
        aliases: Array.from({ length: 40 }, (_, index) => `alias-${index}`),
        fields: [
          { name: 'amount', description: 'x'.repeat(1_000) },
          { name: 'amount', description: 'duplicate' },
        ],
      });
      expect(saved.aliases).toHaveLength(32);
      expect(saved.fields).toEqual([{
        name: 'amount',
        description: 'x'.repeat(500),
      }]);
    } finally {
      db.close?.();
    }
  });
});
