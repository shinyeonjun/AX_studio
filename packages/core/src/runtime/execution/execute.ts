import type { ExecutionLogEntry, ConnectorContext } from '../../modules/types.js';
import { validateWorkflowContracts } from '../../workflow/contract-validator.js';
import { parseWorkflowIR, type WorkflowIR } from '../../workflow/schema.js';
import { inferWorkflowBindings } from '../../workflow/bindings.js';
import type { ExecutionResult, WorkflowExecutionOptions } from '../types.js';
import { linearSteps } from '../control-flow.js';
import {
  createContractFailure,
  isContractFailure,
  validateOutputContract,
} from '../output-contract.js';
import type { WorkflowExecutionHost, PendingError } from './contracts.js';
import { createConnectorContext } from './context.js';
import { recordPreflightResult } from './preflight.js';
import { runSequence } from './sequence.js';

export async function executeWorkflow(
  host: WorkflowExecutionHost,
  ir: WorkflowIR,
  options: WorkflowExecutionOptions = {},
): Promise<ExecutionResult> {
  let parsedIr: WorkflowIR;
  try {
    parsedIr = parseWorkflowIR(ir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return recordPreflightResult(host, options, undefined, 'failed', 'invalid_workflow_schema', message);
  }
  ir = parsedIr;

  if (!host.config.globalActive) {
    return recordPreflightResult(
      host,
      options,
      ir,
      'cancelled',
      'global_off_duty',
      '전역 퇴근 상태입니다.',
    );
  }

  if (ir.id && host.config.workflowActive[ir.id] === false && !options.forceManual) {
    return recordPreflightResult(
      host,
      options,
      ir,
      'cancelled',
      'workflow_paused',
      '워크플로우가 중지되어 있습니다.',
    );
  }

  const contractIssues = validateWorkflowContracts(ir, { runtimeConnectors: host.connectors });
  if (contractIssues.length > 0) {
    const issue = contractIssues[0]!;
    return recordPreflightResult(
      host,
      options,
      ir,
      'failed',
      'contract_validation_failed',
      issue.message,
      { issues: contractIssues },
    );
  }

  const workflowIr = inferWorkflowBindings(ir);
  const executionId = host.config.store.createExecution({
    workflowId: options.ephemeral ? undefined : workflowIr.id,
    workflowVersion: workflowIr.version,
    ephemeral: options.ephemeral ?? false,
    triggerType: options.triggerType,
    irJson: JSON.stringify(workflowIr),
    workspaceSessionId: options.workspaceSessionId,
  });
  host.notifyExecutionStarted(executionId);

  const log: ExecutionLogEntry[] = [];
  const appendLog = (entry: ExecutionLogEntry) => {
    log.push(entry);
    host.config.store.updateExecutionLog(executionId, log);
  };
  const connections = host.config.store.getConnections();
  const ctx: ConnectorContext = createConnectorContext(
    host,
    executionId,
    workflowIr.id,
    { ...options.input },
    connections,
    appendLog,
  );
  const stepResults: Record<string, unknown> = { ...(options.input ?? {}) };

  try {
    await runSequence(host, linearSteps(workflowIr.steps), workflowIr, ctx, stepResults, [], new Set());
    if (workflowIr.outputContract) {
      const output = validateOutputContract(workflowIr.outputContract, ctx.variables, stepResults);
      if (!output.ok) throw createContractFailure('output_contract_failed', 'after_sequence', output);
    }
    host.config.store.finishExecution(executionId, 'success', undefined, log);
    const result: ExecutionResult = { executionId, status: 'success', log };
    host.notifyExecutionFinished(result);
    return result;
  } catch (err) {
    const error = err as PendingError;
    if (error.pending && error.approvalId) {
      if (error.checkpoint) {
        host.config.store.updateApprovalPayload(error.approvalId, {
          checkpoint: error.checkpoint,
        });
      }
      host.config.store.markExecutionPending(executionId, 'pending_approval', log);
      const result: ExecutionResult = {
        executionId,
        status: 'pending_approval',
        pendingApprovalId: error.approvalId,
        log,
      };
      host.notifyExecutionFinished(result);
      return result;
    }
    const code = error.code ?? 'execution_failed';
    log.push({
      at: new Date().toISOString(),
      level: 'error',
      code,
      message: error.message,
      ...(isContractFailure(error) ? { data: error.data } : {}),
    });
    host.config.store.finishExecution(executionId, 'failed', code, log);
    const result: ExecutionResult = { executionId, status: 'failed', errorCode: code, log };
    host.notifyExecutionFinished(result);
    return result;
  }
}
