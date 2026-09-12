import type { WorkflowStore } from '../persistence/workflow-store.js';
import type { WorkflowRuntime } from './engine.js';
import type { PushTransportState } from '../triggers/push-state.js';
import type { TriggerEvent } from '../triggers/types.js';
import type { PushTriggerConfigOverrides } from './trigger-engine/helpers.js';
import { TriggerEventCoordinator } from './trigger-engine/events.js';
import { TriggerPoller } from './trigger-engine/poll.js';
import { PushTransportManager } from './trigger-engine/push.js';

export class TriggerEngine {
  private timer?: ReturnType<typeof setInterval>;
  private readonly tickMs = 30_000;
  private lifecycleGeneration = 0;
  private acceptingEvents = false;
  private readonly events: TriggerEventCoordinator;
  private readonly pushTransports: PushTransportManager;
  private readonly poller: TriggerPoller;

  constructor(
    store: WorkflowStore,
    runtime: WorkflowRuntime,
    onTriggeredRun?: (workflowId: string, result: unknown) => void,
    onPushTransportStateChanged?: (triggerType: string, state: PushTransportState) => void,
  ) {
    this.events = new TriggerEventCoordinator(
      store,
      runtime,
      () => this.acceptingEvents,
      onTriggeredRun,
    );
    this.pushTransports = new PushTransportManager(
      store,
      () => this.acceptingEvents,
      (driver, event: TriggerEvent) => this.events.handlePushEvent(driver, event),
      onPushTransportStateChanged,
    );
    this.poller = new TriggerPoller({
      store,
      runtime,
      getLifecycleGeneration: () => this.lifecycleGeneration,
      isCurrentGeneration: (generation) => generation === this.lifecycleGeneration,
      pushTransportActive: (triggerType) => this.pushTransports.pushTransportActive(triggerType),
      rememberEvent: (key) => this.events.rememberEvent(key),
      onTriggeredRun,
    });
  }

  start(): void {
    if (!this.timer) {
      this.lifecycleGeneration += 1;
      this.acceptingEvents = true;
      this.timer = setInterval(() => {
        void this.tick();
      }, this.tickMs);
      void this.tick();
    }
    void this.refreshPushTransports();
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration += 1;
    this.acceptingEvents = false;
    clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all([this.poller.stop(), this.refreshPushTransports(null)]);
  }

  pushTransportActive(triggerType: string): boolean {
    return this.pushTransports.pushTransportActive(triggerType);
  }

  pushTransportStatus(triggerType: string): PushTransportState | undefined {
    return this.pushTransports.pushTransportStatus(triggerType);
  }

  slackSocketActive(): boolean {
    return this.pushTransportActive('slack.new_message');
  }

  slackSocketStatus(): PushTransportState {
    return this.pushTransports.pushTransportStatus('slack.new_message') ?? { phase: 'disconnected' };
  }

  refreshPushTransports(
    disconnect?: null,
    configOverrides?: PushTriggerConfigOverrides,
  ): Promise<void> {
    return this.pushTransports.refresh(disconnect, configOverrides);
  }

  refreshSlackSocket(config?: { token: string; appToken?: string } | null): Promise<void> {
    return this.pushTransports.refreshSlackSocket(config);
  }

  tick(): Promise<void> {
    return this.poller.tick();
  }
}
