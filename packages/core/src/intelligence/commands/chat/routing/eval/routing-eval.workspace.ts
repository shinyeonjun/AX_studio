/** Synthetic sources shaped like the dogfood workspace: a shop DB, a product API, Gmail and Slack. */
export const BASIC_CONNECTIONS = [
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
