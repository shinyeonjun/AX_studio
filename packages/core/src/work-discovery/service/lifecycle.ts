import { mkdirSync } from 'node:fs';
import type { DecisionEngine } from '../../contracts/decision.js';
import type { WorkDiscoveryRuntime, WorkDiscoveryRuntimeOptions } from './contracts.js';
import { createDiscoveryLifecycleRunner } from './lifecycle/runner.js';
import { createDiscoveryLifecycleStateOperations } from './lifecycle/state.js';

export function createWorkDiscoveryRuntime(
  options: WorkDiscoveryRuntimeOptions,
): WorkDiscoveryRuntime {
  mkdirSync(options.snapshotDir, { recursive: true });
  const mutableOptions: WorkDiscoveryRuntimeOptions = { ...options };
  const running = new Set<string>();
  const stateOperations = createDiscoveryLifecycleStateOperations(mutableOptions, running);
  const runner = createDiscoveryLifecycleRunner(mutableOptions, running, stateOperations);

  const runtime: WorkDiscoveryRuntime = {
    ...mutableOptions,
    running,
    setDecisionEngine(decisionEngine?: DecisionEngine) {
      mutableOptions.decisionEngine = decisionEngine;
      runtime.decisionEngine = decisionEngine;
    },
    ...runner,
    ...stateOperations,
  };
  return runtime;
}
