import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppState } from '../../../../types/app-state';
import { needsJevSetup, SetupChecklist, setupSteps } from './SetupChecklist';

const base: AppState = { globalActive: true, works: [], connections: [], pendingApprovals: 0, approvals: [], executions: [] };
const ready: AppState = {
  ...base,
  aiProvider: { provider: 'codex-cli' }, aiProviderInstalled: true,
  jevDecisionConfigured: true, jevDecisionEnabled: true,
  connections: [{ connector: 'gmail', connected: true }],
};
const noop = () => {};

describe('the start checklist', () => {
  it('stays hidden until state loads, and once everything is set up', () => {
    expect(setupSteps(null)).toEqual([]);
    expect(needsJevSetup(null)).toBe(false);
    expect(renderToStaticMarkup(<SetupChecklist state={null} onOpenSettings={noop} />)).toBe('');
    expect(renderToStaticMarkup(<SetupChecklist state={ready} onOpenSettings={noop} />)).toBe('');
  });

  it('lists what is left for a new person, each with its way there', () => {
    const html = renderToStaticMarkup(<SetupChecklist state={base} onOpenSettings={noop} />);
    expect(html).toContain('시작 준비 0/3');
    expect(html).toContain('AI 연결하기');
    expect(html).toContain('요청 판단 연결하기');
    expect(html).toContain('자료 연결하기');
  });

  it('asks to switch Jev on when it is set up but off', () => {
    const steps = setupSteps({ ...ready, jevDecisionEnabled: false });
    expect(steps.find((step) => step.id === 'jev')).toMatchObject({ done: false, action: '요청 판단 켜기', screen: 'ai-jev' });
  });

  it('counts only connections that bring data in', () => {
    const webhookOnly = { ...ready, connections: [{ connector: 'webhook', connected: true }, { connector: 'slack', connected: false }] };
    expect(setupSteps(webhookOnly).find((step) => step.id === 'data')?.done).toBe(false);
    expect(setupSteps({ ...ready, connections: [{ connector: 'local_folder', connected: true }] }).every((step) => step.done)).toBe(true);
  });

  it('does not count an AI whose program is missing', () => {
    expect(setupSteps({ ...ready, aiProviderInstalled: false }).find((step) => step.id === 'ai')?.done).toBe(false);
  });
});
