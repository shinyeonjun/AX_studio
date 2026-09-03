import { describe, expect, it } from 'vitest';
import { compileScheduledHttpSlackJob } from './job-registration.js';
import { validateWorkflowContracts } from '../../workflow/contract-validator.js';


describe('compileScheduledHttpSlackJob', () => {
  it('builds a scheduled HTTP GET → AI brief → Slack notify workflow', () => {
    const ir = compileScheduledHttpSlackJob({
      name: 'Daily Dev Brief',
      goal: '커밋 브리프',
      cron: '0 21 * * *',
      timezone: 'Asia/Seoul',
      connectionId: 'default',
      path: '/repos/shinyeonjun/AX_studio/commits',
      interpretGoal: '리스크 요약',
      channel: '#ax테스트2',
      skipIfEmpty: true,
      runOnceNow: true,
      allowExternalAuto: true,
    });

    expect(ir.trigger).toEqual({ type: 'schedule', schedule: '0 21 * * *', timezone: 'Asia/Seoul' });
    expect(ir.allowExternalAuto).toBe(true);
    expect(ir.steps.map((step) => step.id)).toEqual(['fetch', 'brief', 'should_notify', 'notify']);
    const fetch = ir.steps.find((step) => step.id === 'fetch');
    expect(fetch && 'params' in fetch ? fetch.params : undefined).toMatchObject({
      method: 'GET',
      path: '/repos/shinyeonjun/AX_studio/commits',
      connectionId: 'default',
    });
    expect(validateWorkflowContracts(ir, { connectedConnectors: ['http', 'slack'] })).toEqual([]);
  });
});
