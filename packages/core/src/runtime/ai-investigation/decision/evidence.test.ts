import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentHarness, createInvestigationRunner } from '../../../agent/harness.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { runAiDecision } from '../../ai-investigation.js';
import { PrivacyCaptureProvider, VisionCaptureProvider, decisionWorkflow as ir } from './fixtures.js';

describe('runAiDecision evidence and binding', () => {

  it('loads PDF image artifacts as bytes for a vision-capable provider', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ax-vision-test-'));
    const imagePath = join(directory, 'page-0.png');
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71, 1, 2, 3]));
    try {
      const model = new VisionCaptureProvider();
      await runAiDecision(
        {
          type: 'ai_decision',
          id: 'classify',
          goal: 'PDF 시각 위험도 분류',
          investigation: false,
          maxReads: 1,
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
        },
        ir,
        { executionId: 'exec-1', variables: {}, log: () => {} },
        { ingest: { pages: [{ index: 0, hasVisual: true, imagePath }] } },
        createInvestigationRunner(createAgentHarness(model)),
        {},
      );

      expect(model.captured?.images).toHaveLength(1);
      expect(model.captured?.images?.[0]).toMatchObject({
        mimeType: 'image/png',
        pageIndex: 0,
        filename: 'page-0.png',
      });
      expect(Array.from(model.captured?.images?.[0]?.data ?? [])).toEqual([137, 80, 78, 71, 1, 2, 3]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses explicit bindings instead of scanning stepResults for document text', async () => {
    const model = new PrivacyCaptureProvider();
    const documentIr = {
      ...ir,
      dataPolicy: { document: { cloudAllowed: true } },
      steps: [
        {
          type: 'action' as const,
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: {},
          sideEffect: 'NONE' as const,
        },
        {
          type: 'ai_decision' as const,
          id: 'classify',
          goal: 'PDF 위험도 분류',
          investigation: false,
          maxReads: 1,
          inputContracts: { document: 'DocumentArtifact' },
          bindings: { document: { from: 'ingest', output: 'document' } },
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
        },
      ],
    };

    await runAiDecision(
      documentIr.steps[1] as Extract<WorkflowIR['steps'][number], { type: 'ai_decision' }>,
      documentIr,
      { executionId: 'exec-1', variables: {}, log: () => {} },
      {
        ingest: { text: 'BOUND-PDF-EVIDENCE', document: { text: 'BOUND-PDF-EVIDENCE' } },
        noise: { text: 'SHOULD-NOT-APPEAR' },
      },
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );

    expect(model.captured?.user).toContain('BOUND-PDF-EVIDENCE');
    expect(model.captured?.user).not.toContain('SHOULD-NOT-APPEAR');
  });
});
