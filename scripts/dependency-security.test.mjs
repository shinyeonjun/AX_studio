import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const lock = readJson('package-lock.json');

function resolvedPackages(name) {
  return Object.entries(lock.packages).filter(([path]) => path.endsWith(`/node_modules/${name}`)
    || path === `node_modules/${name}`);
}

function assertMinimum(path, version, minimum) {
  assert.match(version, /^\d+\.\d+\.\d+$/, `${path}: review non-stable versions explicitly`);
  const actual = version.split('.').map(Number);
  const expected = minimum.split('.').map(Number);
  assert.equal(actual[0], expected[0], `${path}: an unreviewed major upgrade is outside this gate`);
  assert.ok(actual[1] > expected[1] || (actual[1] === expected[1] && actual[2] >= expected[2]),
    `${path}: ${version} is below the security floor ${minimum}`);
}

test('all resolved npm undici copies retain supported security floors', () => {
  const packages = resolvedPackages('undici');
  assert.ok(packages.length > 0);
  for (const [path, { version }] of packages) {
    const minimum = { 6: '6.28.1', 7: '7.29.1' }[version.split('.')[0]];
    assert.ok(minimum, `${path}: review the new undici major explicitly`);
    assertMinimum(path, version, minimum);
  }
});

test('axios and each brace-expansion major resolve above their security floors', () => {
  assert.ok(resolvedPackages('axios').length > 0);
  assert.ok(resolvedPackages('brace-expansion').length > 0);
  for (const [path, { version }] of resolvedPackages('axios')) assertMinimum(path, version, '1.20.0');
  for (const [path, { version }] of resolvedPackages('brace-expansion')) {
    const minimum = { 1: '1.1.21', 2: '2.1.7', 5: '5.0.12' }[version.split('.')[0]];
    assert.ok(minimum, `${path}: review the new brace-expansion major explicitly`);
    assertMinimum(path, version, minimum);
  }
});

test('workspace manifests and the canonical npm lock agree on the undici pin', () => {
  for (const [path, lockPath, section] of [
    ['package.json', '', 'devDependencies'],
    ['packages/core/package.json', 'packages/core', 'dependencies'],
    ['apps/desktop/package.json', 'apps/desktop', 'dependencies'],
  ]) {
    assert.equal(readJson(path)[section].undici, '7.29.1', `${path}: preserve the reviewed patch pin`);
    assert.equal(lock.packages[lockPath][section].undici, '7.29.1', `${path}: regenerate the npm lock`);
  }
});

test('the document-engine requirement selects the reviewed pypdf security release', () => {
  const requirements = readFileSync(new URL('packages/document-engine/requirements.txt', root), 'utf8');
  const entries = requirements.split(/\r?\n/).filter((line) => /^pypdf\s*(?:[=<>!~]|$)/i.test(line));
  assert.deepEqual(entries, ['pypdf==6.19.0']);
});
