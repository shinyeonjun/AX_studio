import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { assertRunner, isolatedAppEnvironment } from './runner-safety.mjs';

const { values } = parseArgs({ options: { executable: { type: 'string' }, version: { type: 'string' } } });
const context = assertRunner({ paths: [values.executable] });
assert.equal(values.executable, join(context.install, 'AX Studio.exe'));
const workspace = join(context.root, 'clean-startup');
assertRunner({ paths: [workspace] });
assert(!existsSync(workspace), 'Clean startup requires an absent profile and data root');
const env = isolatedAppEnvironment(process.env, workspace);
const profile = join(workspace, 'electron-profile');
for (const directory of [workspace, profile, env.HOME, env.APPDATA, env.LOCALAPPDATA, env.TEMP]) mkdirSync(directory, { recursive: true });
const report = { schemaVersion: 1, scenario: 'clean-startup', windowsScenarioExecuted: true, passed: false };
const { _electron: electron } = await import('@playwright/test');
let app;
try {
  assertRunner({ paths: [values.executable, workspace] });
  app = await electron.launch({ executablePath: values.executable, chromiumSandbox: true, args: [`--user-data-dir=${profile}`], cwd: workspace, env, timeout: 60_000 });
  const page = await app.firstWindow({ timeout: 60_000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '새 대화', exact: true }).waitFor({ timeout: 60_000 });
  const identity = await app.evaluate(({ app, safeStorage }) => ({ packaged: app.isPackaged, version: app.getVersion(),
    encrypted: safeStorage.isEncryptionAvailable(), profile: app.getPath('userData'), root: process.env.AX_DATA_ROOT,
    seams: Object.keys(process.env).filter(key => /^(AX_E2E|AX_PRODUCT_QA|AX_POC|AX_FAKE|NODE_OPTIONS)/.test(key)),
    unsafeFlags: process.argv.filter(arg => /no-sandbox|disable.*sandbox|fake.?agent/i.test(arg)) }));
  assert.equal(identity.packaged, true); assert.equal(identity.version, values.version); assert.equal(identity.encrypted, true);
  assert.equal(identity.profile, profile); assert.equal(identity.root, env.AX_DATA_ROOT);
  assert.deepEqual(identity.seams, []); assert.deepEqual(identity.unsafeFlags, []);
  const state = await page.evaluate(() => window.ax.getState());
  assert.deepEqual(state.executions, []); assert.deepEqual(state.approvals, []);
  const config = await page.evaluate(() => window.ax.getAiConfig());
  assert.equal(config.secrets.gpt.configured, false);
  assert(existsSync(join(env.AX_DATA_ROOT, 'data/ax-studio.db')));
  assert(existsSync(join(env.AX_DATA_ROOT, 'config/migration.json')), 'Real migration startup must run even on a virgin profile');
  assert.deepEqual(errors, []);
  report.identity = identity;
  await page.screenshot({ path: join(context.root, 'clean-startup.png') });
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  try { if (app) await app.close(); }
  catch (error) { report.passed = false; report.closeError = error.message; process.exitCode = 1; }
  assertRunner({ paths: [workspace] });
  writeFileSync(join(context.root, 'clean-startup.json'), JSON.stringify(report, null, 2));
}
console.log(`[clean-startup] version=${values.version}; passed=${report.passed}`);
