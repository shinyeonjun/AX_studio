/** Frozen synthetic integration cases, independent of the completed offline prototype. */
export const singletonSchemaFixture = {
  sourceId: 'http:orders', label: 'OrdersAPI',
  paraphrases: [
    { id: 'SCHEMA-01', text: 'OrdersAPI 데이터 필드랑 타입 알려줘' },
    { id: 'SCHEMA-02', text: 'OrdersAPI에 등록된 스키마를 보여줘' },
    { id: 'SCHEMA-03', text: 'OrdersAPI에서 어떤 필드를 쓰는지 정리해 줘' },
  ],
  fields: [{ name: 'orderId', type: 'string', required: true }, { name: 'quantity' }],
  expectedScope: 'registered_field_dictionary',
} as const;
