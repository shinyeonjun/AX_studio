import type { AgentScopedContextMap } from '../../../scoped-context.js';
import type { AxCommand, AxUiPresentation } from '../../schema.js';

export interface ContextMemoryProposalInput {
  userMessage: string;
  hasWorkspaceSession?: boolean;
  sessionMemo?: AgentScopedContextMap;
  currentWorkflowId?: string;
  workflowPolicy?: AgentScopedContextMap;
}

export type ContextMemoryProposal = AxCommand | {
  kind: 'clarify';
  route: 'context_remember';
  message: string;
  confidence: number;
};

function contextValueFromRequest(message: string): string | undefined {
  const value = message.trim()
    .replace(/(?:[,，\s]*(?:(?:이것|이걸|이 내용|이 기준|이 규칙)(?:도|을|를)?\s*)?(?:기억해(?:줘|주세요)?|저장해(?:줘|주세요)?|기록해(?:줘|주세요)?|remember(?:\s+(?:this|that))?|save\s+(?:this|that))[.!?。！\s]*)$/iu, '')
    .replace(/^(?:기억해(?:줘|주세요)?|저장해(?:줘|주세요)?|기록해(?:줘|주세요)?)[,:：-]?\s*/iu, '')
    .replace(/[\s,，.!?。！？:：-]+$/u, '')
    .trim();
  if (!value || value.length > 1_200 || /^(?:이|그|저)?\s*(?:것|걸|내용|기준|규칙)(?:은|는|을|를)?$/iu.test(value)) return undefined;
  return value;
}

function nextContextRuleKey(context: AgentScopedContextMap | undefined): string | undefined {
  // The context schema rejects maps over 64 entries; don't offer an update it cannot persist.
  if (Object.keys(context ?? {}).length >= 64) return undefined;
  for (let index = 1; index <= 64; index += 1) {
    const key = `user_rule_${index}`;
    if (!Object.hasOwn(context ?? {}, key)) return key;
  }
  return undefined;
}

export function contextProposalCommand(input: ContextMemoryProposalInput): ContextMemoryProposal {
  const value = contextValueFromRequest(input.userMessage);
  if (!value) {
    return {
      kind: 'clarify',
      route: 'context_remember',
      message: '기억할 규칙이나 선호를 구체적으로 적어 주세요. 예: “앞으로 답변은 한국어로 짧게 해줘. 이걸 기억해줘.”',
      confidence: 1,
    };
  }

  const actions: AxUiPresentation['actions'] = [];
  if (input.hasWorkspaceSession) {
    const key = nextContextRuleKey(input.sessionMemo);
    if (!key) {
      return {
        kind: 'clarify', route: 'context_remember',
        message: '이 대화의 기억 공간이 가득 차서 저장하지 않았습니다. 기존 기준을 정리한 뒤 다시 요청해 주세요.',
        confidence: 1,
      };
    }
    actions.push({
      id: 'remember-session',
      label: '이 대화에 저장',
      value: `이 대화에 ${key} 규칙으로 저장해줘`,
      tone: 'secondary',
      purpose: 'confirm_context',
      contextUpdate: { scope: 'session', key, value },
    });
  }
  if (input.currentWorkflowId?.trim()) {
    const key = nextContextRuleKey(input.workflowPolicy);
    if (!key) {
      return {
        kind: 'clarify', route: 'context_remember',
        message: '이 workflow의 기억 공간이 가득 차서 저장하지 않았습니다. 기존 기준을 정리한 뒤 다시 요청해 주세요.',
        confidence: 1,
      };
    }
    actions.push({
      id: 'remember-workflow',
      label: '현재 workflow에 저장',
      value: `현재 workflow에 ${key} 규칙으로 저장해줘`,
      tone: 'secondary',
      purpose: 'confirm_context',
      contextUpdate: { scope: 'workflow', key, value, workflowId: input.currentWorkflowId.trim() },
    });
  }
  if (actions.length === 0) {
    return {
      kind: 'clarify', route: 'context_remember',
      message: '저장할 대화나 workflow가 없어 내용을 기억하지 않았습니다.',
      confidence: 1,
    };
  }

  return {
    name: 'ui.present',
    args: {
      title: '이 내용을 기억할까요?',
      subtitle: '저장 범위를 선택하면 아래 문장이 그대로 저장됩니다.',
      blocks: [{ type: 'note', text: value }],
      actions,
    },
  };
}
