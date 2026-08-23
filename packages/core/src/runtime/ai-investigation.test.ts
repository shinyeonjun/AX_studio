import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentHarness, createInvestigationRunner } from '../agent/harness.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../agent/model/provider.js';
import type { ConnectorContext } from '../modules/types.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { resolveStepParams, runAiDecision } from './ai-investigation.js';

describe('resolveStepParams', () => {
  it('interpolates only explicitly declared parameter values', () => {
    const params = resolveStepParams(
      {
        channel: '#ax테스트',
        text: '📧 {{trigger.subject}}\n\n{{summarize.summary}}',
      },
      {
        executionId: 'exec-1',
        variables: { subject: '테스트' },
        log: () => {},
      },
      {
        summarize: { summary: '요약 본문' },
      },
    );

    expect(params.text).toBe('📧 테스트\n\n요약 본문');
    expect(params.channel).toBe('#ax테스트');
    expect(params).not.toHaveProperty('message');
  });

  it('resolves nested ref objects and first matching item in list results', () => {
    const params = resolveStepParams(
      {
        messageId: { ref: 'search-mails.messageId' },
        text: { ref: 'summarize-mails.summary' },
      },
      { executionId: 'exec-1', variables: {}, log: () => {} },
      {
        'search-mails': [{ id: 'message-1', threadId: 'thread-1' }],
        'summarize-mails': { summary: '요약 결과' },
      },
    );

    expect(params).toEqual({ messageId: 'message-1', text: '요약 결과' });
  });

  it('fails closed when a template reference is missing', () => {
    expect(() =>
      resolveStepParams(
        { text: '{{classify.summary}}' },
        { executionId: 'exec-1', variables: {}, log: () => {} },
        { classify: { riskLevel: 'high' } },
      ),
    ).toThrow(/classify\.summary/);
  });

  it('fails closed when an object binding reference is missing', () => {
    expect(() =>
      resolveStepParams(
        { payload: { ref: 'classify.riskLevel' } },
        { executionId: 'exec-1', variables: {}, log: () => {} },
        { classify: {} },
      ),
    ).toThrow(/classify\.riskLevel/);
  });
});

class CountingProvider implements ModelProvider {
  readonly name = 'fake';
  calls = 0;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.calls += 1;
    return input.schema.parse({
      needMore: true,
      nextRead: 'gmail.messages.read',
      conclusion: '요약 완료',
    });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

class PrivacyCaptureProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  captured?: StructuredGenerateInput<unknown>;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.captured = input as StructuredGenerateInput<unknown>;
    return input.schema.parse({ needMore: false, conclusion: '분류 완료', riskLevel: 'normal' });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

class InvestigationProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  calls = 0;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.calls += 1;
    return input.schema.parse(
      this.calls === 1
        ? { needMore: true, nextRead: 'gmail.messages.read', nextReadParams: { messageId: 'm1' } }
        : { needMore: false, conclusion: '분류 완료', riskLevel: 'high' },
    );
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

class IncompleteConclusionProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  calls = 0;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.calls += 1;
    return input.schema.parse(
      this.calls === 1
        ? { needMore: false, reason: '추가 근거가 필요하지만 읽기 없이 결론을 요청받음' }
        : { needMore: false, conclusion: '분류 완료', riskLevel: 'critical' },
    );
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

class VisionCaptureProvider implements ModelProvider {
  readonly name = 'openai-compatible';
  readonly supportsVision = true;
  captured?: StructuredGenerateInput<unknown>;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.captured = input as StructuredGenerateInput<unknown>;
    return input.schema.parse({ needMore: false, conclusion: '이미지 분석 완료', riskLevel: 'high' });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

describe('runAiDecision', () => {
  const ir = {
    version: 1,
    name: 'pdf',
    goal: '요약',
    steps: [],
    permissions: {},
    approval: [],
    allowExternalAuto: true,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
    inputs: [],
  } as WorkflowIR;
  const ctx: ConnectorContext = { executionId: 'exec-1', variables: {}, log: () => {} };

  it('does not follow extra reads when investigation is off', async () => {
    const model = new CountingProvider();
    const results: Record<string, unknown> = {};
    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'summarize',
        goal: 'PDF 요약',
        investigation: false,
        maxReads: 4,
        outputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
      },
      ir,
      ctx,
      results,
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );
    expect(model.calls).toBe(1);
    expect(results.summarize).toMatchObject({ conclusion: '요약 완료' });
    expect(results.summarize).not.toHaveProperty('summary');
  });

  it('does not send email or document content to a cloud provider when cloudAllowed is false', async () => {
    const model = new PrivacyCaptureProvider();
    const privacyIr = { ...ir, dataPolicy: { emailBody: { cloudAllowed: false } } };
    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: '위험도 분류',
        investigation: false,
        maxReads: 1,
        outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
      },
      privacyIr,
      { executionId: 'exec-1', variables: { subject: 'SECRET-SUBJECT' }, log: () => {} },
      { read: { body: 'SECRET-BODY' }, document: { text: 'SECRET-PDF-TEXT' } },
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );

