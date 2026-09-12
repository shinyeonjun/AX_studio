import { describe, expect, it } from 'vitest';
import type { WorkflowCanvasDraft, WorkflowNode } from '@ax-studio/core';
import { draftToFlow } from './draft-to-flow.js';

function draft(nodes: WorkflowNode[] = [], overrides: Partial<WorkflowCanvasDraft> = {}): WorkflowCanvasDraft {
  return {
    name: '테스트 워크플로우',
    goal: '테스트 작업',
    triggerType: 'manual',
    assumptions: [],
    nodes,
    actions: {},
    ...overrides,
  };
}

function action(id: string): WorkflowNode {
  return {
    type: 'action',
    id,
    actionRef: 'slack.message.send@1',
    params: { channel: '#docs', text: id },
  };
}

describe('draftToFlow', () => {
  it('returns an empty graph for a missing draft', () => {
    expect(draftToFlow(undefined)).toEqual({ nodes: [], edges: [], hasContent: false });
  });

  it('shows a placeholder after the trigger for an empty draft', () => {
    const graph = draftToFlow(draft());

    expect(graph.hasContent).toBe(true);
    expect(graph.nodes.map((node) => node.id)).toEqual(['trigger', 'placeholder']);
    expect(graph.edges.map(({ source, target }) => `${source}->${target}`)).toEqual(['trigger->placeholder']);
  });

  it('connects a linear workflow in order', () => {
    const graph = draftToFlow(draft([action('first'), action('second')]));

    expect(graph.nodes.map((node) => node.id)).toEqual(['trigger', 'step:first', 'step:second']);
    expect(graph.edges.map(({ source, target }) => `${source}->${target}`)).toEqual([
      'trigger->step:first',
      'step:first->step:second',
    ]);
  });

  it('renders both branch paths and joins them again', () => {
    const branch: WorkflowNode = {
      type: 'if',
      id: 'check',
      condition: { op: 'eq', left: { ref: 'status' }, right: { lit: 'paid' } },
      thenStepIds: ['yes'],
      elseStepIds: ['no'],
    };
    const graph = draftToFlow(draft([branch, action('yes'), action('no')]));

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'trigger',
      'step:check',
      'join:check',
      'step:yes',
      'step:no',
    ]);
    expect(graph.edges.map(({ source, target, label }) => `${source}->${target}${label ? `:${label}` : ''}`)).toEqual([
      'trigger->step:check',
      'step:check->step:yes:예',
      'step:check->step:no:아니오',
      'step:yes->join:check',
      'step:no->join:check',
    ]);
  });

  it('injects the Gmail read helper when the trigger needs message content', () => {
    const graph = draftToFlow(draft([], { triggerType: 'gmail.new_message' }));
    const helper = graph.nodes.find((node) => node.data.systemInjected);

    expect(helper?.id).toBe('step:read_trigger_mail');
    expect(helper?.data.kind).toBe('system');
    expect(graph.edges.map(({ source, target }) => `${source}->${target}`)).toEqual([
      'trigger->step:read_trigger_mail',
    ]);
  });

  it('shows the false skip path when a conditional has no else steps', () => {
    const graph = draftToFlow(draft([{
      type: 'if', id: 'check',
      condition: { op: 'eq', left: { ref: 'status' }, right: { lit: 'paid' } },
      thenStepIds: ['notify'],
    }, action('notify'), action('after')]));

    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'step:check', target: 'join:check', label: '아니오' }),
      expect.objectContaining({ source: 'step:notify', target: 'join:check' }),
      expect.objectContaining({ source: 'join:check', target: 'step:after' }),
    ]));
  });

  it('shows the true skip path when a conditional has no then steps', () => {
    const graph = draftToFlow(draft([{
      type: 'if', id: 'check',
      condition: { op: 'eq', left: { ref: 'status' }, right: { lit: 'paid' } },
      elseStepIds: ['notify'],
    }, action('notify')]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'step:check', target: 'join:check', label: '예' }),
      expect.objectContaining({ source: 'step:notify', target: 'join:check' }),
    ]));
  });

  it('reports a reachable branch cycle instead of recursively rendering forever', () => {
    const branch = (id: string, target: string): WorkflowNode => ({
      type: 'if', id, thenStepIds: [target],
      condition: { op: 'eq', left: { lit: true }, right: { lit: true } },
    });
    const graph = draftToFlow(draft([branch('entry', 'a'), branch('a', 'b'), branch('b', 'a')]));
    expect(graph).toMatchObject({ nodes: [], edges: [], hasContent: true,
      error: expect.stringContaining('순환') });
  });

  it.each([
    [['a', 'a']],
    [['a', 'b'], ['b', 'a']],
  ])('reports cycles even when no top-level branch exists: %j', (...links) => {
    const nodes: WorkflowNode[] = links.map(([id, target]) => ({
      type: 'if', id, thenStepIds: [target],
      condition: { op: 'eq', left: { lit: true }, right: { lit: true } },
    }));
    expect(draftToFlow(draft(nodes))).toMatchObject({ nodes: [], edges: [],
      error: expect.stringContaining('순환') });
  });
});
