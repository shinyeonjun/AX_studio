import type { Connector, WorkflowIR } from '@ax-studio/core';

/** Fixed synthetic identities; available only through the existing gated E2E chat seam. */
export function syntheticSlackApprovalConnector(): Connector {
  const channels: Record<string, { id: string; label: string }> = {
    '#e2e': { id: 'C12345678', label: '#e2e' },
    C12345678: { id: 'C12345678', label: '#e2e' },
    '#e2e-edited': { id: 'C87654321', label: '#e2e-edited' },
    C87654321: { id: 'C87654321', label: '#e2e-edited' },
  };
  return {
    name: 'e2e-slack',
    async prepareMessageSend(draft) {
      if (draft.tool !== 'slack') throw new Error('tool_result_identity_unverified');
      const destination = channels[draft.channel];
      if (!destination) throw new Error('tool_result_destination_unknown');
      return {
        provider: 'slack', accountId: 'U12345678', accountLabel: 'E2E synthetic bot',
        workspaceId: 'T12345678', workspaceLabel: 'E2E synthetic workspace',
        destinationId: destination.id, destinationLabel: destination.label,
      };
    },
    async execute(action, params, ctx) {
      // The audit is part of the existing execution log, not a renderer-controlled
      // counter. Every synthetic connector invocation is recorded before validation.
      ctx.log({ at: new Date().toISOString(), level: 'info', code: 'e2e_slack_send',
        message: 'Synthetic Slack connector invoked',
        data: { action, params: structuredClone(params), literalMessage: ctx.literalMessage === true,
          executionId: ctx.executionId, workspaceSessionId: ctx.workspaceSessionId } });
      if (action !== 'message.send' || typeof params.channel !== 'string' || !channels[params.channel]) {
        return { ok: false, errorCode: 'tool_result_destination_unknown', error: 'Unknown synthetic destination' };
      }
      // Keep a genuine in-flight UI interval for repeated pointer/keyboard input.
      await new Promise<void>(resolve => setTimeout(resolve, 250));
      return { ok: true, data: { ts: '100.001', channel: params.channel } };
    },
  };
}

export function syntheticSlackApprovalPlan(legacy = false): WorkflowIR {
  return {
    name: legacy ? 'E2E legacy approval' : 'E2E 일회 승인',
    goal: '승인 후에만 테스트 메시지를 전송합니다.', version: 1, inputs: [],
    steps: [{ type: 'action', id: 'send', connector: 'slack', action: 'message.send',
      actionRef: 'slack.message.send', params: { channel: '#e2e', text: 'E2E approval test' }, sideEffect: 'EXTERNAL' },
    // A continuation makes this a generic workflow approval, outside the final
    // one-action editable-result contract. The false branch must never dispatch.
    ...(legacy ? [{ type: 'if' as const, id: 'finish',
      condition: { op: 'eq' as const, left: { lit: true }, right: { lit: false } }, thenStepIds: ['never-send'] },
    { type: 'action' as const, id: 'never-send', connector: 'slack', action: 'message.send',
      actionRef: 'slack.message.send', params: { channel: '#e2e', text: 'Must never send' }, sideEffect: 'EXTERNAL' as const }] : [])],
    permissions: {}, approval: [], allowExternalAuto: false,
    assumptions: [], sideEffects: {}, dataPolicy: {},
  };
}
