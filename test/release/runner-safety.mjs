import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { win32, resolve, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const DISPOSABLE_MARKER = 'ax-github-windows-disposable-v1';
export const PREVIEW_SHA = '0ba5e22f54cc9fe2bb777f085290bb03de5f457b';
export const PREVIEW_VERSION = '0.1.0-preview.1';

export function windowsPath(value) {
  assert(typeof value === 'string' && /^[A-Za-z]:[\\/]/.test(value), 'An absolute local Windows path is required');
  assert(!/[\x00-\x1f*?"<>|]/.test(value) && !value.slice(2).includes(':'), 'Unsafe Windows path');
  assert(!value.split(/[\\/]/).includes('..'), 'Path traversal is forbidden');
  const normalized = win32.normalize(value);
  return normalized.length === 3 ? normalized : normalized.replace(/\\$/, '');
}

export function assertInside(root, target) {
  const parent = windowsPath(root);
  const child = windowsPath(target);
  const relative = win32.relative(parent, child);
  assert(relative && relative !== '..' && !relative.startsWith('..\\') && !win32.isAbsolute(relative), 'Target escaped its owned root');
  return child;
}

export function runnerContext(env, username, platform = process.platform) {
  assert.equal(platform, 'win32', 'Windows is required');
  for (const [key, expected] of Object.entries({
    GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows',
    RUNNER_ARCH: 'X64', AX_INSTALLER_DISPOSABLE: DISPOSABLE_MARKER,
  })) assert.equal(env[key], expected, `Refusing execution: ${key}`);
  assert.equal(env.GITHUB_REPOSITORY?.toLowerCase(), 'shinyeonjun/ax_studio', 'Unexpected repository');
  assert(/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? ''), 'Missing immutable source identity');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) assert(/^[1-9]\d*$/.test(env[key] ?? ''), `Missing ${key}`);
  assert(/^[A-Za-z0-9_-]+$/.test(env.GITHUB_JOB ?? ''), 'Missing job identity');
  assert.equal(username.toLowerCase(), 'runneradmin', 'An existing user account is forbidden');
  const profile = windowsPath(env.USERPROFILE);
  assert.equal(profile.toLowerCase(), 'c:\\users\\runneradmin', 'Unexpected hosted runner profile');
  assert.equal(windowsPath(env.LOCALAPPDATA).toLowerCase(), win32.join(profile, 'AppData', 'Local').toLowerCase());
  assert.equal(windowsPath(env.APPDATA).toLowerCase(), win32.join(profile, 'AppData', 'Roaming').toLowerCase());
  const temp = windowsPath(env.RUNNER_TEMP);
  const workspace = windowsPath(env.GITHUB_WORKSPACE);
  assert.equal(win32.basename(temp).toLowerCase(), '_temp', 'Unexpected runner temp directory');
  assert.equal(win32.dirname(temp).toLowerCase(), win32.dirname(win32.dirname(workspace)).toLowerCase(), 'Temp/workspace roots differ');
  assert(!temp.toLowerCase().startsWith(profile.toLowerCase() + '\\'), 'Runner temp is inside a user profile');
  const root = win32.join(temp, `ax-installer-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}-${env.GITHUB_JOB}`);
  return { root, temp, workspace, profile, install: win32.join(root, 'program'), acceptance: win32.join(root, 'acceptance'),
    marker: win32.join(root, 'disposable-runner.json'), schemaVersion: 1, kind: DISPOSABLE_MARKER,
    runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, job: env.GITHUB_JOB, sourceSha: env.GITHUB_SHA };
}

export function assertNoReparse(target) {
  assert(isAbsolute(target), 'Filesystem safety checks require an absolute path');
  let path = resolve(target);
  const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
  while (true) {
    if (existsSync(path)) {
      assert(!lstatSync(path).isSymbolicLink(), 'Reparse points are forbidden');
      assert.equal(comparable(realpathSync.native(path)), comparable(path), 'Path resolves outside its declared location');
    }
    const parent = dirname(path);
    if (parent === path) break;
    path = parent;
  }
}

function assertPristineProfile(env, context) {
  for (const path of [
    win32.join(context.profile, '.ax-studio'), win32.join(env.LOCALAPPDATA, 'AXStudio'),
    win32.join(env.LOCALAPPDATA, 'AXStudio-dev'), win32.join(env.LOCALAPPDATA, 'Programs', 'AX Studio'),
    win32.join(env.APPDATA, 'AX Studio'), win32.join(env.APPDATA, '@ax-studio', 'desktop'),
  ]) assert(!existsSync(path), 'Refusing an existing AX user profile');
}

export function assertRunner({ initialize = false, paths = [] } = {}) {
  const context = runnerContext(process.env, userInfo().username);
  for (const path of [context.temp, context.workspace, context.profile, context.root, context.marker, ...paths]) assertNoReparse(path);
  for (const path of paths) {
    const normalized = windowsPath(path);
    const inScratch = normalized.toLowerCase().startsWith(context.root.toLowerCase() + '\\');
    assertInside(inScratch ? context.root : context.workspace, normalized);
  }
  assertPristineProfile(process.env, context);
  if (initialize) {
    assert(!existsSync(context.root), 'Runner workspace already exists; never reuse or remove it');
    mkdirSync(context.root);
    writeFileSync(context.marker, JSON.stringify(context, null, 2), { flag: 'wx' });
  } else {
    assert.deepEqual(JSON.parse(readFileSync(context.marker, 'utf8')), context, 'Missing or foreign disposable marker');
  }
  return context;
}

// Construct the app environment from an allowlist, never from the user's shell.
export function isolatedAppEnvironment(env, workspace) {
  const result = Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined &&
    /^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|LANG|USERDOMAIN|USERNAME)$/i.test(key)));
  Object.assign(result, { AX_DATA_ROOT: win32.join(workspace, 'app-data'),
    HOME: win32.join(workspace, 'home'), USERPROFILE: win32.join(workspace, 'home'),
    APPDATA: win32.join(workspace, 'roaming'), LOCALAPPDATA: win32.join(workspace, 'local'),
    TEMP: win32.join(workspace, 'temp'), TMP: win32.join(workspace, 'temp'),
    PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' });
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { initialize: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
    path: { type: 'string', multiple: true, default: [] } } });
  try {
    if (values['dry-run']) {
      // No marker creation or other mutation, even if the environment would pass.
      const context = assertRunner({ paths: values.path });
      console.log(JSON.stringify({ allowed: true, execution: false, root: context.root }));
    } else console.log(JSON.stringify(assertRunner({ initialize: values.initialize, paths: values.path })));
  } catch (error) {
    if (values['dry-run']) console.log(JSON.stringify({ allowed: false, execution: false, reason: error.message }));
    else { console.error(error.message); process.exitCode = 1; }
  }
}
