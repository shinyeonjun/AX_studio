import { describe, expect, it } from 'vitest';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../agent/model/provider.js';
import { createAgentHarness } from '../agent/harness.js';
import { buildDesignToolContext } from '../design-tools/context.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startInterview } from './interview-flow.js';
import type { InterviewAgentOutput } from './interview-agent-schema.js';

class DiscoveryScriptedProvider implements ModelProvider {
  readonly name = 'discovery-scripted';
  readonly calls: StructuredGenerateInput<unknown>[] = [];
  private index = 0;

  constructor(private outputs: InterviewAgentOutput[]) {}

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.calls.push(input as StructuredGenerateInput<unknown>);
    const output = this.outputs[Math.min(this.index, this.outputs.length - 1)];
    this.index += 1;
    return input.schema.parse(output);
  }

  async generateText(_input: TextGenerateInput): Promise<string> {
    return '';
  }
}

describe('interview-discovery', () => {
  it('runs design-tools before compiling workflow', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-interview-'));
    writeFileSync(join(dir, 'report.pdf'), 'pdf-content');

    const ctx = buildDesignToolContext(
      [
        {
          connector: 'local_folder',
          connected: true,
          config: {
            folders: [{ id: 'folder-1', label: 'Inbox', path: dir, addedAt: '2026-01-01T00:00:00.000Z' }],
          },
        },
        { connector: 'slack', connected: true, config: {} },
      ],
      ['slack', 'local_folder', 'document'],
    );

    const model = new DiscoveryScriptedProvider([
      {
        kind: 'discover',
        toolCalls: [
          { tool: 'sources.list', args: { connector: 'local_folder' } },
          { tool: 'sources.files.list', args: { folderId: 'folder-1', extensions: ['.pdf'] } },
        ],
      },
      {
        kind: 'design',
        name: 'PDF 요약 Slack 알림',
        goal: '폴더 PDF 요약 후 Slack 알림',
        triggerType: 'manual',
        assumptions: [],
        nodes: [
          {
            type: 'action',
            id: 'ingest',
            connector: 'document',
            action: 'ingest',
            params: { path: join(dir, 'report.pdf') },
          },
          {
            type: 'ai_decision',
            id: 'summarize',
            goal: 'PDF 내용을 3줄로 요약',
            investigation: false,
          },
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#docs', text: '{{summarize.result}}' },
          },
        ],
        nextQuestion: '이렇게 PDF를 요약해 Slack으로 보내는 업무로 이해했습니다.',
      },
    ]);

    const harness = createAgentHarness(model);
    const state = await startInterview('연결된 폴더 pdf 요약해서 slack으로 알려줘', {
      harness,
      connectedConnectors: ctx.connectedConnectorIds,
      designToolContext: ctx,
    });

    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.messages?.some((message) => message.content.includes('design-tool results'))).toBe(
      true,
    );
    expect(state.workflow.nodes).toHaveLength(3);
    expect(state.messages.at(-1)?.content).toContain('Slack');
  });
});
