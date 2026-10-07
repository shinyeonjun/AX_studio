import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('learned Korean column headers', () => {
  it('are remembered across reads and ignore malformed entries', async () => {
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    expect(store.getColumnLabels()).toEqual({});
    store.rememberColumnLabels({ amount: '금액', bad: 'a|b' });
    store.rememberColumnLabels({ status: '상태', amount: '주문 금액' });
    expect(store.getColumnLabels()).toEqual({ amount: '주문 금액', status: '상태' });
    store.setSetting('column_labels', { amount: 3, region: '지역' });
    expect(store.getColumnLabels()).toEqual({ region: '지역' });
  });
});
