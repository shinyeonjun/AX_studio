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
  ],
  options: {
    tsPreCompilationDeps: true,
    exclude: {
      path: 'node_modules',
    },
  },
};
