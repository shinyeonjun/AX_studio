import { pauseForDeterministicBusyCheck } from './timing.js';
import type { E2EChatReply, E2EChatRequest } from './contracts.js';

function emptyReply(content: string): E2EChatReply {
  return {
    content,
    changedWorkflowIds: [],
    removedWorkflowIds: [],
    inputRequests: [],
    presentations: [],
  };
}

/**
 * Deterministic provider replacement for Electron E2E only.
 *
 * It deliberately speaks through the same host result contract as the real
 * command chat. It never reaches a provider, connector, or network.
 */
export async function runE2EChat(request: E2EChatRequest): Promise<E2EChatReply> {
  await pauseForDeterministicBusyCheck();
  const instruction = request.userMessage.trim();
  const core = request.core;

  if (instruction === '__e2e:source-read__') {
    const sessionId = request.workspaceSessionId;
    const source = sessionId
      ? core.workspaceSources.list(sessionId).find((entry) => entry.status === 'ready')
      : undefined;
    if (!sessionId || !source) return emptyReply('E2E source_not_found');
    const result = core.workspaceSources.read(sessionId, source.id, 4_000);
    return emptyReply(
      `E2E source_read_ok file=${result.source.fileName} engine=${result.source.engine ?? result.document.engine ?? 'unknown'} pages=${result.source.summary?.pageCount ?? result.document.pages.length}`,
    );
  }

  if (instruction === '__e2e:workflow-create__') {
    const result = await core.commandService.execute(
      {
        name: 'workflow.create',
        args: {
          name: 'E2E 업무',
          goal: 'Electron 경계에서 workflow 등록을 검증합니다.',
          steps: [{
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#e2e', text: 'E2E workflow test' },
          }],
        },
      },
      { executionContext: { origin: 'agent' } },
    );
    const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? result.data as { workflowId?: unknown }
      : undefined;
    if (result.status !== 'ok' || typeof data?.workflowId !== 'string') {
      return emptyReply(`E2E workflow_create_${result.status}`);
    }
    return {
      ...emptyReply('E2E workflow_created'),
      changedWorkflowIds: [data.workflowId],
    };
  }

  if (instruction === '__e2e:presentation__') {
    return {
      ...emptyReply('E2E presentation_ready'),
      presentations: [{
        title: 'E2E 확인 카드',
        subtitle: 'host renderer interaction',
        inputMode: 'individual',
        blocks: [{ type: 'decision', label: '상태', value: '검증 대기', reason: '버튼을 눌러 다음 대화를 이어갑니다.' }],
        inputs: [],
        actions: [{ id: 'continue', label: '진행', value: '__e2e:plain-reply__', tone: 'primary', purpose: 'reply' }],
      }],
    };
  }

  if (instruction === '__e2e:inline-approval__') {
    core.runtime.setConnector('slack', {
      name: 'e2e-slack',
      execute: async () => ({ ok: true, data: { id: 'e2e-message' } }),
    });
    core.runtime.enqueueEphemeralWorkflow({
      name: 'E2E 일회 승인',
      goal: '승인 후에만 테스트 메시지를 전송합니다.',
      version: 1,
      inputs: [],
      steps: [
        {
          type: 'action',
          id: 'send',
          connector: 'slack',
          action: 'message.send',
          actionRef: 'slack.message.send',
          params: { channel: '#e2e', text: 'E2E approval test' },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    }, { workspaceSessionId: request.workspaceSessionId });
    return emptyReply('E2E inline_approval_queued');
  }

  if (instruction === '__e2e:input__') {
    return {
      ...emptyReply('E2E input_required'),
      inputRequests: [{
        id: 'e2e-recipient',
        label: '테스트 수신자',
        type: 'email',
        required: true,
        placeholder: 'qa@example.com',
        reason: '입력 카드 렌더링과 후속 메시지를 검증합니다.',
      }],
    };
  }

  return emptyReply(`E2E reply: ${instruction.replaceAll('_', '-')}`);
}
