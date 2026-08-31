#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const integrationSpecs = [
  'src/testing/e2e',
  'src/work-discovery/service.test.ts',
  'src/work-discovery/observation/observe-artifact.test.ts',
  'src/modules/local-sheet/discovery-source.test.ts',
  'src/store/artifact-store.test.ts',
  'src/store/discovery-repository.test.ts',
  'src/modules/http/request.probe.test.ts',
  'src/triggers/webhook/listener.test.ts',
  'src/modules/rdb/connector.test.ts',
];

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
