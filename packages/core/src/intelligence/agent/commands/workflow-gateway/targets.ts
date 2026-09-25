import { httpEndpointsFromConnections } from '../../../../connectors/http/connection.js';
import type { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type {
  Step,
  WorkflowIR,
} from '../../../../workflow/schema.js';
import { AX_INPUT_REQUEST_MAX_COUNT, type AxInputRequest } from '../schema.js';
import {
  actionInputScope,
  httpConnectionInput,
  needsSlackChannelSelection,
  slackChannelInput,
} from '../job-registration/targets.js';
import type { ListSlackChannels } from '../job-registration/contract.js';

function hasConfiguredParam(
  step: Extract<Step, { type: 'action' }>,
  name: string,
): boolean {
  if (step.bindings?.[name]) return true;
  const value = step.params[name];
  return value != null && (typeof value !== 'string' || value.trim().length > 0);
}

export async function oneShotTargetInputs(
  store: WorkflowStore,
  workflow: WorkflowIR,
  listSlackChannels?: ListSlackChannels,
): Promise<AxInputRequest[]> {
  const actions = workflow.steps.filter(
    (step): step is Extract<Step, { type: 'action' }> => step.type === 'action',
  );
  const endpoints = httpEndpointsFromConnections(store.getConnections());
  const inputs: AxInputRequest[] = [];
  for (const step of actions) {
    if (step.connector === 'http' && endpoints.length > 1
      && !hasConfiguredParam(step, 'connectionId')) {
      const scope = actionInputScope(step, 'connectionId');
      if (scope) inputs.push(httpConnectionInput(endpoints, `execution-${step.id}-http-connection`, scope));
    }
    if (needsSlackChannelSelection(step)) {
      const scope = actionInputScope(step, 'channel');
      if (scope) inputs.push(await slackChannelInput(listSlackChannels, `execution-${step.id}-slack-channel`, scope));
    }
  }
  // The renderer and command contract accept eight controls; later missing targets are requested on resume.
  return inputs.slice(0, AX_INPUT_REQUEST_MAX_COUNT);
}
