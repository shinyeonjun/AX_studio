import type { AxCommand, AxCommandResult } from '../../schema.js';
import { result } from '../../contract.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';

function rejectUnboundRepairTarget(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
): AxCommandResult | undefined {
  if (options.executionContext?.origin !== 'agent') return undefined;
  if (!options.currentWorkflowId) {
    return result(command.name, 'forbidden', undefined, [{
      code: 'workflow_target_required',
      message: '에이전트가 repair 대상을 직접 선택할 수 없습니다. 현재 대화의 workflow만 사용할 수 있습니다.',
      path: 'args.workflowId',
    }]);
  }

  const args = command.args && typeof command.args === 'object'
    ? command.args as { workflowId?: unknown; repairId?: unknown }
    : {};
  if (command.name === 'repair.list') {
    if (args.workflowId !== undefined && args.workflowId !== options.currentWorkflowId) {
      return result(command.name, 'forbidden', undefined, [{
        code: 'workflow_target_mismatch',
        message: '현재 대화에 연결된 workflow의 repair만 조회할 수 있습니다.',
        path: 'args.workflowId',
      }]);
    }
    return undefined;
  }

  if (typeof args.repairId !== 'string') return undefined;
  const proposal = state.store.getRepairProposal(args.repairId);
  if (proposal && proposal.workflowId !== options.currentWorkflowId) {
    return result(command.name, 'forbidden', undefined, [{
      code: 'workflow_target_mismatch',
      message: '현재 대화에 연결된 workflow의 repair만 사용할 수 있습니다.',
      path: 'args.repairId',
    }]);
  }
  return undefined;
}

export function executeRepairCommand(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
): AxCommandResult {
  const targetError = rejectUnboundRepairTarget(state, command, options);
  if (targetError) return targetError;

  if (command.name === 'repair.list' && options.executionContext?.origin === 'agent') {
    const args = command.args && typeof command.args === 'object' ? command.args : {};
    if ((args as { workflowId?: unknown }).workflowId === undefined) {
      command = { ...command, args: { ...args, workflowId: options.currentWorkflowId } } as AxCommand;
    }
  }

  switch (command.name) {
    case 'repair.list':
      return result(command.name, ...state.repairGateway.list(command));
    case 'repair.inspect':
      return result(command.name, ...state.repairGateway.inspect(command));
    case 'repair.apply':
      return result(command.name, ...state.repairGateway.apply(command));
    case 'repair.reject':
      return result(command.name, ...state.repairGateway.reject(command));
    default:
      throw new Error('Unsupported repair command: ' + command.name);
  }
}
