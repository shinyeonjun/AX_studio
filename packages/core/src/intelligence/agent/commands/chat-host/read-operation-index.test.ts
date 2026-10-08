import { describe, expect, it } from 'vitest';
import { selectJevReadOperations } from './read-operation-index.js';

const rdb = (table: string) => [{
  connector: 'rdb', connected: true,
  config: { type: 'sqlite', allowedTables: [table], schema: { tables: [{ table, columns: ['id', 'name'], uniqueColumns: ['id'] }], relations: [] } },
}];

describe('the read catalog a chat turn chooses from', () => {
  it('is built once per connection revision and rebuilt when the connections change', () => {
    const store = {};
    const first = JSON.stringify(selectJevReadOperations(store, 1, rdb('orders'), '목록').hints);
    expect(first).toContain('orders');
    // Same revision: the catalog built for it is reused, whatever list is passed.
    expect(JSON.stringify(selectJevReadOperations(store, 1, rdb('customers'), '목록').hints)).toContain('orders');
    // A new revision (a connection was added or changed) builds it again.
    expect(JSON.stringify(selectJevReadOperations(store, 2, rdb('customers'), '목록').hints)).toContain('customers');
    // Without a revision nothing is cached.
    expect(JSON.stringify(selectJevReadOperations({}, undefined, rdb('products'), '목록').hints)).toContain('products');
  });
});
