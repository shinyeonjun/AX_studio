// Real packaged startup: no fake agent, migration, IPC, storage or connector overrides.
// Uses synthetic credentials and a caller-owned temporary workspace; never user data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { _electron as electron } from '@playwright/test';
import { createSqlJsDatabase } from '../../packages/core/dist/persistence/db/sqljs.js';
import { WorkflowStore } from '../../packages/core/dist/persistence/workflow-store.js';
import { buildAxDataPaths } from '../../packages/core/dist/persistence/paths/ax-data.js';

const { values } = parseArgs({ options: {
  executable: { type: 'string' }, workspace: { type: 'string' },
  reopen: { type: 'boolean', default: false }, version: { type: 'string' },
  'corrupt-credential': { type: 'boolean', default: false },
} });
assert(values.executable && isAbsolute(values.executable) && existsSync(values.executable), 'An existing absolute packaged executable is required');
assert(values.workspace && isAbsolute(values.workspace), 'An absolute owned workspace is required');
const workspace = resolve(values.workspace);
const profile = join(workspace, 'electron-profile');
const home = join(workspace, 'home');
const paths = buildAxDataPaths(join(workspace, 'app-data'));
const checkpointPath = join(workspace, 'acceptance.json');
const legacyDb = join(profile, 'ax-studio.db');
const syntheticSecret = 'ax-release-synthetic-not-a-real-api-key';
const credentialPath = join(paths.credentials, 'secret-OPENAI_API_KEY.cred');
const damagedCredential = 'synthetic damaged DPAPI credential';
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
let checkpoint;
if (!values.reopen) {
  assert(!existsSync(workspace), 'Initial acceptance requires a fresh workspace');
  mkdirSync(profile, { recursive: true });
  mkdirSync(home);
  const db = await createSqlJsDatabase(legacyDb);
  const store = new WorkflowStore(db);
  try {
    const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '설치 전 보존한 대화' }] });
    const interrupted = store.createExecution({ ephemeral: true, workspaceSessionId: chat.id });
    const pending = store.createExecution({ ephemeral: true });
    store.markExecutionPending(pending);
    const approval = store.createApproval({ executionId: pending, actionIds: ['send'], reason: '설치 후에도 사용자 승인 필요' });
    const completed = store.createExecution({ ephemeral: true });
    store.finishExecution(completed, 'success', undefined, []);
    checkpoint = { interrupted, pending, approval, completed };
  } finally { db.close?.(); }
  writeFileSync(join(profile, 'ai.toml'), `[providers.gpt]\nmode = "api"\nmodel = "gpt-5.5"\n\n[secrets]\nopenai_api_key = "${syntheticSecret}"\n`);
  mkdirSync(join(home, '.ax-studio', 'documents'), { recursive: true });
  writeFileSync(join(home, '.ax-studio', 'documents', 'migration-fixture.txt'), 'synthetic legacy document');
  checkpoint.legacyDatabaseSha256 = hash(legacyDb);
  if (values['corrupt-credential']) {
    mkdirSync(paths.credentials, { recursive: true });
    writeFileSync(credentialPath, damagedCredential);
  }
} else {
  checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
}

// Allowlist prevents real API credentials, AX test seams and developer overrides leaking in.
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
  value !== undefined && /^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|TEMP|TMP|LOCALAPPDATA|APPDATA|LANG|USERDOMAIN|USERNAME)$/i.test(key)));
Object.assign(env, { AX_DATA_ROOT: paths.root, USERPROFILE: home, HOME: home });
const errors = [];
const app = await electron.launch({ executablePath: values.executable,
  args: [`--user-data-dir=${profile}`], cwd: workspace, env, timeout: 60_000 });
