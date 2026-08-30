#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const forwardedArgs = process.argv.slice(2);

const result = spawnSync(
  npmCommand,
  [
    'run',
    'test:product-qa',
    '--',
    '--mode',
    'deterministic',
    '--tier',
    'smoke',
    '--strict',
    '--isolated-data',
    ...forwardedArgs,
  ],
  {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

if (result.error) {
  console.error(`[e2e] unable to start Product QA: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
