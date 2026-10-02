// No E2E flags, fake agent, IPC handler replacement, connector or migration overrides.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertRunner, isolatedAppEnvironment, denyRendererHttp, PREVIEW_SHA, PREVIEW_VERSION } from './runner-safety.mjs';
import { sha256 } from './verify-assets.mjs';
import { assertUpgradeObservation, assertProcessedPdfSource, CALCULATED_OUTPUT, TAIL_MESSAGES } from './acceptance-contract.mjs';

const { values } = parseArgs({ options: {
  executable: { type: 'string' }, workspace: { type: 'string' }, version: { type: 'string' },
  'fixture-repo': { type: 'string' }, 'fixture-sha': { type: 'string' }, stage: { type: 'string' },
  reopen: { type: 'boolean', default: false }, upgrade: { type: 'boolean', default: false },
} });
assert(values.executable && values.workspace && values['fixture-repo'] && values['fixture-sha'] && values.version);
assert(/^[a-z-]+$/.test(values.stage ?? ''), 'A unique safe evidence stage is required');
const context = assertRunner({ paths: [values.executable, values.workspace, values['fixture-repo']] });
assert.equal(values.executable, join(context.install, 'AX Studio.exe'), 'Only this installed executable is allowed');
assert.equal(values.workspace, context.acceptance);
assert([process.env.GITHUB_SHA, PREVIEW_SHA].includes(values['fixture-sha']), 'Unknown fixture producer');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: values['fixture-repo'], encoding: 'utf8', windowsHide: true }).trim(), values['fixture-sha']);
const preview = values['fixture-sha'] === PREVIEW_SHA;
if (values.upgrade) assert(preview && values.reopen && values.version !== PREVIEW_VERSION, 'Upgrade requires a different version and previous installed-app data');
const workspace = values.workspace;
const profile = join(workspace, 'electron-profile');
const paths = { root: join(workspace, 'app-data'), database: join(workspace, 'app-data/data/ax-studio.db'),
  config: join(workspace, 'app-data/config/ai.toml'), migration: join(workspace, 'app-data/config/migration.json'),
  credential: join(workspace, 'app-data/credentials/secret-OPENAI_API_KEY.cred'),
  reports: join(workspace, 'app-data/generated/reports'), documents: join(workspace, 'app-data/documents') };
const checkpointPath = join(workspace, 'acceptance.json');
const legacyDb = join(profile, 'ax-studio.db');
const secret = 'ax-installer-synthetic-not-a-real-api-key';
const env = isolatedAppEnvironment(process.env, workspace);
const importFrom = (repo, relative) => import(pathToFileURL(join(repo, relative)).href);
let checkpoint;
const report = { schemaVersion: 1, stage: values.stage, expectedVersion: values.version, checks: [], windowsScenarioExecuted: true };
// Fatal startup/worker/close errors also leave a failing stage record. This never
// turns an interrupted check into a completed or successful scenario.
process.on('uncaughtException', error => {
  report.passed = false;
  report.fatal = error.message.replaceAll(secret, '[synthetic]');
  try { assertRunner({ paths: [workspace] }); writeFileSync(join(workspace, values.stage + '.json'), JSON.stringify(report, null, 2)); }
  catch { /* A changed runner/marker is not permission to write elsewhere. */ }
  console.error(report.fatal); process.exitCode = 1;
});
async function check(name, action) {
  try { const result = await action(); report.checks.push({ name, passed: true }); return result; }
  catch (error) { report.checks.push({ name, passed: false, error: error.message.replaceAll(secret, '[synthetic]') }); }
}

