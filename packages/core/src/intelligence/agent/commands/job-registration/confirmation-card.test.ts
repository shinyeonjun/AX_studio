import { describe, expect, it } from 'vitest';
import type { AxUiPresentation } from '../schema.js';
import { commandChatContext, connectedService, dailyBriefArgs } from './fixtures.js';

function card(data: unknown): { presentation: AxUiPresentation; text: string; summary: Record<string, unknown> } {
  const value = data as { presentation: AxUiPresentation; summary: Record<string, unknown> };
  return { presentation: value.presentation, text: JSON.stringify(value.presentation), summary: value.summary };
}

describe('job confirmation card safety defaults', () => {
  it('does not auto-send or run now unless the proposal explicitly opts in', async () => {
    const { service, chat } = await connectedService();
    const { runOnceNow: _run, allowExternalAuto: _auto, ...args } = dailyBriefArgs;
    const response = await service.execute({ name: 'job.propose', args }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('ok');
    const { text, summary } = card(response.data);
    expect(summary).toMatchObject({ runOnceNow: false, allowExternalAuto: false });
    expect(text).toContain('자동 발송: 꺼짐(기본)');
    expect(text).toContain('지금은 실행하지 않고 시작 조건만 켭니다.');
  });

  it('lists every step with connector, action, side effect and resolved destination', async () => {
    const { service, chat } = await connectedService();
    const response = await service.execute({ name: 'job.propose', args: dailyBriefArgs }, { ...commandChatContext, workspaceSessionId: chat.id });

    const { presentation, text } = card(response.data);
    const steps = presentation.blocks.find((block) => block.type === 'steps' && block.title === '단계별 연결·동작·대상');
    expect(steps).toBeDefined();
    const items = (steps as { items: string[] }).items;
    expect(items.find((item) => item.startsWith('fetch:'))).toMatch(/http \/ request · 부작용 없음\(조회\) · 대상: .*path=\/repos\/shinyeonjun\/AX_studio\/commits/u);
    expect(items.find((item) => item.includes(' notify:'))).toMatch(/^\[외부\] notify: slack \/ message\.send · 외부 전송 · 대상: channel=#ax테스트2/u);
    expect(text).toContain('자동 발송(별도 선택): 켜짐');
  });

  it('defaults run-now off for generic workflows with external steps and on when nothing is sent externally', async () => {
    const { store, service, chat } = await connectedService();
    store.setConnection('http', false);
    store.setConnection('gmail', true, { email: 'primary' });
    const external = await service.execute({
      name: 'job.propose',
      args: {
        name: '외부 알림',
        goal: '새 메일을 Slack으로 알린다',
        trigger: { type: 'gmail.new_message', accountId: 'primary' },
        steps: [{ type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ops', text: '요약' } }],
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });
    expect(card(external.data).summary).toMatchObject({ runOnceNow: false, allowExternalAuto: false });

    const readOnly = await service.execute({
      name: 'job.propose',
      args: {
        name: '메일 확인',
        goal: '새 메일을 읽는다',
        trigger: { type: 'gmail.new_message', accountId: 'primary' },
        steps: [{ type: 'action', id: 'read', connector: 'gmail', action: 'messages.search', params: { query: 'is:unread' } }],
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });
    const { summary, text } = card(readOnly.data);
    expect(summary).toMatchObject({ runOnceNow: true });
    expect(text).toContain('외부 전송 단계가 없습니다.');
    expect(text).not.toContain('[외부]');
  });
});
