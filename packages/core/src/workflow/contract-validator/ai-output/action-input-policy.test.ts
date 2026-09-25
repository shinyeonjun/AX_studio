import { describe, expect, it } from 'vitest';
import { validateWorkflowContracts } from '../../contract-validator.js';
import type { Step, WorkflowIR } from '../../schema.js';

type AiDecisionStep = Extract<Step, { type: 'ai_decision' }>;
type ActionStep = Extract<Step, { type: 'action' }>;

function workflowFor(outputSchema: Record<string, unknown> | undefined, action: ActionStep): WorkflowIR {
  const decision: AiDecisionStep = {
    type: 'ai_decision',
    id: 'compose',
    goal: 'Analyze the request',
    ...(outputSchema ? { outputSchema } : {}),
    investigation: false,
    maxReads: 1,
  };
  return {
    name: 'AI output action-input policy',
    goal: 'Keep model prose out of structured action inputs',
    version: 1,
    trigger: { type: 'manual' },
    steps: [decision, action],
    permissions: {},
    approval: [],
    allowExternalAuto: false,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
  };
}

function slackSend(params: Record<string, unknown>, bindings?: ActionStep['bindings']): ActionStep {
  return {
    type: 'action',
    id: 'send',
    connector: 'slack',
    action: 'message.send',
    params,
    ...(bindings ? { bindings } : {}),
    sideEffect: 'EXTERNAL',
  };
}

describe('AI output action-input policy', () => {
  it('rejects an LLM-generated value used as a Slack destination', () => {
    const workflow = workflowFor({
      type: 'object',
      properties: { destination: { type: 'string' } },
      required: ['destination'],
    }, slackSend({ channel: '{{compose.destination}}', text: 'user-provided message' }));
    const issues = validateWorkflowContracts(workflow);

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'invalid_workflow_schema',
      stepId: 'compose',
      message: expect.stringContaining('destination'),
    }));
  });

  it('rejects the implicit LLM conclusion as a destination', () => {
    const issues = validateWorkflowContracts(workflowFor(undefined, slackSend({
      channel: '{{compose.conclusion}}',
      text: 'user-provided message',
    })));

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'invalid_workflow_schema',
      message: expect.stringContaining('conclusion'),
    }));
  });

  it('allows free-form LLM text only through a TextArtifact action input', () => {
    const workflow = workflowFor({
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    }, slackSend({ channel: '#ops' }, { text: { from: 'compose', output: 'summary' } }));

    expect(validateWorkflowContracts(workflow).filter((issue) => issue.code === 'invalid_workflow_schema')).toEqual([]);
  });

  it('allows a Jev-selectable enum to supply a structured action parameter', () => {
    const workflow = workflowFor({
      type: 'object',
      properties: { destination: { type: 'string', enum: ['#ops', '#sales'] } },
      required: ['destination'],
    }, slackSend({ channel: '{{compose.destination}}', text: 'user-provided message' }));

    expect(validateWorkflowContracts(workflow).filter((issue) => issue.code === 'invalid_workflow_schema')).toEqual([]);
  });

  it('rejects a numeric Jev choice for an input declared as an identifier', () => {
    const workflow = workflowFor({
      type: 'object',
      properties: { destination: { type: 'number', enum: [1, 2] } },
      required: ['destination'],
    }, slackSend({ channel: '{{compose.destination}}', text: 'user-provided message' }));

    expect(validateWorkflowContracts(workflow)).toContainEqual(expect.objectContaining({
      code: 'invalid_workflow_schema',
      message: expect.stringContaining('destination'),
    }));
  });

  it('allows numeric Jev choices for untyped scalar parameters', () => {
    const workflow = workflowFor({
      type: 'object',
      properties: { limit: { type: 'integer', enum: [5, 10] } },
      required: ['limit'],
    }, {
      type: 'action',
      id: 'search',
      connector: 'slack',
      action: 'messages.search',
      params: { query: 'inventory', limit: '{{compose.limit}}' },
      sideEffect: 'NONE',
    });

    expect(validateWorkflowContracts(workflow).filter((issue) => issue.code === 'invalid_workflow_schema')).toEqual([]);
  });
});
