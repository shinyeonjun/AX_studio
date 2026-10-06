import type { AxCommand, AxCommandResult } from '../../schema.js';
import { result } from '../../contract.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';
import { explainExecution } from '../execution.js';
import { slackChannelLister } from './shared.js';
import { requestMutationConfirmation, requiresMutationConfirmation } from './mutation-confirmation.js';

const WORKFLOW_TARGET_COMMANDS = new Set([
  'workflow.inspect',
  'workflow.validate',
  'workflow.update',
  'workflow.delete',
  'workflow.run',
]);

function rejectUnboundWorkflowTarget(
  command: AxCommand,
  options: AxCommandExecuteOptions,
): AxCommandResult | undefined {
  if (options.executionContext?.origin !== 'agent' || !WORKFLOW_TARGET_COMMANDS.has(command.name)) return undefined;
  const requested = command.args && typeof command.args === 'object'
    ? (command.args as { workflowId?: unknown }).workflowId
    : undefined;
  if (requested === undefined) return undefined;
  if (!options.currentWorkflowId) {
    return result(command.name, 'forbidden', undefined, [{
      code: 'workflow_target_required',
      message: '에이전트가 업무를 직접 선택할 수 없습니다. 현재 대화의 업무만 사용할 수 있습니다.',
      path: 'args.workflowId',
    }]);
  }
  if (requested !== options.currentWorkflowId) {
    return result(command.name, 'forbidden', undefined, [{
      code: 'workflow_target_mismatch',
      message: '현재 대화에 연결된 업무만 사용할 수 있습니다.',
      path: 'args.workflowId',
    }]);
  }
  return undefined;
}

export async function executeWorkflowCommand(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
): Promise<AxCommandResult> {
  const targetError = rejectUnboundWorkflowTarget(command, options);
  if (targetError) return targetError;
  if (requiresMutationConfirmation(command, options)) return requestMutationConfirmation(state, command, options);

  switch (command.name) {
    case 'workflow.list':
      return result(command.name, 'ok', state.workflowGateway.list());
    case 'workflow.inspect':
      return result(command.name, ...state.workflowGateway.inspect(command));
    case 'workflow.validate':
      return result(command.name, ...state.workflowGateway.validate(command));
    case 'workflow.create':
      return result(command.name, ...state.workflowGateway.create(command));
    case 'workflow.update':
      return result(command.name, ...state.workflowGateway.update(command));
    case 'workflow.delete':
      return result(command.name, ...await state.workflowGateway.delete(command));
    case 'workflow.run':
      return result(command.name, ...await state.workflowGateway.run(command));
    case 'execution.enqueue_once':
      return result(command.name, ...await state.workflowGateway.enqueueOnce(command, {
        workspaceSessionId: options.workspaceSessionId,
        listSlackChannels: slackChannelLister(state, options),
      }));
    case 'execution.explain':
      return result(command.name, ...explainExecution(state, command, options));
    default:
      throw new Error('Unsupported workflow command: ' + command.name);
  }
}
