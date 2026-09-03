import { mkdirSync } from 'node:fs';
import type { WorkDiscoveryRuntime, WorkDiscoveryRuntimeOptions } from './contracts.js';
import { createDiscoveryLifecycleRunner } from './lifecycle/runner.js';
import { createDiscoveryLifecycleStateOperations } from './lifecycle/state.js';

export function createWorkDiscoveryRuntime(
  options: WorkDiscoveryRuntimeOptions,
): WorkDiscoveryRuntime {
  mkdirSync(options.snapshotDir, { recursive: true });
  const running = new Set<string>();
  const stateOperations = createDiscoveryLifecycleStateOperations(options, running);
  const runner = createDiscoveryLifecycleRunner(options, running, stateOperations);

  return {
    ...options,
    running,
    ...runner,
    ...stateOperations,
  };
}
