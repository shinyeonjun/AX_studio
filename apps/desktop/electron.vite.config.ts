import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
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

function readGoogleOAuthValue(key: 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET'): string {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  const envPath = resolve('../../.env');
  if (!existsSync(envPath)) return '';
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
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

/**
 * Renderer Content-Security-Policy, injected into src/index.html as a <meta>
 * tag so it applies to file:// loads (packaged) as well as the Vite dev server.
 * Kept in this file because fixture tests copy the config on its own.
 */
const SHARED_DIRECTIVES: ReadonlyArray<string> = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
];

const INLINE_SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/** sha256 sources for every inline classic/module script without a src attribute. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(INLINE_SCRIPT_PATTERN)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    if (/\bsrc\s*=/.test(attributes) || body.length === 0) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

export function productionRendererCsp(html: string): string {
  return [
    ...SHARED_DIRECTIVES.slice(0, 1),
    ["script-src 'self'", ...inlineScriptHashes(html)].join(' '),
    ...SHARED_DIRECTIVES.slice(1),
    "connect-src 'self'",
  ].join('; ');
}

/** Dev only: Vite HMR needs its websocket, the React refresh preamble and eval'd modules. */
export function developmentRendererCsp(): string {
  return [
    ...SHARED_DIRECTIVES.slice(0, 1),
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    ...SHARED_DIRECTIVES.slice(1),
    "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
  ].join('; ');
}

export function injectCspMeta(html: string, policy: string): string {
  if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) {
    throw new Error('index.html already declares a Content-Security-Policy; let the build inject it.');
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/"/g, '&quot;')}" />`;
  const replaced = html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}\n    ${meta}`);
  if (replaced === html) throw new Error('index.html has no <head> to receive the Content-Security-Policy.');
  return replaced;
}

/** Strict CSP for packaged builds (inline scripts pinned by hash); relaxed only for Vite HMR in dev. */
function rendererCspPlugin(): Plugin {
  let isBuild = false;
  return {
    name: 'ax-renderer-csp',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    transformIndexHtml: {
      order: 'post',
      handler: (html) => injectCspMeta(html, isBuild ? productionRendererCsp(html) : developmentRendererCsp()),
    },
  };
}

const googleOAuthClientId = readGoogleOAuthValue('GOOGLE_OAUTH_CLIENT_ID');
// Only a Google Desktop application client belongs in a distributed app.
// Account access/refresh tokens are never build inputs.
const googleOAuthClientSecret = readGoogleOAuthValue('GOOGLE_OAUTH_CLIENT_SECRET');

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@ax-studio/core': resolve('../../packages/core/src/index.ts'),
      },
    },
    define: {
      __GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(googleOAuthClientId),
      __GOOGLE_OAUTH_CLIENT_SECRET__: JSON.stringify(googleOAuthClientSecret),
    },
    plugins: [externalizeDepsPlugin({ exclude: ['@ax-studio/core'] })],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve('electron/main/index.ts'),
          'scan-worker': resolve('../../packages/core/src/platform/local-folder-scan-worker.ts'),
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
        '@ax-studio/core/catalog-data': resolve('../../packages/core/src/catalog/data.ts'),
        '@ax-studio/core/workflow/canvas/compile/constants': resolve('../../packages/core/src/workflow/canvas/compile/constants.ts'),
        '@ax-studio/core/workflow/canvas/presentation/panel-fields': resolve('../../packages/core/src/workflow/canvas/presentation/panel-fields.ts'),
        '@ax-studio/core/visual-display': resolve('../../packages/core/src/workflow/visual-display.ts'),
        '@ax-studio/core/ai-catalog': resolve('../../packages/core/src/intelligence/agent/settings/ai-catalog.ts'),
        '@ax-studio/core/tool-result': resolve('../../packages/core/src/contracts/tool-result.ts'),
      },
    },
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve('src/index.html'),
        },
      },
    },
    plugins: [react(), rendererCspPlugin()],
  },
});
