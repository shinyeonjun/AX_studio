import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkspaceChatMessage } from '@ax-studio/core';
import { WorkspaceContextPanel } from './WorkspaceContextPanel';
import {
  resolveWorkspaceFlowPresentation,
  latestWorkspaceExecutionResult,
} from './WorkspaceFlowPanel';
import {
  resolveWorkspaceExecutionStatus,
  WorkspaceRunResultCard,
} from './WorkspaceRunResultCard';

const emptyFlow = {
  messages: [],
  busy: false,
  progress: '',
};

describe('Workspace context tabs', () => {
  it('renders 자료, 흐름, 워크플로우 as accessible tabs', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceContextPanel
        sources={[]}
        sourceBusy={false}
        onAttachSource={async () => undefined}
        flow={<div>flow</div>}
        workflow={<div>workflow</div>}
        workflowAvailable
      />,
    );

    expect(markup.match(/role="tab"/g) ?? []).toHaveLength(3);
    expect(markup).toContain('자료');
    expect(markup).toContain('흐름');
    expect(markup).toContain('워크플로우');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-controls="workspace-context-panel-flow"');
  });
});

describe('Workspace flow state', () => {
  it('starts in the request state when no work has started', () => {
    expect(resolveWorkspaceFlowPresentation(emptyFlow)).toMatchObject({
      status: 'idle',
      statusLabel: '대기 중',
      activeStage: 0,
    });
  });

  it('uses live progress while the request or discovery is busy', () => {
    expect(resolveWorkspaceFlowPresentation({
      ...emptyFlow,
      busy: true,
      progress: '연결된 리소스를 확인하고 있습니다',
    })).toMatchObject({
      status: 'running',
      activeStage: 1,
      message: '연결된 리소스를 확인하고 있습니다',
    });
  });

  it('does not show a previous terminal result while a new request is running', () => {
    const success: WorkspaceChatMessage = {
      role: 'assistant',
      content: '완료했습니다.',
      kind: 'execution_result',
      executionStatus: 'success',
    };

    expect(resolveWorkspaceFlowPresentation({
      ...emptyFlow,
      messages: [success],
      busy: true,
      progress: '새 요청을 처리하고 있습니다.',
    })).toMatchObject({
      status: 'running',
      activeStage: 1,
      message: '새 요청을 처리하고 있습니다.',
    });
  });

  it('shows method review after a discovery result is ready', () => {
    expect(resolveWorkspaceFlowPresentation({
      ...emptyFlow,
      discovery: {
        status: 'ready_to_publish',
        progress: '결제 완료 주문을 금액순으로 정리하는 방법을 찾았습니다.',
        replaySummary: { total: 3, passed: 3, failed: 0 },
      },
    })).toMatchObject({
      status: 'review',
      statusLabel: '방법 검토',
      activeStage: 2,
    });
  });

  it('maps pending approval and terminal execution results to distinct stages', () => {
    const pending: WorkspaceChatMessage = {
      role: 'assistant',
      content: '승인이 필요합니다.',
      kind: 'execution_result',
      executionStatus: 'pending_approval',
      approval: { id: 'approval-1', title: 'Slack으로 공유', reason: '외부 채널에 메시지를 보냅니다.' },
    };
    const success: WorkspaceChatMessage = {
      role: 'assistant',
      content: '완료했습니다.',
      kind: 'execution_result',
      executionStatus: 'success',
    };

    expect(resolveWorkspaceFlowPresentation({ ...emptyFlow, messages: [pending] })).toMatchObject({
      status: 'approval',
      activeStage: 3,
      message: 'Slack으로 공유',
    });
    expect(resolveWorkspaceFlowPresentation({ ...emptyFlow, messages: [pending, success] })).toMatchObject({
      status: 'success',
      statusLabel: '실행 완료',
      activeStage: 4,
    });
    expect(latestWorkspaceExecutionResult([pending, success])).toBe(success);
  });

  it('recognizes a legacy completed execution result without structured status metadata', () => {
    const legacyCompleted: WorkspaceChatMessage = {
      role: 'assistant',
      content: '「invoice-paid 한국어 요약」 실행이 완료되었습니다.\n결론: 결제 완료 인보이스입니다.',
      kind: 'execution_result',
      executionId: 'exec-legacy-completed',
    };

    expect(resolveWorkspaceFlowPresentation({
      ...emptyFlow,
      messages: [legacyCompleted],
      workflow: { title: 'invoice-paid 한국어 요약' },
    })).toMatchObject({
      status: 'success',
      statusLabel: '실행 완료',
      activeStage: 4,
    });
  });

  it('only infers legacy statuses from the host-generated status sentence', () => {
    expect(resolveWorkspaceExecutionStatus(undefined, '「업무」 실행이 완료되었습니다.')).toBe('success');
    expect(resolveWorkspaceExecutionStatus(undefined, '업무 실행이 승인 대기 중입니다.')).toBe('pending_approval');
    expect(resolveWorkspaceExecutionStatus(undefined, '「업무」 실행이 취소되었습니다.')).toBe('cancelled');
    expect(resolveWorkspaceExecutionStatus(undefined, '업무 실행에 실패했습니다.')).toBe('failed');
    expect(resolveWorkspaceExecutionStatus(undefined, '작업이 끝났습니다.')).toBeUndefined();
    expect(resolveWorkspaceExecutionStatus('success', '업무 실행에 실패했습니다.')).toBe('success');
  });

  it('uses the same legacy status in the execution result card', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceRunResultCard
        content={'「invoice-paid 한국어 요약」 실행이 완료되었습니다.\n결론: 결제 완료 인보이스입니다.'}
      />,
    );

    expect(markup).toContain('실행 완료');
    expect(markup).not.toContain('실행 결과');
  });

  it('prioritizes a surfaced error so recovery remains visible', () => {
    expect(resolveWorkspaceFlowPresentation({
      ...emptyFlow,
      error: '실행 결과를 불러오지 못했습니다.',
    })).toMatchObject({
      status: 'error',
      statusLabel: '확인 필요',
      message: '실행 결과를 불러오지 못했습니다.',
    });
  });
});
