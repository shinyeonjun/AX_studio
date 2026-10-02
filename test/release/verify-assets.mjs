import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertRunner, assertNoReparse, PREVIEW_SHA, PREVIEW_VERSION } from './runner-safety.mjs';

export const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export function assertPeMetadata(info, kind, version) {
  assert.equal(info.productName, 'AX Studio', 'Incorrect Windows product identity');
  const match = /^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version);
  assert(match, 'Unsupported package version');
  const numeric = `${match[1]}.0`;
  assert((kind === 'app' ? [numeric] : [version, ...(!version.includes('-') ? [numeric] : [])]).includes(info.productVersion), 'Incorrect PE ProductVersion');
  assert([version, ...(!version.includes('-') ? [numeric] : [])].includes(info.fileVersion), 'Incorrect PE FileVersion');
  assert(['Valid', 'NotSigned'].includes(info.signature), 'Untrusted or broken executable signature');
}

export function fileInventory(root) {
  const files = {};
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      assertNoReparse(path);
      const relative = prefix + entry.name;
      if (entry.isDirectory()) visit(path, relative + '/');
      else { assert(entry.isFile(), 'Non-regular payload entry'); files[relative] = { sha256: sha256(path), size: statSync(path).size }; }
    }
  }
  visit(root);
  return files;
}

export function verifyFile(path, expected) {
  assert(/^[a-f0-9]{64}$/.test(expected.sha256 ?? ''), 'Missing artifact checksum');
  assert.equal(statSync(path).size, expected.size, 'Artifact size changed');
  assert.equal(sha256(path), expected.sha256, 'Artifact checksum changed');
}

export function readManifest(path, expectedSha, expectedVersion) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.appId, 'com.axstudio.desktop');
  assert.equal(manifest.sourceSha, expectedSha, 'Manifest source mismatch');
  assert.equal(manifest.version, expectedVersion, 'Manifest version mismatch');
  assert.deepEqual(Object.keys(manifest.assets).sort(), [`AX Studio Setup ${expectedVersion}.exe`, `AX Studio Setup ${expectedVersion}.exe.blockmap`].sort());
  assert(manifest.payload['AX Studio.exe'] && manifest.payload['resources/app.asar'], 'Missing exact installed payload hashes');
  assert(manifest.payload['resources/document-engine/python/python.exe'] && manifest.payload['resources/document-engine/src/worker.py'], 'Bundled PDF runtime is required');
  return manifest;
}

export function verifyInstalled(install, manifest, removed = false) {
  for (const [relative, expected] of Object.entries(manifest.payload)) {
    assert(!relative.startsWith('/') && !relative.includes('\\') && !relative.split('/').some(part => !part || part === '..' || part.includes(':')), 'Unsafe manifest payload path');
    const path = join(install, ...relative.split('/'));
    assertNoReparse(path);
    if (removed) assert(!existsSync(path), 'Installed payload survived uninstall: ' + relative);
    else verifyFile(path, expected);
  }
}

function verifyUpdateMetadata(directory, version, installer) {
  const channel = version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest';
  const names = readdirSync(directory).filter(name => name === 'latest.yml' || name === channel + '.yml');
  assert(names.length <= 1, 'Ambiguous update metadata');
  if (!names.length) return { present: false }; // This app currently has no published update feed.
  const content = readFileSync(join(directory, names[0]), 'utf8');
  const scalar = key => content.match(new RegExp(`^${key}:\\s*["']?([^\\r\\n"']+)["']?\\s*$`, 'm'))?.[1]?.trim();
  assert.equal(scalar('version'), version, 'Update metadata version mismatch');
  assert.equal(decodeURIComponent(scalar('path') ?? ''), `AX Studio Setup ${version}.exe`, 'Update metadata asset mismatch');
  assert.equal(scalar('sha512'), createHash('sha512').update(readFileSync(installer)).digest('base64'), 'Update metadata hash mismatch');
  return { present: true, name: names[0], sha256: sha256(join(directory, names[0])) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { repo: { type: 'string' }, manifest: { type: 'string' },
    'source-sha': { type: 'string' }, installed: { type: 'string' }, installer: { type: 'string' }, removed: { type: 'boolean' } } });
  try {
    assert(values.repo && values.manifest && values['source-sha']);
    assertRunner({ paths: [values.repo, values.manifest, ...(values.installed ? [values.installed] : []), ...(values.installer ? [values.installer] : [])] });
    const sourceSha = values['source-sha'];
    assert([process.env.GITHUB_SHA, PREVIEW_SHA].includes(sourceSha), 'Only this build and the pinned preview are allowed');
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: values.repo, encoding: 'utf8', windowsHide: true }).trim(), sourceSha);
    execFileSync('git', ['diff', '--exit-code', 'HEAD', '--'], { cwd: values.repo, windowsHide: true, stdio: 'pipe' });
    const { version } = JSON.parse(readFileSync(join(values.repo, 'apps/desktop/package.json'), 'utf8'));
    if (sourceSha === PREVIEW_SHA) assert.equal(version, PREVIEW_VERSION);
    if (values.installed || values.installer) {
      const manifest = readManifest(values.manifest, sourceSha, version);
      if (values.installed) verifyInstalled(values.installed, manifest, values.removed);
      if (values.installer) {
        assert.equal(values.installer, join(values.repo, 'apps/desktop/release', `AX Studio Setup ${version}.exe`));
        verifyFile(values.installer, manifest.assets[`AX Studio Setup ${version}.exe`]);
        verifyFile(values.installer + '.blockmap', manifest.assets[`AX Studio Setup ${version}.exe.blockmap`]);
      }
    } else {
      const directory = join(values.repo, 'apps/desktop/release');
      const name = `AX Studio Setup ${version}.exe`;
      const assets = Object.fromEntries([name, name + '.blockmap'].map(asset => {
        const path = join(directory, asset); assertNoReparse(path);
        return [asset, { sha256: sha256(path), size: statSync(path).size }];
      }));
      const installerNames = readdirSync(directory).filter(name => name.endsWith('.exe'));
      assert.deepEqual(installerNames, [name], 'Unexpected installer in release directory');
      const pe = JSON.parse(readFileSync(join(directory, 'pe-metadata.json'), 'utf8'));
      assertPeMetadata(pe.app, 'app', version); assertPeMetadata(pe.installer, 'installer', version);
      const manifest = { schemaVersion: 1, appId: 'com.axstudio.desktop', sourceSha, version, assets, pe,
        updateMetadata: verifyUpdateMetadata(directory, version, join(directory, name)),
        payload: fileInventory(join(directory, 'win-unpacked')) };
      writeFileSync(values.manifest, JSON.stringify(manifest, null, 2), { flag: 'wx' });
      readManifest(values.manifest, sourceSha, version);
    }
    console.log('[assets] PASS: exact source/version/installer/blockmap and installed payload');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
