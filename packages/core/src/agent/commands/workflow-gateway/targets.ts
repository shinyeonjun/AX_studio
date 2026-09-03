import { resolveCapability } from '../../../catalog/capability-graph.js';
import { httpEndpointsFromConnections } from '../../../modules/http/connection.js';
import type { WorkflowStore } from '../../../store/workflow-store.js';
import type {
  Step,
  WorkflowIR,
} from '../../../workflow/schema.js';
import type { AxInputRequest } from '../schema.js';
import {
  httpConnectionInput,
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
  const needsHttpSelection = endpoints.length > 1 && actions.some(
    (step) => step.connector === 'http' && !hasConfiguredParam(step, 'connectionId'),
  );
  const needsSlackSelection = actions.some((step) => {
    const capability = resolveCapability(step.connector, step.action);
    const channelParam = capability?.params?.find((param) => param.name === 'channel' && param.inputType === 'slack_channel');
    return Boolean(capability?.notification && channelParam && !hasConfiguredParam(step, channelParam.name));
  });

  const inputs: AxInputRequest[] = [];
  if (needsHttpSelection) inputs.push(httpConnectionInput(endpoints, 'execution-http-connection'));
  if (needsSlackSelection) inputs.push(await slackChannelInput(listSlackChannels, 'execution-slack-channel'));
  return inputs;
}