if (!values.reopen) {
  assert(!existsSync(workspace), 'Initial acceptance requires an absent synthetic workspace');
  for (const directory of [workspace, profile, env.HOME, env.APPDATA, env.LOCALAPPDATA, env.TEMP, paths.reports]) mkdirSync(directory, { recursive: true });
  const { createSqlJsDatabase } = await importFrom(values['fixture-repo'], 'packages/core/dist/persistence/db/sqljs.js');
  const { WorkflowStore } = await importFrom(values['fixture-repo'], 'packages/core/dist/persistence/workflow-store.js');
  const db = await createSqlJsDatabase(legacyDb);
  const store = new WorkflowStore(db);
  try {
    const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'AX synthetic retained chat' }] });
    const interrupted = store.createExecution({ ephemeral: true, workspaceSessionId: chat.id });
    const pending = store.createExecution({ ephemeral: true });
    store.markExecutionPending(pending);
    const approval = store.createApproval({ executionId: pending, actionIds: ['synthetic_no_delivery'], reason: 'AX synthetic approval: never send' });
    if (preview) {
      assert.equal(typeof store.appendExecutionLog, 'function', 'Exact preview append-only Store API required');
      for (const [kind, id] of [['interrupted', interrupted], ['pending', pending]]) {
        store.appendExecutionLog(id, { at: new Date().toISOString(), level: 'info', code: 'step_started',
          message: TAIL_MESSAGES[kind], data: { stepId: 'synthetic-' + kind } });
      }
    }
    const completed = store.createExecution({ ephemeral: true });
    store.finishExecution(completed, 'success', undefined, [], ...(preview ? [CALCULATED_OUTPUT] : []));
    checkpoint = { chat: chat.id, interrupted, pending, approval, completed,
      producer: { sourceSha: values['fixture-sha'], version: values.version, installedAppPersisted: false } };
  } finally { db.close(); }
  writeFileSync(join(profile, 'ai.toml'), `[providers.gpt]\nmode = "api"\nmodel = "gpt-5.5"\n\n[secrets]\nopenai_api_key = "${secret}"\n`);
  mkdirSync(join(env.HOME, '.ax-studio/documents'), { recursive: true });
  writeFileSync(join(env.HOME, '.ax-studio/documents/이관 문서 한글.txt'), 'AX synthetic legacy document');
  checkpoint.legacyDatabaseSha256 = sha256(legacyDb);
} else {
  checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
  assert.equal(checkpoint.producer.sourceSha, values['fixture-sha']);
  assert.equal(checkpoint.producer.installedAppPersisted, true, 'The previous installed app has not saved this database');
  if (preview) assert.equal(checkpoint.producer.version, PREVIEW_VERSION);
}

