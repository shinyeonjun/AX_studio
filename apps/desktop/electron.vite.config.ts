import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const sqlJsExternal = ['sql.js', 'sql.js/dist/sql-asm.js', 'sql.js/dist/sql-wasm.js'];
const mainExternals = [
  ...sqlJsExternal,
  'better-sqlite3',
  'undici',
  '@slack/socket-mode',
  '@slack/web-api',
];

const googleOAuthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@ax-studio/core': resolve('../../packages/core/src/index.ts'),
      },
    },
    define: {
      __GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(googleOAuthClientId),
    },
    plugins: [externalizeDepsPlugin({ exclude: ['@ax-studio/core'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve('electron/main/index.ts'),
          'scan-worker': resolve('../../packages/core/src/modules/local-folder/scan-worker.ts'),
        },
        external: mainExternals,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('electron/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: 'src',
    resolve: {
      alias: {
        // Renderer aliases expose only browser-safe, pure presentation modules.
        '@ax-studio/core/catalog-data': resolve('../../packages/core/src/modules/packages/catalog-data.ts'),
        '@ax-studio/core/workflow/canvas/compile/constants': resolve('../../packages/core/src/workflow/canvas/compile/constants.ts'),
        '@ax-studio/core/workflow/canvas/presentation/panel-fields': resolve('../../packages/core/src/workflow/canvas/presentation/panel-fields.ts'),
        '@ax-studio/core/visual-display': resolve('../../packages/core/src/workflow/visual-display.ts'),
        '@ax-studio/core/ai-catalog': resolve('../../packages/core/src/agent/settings/ai-catalog.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/index.html'),
        },
      },
    },
    plugins: [react()],
  },
});
