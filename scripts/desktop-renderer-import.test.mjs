import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'electron-vite';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureParent = join(root, 'build-evidence', 'renderer-import');
const contractImport = '@ax-studio/core/tool-result';
const controllerPath = 'src/features/chat/ui/workspace/tool-result/draft-controller.ts';

for (const distState of ['absent', 'stale']) {
  test('dev renderer serves the shared contract with ' + distState + ' Core dist', { timeout: 30_000 }, async () => {
    mkdirSync(fixtureParent, { recursive: true });
    const scratch = mkdtempSync(join(fixtureParent, 'case-'));
    const desktop = join(scratch, 'apps/desktop');
    const core = join(scratch, 'packages/core');
    const previousCwd = process.cwd();
    let server;
    try {
      mkdirSync(desktop, { recursive: true });
      mkdirSync(join(core, 'src/contracts'), { recursive: true });
      cpSync(join(root, 'apps/desktop/electron.vite.config.ts'), join(desktop, 'electron.vite.config.ts'));
      cpSync(join(root, 'apps/desktop/package.json'), join(desktop, 'package.json'));
      cpSync(join(root, 'packages/core/package.json'), join(core, 'package.json'));
      cpSync(join(root, 'packages/core/src/contracts/tool-result.ts'), join(core, 'src/contracts/tool-result.ts'));
      mkdirSync(dirname(join(desktop, controllerPath)), { recursive: true });
      cpSync(join(root, 'apps/desktop', controllerPath), join(desktop, controllerPath));
      // The controller's own renderer helpers (no Core import of their own).
      for (const helper of ['src/ui/lib/ipc-error.ts']) {
        mkdirSync(dirname(join(desktop, helper)), { recursive: true });
        cpSync(join(root, 'apps/desktop', helper), join(desktop, helper));
      }
      const modules = join(scratch, 'node_modules');
      mkdirSync(join(modules, '@ax-studio'), { recursive: true });
      symlinkSync(core, join(modules, '@ax-studio/core'), 'junction');
      for (const dependency of ['electron-vite', '@vitejs/plugin-react', 'zod']) {
        mkdirSync(dirname(join(modules, dependency)), { recursive: true });
        symlinkSync(join(root, 'node_modules', dependency), join(modules, dependency), 'junction');
      }
      if (distState === 'stale') {
        mkdirSync(join(core, 'dist/contracts'), { recursive: true });
        writeFileSync(join(core, 'dist/index.js'), 'export const oldBuild = true;\n');
      }
      const missingDist = join(core, 'dist/contracts/tool-result.js');
      assert.equal(existsSync(missingDist), false, 'fixture must not provide a built contract');
      process.chdir(desktop);
      const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, join(desktop, 'electron.vite.config.ts'));
      const renderer = loaded.config.renderer;
      server = await createServer({ ...renderer, configFile: false, cacheDir: join(scratch, 'vite-cache'),
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [scratch, join(root, 'node_modules')] } }, logLevel: 'silent' });
      await server.listen();
      const importer = join(desktop, controllerPath);
      const resolved = await server.pluginContainer.resolveId(contractImport, importer);
      assert(resolved, 'the renderer must resolve the contract without a Core build');
      assert.equal(resolve(resolved.id), resolve(core, 'src/contracts/tool-result.ts'));
      const address = server.httpServer.address();
      const response = await fetch('http://127.0.0.1:' + address.port + '/features/chat/ui/workspace/tool-result/draft-controller.ts');
      assert.equal(response.status, 200, await response.text());
      const contract = await server.transformRequest('/@fs/' + join(core, 'src/contracts/tool-result.ts').replaceAll('\\', '/'));
      for (const name of ['MessageToolDraftSchema', 'missingToolEssentials', 'validGmailRecipient']) assert.match(contract.code, new RegExp(name));
      assert.doesNotMatch(contract.code, /from\s+["'](?:node:|googleapis|@slack\/|better-sqlite3)/u);
      assert.equal(existsSync(missingDist), false, 'dev resolution must not build or alter Core dist');
      assert.equal(readFileSync(join(core, 'src/contracts/tool-result.ts'), 'utf8'), readFileSync(join(root, 'packages/core/src/contracts/tool-result.ts'), 'utf8'));
    } finally {
      await server?.close();
      process.chdir(previousCwd);
      if (!scratch.startsWith(fixtureParent + sep)) throw new Error('Fixture cleanup escaped its owned root');
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
