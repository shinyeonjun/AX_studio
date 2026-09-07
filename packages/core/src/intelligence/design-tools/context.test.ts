import { describe, expect, it } from 'vitest';
import { buildDesignToolContext } from './context.js';

describe('design tool context', () => {
  it('carries persisted discovery metadata as an explicit read-only input', () => {
    const metadata = [{
      assetId: 'rdb:orders',
      aliases: ['주문'],
      fields: [{ name: 'amount', description: '결제 금액' }],
      updatedAt: '2026-09-05T00:00:00.000Z',
    }];
    const context = buildDesignToolContext([], [], { discoveryMetadata: metadata });
    expect(context.discoveryMetadata).toEqual(metadata);
  });
});
