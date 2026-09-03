import { describe, expect, it } from 'vitest';
import { parseStoredWorkflow, splitWorkflowIR } from '../persisted-document.js';
import { parseWorkflowIR } from '../schema.js';

describe('persisted workflow document HTTP reload', () => {
  it('reloads HTTP GET as NONE so scheduled fetch jobs remain runnable', () => {
    const ir = parseWorkflowIR({
      name: '브리프',
      goal: '커밋 조회',
      version: 1,
      trigger: { type: 'schedule', schedule: '0 21 * * *', timezone: 'Asia/Seoul' },
      steps: [
        {
          type: 'action',
          id: 'fetch',
          connector: 'http',
          action: 'request',
          actionRef: 'http.request@1',
          params: { method: 'GET', path: '/repos/shinyeonjun/AX_studio/commits' },
          sideEffect: 'NONE',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      sideEffects: {},
    });

    const loaded = parseStoredWorkflow(JSON.parse(JSON.stringify(splitWorkflowIR(ir))));
    const fetch = loaded.steps.find((step) => step.id === 'fetch' && step.type === 'action');
    expect(fetch).toMatchObject({ action: 'request', sideEffect: 'NONE' });
  });
});
