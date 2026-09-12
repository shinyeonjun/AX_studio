import { runTriggerPoll } from './poll/run.js';
import type { TriggerPollerOptions } from './poll/contracts.js';

export type { TriggerPollerOptions } from './poll/contracts.js';

export class TriggerPoller {
  private activeTick?: Promise<void>;
  private controller?: AbortController;

  constructor(private readonly options: TriggerPollerOptions) {}

  tick(): Promise<void> {
    if (this.activeTick) return Promise.resolve();
    const controller = new AbortController();
    this.controller = controller;
    const generation = this.options.getLifecycleGeneration();
    const run = runTriggerPoll(this.options, generation, controller.signal).finally(() => {
      this.activeTick = undefined;
      this.controller = undefined;
    });
    this.activeTick = run;
    return run;
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    // Only source reads are interruptible. Already-started workflow execution
    // retains ownership until its receipt and cursor have been acknowledged.
    await this.activeTick;
  }
}