    expect(model.captured?.user).not.toContain('SECRET-SUBJECT');
    expect(model.captured?.user).not.toContain('SECRET-BODY');
    expect(model.captured?.user).not.toContain('SECRET-PDF-TEXT');
    expect(model.captured?.system).not.toContain('SECRET-BODY');
    expect(model.captured?.system).not.toContain('SECRET-PDF-TEXT');
  });

  it('fails closed instead of classifying a PDF when the cloud policy hides its content', async () => {
    const model = new PrivacyCaptureProvider();
    const documentIr = {
      ...ir,
      dataPolicy: { document: { cloudAllowed: false } },
      steps: [
        {
          type: 'action' as const,
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: {},
          sideEffect: 'NONE' as const,
        },
      ],
    };

    await expect(
      runAiDecision(
        {
          type: 'ai_decision',
          id: 'classify',
          goal: 'PDF 위험도 분류',
          investigation: false,
          maxReads: 1,
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
        },
        documentIr,
        { executionId: 'exec-1', variables: {}, log: () => {} },
        { ingest: { text: 'PDF evidence' } },
        createInvestigationRunner(createAgentHarness(model)),
        {},
      ),
    ).rejects.toMatchObject({ code: 'ai_input_unavailable' });
    expect(model.captured).toBeUndefined();
  });

  it('allows document evidence by default when no cloud policy is specified', async () => {
    const model = new PrivacyCaptureProvider();
    const documentIr = {
      ...ir,
      dataPolicy: {},
      steps: [
        {
          type: 'action' as const,
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: {},
          sideEffect: 'NONE' as const,
        },
      ],
    };

    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: 'PDF 위험도 분류',
        investigation: false,
        maxReads: 1,
        outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
      },
      documentIr,
      { executionId: 'exec-1', variables: {}, log: () => {} },
      { ingest: { text: 'DEFAULT-PDF-EVIDENCE' } },
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );

    expect(model.captured?.user).toContain('DEFAULT-PDF-EVIDENCE');
  });

  it('allows document evidence when cloud transfer is explicitly allowed', async () => {
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
      ],
    };

    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: 'PDF 위험도 분류',
        investigation: false,
        maxReads: 1,
        outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
      },
      documentIr,
      { executionId: 'exec-1', variables: {}, log: () => {} },
      { ingest: { text: 'EXPLICIT-PDF-EVIDENCE' } },
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );

    expect(model.captured?.user).toContain('EXPLICIT-PDF-EVIDENCE');
  });

  it('does not let document consent override a separate email-body policy', async () => {
    const model = new PrivacyCaptureProvider();
    const documentIr = {
      ...ir,
      dataPolicy: {
        document: { cloudAllowed: true },
        emailBody: { cloudAllowed: false },
      },
      steps: [
        {
          type: 'action' as const,
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: {},
          sideEffect: 'NONE' as const,
        },
      ],
    };

    await expect(
      runAiDecision(
        {
          type: 'ai_decision',
          id: 'classify',
          goal: 'PDF 위험도 분류',
          investigation: false,
          maxReads: 1,
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
        },
        documentIr,
        { executionId: 'exec-1', variables: { body: 'SECRET-EMAIL-BODY' }, log: () => {} },
        { ingest: { text: 'EXPLICIT-PDF-EVIDENCE' } },
        createInvestigationRunner(createAgentHarness(model)),
        {},
      ),
    ).rejects.toMatchObject({ code: 'ai_input_unavailable' });
    expect(model.captured).toBeUndefined();
  });

  it('allows investigation reads before requiring declared final output fields', async () => {
    const model = new InvestigationProvider();
    const results: Record<string, unknown> = {};
    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: '위험도 분류',
        investigation: true,
        maxReads: 2,
        outputSchema: {
          type: 'object',
          properties: { riskLevel: { type: 'string' } },
          required: ['riskLevel'],
        },
      },
      { ...ir, dataPolicy: { emailBody: { cloudAllowed: false } } },
      { executionId: 'exec-1', variables: {}, log: () => {} },
      results,
      createInvestigationRunner(createAgentHarness(model)),
      { gmail: { name: 'gmail', execute: async () => ({ ok: true, data: { body: 'evidence' } }) } },
    );

    expect(model.calls).toBe(2);
    expect(results.classify).toMatchObject({ riskLevel: 'high' });
  });

  it('repairs an incomplete terminal investigation output before storing it', async () => {
    const model = new IncompleteConclusionProvider();
    const results: Record<string, unknown> = {};
    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: '위험도 분류',
        investigation: true,
        maxReads: 2,
        outputSchema: {
          type: 'object',
          properties: { riskLevel: { type: 'string' } },
          required: ['riskLevel'],
        },
      },
      { ...ir, dataPolicy: { emailBody: { cloudAllowed: false } } },
      { executionId: 'exec-1', variables: {}, log: () => {} },
      results,
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );

    expect(model.calls).toBe(2);
    expect(results.classify).toMatchObject({ riskLevel: 'critical' });
  });

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
});
