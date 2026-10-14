/** @type {import('knip').KnipConfig} */
export default {
  ignoreIssues: {
    // AxExecutionEnqueueOnceArgsSchema is the create schema under the name its command uses.
    'packages/core/src/intelligence/commands/schema/workflow-args.ts': ['duplicates'],
  },
  ignoreBinaries: ['where.exe', 'taskkill.exe'],
  workspaces: {
    '.': {
      entry: ['test/product-qa/specs/**/*.ts'],
      project: ['test/product-qa/**/*.ts'],
      // Root scripts and QA runners use the build tools installed for apps/desktop.
      ignoreDependencies: ['electron', 'xlsx', 'vite', 'electron-vite', 'esbuild', '@vitejs/plugin-react'],
    },
    'packages/core': {
      entry: [
        'src/application/bootstrap.ts',
        'src/**/*.test.ts',
        'src/testing/**/*.ts',
        // Maintainer scripts run by hand (evaluation reports).
        'scripts/**/*.mjs',
      ],
      project: ['src/**/*.ts', 'scripts/**/*.mjs'],
    },
    'apps/desktop': {
      entry: [
        'electron/main/index.ts',
        'electron/preload/index.ts',
        'src/main.tsx',
        'src/types/ax-api.ts',
        'electron/main/ipc/**/*.ts',
        'electron/main/**/connection.ts',
      ],
      project: ['electron/**/*.ts', 'src/**/*.{ts,tsx}'],
      // Core's connector runtimes, declared here so the packaged app ships them (electron.vite.config.ts).
      ignoreDependencies: [
        '@googleapis/gmail',
        '@slack/socket-mode',
        '@slack/web-api',
        'google-auth-library',
        'mysql2',
        'pg',
        'undici',
      ],
    },
  },
};
