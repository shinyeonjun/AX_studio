import {
  buildDesignToolContext,
  isCloudProvider,
  runSavedWorkflowById,
  type ConnectionRecord,
  type DesignToolContext,
} from '@ax-studio/core';
import type { AxCore } from '../core-instance.js';
import { notifyStateChanged } from '../state-broadcast.js';

/**
 * Desktop-only policy boundary for design tools.
 *
 * Source metadata is safe to inspect for every provider. PDF body text is
 * untrusted user data and is exposed to local models only by default.
 */
export function buildDesktopDesignToolContext(
  core: AxCore,
  connections: ConnectionRecord[],
  connectedConnectorIds: string[],
  workflow?: DesignToolContext['workflow'],
  interactionMode: 'plain_chat' | 'authoring' = 'plain_chat',
): DesignToolContext {
  const workflowActions = interactionMode === 'plain_chat'
    ? {
        list: () => core.store.listWorkflows(),
        run: async (workflowId: string) => {
          const result = await runSavedWorkflowById(
            { store: core.store, runtime: core.runtime },
            workflowId,
          );
          notifyStateChanged();
          return {
            executionId: result.executionId,
            status: result.status,
            errorCode: result.errorCode,
          };
        },
      }
    : undefined;

  return buildDesignToolContext(connections, connectedConnectorIds, workflow, {
    allowUntrustedData: !isCloudProvider(core.agentHarness.providerName),
    interactionMode,
    workflowActions,
    connectors: core.runtime.connectors,
  });
}
