import { runTriggerPoll } from './poll/run.js';
import type { TriggerPollerOptions } from './poll/contracts.js';

export type { TriggerPollerOptions } from './poll/contracts.js';

export class TriggerPoller {
  private ticking = false;

  constructor(private readonly options: TriggerPollerOptions) {}

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    const generation = this.options.getLifecycleGeneration();

    try {
      await runTriggerPoll(this.options, generation);
    } finally {
      this.ticking = false;
    }
  }
}
