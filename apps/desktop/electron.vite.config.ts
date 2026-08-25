import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sqlJsExternal = ['sql.js', 'sql.js/dist/sql-asm.js', 'sql.js/dist/sql-wasm.js'];
const mainExternals = [
  ...sqlJsExternal,
  'better-sqlite3',
  'undici',
  '@slack/socket-mode',
  '@slack/web-api',
  'pg',
  'pg-native',
  'mysql2',
  'mysql2/promise',
  // googleapis alone was ~25MB of the bundled main chunk; load it from
  // node_modules at runtime like the other connector SDKs.
  'googleapis',
  'google-auth-library',
];

function readGoogleOAuthClientId(): string {
  const fromEnv = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (fromEnv) return fromEnv;
  const envPath = resolve('../../.env');
  if (!existsSync(envPath)) return '';
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq).trim() !== 'GOOGLE_OAUTH_CLIENT_ID') continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return '';
}

const googleOAuthClientId = readGoogleOAuthClientId();

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