try {
  const page = await app.firstWindow({ timeout: 60_000 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '새 대화', exact: true }).waitFor({ timeout: 60_000 });
  const identity = await app.evaluate(({ app, safeStorage }) => ({
    packaged: app.isPackaged, version: app.getVersion(), encrypted: safeStorage.isEncryptionAvailable(),
    dataRoot: process.env.AX_DATA_ROOT, home: process.env.USERPROFILE,
    testSeams: Boolean(process.env.AX_E2E || process.env.AX_PRODUCT_QA),
  }));
  assert.equal(identity.packaged, true);
  assert.equal(identity.encrypted, true, 'Real OS encryption must be available');
  assert.equal(identity.testSeams, false);
  assert.equal(identity.dataRoot, paths.root);
  assert.equal(identity.home, home);
  if (values.version) assert.equal(identity.version, values.version);
  const state = await page.evaluate(() => window.ax.getState());
  assert.equal(state.executions.length, 3);
  assert.equal(state.executions.find((entry) => entry.id === checkpoint.interrupted)?.errorCode, 'execution_interrupted');
  assert.equal(state.executions.find((entry) => entry.id === checkpoint.pending)?.status, 'pending_approval');
  assert.equal(state.executions.find((entry) => entry.id === checkpoint.completed)?.status, 'success');
  assert.equal(state.pendingApprovals, 1);
  assert(state.approvals.some((entry) => entry.id === checkpoint.approval));
  await page.getByRole('button', { name: '설치 전 보존한 대화', exact: true }).waitFor({ timeout: 10_000 });
  let config = await page.evaluate(() => window.ax.getAiConfig());
  if (values['corrupt-credential'] && !values.reopen) {
    assert.equal(config.secrets.gpt.configured, false);
    assert(config.secrets.gpt.error.includes('다시 입력'));
    assert.equal(readFileSync(credentialPath, 'utf8'), damagedCredential, 'Unreadable credentials must be preserved until the user replaces them');
    await page.locator('.workspace-sidebar-tab', { hasText: '설정' }).click();
    await page.getByRole('button', { name: 'GPT 설정', exact: true }).click();
    await page.getByText(config.secrets.gpt.error, { exact: true }).waitFor({ timeout: 15_000 });
    await page.getByLabel('API 키', { exact: true }).fill(syntheticSecret);
    await page.getByRole('button', { name: '저장하기', exact: true }).click();
    await page.getByText('설정이 ai.toml에 저장되었습니다.', { exact: true }).waitFor({ timeout: 15_000 });
    const saveButton = page.getByRole('button', { name: '저장하기', exact: true });
    await saveButton.waitFor({ state: 'visible', timeout: 30_000 });
    assert.equal(await saveButton.isEnabled(), true, 'Settings must leave the saving state');
    config = await page.evaluate(() => window.ax.getAiConfig());
    assert.equal(config.secrets.gpt.error, undefined);
    console.log('[installed-app] PASS: damaged OS credential leaves the app usable; explicit replacement recovers through real IPC');
  }
  assert.equal(config.secrets.gpt.configured, true, 'Migrated credential must be readable through real IPC');
  assert(!JSON.stringify(config).includes(syntheticSecret), 'IPC must not return plaintext credentials');
  assert(!readFileSync(join(paths.config, 'ai.toml'), 'utf8').includes(syntheticSecret));
  const credential = readFileSync(credentialPath);
  assert(!credential.includes(Buffer.from(syntheticSecret)), 'Credential file must be encrypted');
  const matches = await app.evaluate(({ safeStorage }, { bytes, expected }) =>
    safeStorage.decryptString(Buffer.from(bytes, 'base64')) === expected,
  { bytes: credential.toString('base64'), expected: syntheticSecret });
  assert.equal(matches, true, 'Windows DPAPI round-trip must survive startup/reinstallation');
  assert.equal(readFileSync(join(paths.documents, 'migration-fixture.txt'), 'utf8'), 'synthetic legacy document');
  assert.equal(hash(legacyDb), checkpoint.legacyDatabaseSha256, 'Migration must not change the legacy database');
  const migrationSha256 = hash(paths.migration);
  if (values.reopen) assert.equal(migrationSha256, checkpoint.migrationSha256, 'Migration must not repeat');
  checkpoint.migrationSha256 = migrationSha256;
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(workspace, values.reopen ? 'reopened.png' : 'installed.png') });
  writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
  console.log(`[installed-app] PASS: packaged ${identity.version}; real startup, database/document migration, OS encryption and approval retention (${values.reopen ? 'reopened' : 'initial'})`);
} finally { await app.close(); }