// Fresh source-only fixture creation uses the exact old Store only above. Reopen
// never seeds, applies a current schema to an old fixture, or recreates outputs.
const pdfPath = join(workspace, `engine-${values.stage} 한글 입력.pdf`);
assertRunner({ paths: [pdfPath, values.executable] });
const runtime = join(context.install, 'resources/document-engine/python');
const pdfRun = spawnSync(join(runtime, 'python.exe'), [join(import.meta.dirname, 'pdf-acceptance.py'), runtime, pdfPath],
  { env, cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
assert.equal(pdfRun.status, 0, pdfRun.error?.message ?? pdfRun.stderr);
report.pdfEngine = JSON.parse(pdfRun.stdout.trim());
if (!values.reopen) {
  const { ArtifactStore } = await importFrom(values['fixture-repo'], 'packages/core/dist/persistence/artifact-store.js');
  const artifact = new ArtifactStore(paths.reports).putBytes(readFileSync(pdfPath), { fileName: '합성 결과 한글.pdf', mimeType: 'application/pdf' });
  checkpoint.artifact = { artifactId: artifact.id, fileName: artifact.fileName, size: artifact.size, mimeType: 'application/pdf' };
  const { createSqlJsDatabase } = await importFrom(values['fixture-repo'], 'packages/core/dist/persistence/db/sqljs.js');
  const { WorkflowStore } = await importFrom(values['fixture-repo'], 'packages/core/dist/persistence/workflow-store.js');
  const db = await createSqlJsDatabase(legacyDb);
  try {
    new WorkflowStore(db).finishExecution(checkpoint.completed, 'success', undefined,
      [{ at: new Date().toISOString(), level: 'info', code: 'pdf_generated', message: 'AX synthetic PDF', data: checkpoint.artifact }],
      ...(preview ? [CALCULATED_OUTPUT] : []));
  } finally { db.close(); }
  checkpoint.legacyDatabaseSha256 = sha256(legacyDb);
}

const { _electron: electron } = await import('@playwright/test');
assertRunner({ paths: [values.executable, workspace] });
const app = await electron.launch({ executablePath: values.executable, chromiumSandbox: true, args: [`--user-data-dir=${profile}`], cwd: workspace, env, timeout: 60_000 });
let diagnostic = '';
for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-16_384); });
let projection;
let network;
try {
  network = await denyRendererHttp(app.context());
  report.networkBoundary = { scope: 'renderer HTTP(S) after context creation', blocked: network.blocked, processIsolation: false };
  const page = await app.firstWindow({ timeout: 60_000 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.getByRole('button', { name: '새 대화', exact: true }).waitFor({ timeout: 60_000 });
  await check('real packaged startup and Windows OS encryption', async () => {
    const identity = await app.evaluate(({ app, safeStorage }) => ({ packaged: app.isPackaged, version: app.getVersion(),
      encrypted: safeStorage.isEncryptionAvailable(), profile: app.getPath('userData'), resources: process.resourcesPath,
      root: process.env.AX_DATA_ROOT, home: process.env.USERPROFILE,
      seams: Object.keys(process.env).filter(key => /^(AX_E2E|AX_PRODUCT_QA|AX_POC|AX_FAKE|NODE_OPTIONS)/.test(key)),
      unsafeFlags: process.argv.filter(arg => /no-sandbox|disable.*sandbox|fake.?agent/i.test(arg)) }));
    assert.equal(identity.packaged, true); assert.equal(identity.version, values.version);
    assert.equal(identity.encrypted, true, 'OS encryption must be available');
    assert.equal(identity.profile, profile); assert.equal(identity.root, paths.root); assert.equal(identity.home, env.HOME);
    assert.equal(win32.normalize(identity.resources).toLowerCase(), join(context.install, 'resources').toLowerCase());
    assert.deepEqual(identity.seams, []); assert.deepEqual(identity.unsafeFlags, []);
    report.identity = identity;
  });
  const state = await page.evaluate(() => window.ax.getState());
  await check('migration, interrupted/pending/completed execution and approval retention', async () => {
    assert.equal(state.executions.find(entry => entry.id === checkpoint.interrupted)?.errorCode, 'execution_interrupted');
    assert.equal(state.executions.find(entry => entry.id === checkpoint.pending)?.status, 'pending_approval');
    assert.equal(state.executions.find(entry => entry.id === checkpoint.completed)?.status, 'success');
    assert(state.approvals.some(entry => entry.id === checkpoint.approval));
    assert.equal(readFileSync(join(paths.documents, '이관 문서 한글.txt'), 'utf8'), 'AX synthetic legacy document');
    assert.equal(sha256(legacyDb), checkpoint.legacyDatabaseSha256, 'Legacy DB must remain unchanged');
    if (values.reopen) assert.equal(sha256(paths.migration), checkpoint.migrationSha256, 'Migration must not repeat');
    checkpoint.migrationSha256 = sha256(paths.migration);
  });
  await check('migrated credential config and DPAPI reopen', async () => {
    const config = await page.evaluate(() => window.ax.getAiConfig());
    assert.equal(config.secrets.gpt.configured, true);
    assert(!JSON.stringify(config).includes(secret)); assert(!readFileSync(paths.config, 'utf8').includes(secret));
    const bytes = readFileSync(paths.credential);
    assert(!bytes.includes(Buffer.from(secret)));
    assert.equal(await app.evaluate(({ safeStorage }, payload) => safeStorage.decryptString(Buffer.from(payload.bytes, 'base64')) === payload.expected,
      { bytes: bytes.toString('base64'), expected: secret }), true);
    if (values.reopen) assert.equal(sha256(paths.credential), checkpoint.credentialSha256);
    checkpoint.credentialSha256 = sha256(paths.credential);
  });
  await check('chat saved by real installed IPC and recovered after restart', async () => {
    if (!values.reopen) {
      await page.evaluate(async id => {
        const chat = await window.ax.loadWorkspaceChat(id);
        await window.ax.saveWorkspaceChat(id, [...chat.messages, { role: 'assistant', content: 'AX saved by installed IPC' }]);
      }, checkpoint.chat);
      checkpoint.producer.installedAppPersisted = true;
    }
    const chat = await page.evaluate(id => window.ax.loadWorkspaceChat(id), checkpoint.chat);
    assert(chat.messages.some(message => message.content === 'AX saved by installed IPC'));
  });

  async function nativeDialog(kind, filePath, action) {
    assertRunner({ paths: [filePath] });
    const helper = spawn('powershell.exe', ['-NoProfile', '-File', join(import.meta.dirname, 'native-file-dialog.ps1'),
      '-AppProcessId', String(app.process().pid), '-FilePath', filePath, '-Kind', kind], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    helper.stdout.on('data', chunk => { output += chunk; }); helper.stderr.on('data', chunk => { output += chunk; });
    const completion = new Promise((resolveCompletion, reject) => {
      helper.on('error', reject); helper.on('exit', code => code === 0 ? resolveCompletion() : reject(new Error('Native dialog failed: ' + output)));
    });
    // Both operations are observed; never leave the helper detached on an IPC failure.
    let timeout;
    try {
      const results = await Promise.race([Promise.all([completion, action()]),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Native dialog/IPC completion timed out')), 45_000); })]);
      return results[1];
    } finally { clearTimeout(timeout); await completion.catch(() => {}); }
  }
  await check('real PDF worker through production source attachment IPC', async () => {
    const result = await nativeDialog('open', pdfPath, () => page.evaluate(id => window.ax.attachWorkspaceSource(id), checkpoint.chat));
    assert.equal(result.ok, true, result.error);
    await page.waitForFunction(async ({ sessionId, sourceId }) => {
      const result = await window.ax.listWorkspaceSources(sessionId);
      const status = result.sources.find(source => source.id === sourceId)?.status;
      return status === 'ready' || status === 'failed';
    }, { sessionId: checkpoint.chat, sourceId: result.source.id }, { timeout: 120_000 });
    const sources = await page.evaluate(id => window.ax.listWorkspaceSources(id), checkpoint.chat);
    const source = sources.sources.find(source => source.id === result.source.id);
    const { ArtifactStore } = await importFrom(values['fixture-repo'], 'packages/core/dist/persistence/artifact-store.js');
    assertProcessedPdfSource(source, new ArtifactStore(join(paths.root, 'artifacts')).getDocumentArtifact(source.documentArtifactId));
    if (values.reopen) assert(sources.sources.some(source => source.id === checkpoint.sourceId && source.status === 'ready'), 'Previously parsed source must survive');
    report.pdfWorker = { engine: source.engine, summary: source.summary, documentArtifactId: source.documentArtifactId };
    checkpoint.sourceId = result.source.id;
  });
  await page.locator('.workspace-sidebar-tab', { hasText: '활동' }).click();
  await check('real native Save dialog and production file-export IPC', async () => {
    const saved = join(workspace, `saved-${values.stage} 한글 결과.pdf`);
    const source = join(paths.reports, readdirReportFile());
    if (values.reopen) assert.equal(sha256(join(workspace, 'saved-initial 한글 결과.pdf')), checkpoint.savedPdfSha256);
    await nativeDialog('save', saved, async () => {
      await page.getByRole('button', { name: '합성 결과 한글.pdf PDF 다운로드', exact: true }).click();
      await page.getByRole('button', { name: '합성 결과 한글.pdf PDF 다운로드', exact: true }).filter({ hasText: '다운로드됨' }).waitFor({ timeout: 30_000 });
    });
    assert.equal(sha256(saved), sha256(source), 'Exported file bytes differ');
    if (!values.reopen) checkpoint.savedPdfSha256 = sha256(saved);
  });
  if (preview) {
    projection = { producer: checkpoint.producer, hasOutput: state.executions.find(entry => entry.id === checkpoint.completed)?.hasOutput,
      pendingTailVisible: false, renderedOutput: null, ipcOutput: null };
    await check('lazy output through actual preload and IPC', async () => {
      assert.equal(await page.evaluate(() => typeof window.ax.getExecutionOutput), 'function');
      projection.ipcOutput = await page.evaluate(id => window.ax.getExecutionOutput(id), checkpoint.completed);
      assert.deepEqual(projection.ipcOutput, CALCULATED_OUTPUT);
    });
    await check('CalculatedOutput rendered by the actual activity UI', async () => {
      await page.getByRole('button', { name: '계산 결과 보기', exact: true }).click({ timeout: 10_000 });
      const value = page.getByRole('region', { name: '계산 결과', exact: true }).locator('pre');
      await value.waitFor({ timeout: 10_000 }); projection.renderedOutput = await value.innerText();
      assert.equal(projection.renderedOutput, '731');
    });
    await check('pending append-only tail rendered by the actual activity UI', async () => {
      await page.getByText(TAIL_MESSAGES.pending, { exact: false }).filter({ visible: true }).first().waitFor({ timeout: 10_000 });
      projection.pendingTailVisible = true;
    });
  }
  await check('renderer errors', async () => assert.deepEqual(pageErrors, []));
  await page.screenshot({ path: join(workspace, values.stage + '.png') });
} finally { await app.close(); }
await check('no unexpected renderer HTTP dispatch (main/Python network is not fenced)', () => network.assertUnused());

// Inspect physical values with a read-only SQLite handle. No current migration or
// Store writer can rewrite the evidence while the acceptance oracle reads it.
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(paths.database, { readOnly: true });
try {
  if (preview) {
    const raw = { outputs: db.prepare('SELECT id, output_json FROM executions WHERE output_json IS NOT NULL ORDER BY id').all(),
      tails: db.prepare('SELECT sequence, execution_id, entry_json FROM execution_log_entries ORDER BY sequence').all() };
    report.rawPreserved = !values.reopen || JSON.stringify(raw) === JSON.stringify(checkpoint.rawPreview);
    if (!values.reopen) checkpoint.rawPreview = raw;
    const { WorkflowStore } = await importFrom(resolve(import.meta.dirname, '../..'), 'packages/core/dist/persistence/workflow-store.js');
    // The current read projection is checked only on the upgrade stages. On the
    // preview baseline use its own Store, without constructing a current DB.
    const Store = values.upgrade ? WorkflowStore : (await importFrom(values['fixture-repo'], 'packages/core/dist/persistence/workflow-store.js')).WorkflowStore;
    const store = new Store(db);
    const list = store.listExecutions();
    const observe = get => ({ output: get(checkpoint.completed)?.output,
      interrupted: JSON.parse(get(checkpoint.interrupted)?.logJson ?? '[]'), pending: JSON.parse(get(checkpoint.pending)?.logJson ?? '[]') });
    projection.getExecution = observe(id => store.getExecution(id));
    projection.listExecutions = observe(id => list.find(entry => entry.id === id));
    projection.rawPreserved = report.rawPreserved;
    report.upgradeObservation = projection;
    await check('full preview output/log/Store/preload/IPC/UI preservation contract', async () => assertUpgradeObservation(projection));
  }
} finally { db.close(); }
checkpoint.lastDatabaseSha256 = sha256(paths.database);
if (!values.reopen) checkpoint.producer.databaseSha256AfterInstalledApp = checkpoint.lastDatabaseSha256;
writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
report.passed = report.checks.every(check => check.passed);
report.logTail = diagnostic.replaceAll(secret, '[synthetic]');
writeFileSync(join(workspace, values.stage + '.json'), JSON.stringify(report, null, 2));
console.log(`[installed-app] stage=${values.stage}; version=${values.version}; passed=${report.passed}`);
if (!report.passed) {
  console.error('Installed-app contract failures: ' + report.checks.filter(check => !check.passed).map(check => check.name).join(', '));
  process.exitCode = 1;
}

function readdirReportFile() {
  // Artifact metadata determines the exact source; no filename guessing or glob.
  const metadata = JSON.parse(readFileSync(join(paths.reports, checkpoint.artifact.artifactId + '.json'), 'utf8'));
  assert.equal(metadata.sha256, sha256(metadata.storedPath));
  assert.equal(win32.dirname(metadata.storedPath), paths.reports);
  return win32.basename(metadata.storedPath);
}
