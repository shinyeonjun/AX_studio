import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseWorkspaceCommand } from '../workspace/commands.js';
import {
  defaultSideEffectForHttpMethod,
  interactionModeFromCommand,
  isPlainChatSideEffectAllowed,
  isToolAllowedInMode,
  filterToolCallsForMode,
  DEFAULT_SAVED_WORKFLOW_ACTIVE,
  workflowLifecycleFromActive,
  isTriggerArmed,
  usesCliWireEnvelope,
  parseToolCallsJsonPayload,
} from './index.js';
import { DesignToolCallSchema } from '../design-tools/types.js';

describe('platform lifecycle', () => {
  it('separates workflow document state from run state', () => {
    expect(workflowLifecycleFromActive(false, false)).toBe('draft');
    expect(workflowLifecycleFromActive(false, true)).toBe('disabled');
    expect(workflowLifecycleFromActive(true, true)).toBe('enabled');
    expect(isTriggerArmed('enabled')).toBe(true);
    expect(isTriggerArmed('disabled')).toBe(false);
    expect(DEFAULT_SAVED_WORKFLOW_ACTIVE).toBe(false);
  });
});

describe('platform sideEffect policy', () => {
  it('allows plain chat only NONE and REVERSIBLE', () => {
    expect(isPlainChatSideEffectAllowed('NONE')).toBe(true);
    expect(isPlainChatSideEffectAllowed('REVERSIBLE')).toBe(true);
    expect(isPlainChatSideEffectAllowed('EXTERNAL')).toBe(false);
    expect(isPlainChatSideEffectAllowed('EXTERNAL_HIGH')).toBe(false);
  });

  it('uses HTTP method only as ingest default', () => {
    expect(defaultSideEffectForHttpMethod('GET')).toBe('NONE');
    expect(defaultSideEffectForHttpMethod('post')).toBe('EXTERNAL');
  });
});

describe('platform mode policy', () => {
  it('routes slash commands to authoring mode', () => {
    expect(interactionModeFromCommand(parseWorkspaceCommand('hello'))).toBe('plain_chat');
    expect(interactionModeFromCommand(parseWorkspaceCommand('/once run'))).toBe('authoring');
    expect(interactionModeFromCommand(parseWorkspaceCommand('/workflow save'))).toBe('authoring');
  });

  it('blocks workflow.inspect in plain chat and workflows.* in authoring', () => {
    expect(isToolAllowedInMode('workflow.inspect', 'plain_chat')).toBe(false);
    expect(isToolAllowedInMode('capabilities.list', 'plain_chat')).toBe(true);
    expect(isToolAllowedInMode('workflows.run', 'authoring')).toBe(false);
    expect(isToolAllowedInMode('workflow.inspect', 'authoring')).toBe(true);
  });

  it('filters tool calls by mode', () => {
    const calls = [
      { tool: 'capabilities.list' as const },
      { tool: 'workflow.inspect' as const },
    ];
    expect(filterToolCallsForMode(calls, 'plain_chat')).toEqual([{ tool: 'capabilities.list' }]);
  });
});

describe('platform provider envelope', () => {
  it('detects CLI providers', () => {
    expect(usesCliWireEnvelope('codex-cli')).toBe(true);
    expect(usesCliWireEnvelope('openai-api')).toBe(false);
  });

  it('parses toolCalls JSON string payloads', () => {
    const schema = z.object({ id: z.string() });
    const parsed = parseToolCallsJsonPayload('[{"id":"a"}]', schema);
    expect(parsed).toEqual([{ id: 'a' }]);
  });
});
