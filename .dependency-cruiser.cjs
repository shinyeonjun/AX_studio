const CONNECTOR_IDS = [
  'gmail',
  'slack',
  'local-folder',
  'document',
  'rdb',
  'local-sheet',
  'transform',
  'http',
  'webhook',
];

// Chat turn layers, lowest first. A layer may use the layers below it, never its peers or the
// layers above: shared helpers know no turn, table shaping and result display know no plan,
// planning knows no routing, routing knows no turn loop.
const CHAT = '^packages/core/src/intelligence/agent/commands/chat';
const CHAT_LAYERS = [['shared'], ['shaping', 'result'], ['planning'], ['routing'], ['loop']];
const CHAT_NOT_TEST = '[.](test|live[.]test)[.]ts$|[.]fixture[.]ts$';
const TEST_SUPPORT = '[.]test[.]ts$|(^|/)fixtures?[.]ts$|[.]fixture[.]ts$';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Keep module dependencies acyclic so ownership stays explicit and refactors remain local.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Orphan modules need an explicit exception when they are ambient declarations or build entrypoints.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)persistence/sql-js[.]d[.]ts$',
          '(^|/)tsconfig[.]json$',
          '(^|/)(?:babel|webpack)[.]config[.](?:js|cjs|mjs|ts|cts|mts|json)$',
        ],
      },
      to: {},
    },
    {
      name: 'no-interview-namespace',
      severity: 'error',
      from: {},
      to: { path: 'interview' },
    },
    {
      name: 'runtime-no-work-discovery',
      severity: 'error',
      from: { path: '^packages/core/src/runtime' },
      to: { path: '^packages/core/src/work-discovery' },
    },
    {
      // Runtime executes what the host validated; it asks an investigation runner for decisions
      // through contracts/investigation-runner, never by importing the intelligence module.
      // Test doubles and fixtures may use intelligence types.
      name: 'runtime-no-intelligence',
      severity: 'error',
      from: { path: '^packages/core/src/runtime', pathNot: TEST_SUPPORT },
      to: { path: '^packages/core/src/intelligence' },
    },
    {
      name: 'workflow-no-runtime',
      severity: 'error',
      comment: 'Workflow IR, validation and repair are below Runtime; the shared helpers live in contracts.',
      from: { path: '^packages/core/src/workflow', pathNot: TEST_SUPPORT },
      to: { path: '^packages/core/src/runtime' },
    },
    {
      name: 'connectors-no-work-discovery',
      severity: 'error',
      from: { path: '^packages/core/src/connectors/(?!packages)' },
      to: { path: '^packages/core/src/work-discovery' },
    },
    ...CONNECTOR_IDS.flatMap((fromConnector) =>
      CONNECTOR_IDS.filter((toConnector) => fromConnector !== toConnector).map((toConnector) => ({
        name: `no-${fromConnector}-to-${toConnector}`,
        severity: 'error',
        from: { path: `^packages/core/src/connectors/${fromConnector}(/|$)` },
        to: { path: `^packages/core/src/connectors/${toConnector}(/|$)` },
      })),
    ),
    {
      name: 'work-discovery-no-connector-impl',
      severity: 'error',
      from: { path: '^packages/core/src/work-discovery' },
      to: {
        path: `^packages/core/src/connectors/(${CONNECTOR_IDS.join('|')})(/|$)`,
      },
    },
    ...CHAT_LAYERS.flatMap((layer, index) => layer.map((from) => ({
      name: `chat-${from}-layer`,
      severity: 'error',
      comment: `chat/${from} may only use chat layers below it.`,
      from: { path: `${CHAT}/${from}/`, pathNot: CHAT_NOT_TEST },
      to: {
        path: `${CHAT}/(${CHAT_LAYERS.flatMap((other, otherIndex) =>
          other.filter((name) => name !== from && otherIndex >= index)).join('|')})/`,
      },
    }))),
    {
      name: 'chat-turn-no-host-state',
      severity: 'error',
      comment: 'The chat turn knows nothing of what a host keeps around it (chat-host uses chat, not the other way).',
      from: { path: `${CHAT}/` },
      to: { path: '^packages/core/src/intelligence/agent/commands/chat-host/' },
    },
    {
      name: 'chat-no-test-support-in-product',
      severity: 'error',
      from: { path: '^packages/core/src/', pathNot: `${CHAT_NOT_TEST}|${CHAT}/testing/` },
      to: { path: `${CHAT}/testing/` },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    exclude: {
      path: 'node_modules',
    },
  },
};
