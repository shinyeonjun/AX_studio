import { PUSH_TRIGGER_DRIVERS } from '../../../modules/packages/catalog.js';
import { getTriggerHandler } from '../../../triggers/registry.js';

export function shouldPollTriggerType(
  triggerType: string,
  pushTransportActive: (triggerType: string) => boolean,
): boolean {
  const driver = PUSH_TRIGGER_DRIVERS.find((entry) => entry.triggerType === triggerType);
  if (driver?.skipPollWhenActive && pushTransportActive(triggerType)) {
    return false;
  }
  const handler = getTriggerHandler(triggerType);
  if (!handler) return false;
  if (handler.transport === 'push' && !driver?.skipPollWhenActive) {
    return false;
  }
  return typeof handler.poll === 'function';
}
