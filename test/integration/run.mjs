#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const integrationSpecs = [
  'src/testing/e2e',
  'src/work-discovery/service',
  'src/work-discovery/observation/observe-artifact.test.ts',
  'src/connectors/local-sheet/discovery-source',
  'src/persistence/artifact',
  'src/persistence/discovery-repository',
  'src/connectors/http/request.probe.test.ts',
  'src/triggers/webhook/listener',
  'src/runtime/trigger-engine',
  'src/connectors/rdb/connector.test.ts',
];

const missing = integrationSpecs.filter((path) => !existsSync(join(root, 'packages/core', path)));
if (missing.length > 0) {
  console.error(`[integration] test selections no longer exist:\n${missing.join('\n')}`);
  process.exit(1);
}

const result = spawnSync(
  npmCommand,
  ['test', '-w', '@ax-studio/core', '--', ...integrationSpecs, ...process.argv.slice(2)],
  {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

if (result.error) {
  console.error(`[integration] unable to start Core tests: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
