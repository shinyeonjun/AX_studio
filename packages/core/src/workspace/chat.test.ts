import { describe, expect, it } from 'vitest';
import { zodToCodexJsonSchema, zodToJsonSchema } from '../agent/model/cli-json.js';
import {
  expandWorkspaceChatWireEnvelope,
  normalizeWorkspaceChatOutput,
  workspaceChatOutputSchemaForProvider,
  WorkspaceChatWireEnvelopeSchema,
} from './chat.js';

describe('workspace chat codex wire schema', () => {
  it('converts workspace wire envelope for codex output-schema', () => {
    const schema = workspaceChatOutputSchemaForProvider('codex-cli');
    expect(schema).toBe(WorkspaceChatWireEnvelopeSchema);
    const json = zodToCodexJsonSchema(schema);
    expect(json.type).toBe('object');
    expect(json.oneOf).toBeUndefined();
    expect(json.required).toEqual(Object.keys(json.properties as object));
    const properties = json.properties as Record<string, Record<string, unknown>>;
    expect(properties.kind.type).toBe('string');
    expect(properties.message.type).toBe('string');
    expect(properties.toolCalls.type).toBe('string');
    expect(JSON.stringify(json)).not.toContain('"oneOf"');
  });

  it('uses the same object envelope for Claude structured output', () => {
    const schema = workspaceChatOutputSchemaForProvider('claude-cli');
    expect(schema).toBe(WorkspaceChatWireEnvelopeSchema);
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe('object');
    expect(json.oneOf).toBeUndefined();
    expect(zodToCodexJsonSchema(schema).type).toBe('object');
    expect(normalizeWorkspaceChatOutput('claude-cli', {
      kind: 'reply',
      message: '확인했습니다',
      toolCalls: '',
    })).toEqual({ kind: 'reply', message: '확인했습니다' });
  });

  it('never sends the native workspace union as a codex root schema', () => {
    const nativeJson = zodToCodexJsonSchema(workspaceChatOutputSchemaForProvider('codex-cli'));
    expect(nativeJson.type).toBe('object');
    expect(zodToCodexJsonSchema(WorkspaceChatWireEnvelopeSchema).type).toBe('object');
  });

  it('expands reply wire envelope', () => {
    expect(
      expandWorkspaceChatWireEnvelope({
        kind: 'reply',
        message: '안녕하세요',
        toolCalls: '',
      }),
    ).toEqual({ kind: 'reply', message: '안녕하세요' });
  });

  it('expands tools wire envelope', () => {
    expect(
      expandWorkspaceChatWireEnvelope({
        kind: 'tools',
        message: '',
        toolCalls: JSON.stringify([{ tool: 'connections.list' }]),
      }),
    ).toEqual({
      kind: 'tools',
      toolCalls: [{ tool: 'connections.list' }],
    });
  });

  it('normalizes codex wire output into native workspace output', () => {
    expect(
      normalizeWorkspaceChatOutput('codex-cli', {
        kind: 'reply',
        message: '확인했습니다',
        toolCalls: '',
      }),
    ).toEqual({ kind: 'reply', message: '확인했습니다' });
  });
});
