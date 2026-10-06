import { describe, expect, it } from 'vitest';
import { validateWorkflowContracts } from '../../contract-validator.js';
import type { WorkflowIR } from '../../schema.js';
import { folderToDocument } from '../fixtures.js';

const fetchStep = { type: 'action' as const, id: 'fetch', connector: 'http', action: 'request', params: { path: '/x' }, sideEffect: 'NONE' as const };
const notify = (text: string) => ({
  type: 'action' as const, id: 'notify', connector: 'slack', action: 'message.send',
  params: { channel: '#ax', text }, sideEffect: 'EXTERNAL' as const,
});
const orderingIssues = (ir: WorkflowIR) => validateWorkflowContracts(ir)
  .filter((issue) => issue.code === 'invalid_workflow_reference' && issue.message.includes('먼저 실행'));

describe('reference ordering', () => {
  it('accepts references to steps that ran earlier', () => {
    const ir: WorkflowIR = { ...folderToDocument, trigger: { type: 'manual' }, inputs: [],
      steps: [fetchStep, notify('{{fetch.status}}')] };
    expect(orderingIssues(ir)).toEqual([]);
  });

  it('rejects a reference to a later step', () => {
    const ir: WorkflowIR = { ...folderToDocument, trigger: { type: 'manual' }, inputs: [],
      steps: [notify('{{fetch.status}}'), fetchStep] };
    expect(orderingIssues(ir)).toEqual([expect.objectContaining({ stepId: 'notify' })]);
  });

  it('rejects a reference to a step that runs on only one branch', () => {
    const ir: WorkflowIR = { ...folderToDocument, trigger: { type: 'manual' }, inputs: ['flag'],
      steps: [
        { type: 'if', id: 'gate', condition: { op: 'eq', left: { ref: 'flag' }, right: { lit: 'y' } }, thenStepIds: ['fetch'] },
        fetchStep,
        notify('{{fetch.status}}'),
      ] };
    expect(orderingIssues(ir)).toEqual([expect.objectContaining({ stepId: 'notify' })]);
  });
});
