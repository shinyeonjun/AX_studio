import type { ZodType } from 'zod';
import type { ChatMessage } from './model/chat.js';

export type AgentRole = 'interview' | 'direct_compile' | 'investigate';

export interface AgentExecutionPolicy {
  maxTurns: 1;
  timeoutMs: number;
  cloudAllowed?: boolean;
}

export interface AgentRoleDefinition {
  role: AgentRole;
  skillId: string;
  temperature: number;
  policy: AgentExecutionPolicy;
  modeInstructions?: string;
}

export interface InterviewAgentContext {
  workflow: import('../interviewer/workflow-schema.js').InterviewDraft;
  completeness: import('../interviewer/requiredness.js').CompletenessResult;
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
}

export type AgentContext =
  | InterviewAgentContext
  | DirectCompileAgentContext
  | InvestigateAgentContext;

export interface AgentRun<T> {
  role: AgentRole;
  outputSchema: ZodType<T>;
  context: AgentContext;
  messages?: ChatMessage[];
  user?: string;
  temperature?: number;
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
  policy: AgentExecutionPolicy;
  logs: AgentRunLog[];
}
