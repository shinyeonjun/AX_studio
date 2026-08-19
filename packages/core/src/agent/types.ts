import type { ZodType } from 'zod';
import type { ChatMessage } from './model/chat.js';

export type AgentRole = 'interview' | 'direct_compile' | 'investigate' | 'revise';

export interface AgentExecutionPolicy {
  maxTurns: 1;
  timeoutMs: number;
  cloudAllowed?: boolean;
}

export interface AgentRoleDefinition {
  role: AgentRole;
  /** Agent harness SKILL.md id (interview, investigate, revise). Not a saved workflow. */
  agentSkillId: string;
  temperature: number;
  policy: AgentExecutionPolicy;
  modeInstructions?: string;
}

export interface InterviewAgentContext {
  workflow: import('../interview/workflow-schema.js').InterviewDraft;
  completeness: import('../interview/requiredness.js').CompletenessResult;
  connectedConnectors: string[];
  nowIso: string;
}

export interface DirectCompileAgentContext {
  connectedConnectors?: string[];
  nowIso: string;
}

export interface InvestigateAgentContext {
  skillGoal: string;
  taskGoal: string;
  evidence: Array<{ source: string; detail: string }>;
  untrustedData?: string;
  connectedConnectors: string[];
}

export interface ReviseAgentContext {
  workflowJson: string;
  instruction: string;
}

export type AgentContext =
  | InterviewAgentContext
  | DirectCompileAgentContext
  | InvestigateAgentContext
  | ReviseAgentContext;

export interface AgentProgressEvent {
  message: string;
}

export interface AgentRun<T> {
  role: AgentRole;
  outputSchema: ZodType<T>;
  context: AgentContext;
  messages?: ChatMessage[];
  user?: string;
  temperature?: number;
  sessionId?: string;
  cloudAllowed?: boolean;
  onProgress?: (event: AgentProgressEvent) => void;
}

export interface AgentRunLog {
  level: 'info' | 'error';
  message: string;
}

export interface AgentResult<T> {
  output: T;
  role: AgentRole;
  provider: string;
  durationMs: number;
  promptChars: number;
  policy: AgentExecutionPolicy;
  logs: AgentRunLog[];
}
