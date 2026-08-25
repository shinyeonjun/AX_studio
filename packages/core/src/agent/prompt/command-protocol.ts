import { renderAgentScopedContextBlock, type AgentScopedContextMap } from '../scoped-context.js';
import { loadAgentSkill, renderSkillTemplate } from '../skill-load.js';

export interface CommandProtocolOptions {
  connectedConnectors?: string[];
  currentWorkflowId?: string;
  workspaceSources?: unknown[];
  sessionMemo?: AgentScopedContextMap;
  workflowPolicy?: AgentScopedContextMap;
  commands: unknown[];
  outputInstructions: string;
}

export function buildCommandProtocolPrompt(options: CommandProtocolOptions): string {
  const skill = loadAgentSkill('command');
  return renderSkillTemplate(skill.body, {
    connected_connectors: options.connectedConnectors?.join(', ') || '없음',
    current_workflow_id: options.currentWorkflowId?.trim() || '없음',
    session_sources_manifest: options.workspaceSources?.length
      ? JSON.stringify(options.workspaceSources)
      : '[]',
    session_memo_block: renderAgentScopedContextBlock('session memo', options.sessionMemo ?? {}),
    workflow_policy_block: renderAgentScopedContextBlock('workflow policy', options.workflowPolicy ?? {}),
    command_contracts: JSON.stringify(options.commands),
    output_instructions: options.outputInstructions,
  });
}
