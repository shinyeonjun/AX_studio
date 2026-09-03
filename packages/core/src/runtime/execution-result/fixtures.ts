import type { ExecutionResult } from '../types.js';
import { WorkflowStore } from '../../store/workflow-store.js';

export function executionIr(name = '결제 요약') {
  return JSON.stringify({
    id: 'workflow-1',
    name,
    goal: '결제 본문을 요약하고 알린다',
    version: 1,
    steps: [
      {
        type: 'ai_decision',
        id: 'summarize',
        goal: '요약',
        investigation: false,
        maxReads: 1,
      },
      {
        type: 'action',
        id: 'send',
        connector: 'slack',
        action: 'message.send',
        params: {},
        sideEffect: 'EXTERNAL',
      },
    ],
    permissions: {},
    approval: [],
    allowExternalAuto: true,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
  });
}

export function createExecution(store: WorkflowStore, irJson = executionIr()) {
  return store.createExecution({
    workflowId: 'workflow-1',
    workflowVersion: 1,
    ephemeral: false,
    triggerType: 'webhook.inbound',
    irJson,
  });
}

export function result(executionId: string, status: ExecutionResult['status'], log: ExecutionResult['log']): ExecutionResult {
  return { executionId, status, log };
}
