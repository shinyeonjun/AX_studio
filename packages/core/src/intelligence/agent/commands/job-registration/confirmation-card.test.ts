import { describe, expect, it } from 'vitest';
import type { AxUiPresentation } from '../schema.js';
import { commandChatContext, connectedService, dailyBriefArgs } from './fixtures.js';

function card(data: unknown): { presentation: AxUiPresentation; text: string; summary: Record<string, unknown> } {
  const value = data as { presentation: AxUiPresentation; summary: Record<string, unknown> };
  return { presentation: value.presentation, text: JSON.stringify(value.presentation), summary: value.summary };
}

describe('job confirmation card schedule wording', () => {
  it('shows the schedule in plain Korean with next run dates, never the cron text', async () => {
    const { service, chat } = await connectedService();
    const response = await service.execute({ name: 'job.propose', args: dailyBriefArgs }, { ...commandChatContext, workspaceSessionId: chat.id });
    const { text } = card(response.data);
    expect(text).toContain('일정: 매일 오후 9:00');
    expect(text).toMatch(/다음 실행: \d+월 \d+일\([월화수목금토일]\) 오후 9:00/u);
    expect(text).not.toContain('0 21 * * *');
    expect(text).not.toMatch(/cron/iu);
  });
});

describe('job confirmation card safety defaults', () => {
  it('does not auto-send or run now unless the proposal explicitly opts in', async () => {
    const { service, chat } = await connectedService();
    const { runOnceNow: _run, allowExternalAuto: _auto, ...args } = dailyBriefArgs;
    const response = await service.execute({ name: 'job.propose', args }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('ok');
    const { text, summary } = card(response.data);
    expect(summary).toMatchObject({ runOnceNow: false, allowExternalAuto: false });
    expect(text).toContain('자동 발송: 꺼짐 — [외부] 단계는 보낼 때마다 승인을 받습니다.');
    expect(text).toContain('지금은 실행하지 않고 시작 조건만 켭니다.');
  });

  it('lists every step with connector, action, side effect and resolved destination', async () => {
    const { service, chat } = await connectedService();
    const response = await service.execute({ name: 'job.propose', args: dailyBriefArgs }, { ...commandChatContext, workspaceSessionId: chat.id });

    const { presentation, text } = card(response.data);
    const steps = presentation.blocks.find((block) => block.type === 'steps' && block.title === '단계별 연결·동작·대상');
    expect(steps).toBeDefined();
    const items = (steps as { items: string[] }).items;
    // The card numbers the steps; internal step ids are not shown.
    expect(items.find((item) => item.includes('HTTP 요청'))).toMatch(/^HTTP 요청 · 읽기만 함 · 대상: .*경로 \/repos\/shinyeonjun\/AX_studio\/commits/u);
    expect(items.find((item) => item.includes('Slack 메시지'))).toMatch(/^\[외부\] Slack 메시지 · 외부 전송 · 대상: 채널 #ax테스트2/u);
    expect(items.join(' ')).not.toMatch(/(^|\s)(fetch|notify):/u);
    expect(text).toContain('자동 발송: 켜짐 — [외부] 단계는 승인 없이 보냅니다.');
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
