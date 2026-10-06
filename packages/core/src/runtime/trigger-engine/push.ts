import type { WorkflowStore } from '../../persistence/workflow-store.js';
import { PUSH_TRIGGER_DRIVERS } from '../../connectors/packages/catalog.js';
import type { PushTriggerEvent } from '../../connectors/module-package.js';
import type { PushTransportState } from '../../triggers/push-state.js';
import type {
  ActivePushTransport,
  PushTriggerConfigOverrides,
} from './helpers.js';

type PushTriggerDriver = (typeof PUSH_TRIGGER_DRIVERS)[number];

export class PushTransportManager {
  private readonly transports = new Map<string, ActivePushTransport>();
  private readonly states = new Map<string, PushTransportState>();
  /** Per driver, so refreshing one transport never invalidates another. */
  private readonly generations = new Map<string, number>();
  private readonly overrides = new Map<string, Record<string, unknown>>();
  private refreshQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: WorkflowStore,
    private readonly isAcceptingEvents: () => boolean,
    private readonly onEvent: (driver: PushTriggerDriver, event: PushTriggerEvent) => void | boolean | Promise<void | boolean>,
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

  /**
   * Restarts push transports. Each driver is refreshed on its own: reconnecting Slack must not
   * close the webhook server, and a webhook change must not drop the Slack socket. `only` limits
   * the refresh to the given connectors; `disconnect: null` stops them without restarting.
   * A config override (e.g. the Slack token, which is kept out of the store) is remembered per
   * connector so a later full refresh can restart that transport too.
   */
  async refresh(
    disconnect?: null,
    configOverrides?: PushTriggerConfigOverrides,
    only?: ReadonlySet<string>,
  ): Promise<void> {
    const drivers = PUSH_TRIGGER_DRIVERS.filter((driver) => !only || (driver.connector !== undefined && only.has(driver.connector)));
    for (const driver of drivers) {
      if (!driver.connector) continue;
      if (disconnect === null && only) this.overrides.delete(driver.connector);
      const override = configOverrides?.[driver.connector];
      if (override) this.overrides.set(driver.connector, override);
    }
    const generations = new Map(drivers.map((driver) => [driver.triggerType, this.nextGeneration(driver.triggerType)]));
    const refresh = async () => {
      for (const driver of drivers) {
        const generation = generations.get(driver.triggerType)!;
        if (generation !== this.generations.get(driver.triggerType)) continue;
        await this.transports.get(driver.triggerType)?.stop();
        this.transports.delete(driver.triggerType);
        if (disconnect === null) {
          this.updateState(driver.triggerType, { phase: 'disconnected' });
          continue;
        }
        await this.startDriver(driver, generation);
      }
    };

    this.refreshQueue = this.refreshQueue.then(refresh, refresh);
    await this.refreshQueue;
  }

  private nextGeneration(triggerType: string): number {
    const next = (this.generations.get(triggerType) ?? 0) + 1;
    this.generations.set(triggerType, next);
    return next;
  }

  private async startDriver(driver: PushTriggerDriver, generation: number): Promise<void> {
    const current = () => generation === this.generations.get(driver.triggerType);
    this.updateState(driver.triggerType, { phase: 'connecting' });
    try {
      const transport = await driver.refresh(
        this.store,
        (event) => {
          if (!current() || !this.isAcceptingEvents()) return false;
          return Promise.resolve(this.onEvent(driver, event)).catch((error) => {
            console.error(`[trigger-engine] push event failed for ${driver.triggerType}:`, error);
            return false;
          });
        },
        driver.connector ? this.overrides.get(driver.connector) : undefined,
        (state) => { if (current()) this.updateState(driver.triggerType, state); },
      );
      if (!transport) {
        if (current()) this.updateState(driver.triggerType, { phase: 'disconnected' });
        return;
      }
      if (!current()) {
        await transport.stop();
        return;
      }
      this.transports.set(driver.triggerType, transport);
      if (transport.isRunning()) this.updateState(driver.triggerType, { phase: 'connected' });
    } catch (error) {
      if (!current()) return;
      this.updateState(driver.triggerType, {
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`[trigger-engine] push transport refresh failed for ${driver.triggerType}:`, error);
    }
  }

  async refreshSlackSocket(config?: { token: string; appToken?: string } | null): Promise<void> {
    const slackOnly = new Set(['slack']);
    if (config === null) {
      await this.refresh(null, undefined, slackOnly);
      return;
    }
    await this.refresh(undefined, config ? { slack: config } : undefined, slackOnly);
  }
}
