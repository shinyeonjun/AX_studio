import type { AxCommandDefinition, AxCommandLifecycle } from '../schema.js';
import { CORE_COMMAND_DEFINITIONS } from './definitions/core.js';
import { DISCOVERY_COMMAND_DEFINITIONS } from './definitions/discovery.js';
import { WORKFLOW_COMMAND_DEFINITIONS } from './definitions/workflow.js';

export const COMMAND_DEFINITIONS: readonly AxCommandDefinition[] = [
  ...CORE_COMMAND_DEFINITIONS,
  ...WORKFLOW_COMMAND_DEFINITIONS,
  ...DISCOVERY_COMMAND_DEFINITIONS,
] as const satisfies readonly (AxCommandDefinition & { lifecycle: AxCommandLifecycle })[];
