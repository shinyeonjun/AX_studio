import { describe, expect, it } from 'vitest';
import { normalizePlanNodes, parseOutputFields } from '../../plan/normalize.js';
import { WorkflowPlanSchema } from '../../plan/schema.js';
import { expandInterviewWireEnvelope } from '../../agent/wire-schema.js';
import { parseInterviewProviderOutput } from '../../agent/output-schema.js';

describe('interview-plan-normalize', () => {
  it('infers missing node type and converts outputFields object', () => {
    const nodes = normalizePlanNodes([
      { id: 'ingest', connector: 'document', action: 'ingest', params: { path: '{{filePath}}' } },
      {
        id: 'classify',
        goal: '중요도 분류',
        outputFields: {
          risk: { type: 'string', enum: ['critical', 'high', 'normal'], description: '위험도' },
          message: { type: 'string', description: '메시지' },
        },
      },
      {},
      { label: 'ignored' },
    ]);

    expect(nodes).toHaveLength(4);
    expect(nodes[0]).toMatchObject({ id: 'ingest', type: 'action' });
    expect(nodes[1]).toMatchObject({ id: 'classify', type: 'ai_decision' });
    expect(parseOutputFields((nodes[1] as { outputFields?: unknown }).outputFields)).toEqual([
      { name: 'risk', type: 'string', description: '위험도', enumValues: ['critical', 'high', 'normal'] },
      { name: 'message', type: 'string', description: '메시지' },
    ]);
  });

  it('parses Codex plan payload with malformed nodes', () => {
    expect(() => {
      const envelope = expandInterviewWireEnvelope({
        kind: 'plan',
        payload: JSON.stringify({
          name: 'PDF Slack',
          goal: '요약 후 Slack',
          triggerType: 'local_folder.new_file',
          nodes: [
            { id: 'ingest', connector: 'document', action: 'ingest' },
            {
              id: 'summarize',
              goal: '요약',
              outputFields: { summary: { type: 'string', description: '요약' } },
            },
            { id: 'notify', actionRef: 'slack.message.send@1', params: { channel: '#ops' } },
            {},
          ],
        }),
        toolCalls: '',
        nextQuestion: '채널을 알려주세요.',
      });
      parseInterviewProviderOutput('codex-cli', envelope);
    }).toThrow();
  });

  it('accepts WorkflowPlanSchema with inferred nodes', () => {
    const plan = WorkflowPlanSchema.parse({
      goal: 'test',
      nodes: [{ connector: 'slack', action: 'message.send', id: 'notify', params: { text: 'hi' } }],
    });
    expect(plan.nodes[0]?.type).toBe('action');
  });
});
