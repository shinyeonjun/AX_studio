import { fileRefFromExecutionVariables, fileRefFromTriggerPayload } from '../../../contracts/mappers.js';
import { resolveCapability } from '../../../catalog/capability-graph.js';
import type { PortBinding } from '../../port-binding.js';
import type { Step, WorkflowIR } from '../../schema.js';

function textFromBoundValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['text', 'body', 'summary']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return undefined;
}

export interface AiDecisionBoundContext {
  bound: Record<string, unknown>;
  documentText?: string;
  emailBody?: string;
  hasDocumentArtifact: boolean;
  usesExplicitBindings: boolean;
}

export function resolveAiDecisionBindings(
  step: Extract<Step, { type: 'ai_decision' }>,
  ir: WorkflowIR,
  stepResults: Record<string, unknown>,
  variables: Record<string, unknown>,
  outputs?: Record<string, Record<string, unknown>>,
): AiDecisionBoundContext {
  const bindings = step.bindings ?? {};
  const inputContracts = step.inputContracts ?? {};
  const usesExplicitBindings = Object.keys(bindings).length > 0;
  const bound: Record<string, unknown> = {};
  let documentText: string | undefined;
  let emailBody: string | undefined;
  let hasDocumentArtifact = false;

  for (const [port, binding] of Object.entries(bindings)) {
    const value = resolveBindingValue(binding, ir, stepResults, variables, outputs);
    bound[port] = value;
    const contract = inputContracts[port];
    if (contract === 'DocumentArtifact') {
      hasDocumentArtifact = value != null;
      const text = textFromBoundValue(value);
      if (text) documentText = text;
    }
    if (contract === 'TextArtifact' || port === 'emailBody' || port === 'sourceText') {
      const text = textFromBoundValue(value);
      if (text) {
        if (port === 'emailBody') emailBody = text;
        else if (!documentText) documentText = text;
      }
    }
  }

  return { bound, documentText, emailBody, hasDocumentArtifact, usesExplicitBindings };
}

export function resolveTriggerOutput(
  outputPort: string,
  variables: Record<string, unknown>,
): unknown {
  if (outputPort === 'file') {
    return fileRefFromExecutionVariables(variables);
  }
  if (outputPort === 'message') {
    const messageId = variables.messageId;
    return fileRefFromTriggerPayload(variables) ?? {
      id: typeof messageId === 'string' ? messageId : undefined,
      messageId,
      channel: variables.channel,
      text: variables.text,
      from: variables.from,
      subject: variables.subject,
      snippet: variables.snippet,
    };
  }
  return variables[outputPort];
}

export function extractStepOutput(
  step: Extract<Step, { type: 'action' }>,
  outputPort: string,
  data: unknown,
): unknown {
  if (data == null) return undefined;

  const cap = resolveCapability(step.connector, step.action);
  const outputs = cap?.io?.outputs;
  if (!outputs || !(outputPort in outputs)) {
    return data;
  }

  if (outputs[outputPort] === 'TextArtifact' && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    for (const key of ['text', 'body', 'summary']) {
      if (typeof record[key] === 'string') return record[key];
    }
  }

  if (outputPort === 'text' && typeof data === 'object' && data !== null && 'text' in data) {
    return (data as Record<string, unknown>).text;
  }
  if (outputPort === 'body' && typeof data === 'object' && data !== null && 'body' in data) {
    return (data as Record<string, unknown>).body;
  }
  if (outputPort === 'rows' && Array.isArray(data)) return data;
  if (outputPort === 'sheet' && Array.isArray(data)) return data;
  if (outputPort === 'document' || outputPort === 'table' || outputPort === 'file') return data;

  if (typeof data === 'object' && outputPort in (data as Record<string, unknown>)) {
    return (data as Record<string, unknown>)[outputPort];
  }

  return data;
}

export function resolveBindingValue(
  binding: PortBinding,
  ir: WorkflowIR,
  stepResults: Record<string, unknown>,
  variables: Record<string, unknown>,
  outputs?: Record<string, Record<string, unknown>>,
): unknown {
  if (binding.from === 'trigger') {
    return resolveTriggerOutput(binding.output, variables);
  }

  const step = ir.steps.find((candidate) => candidate.id === binding.from);
  const typedOutput = outputs?.[binding.from]?.[binding.output];
  if (typedOutput !== undefined) return typedOutput;
  const data = stepResults[binding.from];
  if (!step) return data;
  if (step.type === 'ai_decision') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    const record = data as Record<string, unknown>;
    if (binding.output in record) return record[binding.output];
    if (binding.output === 'result') return record.result ?? record;
    return undefined;
  }
  if (step.type !== 'action') return data;
  return extractStepOutput(step, binding.output, data);
}
