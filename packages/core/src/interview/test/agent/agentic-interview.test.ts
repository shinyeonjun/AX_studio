import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../../agent/model/provider.js';
import { createAgentHarness } from '../../../agent/harness.js';
import { buildDesignToolContext } from '../../../design-tools/context.js';
import { applyAnswer, startInterview } from '../../session/flow.js';
import { parseWorkflowDraftPatch } from '../../agent/draft-patch.js';
import { describe, expect, it } from 'vitest';

class AgenticScriptedProvider implements ModelProvider {
  readonly name = 'agentic-scripted';
  readonly calls: StructuredGenerateInput<unknown>[] = [];
  private index = 0;

  constructor(private readonly outputs: unknown[]) {}

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.calls.push(input as StructuredGenerateInput<unknown>);
    const output = this.outputs[Math.min(this.index, this.outputs.length - 1)];
    this.index += 1;
    return input.schema.parse(output);
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

const slackContext = buildDesignToolContext(
  [{ connector: 'slack', connected: true, config: {} }],
  ['slack'],
);

function slackPatch(baseRevision?: number) {
  return {
    kind: 'patch',
    patch: {
      ...(baseRevision === undefined ? {} : { baseRevision }),
      meta: { name: 'Slack 알림', goal: 'Slack으로 알림을 보낸다' },
      upsertNodes: [
        {
          type: 'action',
          id: 'notify',
          actionRef: 'slack.message.send@1',
          params: { channel: '#ops', text: '알림' },
        },
      ],
      set: {},
      removeNodeIds: [],
      message: '초안에 Slack 알림 단계를 반영했습니다.',
    },
  };
}

describe('agentic interview authoring', () => {
  it('uses read-only tools before returning a draft patch', async () => {
    const model = new AgenticScriptedProvider([
      { kind: 'tools', toolCalls: [{ tool: 'connections.list' }, { tool: 'capabilities.list', args: { connector: 'slack' } }] },
      slackPatch(),
    ]);
    const state = await startInterview('Slack 알림 보내', {
      harness: createAgentHarness(model),
      connectedConnectors: ['slack'],
      designToolContext: slackContext,
    }, 'once');

    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.messages?.some((message) => message.content.includes('[workflow agent tool results]'))).toBe(true);
    expect(state.workflow.nodes.map((node) => node.id)).toEqual(['notify']);
    expect(state.workflow.triggerType).toBe('manual');
    expect(state.draftRevision).toBe(1);
    expect(state.completeness.deployable).toBe(true);
    expect(state.done).toBe(true);
  });

  it('exposes the current draft through workflow.inspect without exposing live runtime state', async () => {
    const model = new AgenticScriptedProvider([
      { kind: 'tools', toolCalls: [{ tool: 'workflow.inspect' }] },
      { kind: 'reply', message: '현재 초안을 확인했습니다.' },
    ]);
    const state = await startInterview('Slack 알림을 설계해줘', {
      harness: createAgentHarness(model),
      connectedConnectors: ['slack'],
      designToolContext: slackContext,
    }, 'once');

    const toolResultMessage = model.calls[1]?.messages?.find((message) => message.content.includes('[workflow agent tool results]'));
    expect(toolResultMessage?.content).toContain('"revision": 0');
    expect(toolResultMessage?.content).toContain('"draft"');
    expect(toolResultMessage?.content).not.toContain('"steps"');
    expect(state.draftRevision).toBe(0);
    expect(state.done).toBe(false);
  });

  it('rejects a stale patch without mutating the draft', async () => {
    const model = new AgenticScriptedProvider([
      slackPatch(),
      slackPatch(0),
    ]);
    const harness = createAgentHarness(model);
    const first = await startInterview('Slack 알림 보내', {
      harness,
      connectedConnectors: ['slack'],
      designToolContext: slackContext,
    }, 'once');
    const second = await applyAnswer(first, '초안은 그대로 두고 확인해줘', {
      harness,
      connectedConnectors: ['slack'],
      designToolContext: slackContext,
    });

    expect(first.draftRevision).toBe(1);
    expect(second.draftRevision).toBe(1);
    expect(second.workflow.nodes).toHaveLength(1);
    expect(second.done).toBe(true);
  });

  it('bounds unsafe patch object keys before applying them', () => {
    const unsafe = JSON.parse('{"set":{"__proto__":{"polluted":true}}}');
    expect(() => parseWorkflowDraftPatch(unsafe)).toThrow('workflow_patch_unsafe_key');
  });
});
