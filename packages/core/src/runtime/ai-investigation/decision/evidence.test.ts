import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentHarness, createInvestigationRunner } from '../../../intelligence/agent/harness.js';
import { buildTableArtifact } from '../../../contracts/artifacts/table-build.js';
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

  it('passes bounded, untrusted table and JSON bindings to the investigation model without source paths', async () => {
    const model = new PrivacyCaptureProvider();
    const table = buildTableArtifact({
      id: 'products',
      headers: ['title', 'stock'],
      matrix: Array.from({ length: 55 }, (_, index) => [index === 0 ? 'Essence Mascara Lash Princess' : `Product ${index}`, index]),
      source: { filePath: 'C:/private/inventory.csv' },
    });
    const workflow = {
      ...ir,
      dataPolicy: { table: { cloudAllowed: true }, metrics: { cloudAllowed: true } },
      steps: [
        { type: 'action' as const, id: 'read', connector: 'http', action: 'request', params: {}, sideEffect: 'NONE' as const },
        {
          type: 'ai_decision' as const, id: 'summarize', goal: '재고를 요약한다',
          investigation: false, maxReads: 1,
          inputContracts: { table: 'TableArtifact' as const, metrics: 'JsonArtifact' as const },
          bindings: {
            table: { from: 'read', output: 'table' },
            metrics: { from: 'read', output: 'metrics' },
          },
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
        },
      ],
    };

    await runAiDecision(
      workflow.steps[1] as Extract<WorkflowIR['steps'][number], { type: 'ai_decision' }>,
      workflow,
      {
        executionId: 'exec-bound-table', variables: {}, log: () => {},
        outputs: {
          read: {
            table,
            metrics: { value: {
              lowStockCount: 1,
              apiKey: 'json-secret',
              filePath: 'C:/private/source.json',
              longText: 'x'.repeat(40_000),
            } },
          },
        },
      },
      { unrelated: { text: 'MUST-NOT-LEAK' } },
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );

    expect(model.captured?.user).toContain('Essence Mascara Lash Princess');
    expect(model.captured?.user).toContain('lowStockCount');
    expect(model.captured?.user).toContain('previewTruncated');
    expect(model.captured?.user.length).toBeLessThan(26_000);
    expect(model.captured?.user).not.toContain('json-secret');
    expect(model.captured?.user).not.toContain('C:/private/source.json');
    expect(model.captured?.user).toContain('untrusted');
    expect(model.captured?.user).not.toContain('C:/private/inventory.csv');
    expect(model.captured?.user).not.toContain('MUST-NOT-LEAK');
  });

  it('does not send an explicitly restricted table binding to a cloud provider', async () => {
    const model = new PrivacyCaptureProvider();
    const table = buildTableArtifact({ id: 'private', headers: ['account'], matrix: [['acct-123']] });
    const workflow = {
      ...ir,
      dataPolicy: { table: { cloudAllowed: false } },
      steps: [
        { type: 'action' as const, id: 'read', connector: 'rdb', action: 'query', params: {}, sideEffect: 'NONE' as const },
        {
          type: 'ai_decision' as const, id: 'summarize', goal: '표를 요약한다',
          investigation: false, maxReads: 1,
          inputContracts: { table: 'TableArtifact' as const },
          bindings: { table: { from: 'read', output: 'table' } },
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
        },
      ],
    };

    await expect(runAiDecision(
      workflow.steps[1] as Extract<WorkflowIR['steps'][number], { type: 'ai_decision' }>,
      workflow,
      { executionId: 'exec-restricted-table', variables: {}, log: () => {}, outputs: { read: { table } } },
      {},
      createInvestigationRunner(createAgentHarness(model)),
      {},
    )).rejects.toMatchObject({ code: 'ai_input_unavailable' });
    expect(model.captured).toBeUndefined();
  });
});
