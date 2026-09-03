import type { WorkflowStore } from '../../store/workflow-store.js';
import { PUSH_TRIGGER_DRIVERS } from '../../modules/packages/catalog.js';
import type { TriggerEvent } from '../../triggers/types.js';
import type { PushTransportState } from '../../triggers/push-state.js';
import type {
  ActivePushTransport,
  PushTriggerConfigOverrides,
} from './helpers.js';

type PushTriggerDriver = (typeof PUSH_TRIGGER_DRIVERS)[number];

export class PushTransportManager {
  private readonly transports = new Map<string, ActivePushTransport>();
  private readonly states = new Map<string, PushTransportState>();
  private refreshGeneration = 0;
  private refreshQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: WorkflowStore,
    private readonly isAcceptingEvents: () => boolean,
    private readonly onEvent: (driver: PushTriggerDriver, event: TriggerEvent) => void | Promise<void>,
    private readonly onStateChanged?: (triggerType: string, state: PushTransportState) => void,
  ) {}

  pushTransportActive(triggerType: string): boolean {
    return this.transports.get(triggerType)?.isRunning() ?? false;
  }

  pushTransportStatus(triggerType: string): PushTransportState | undefined {
    return this.states.get(triggerType);
  }

  private updateState(triggerType: string, state: PushTransportState): void {
    this.states.set(triggerType, state);
    this.onStateChanged?.(triggerType, state);
  }

  async refresh(
    disconnect?: null,
    configOverrides?: PushTriggerConfigOverrides,
  ): Promise<void> {
    const generation = ++this.refreshGeneration;
    const refresh = async () => {
      for (const transport of this.transports.values()) {
        await transport.stop();
      }
      this.transports.clear();

      if (disconnect === null || generation !== this.refreshGeneration) return;

      for (const driver of PUSH_TRIGGER_DRIVERS) {
        this.updateState(driver.triggerType, { phase: 'connecting' });
        try {
          const transport = await driver.refresh(
            this.store,
            (event) => {
              if (generation !== this.refreshGeneration || !this.isAcceptingEvents()) return;
              void this.onEvent(driver, event);
            },
            driver.connector ? configOverrides?.[driver.connector] : undefined,
            (state) => this.updateState(driver.triggerType, state),
          );
          if (!transport) {
            this.updateState(driver.triggerType, { phase: 'disconnected' });
            continue;
          }

          if (generation !== this.refreshGeneration) {
            await transport.stop();
            return;
          }
          this.transports.set(driver.triggerType, transport);
          if (transport.isRunning()) {
            this.updateState(driver.triggerType, { phase: 'connected' });
          }
        } catch (error) {
          this.updateState(driver.triggerType, {
            phase: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
          console.error(`[trigger-engine] push transport refresh failed for ${driver.triggerType}:`, error);
        }
      }
    };

    this.refreshQueue = this.refreshQueue.then(refresh, refresh);
    await this.refreshQueue;
  }

  async refreshSlackSocket(config?: { token: string; appToken?: string } | null): Promise<void> {
    if (config === null) {
      await this.refresh(null);
      return;
    }
    await this.refresh(undefined, { slack: config });
  }
}
