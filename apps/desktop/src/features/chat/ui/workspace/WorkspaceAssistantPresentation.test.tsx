import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceAssistantPresentation } from './WorkspaceAssistantPresentation.js';

describe('WorkspaceAssistantPresentation', () => {
  it('renders command inputs as one batch submission', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceAssistantPresentation
        inputRequests={[
          { id: 'to', label: '수신자', type: 'email', required: true },
          { id: 'body', label: '본문', type: 'text', required: true },
        ]}
        busy={false}
        interactive
        onSend={async () => undefined}
      />,
    );

    expect(markup).toContain('수신자');
    expect(markup).toContain('본문');
    expect(markup).toContain('입력값으로 계속');
    expect(markup).not.toContain('>입력</button>');
  });

  it('keeps decision-only cards that are not host-marked as diagnostic', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceAssistantPresentation
        presentations={[{
          title: '조회 결과 요약', inputMode: 'individual', inputs: [], actions: [],
          blocks: [{ type: 'decision', label: '상태', value: '확인 필요' }],
        }]}
        busy={false}
        interactive
        onSend={async () => undefined}
      />,
    );
    expect(markup).toContain('조회 결과 요약');
  });

  it('shows input requests no presentation covers even when another card has inputs', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceAssistantPresentation
        presentations={[{
          title: '공유 대상 선택', inputMode: 'individual', blocks: [], actions: [],
          inputs: [{ id: 'slack-channel', label: 'Slack 채널', type: 'text', required: true }],
        }]}
        inputRequests={[{ id: 'mail-to', label: '메일 수신자', type: 'email', required: true }]}
        busy={false}
        interactive
        onSend={async () => undefined}
      />,
    );
    expect(markup).toContain('메일 수신자');
    expect(markup).toContain('추가 정보가 필요합니다');
  });

  it('filters out host-marked diagnostic cards like 실행 전 계획 검사', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceAssistantPresentation
        presentations={[
          {
            title: '실행 전 계획 검사',
            role: 'diagnostic',
            inputMode: 'individual',
            inputs: [],
            actions: [],
            blocks: [
              { type: 'decision', label: '타입·의존 관계', value: 'Host 검사 통과' },
              { type: 'decision', label: '요구 충족·범위 보존', value: 'Jev 검토 통과' },
            ],
          },
        ]}
        busy={false}
        interactive
        onSend={async () => undefined}
      />,
    );

    expect(markup).toBe('');
    expect(markup).not.toContain('실행 전 계획 검사');
    expect(markup).not.toContain('Host 검사 통과');
  });

  it('deduplicates input cards when presentations already include inputs', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceAssistantPresentation
        presentations={[
          {
            title: '공유 대상 선택',
            inputMode: 'individual',
            blocks: [],
            inputs: [
              { id: 'slack-channel', label: 'Slack 채널', type: 'text', required: true },
            ],
            actions: [
              { id: 'review', label: '선택하고 실행안 검토', value: '검토', tone: 'secondary', purpose: 'reply' },
            ],
          },
        ]}
        inputRequests={[
          { id: 'slack-channel', label: 'Slack 채널', type: 'text', required: true },
        ]}
        busy={false}
        interactive
        onSend={async () => undefined}
      />,
    );

    expect(markup).toContain('공유 대상 선택');
    expect(markup).toContain('선택하고 실행안 검토');
    // Must NOT have the duplicate fallback card
    expect(markup).not.toContain('추가 정보가 필요합니다');
    expect(markup).not.toContain('입력값으로 계속');
  });
  it('marks external steps with a badge and renders confirm_mutation danger actions', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceAssistantPresentation
        presentations={[{
          title: '현재 workflow를 삭제할까요?', inputMode: 'individual', inputs: [],
          blocks: [
            { type: 'decision', label: '삭제할 workflow', value: '주간 보고 (wf_123) · 버전 2' },
            { type: 'steps', title: '단계별 연결·동작·대상', items: [
              '[외부] send: slack / postMessage · 외부 전송 · 대상: channel=#general',
              'read: gmail / search · 부작용 없음(조회) · 대상: 지정된 대상 없음',
            ] },
          ],
          actions: [{ id: 'confirm_mutation:tok', label: '삭제 확인', value: '현재 workflow를 삭제할게요', tone: 'danger', purpose: 'confirm_mutation' }],
        }]}
        busy={false}
        interactive
        onSend={async () => undefined}
      />,
    );
    expect(markup).toContain('<span class="ax-workspace-presentation-external">외부</span> send: slack / postMessage');
    expect(markup).not.toContain('[외부]');
    expect(markup).toContain('<li>read: gmail / search');
    expect(markup).toContain('ax-workspace-presentation-action--danger');
    expect(markup).toContain('삭제 확인');
  });
});
