import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const sqlJsExternal = ['sql.js', 'sql.js/dist/sql-asm.js', 'sql.js/dist/sql-wasm.js'];
const mainExternals = [
  ...sqlJsExternal,
  'undici',
  '@slack/socket-mode',
  '@slack/web-api',
];

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@ax-studio/core': resolve('../../packages/core/src/index.ts'),
      },
    },
    plugins: [externalizeDepsPlugin({ exclude: ['@ax-studio/core'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve('electron/main/index.ts'),
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
