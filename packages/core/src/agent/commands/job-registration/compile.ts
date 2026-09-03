import { actionRefFor } from '../../../workflow/action-definition.js';
import {
  parseWorkflowIR,
  type WorkflowIR,
} from '../../../workflow/schema.js';
import type { NormalizedJobSpec } from './contract.js';

export function compileScheduledHttpSlackJob(spec: NormalizedJobSpec): WorkflowIR {
  const fetchParams: Record<string, unknown> = {
    method: 'GET',
    path: spec.path,
    connectionId: spec.connectionId,
  };
  if (spec.headers && Object.keys(spec.headers).length > 0) {
    fetchParams.headers = spec.headers;
  }

  const steps: WorkflowIR['steps'] = [
    {
      type: 'action',
      id: 'fetch',
      connector: 'http',
      action: 'request',
      actionRef: actionRefFor('http', 'request'),
      params: fetchParams,
      sideEffect: 'NONE',
    },
    {
      type: 'ai_decision',
      id: 'brief',
      goal: spec.interpretGoal,
      investigation: false,
      maxReads: 1,
      inputContracts: { response: 'TextArtifact' },
      bindings: { response: { from: 'fetch', output: 'response' } },
      outputSchema: {
        type: 'object',
        properties: {
          notify: { type: 'boolean' },
          summary: { type: 'string' },
        },
        required: ['notify', 'summary'],
      },
    },
    {
      type: 'action',
      id: 'notify',
      connector: 'slack',
      action: 'message.send',
      actionRef: actionRefFor('slack', 'message.send'),
      params: { channel: spec.channel },
      bindings: { text: { from: 'brief', output: 'summary' } },
      sideEffect: 'EXTERNAL',
    },
  ];

  if (spec.skipIfEmpty) {
    steps.splice(2, 0, {
      type: 'if',
      id: 'should_notify',
      condition: { op: 'eq', left: { ref: 'brief.notify' }, right: { lit: true } },
      thenStepIds: ['notify'],
    });
  }

  return parseWorkflowIR({
    name: spec.name,
    goal: spec.goal,
    version: 1,
    trigger: { type: 'schedule', schedule: spec.cron, timezone: spec.timezone },
    inputs: [],
    steps,
    permissions: {},
    approval: [],
    allowExternalAuto: spec.allowExternalAuto,
    success: '스케줄된 HTTP 조회 결과를 요약해 Slack으로 전달',
    assumptions: [],
    sideEffects: { notify: 'EXTERNAL' },
    dataPolicy: {},
  });
}
