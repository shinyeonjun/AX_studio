import { describe, expect, it } from 'vitest';
import { actionRefFor, listActionDefinitions, resolveActionDefinition, validateActionParams } from './action-definition.js';
import { parseWorkflowIR } from './schema.js';

describe('action definitions', () => {
  it('creates a version-pinned action reference', () => {
    expect(actionRefFor('slack', 'message.send')).toBe('slack.message.send@1');
  });

  it('resolves a catalog action as a versioned serializable definition', () => {
    expect(resolveActionDefinition('slack.message.send')).toMatchObject({
      id: 'slack.message.send',
      version: 1,
      connector: 'slack',
      action: 'message.send',
    });
  });

  it('resolves HTTP POST as a write action with an external side effect', () => {
    expect(actionRefFor('http', 'post')).toBe('http.post@1');
    expect(resolveActionDefinition('http.post')).toMatchObject({
      id: 'http.post',
      connector: 'http',
      action: 'post',
      kind: 'write',
      sideEffect: 'EXTERNAL',
    });
    expect(resolveActionDefinition('http.delete')).toBeUndefined();
  });

  it('lists only executable actions, not triggers', () => {
    const definitions = listActionDefinitions();
    expect(definitions.some((definition) => definition.id === 'slack.new_message')).toBe(false);
    expect(definitions.some((definition) => definition.id === 'slack.message.send')).toBe(true);
  });

  it('normalizes legacy connector/action steps to an action reference', () => {
    const workflow = parseWorkflowIR({
      name: 'test',
      goal: 'test',
      steps: [
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#test' },
          sideEffect: 'EXTERNAL',
        },
      ],
    });

    expect(workflow.steps[0]).toMatchObject({ actionRef: 'slack.message.send@1' });
  });

  it('rejects structured data for text input contracts', () => {
    const definition = resolveActionDefinition('slack.message.send');
    expect(definition).toBeDefined();
    expect(validateActionParams(definition!, { channel: '#ops', text: { summary: '잘못된 형식' } })).toContain('text');
  });
});
