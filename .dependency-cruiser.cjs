const MODULES = [
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
      name: 'modules-no-work-discovery',
      severity: 'error',
      from: { path: '^packages/core/src/modules/(?!packages)' },
      to: { path: '^packages/core/src/work-discovery' },
    },
    ...MODULES.flatMap((fromModule) =>
      MODULES.filter((toModule) => fromModule !== toModule).map((toModule) => ({
        name: `no-${fromModule}-to-${toModule}`,
        severity: 'error',
        from: { path: `^packages/core/src/modules/${fromModule}(/|$)` },
        to: { path: `^packages/core/src/modules/${toModule}(/|$)` },
      })),
    ),
    {
      name: 'work-discovery-no-connector-impl',
      severity: 'error',
      from: { path: '^packages/core/src/work-discovery' },
      to: {
        path: `^packages/core/src/modules/(${MODULES.join('|')})(/|$)`,
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
