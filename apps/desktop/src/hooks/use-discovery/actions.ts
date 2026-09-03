import { useDiscoverySessionActions } from './session-actions.js';
import { useDiscoveryStartActions } from './start-actions.js';
import type { UseDiscoveryActionsOptions } from './contracts.js';

export type { UseDiscoveryActionsOptions } from './contracts.js';

export function useDiscoveryActions(options: UseDiscoveryActionsOptions) {
  const startActions = useDiscoveryStartActions(options);
  const sessionActions = useDiscoverySessionActions(options);

  return {
    ...startActions,
    ...sessionActions,
  };
}
