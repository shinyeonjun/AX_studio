import {
  buildDesignToolContext,
  type ConnectionRecord,
  type DesignToolContext,
} from '@ax-studio/core';
import type { AxCore } from '../core-instance.js';

/**
 * Desktop-only policy boundary for design tools.
 *
 * Source metadata is safe to inspect for every provider. PDF body text is
 * extracted by the local document engine and may enter the selected provider
 * unless the workflow explicitly opts out through its data policy.
 */
export function buildDesktopDesignToolContext(
  core: AxCore,
  connections: ConnectionRecord[],
  connectedConnectorIds: string[],
  interactionMode: 'plain_chat' | 'authoring' = 'plain_chat',
): DesignToolContext {
  return buildDesignToolContext(connections, connectedConnectorIds, {
    allowUntrustedData: true,
    interactionMode,
    connectors: core.runtime.connectors,
  });
}
