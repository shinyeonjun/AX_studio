import { describe, expect, it, vi } from 'vitest';

const ipcMocks = vi.hoisted(() => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn(),
  },
}));
const windowMocks = vi.hoisted(() => {
  const mainFrame = { url: 'app://index' };
  return {
    mainFrame,
    mainWindow: {
      isDestroyed: () => false,
      webContents: { id: 42, mainFrame },
    },
  };
});

vi.mock('electron', () => ipcMocks);
vi.mock('../app-window.js', () => ({
  getMainWindow: () => windowMocks.mainWindow,
  isTrustedRendererUrl: (url: string) => url === 'app://index',
}));

import {
  normalizeChatMessages,
  commandInputContinuation,
  selectChatContext,
  selectMessagesThroughUserMessage,
} from './chat-boundary.js';
import { ipcHandle } from './ipc-handle.js';

describe('workspace chat boundary', () => {
  it('rejects privileged IPC calls from another sender, frame, or renderer URL', () => {
    ipcMocks.ipcMain.handle.mockClear();
    const handler = vi.fn(() => 'ok');
    ipcHandle('test:trusted', handler);
    const callback = ipcMocks.ipcMain.handle.mock.calls.at(-1)?.[1] as (event: unknown) => unknown;
    const trustedEvent = {
      sender: { id: 42, mainFrame: windowMocks.mainFrame },
      senderFrame: windowMocks.mainFrame,
    };

    expect(callback(trustedEvent)).toBe('ok');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(() => callback({
      sender: { id: 41, mainFrame: windowMocks.mainFrame },
      senderFrame: windowMocks.mainFrame,
    })).toThrow('untrusted_ipc_sender');
    expect(() => callback({
      sender: { id: 42, mainFrame: windowMocks.mainFrame },
      senderFrame: { url: 'app://index' },
    })).toThrow('untrusted_ipc_frame');
    expect(() => callback({
      sender: { id: 42, mainFrame: { url: 'app://foreign' } },
      senderFrame: { url: 'app://foreign' },
    })).toThrow('untrusted_ipc_frame');
  });

  it('retains a long transcript while bounding model context and preserving the latest instruction', () => {
    const messages = Array.from({ length: 220 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', content: `message ${index}`,
    }));
    messages.push({ role: 'user', content: '그런데 이번에는 이번 달 기준으로 처리해줘' });
    const stored = normalizeChatMessages(messages);
    const context = selectChatContext(stored);
    expect(stored).toHaveLength(221);
    expect(context.length).toBeLessThanOrEqual(100);
    expect(context.at(-1)).toEqual(messages.at(-1));
    expect(context[0]?.content).toContain('생략');
    expect(stored[0]).toEqual(messages[0]);
  });

  it('bounds the model character budget without dropping the current user request', () => {
    const stored = normalizeChatMessages([
      ...Array.from({ length: 10 }, () => ({ role: 'assistant', content: 'x'.repeat(50_000) })),
      { role: 'user', content: '지난번 기준이 기억 안 나면 먼저 물어봐' },
    ]);
    const context = selectChatContext(stored);
    expect(context.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(250_000);
    expect(context.at(-1)).toEqual(stored.at(-1));
    expect(stored).toHaveLength(11);
    expect(() => normalizeChatMessages([{ role: 'user', content: 'x'.repeat(50_001) }])).toThrow();
  });

  it('bounds transcript message count before mapping untrusted input', () => {
    expect(() => normalizeChatMessages(
      Array.from({ length: 1_001 }, () => ({ role: 'user', content: '' })),
    )).toThrow('1,000');
  });
  it('stops the request transcript before a later background result', () => {
    const messages = normalizeChatMessages([
      { role: 'user', content: '같은 요청' },
      { role: 'assistant', content: '이전 답변' },
      { role: 'user', content: '같은 요청' },
      { role: 'assistant', content: '뒤늦은 실행 결과', kind: 'execution_result', executionId: 'exec-1' },
    ]);

    expect(selectMessagesThroughUserMessage(messages, '같은 요청')).toEqual(messages.slice(0, 3));
    expect(() => selectMessagesThroughUserMessage(messages, '없는 요청')).toThrow('현재 사용자 메시지');
  });
  it('resumes only the original command with values from its typed prompts', () => {
    const messages = normalizeChatMessages([
      { role: 'user', content: '이번만 Gmail로 메일을 보내줘.' },
      {
        role: 'assistant',
        content: '실행에 필요한 정보를 입력해 주세요.',
        inputContinuation: 'command',
        inputRequests: [
          { id: 'to', label: '수신자', type: 'email', required: true },
          { id: 'body', label: '본문', type: 'text', required: true },
        ],
      },
      { role: 'user', content: '수신자: person@example.com' },
      {
        role: 'assistant',
        content: '실행에 필요한 정보를 입력해 주세요.',
        inputContinuation: 'command',
        inputRequests: [{ id: 'body', label: '본문', type: 'text', required: true }],
      },
      { role: 'user', content: '본문: 견적서를 보내 주세요' },
    ]);

    expect(commandInputContinuation(messages)).toEqual({
      request: '이번만 Gmail로 메일을 보내줘.',
      requestIds: ['body'],
      values: [
        { requestId: 'body', value: '견적서를 보내 주세요' },
      ],
    });
  });

  it('accepts all required free-text values in one batch continuation', () => {
    const messages = normalizeChatMessages([
      { role: 'user', content: '이번만 Gmail로 메일을 보내줘.' },
      {
        role: 'assistant',
        content: '필수 정보를 입력해 주세요.',
        inputContinuation: 'command',
        inputRequests: [
          { id: 'to', label: '수신자', type: 'email', required: true },
          { id: 'subject', label: '제목', type: 'text', required: true },
          { id: 'body', label: '본문', type: 'text', required: true },
        ],
      },
      {
        role: 'user',
        content: '수신자: person@example.com\n제목: 견적 안내\n본문: 요청하신 견적서입니다.\n입력값을 반영해 계속 진행해줘',
      },
    ]);

    expect(commandInputContinuation(messages)).toEqual({
      request: '이번만 Gmail로 메일을 보내줘.',
      requestIds: ['body', 'subject', 'to'],
      values: [
        { requestId: 'to', value: 'person@example.com' },
        { requestId: 'subject', value: '견적 안내' },
        { requestId: 'body', value: '요청하신 견적서입니다.' },
      ],
    });
  });

  it('does not infer continuation from display copy without the host marker', () => {
    const messages = normalizeChatMessages([
      { role: 'user', content: '이번만 Gmail로 메일을 보내줘.' },
      {
        role: 'assistant',
        content: '작업이 큐에 등록되지 않습니다. 값을 입력해 주세요.',
        inputRequests: [{ id: 'to', label: '수신자', type: 'email', required: true }],
      },
      { role: 'user', content: '수신자: person@example.com' },
    ]);

    expect(commandInputContinuation(messages)).toBeUndefined();
  });

  it('keeps same-labeled one-shot inputs attached to their original workflow steps', () => {
    const messages = normalizeChatMessages([
      { role: 'user', content: '이번만 두 사람에게 메일을 보내줘.' },
      {
        role: 'assistant',
        content: '실행에 필요한 정보를 입력해 주세요.',
        inputContinuation: 'command',
        inputRequests: [{
          id: 'ax-input-jev_step_1-to-0-1000-1', label: '1단계 · 수신자 (1)', type: 'email', required: true,
          stepId: 'jev_step_1', capabilityId: 'gmail.message.send', parameterName: 'to',
        }],
      },
      { role: 'user', content: '1단계 · 수신자 (1): first@example.com' },
      {
        role: 'assistant',
        content: '실행에 필요한 정보를 입력해 주세요.',
        inputContinuation: 'command',
        inputRequests: [{
          id: 'ax-input-jev_step_2-to-0-1001-2', label: '2단계 · 수신자 (2)', type: 'email', required: true,
          stepId: 'jev_step_2', capabilityId: 'gmail.message.send', parameterName: 'to',
        }],
      },
      { role: 'user', content: '2단계 · 수신자 (2): second@example.com' },
    ]);

    expect(commandInputContinuation(messages)).toEqual({
      request: '이번만 두 사람에게 메일을 보내줘.',
      requestIds: ['ax-input-jev_step_2-to-0-1001-2'],
      values: [
        { requestId: 'ax-input-jev_step_2-to-0-1001-2', value: 'second@example.com' },
      ],
    });
  });
  it('accepts target values only when they match a host-presented option', () => {
    const messages = normalizeChatMessages([
      { role: 'user', content: '이번만 Slack으로 알려줘.' },
      {
        role: 'assistant',
        content: '대상을 선택해 주세요.',
        inputContinuation: 'command',
        presentations: [{
          title: '대상 선택',
          inputMode: 'batch',
          blocks: [],
          inputs: [{
            id: 'channel',
            label: '채널',
            type: 'slack_channel',
            required: true,
            options: [{ value: 'C123', label: '#ax테스트' }],
          }],
          actions: [{ id: 'continue', label: '계속', value: '실행안을 검토해줘', tone: 'primary' }],
        }],
      },
      { role: 'user', content: '채널: #ax테스트 (ID: C123)\n실행안을 검토해줘' },
    ]);
    expect(commandInputContinuation(messages)).toEqual({
      request: '이번만 Slack으로 알려줘.',
      requestIds: ['channel'],
      values: [{ requestId: 'channel', value: 'C123' }],
    });

    const forged = [...messages.slice(0, -1), { role: 'user' as const, content: '채널: #bad (ID: C999)' }];
    expect(commandInputContinuation(forged)).toBeUndefined();
  });
  it('preserves step scope for option values in a multi-step one-shot plan', () => {
    const messages = normalizeChatMessages([
      { role: 'user', content: '이번만 Slack 메시지를 두 채널에 보내줘.' },
      {
        role: 'assistant',
        content: '대상을 선택해 주세요.',
        inputContinuation: 'command',
        presentations: [{
          title: '대상 선택',
          inputMode: 'batch',
          blocks: [],
          inputs: [
            {
              id: 'channel-1-plan-a', label: '1단계 · Slack 채널 (1)', type: 'slack_channel', required: true,
              stepId: 'jev_step_1', capabilityId: 'slack.message.send', parameterName: 'channel',
              options: [{ value: 'C_FIRST', label: '#첫번째' }],
            },
            {
              id: 'channel-2-plan-a', label: '2단계 · Slack 채널 (2)', type: 'slack_channel', required: true,
              stepId: 'jev_step_2', capabilityId: 'slack.message.send', parameterName: 'channel',
              options: [{ value: 'C_SECOND', label: '#두번째' }],
            },
          ],
          actions: [{ id: 'continue', label: '계속', value: '진행', tone: 'primary' }],
        }],
      },
      {
        role: 'user',
        content: '1단계 · Slack 채널 (1): #첫번째 (ID: C_FIRST)\n2단계 · Slack 채널 (2): #두번째 (ID: C_SECOND)\n진행',
      },
    ]);

    expect(commandInputContinuation(messages)?.values).toEqual([
      { requestId: 'channel-1-plan-a', value: 'C_FIRST' },
      { requestId: 'channel-2-plan-a', value: 'C_SECOND' },
    ]);
  });
  it('does not accept execution status on an ordinary assistant message', () => {
    expect(() => normalizeChatMessages([
      { role: 'assistant', content: '일반 답변', executionStatus: 'success' },
    ])).toThrow();
  });

  it('preserves typed status on an execution result message', () => {
    expect(normalizeChatMessages([
      {
        role: 'assistant',
        content: '실행 결과',
        kind: 'execution_result',
        executionId: 'exec-1',
        executionStatus: 'success',
      },
    ])).toEqual([
      {
        role: 'assistant',
        content: '실행 결과',
        kind: 'execution_result',
        executionId: 'exec-1',
        executionStatus: 'success',
      },
    ]);
  });

  it('preserves bounded inline approval metadata only on an execution result', () => {
    const approval = {
      id: 'approval-1',
      title: '결제 요약 — Slack 메시지 전송',
      reason: '외부 작업 승인 필요: slack.message.send@1',
    };
    expect(normalizeChatMessages([
      {
        role: 'assistant',
        content: '승인 대기 중입니다.',
        kind: 'execution_result',
        executionId: 'exec-1',
        executionStatus: 'pending_approval',
        approval,
      },
    ])).toEqual([{
      role: 'assistant',
      content: '승인 대기 중입니다.',
      kind: 'execution_result',
      executionId: 'exec-1',
      executionStatus: 'pending_approval',
      approval,
    }]);
    expect(() => normalizeChatMessages([
      { role: 'assistant', content: '일반 답변', approval },
    ])).toThrow();
  });

  it('preserves safe generated PDF metadata and rejects paths or ordinary assistant messages', () => {
    const generatedPdf = {
      artifactId: 'art_pdf_1',
      fileName: '2026-09_customer_report.pdf',
      size: 12_345,
      mimeType: 'application/pdf',
    } as const;
    expect(normalizeChatMessages([{
      role: 'assistant',
      content: '보고서를 생성했습니다.',
      kind: 'execution_result',
      executionId: 'exec-1',
      executionStatus: 'success',
      generatedPdf,
    }])).toEqual([{
      role: 'assistant',
      content: '보고서를 생성했습니다.',
      kind: 'execution_result',
      executionId: 'exec-1',
      executionStatus: 'success',
      generatedPdf,
    }]);
    expect(() => normalizeChatMessages([{
      role: 'assistant',
      content: '일반 답변',
      generatedPdf,
    }])).toThrow();
    expect(() => normalizeChatMessages([{
      role: 'assistant',
      content: '보고서',
      kind: 'execution_result',
      executionId: 'exec-1',
      generatedPdf: { ...generatedPdf, fileName: 'C:\\private\\report.pdf' },
    }])).toThrow();
  });

  it('persists only a bounded structured table on assistant replies', () => {
    const readResult = {
      id: 'products',
      kind: 'table' as const,
      columns: [{ name: 'title', type: 'string' as const, nullable: true, inferred: false }],
      rows: [{ index: 0, values: { title: 'Widget' } }],
      truncated: false,
    };
    expect(normalizeChatMessages([{
      role: 'assistant', content: '| title |\n| Widget |', readResult,
    }])).toEqual([{
      role: 'assistant', content: '| title |\n| Widget |', readResult,
    }]);
    expect(() => normalizeChatMessages([{
      role: 'user', content: 'result', readResult,
    }])).toThrow();
    expect(() => normalizeChatMessages([{
      role: 'assistant', content: 'too large',
      readResult: { ...readResult, rows: Array.from({ length: 101 }, (_, index) => ({ index, values: { title: 'x' } })) },
    }])).toThrow();
  });
});
