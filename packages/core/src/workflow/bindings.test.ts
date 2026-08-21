import { describe, expect, it } from 'vitest';
import { applyStepBindings, coercePortBinding, inferWorkflowBindings } from './bindings.js';
import { parseBindingsRecord } from '../interview/draft/schema.js';
import type { WorkflowIR } from './schema.js';

describe('inferWorkflowBindings', () => {
  it('uses only declared AI output fields for message bindings', () => {
    const ir: WorkflowIR = {
      id: 'wf-ai-contract',
      name: 'AI output contract',
      goal: '분류 결과 전송',
      version: 1,
      trigger: { type: 'manual' },
      inputs: [],
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '분류',
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax' },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const inferred = inferWorkflowBindings(ir);
    const notify = inferred.steps.find((step) => step.id === 'notify');
    expect(notify?.type === 'action' && notify.bindings?.text).toEqual({
      from: 'classify',
      output: 'riskLevel',
    });
    expect(
      applyStepBindings(
        notify as Extract<WorkflowIR['steps'][number], { type: 'action' }>,
        ir,
        { channel: '#ax' },
        { classify: { riskLevel: 'high' } },
        {},
      ).text,
    ).toBe('high');
  });

  it('does not turn an undeclared AI summary into message text', () => {
    const ir: WorkflowIR = {
      id: 'wf-ai-no-fallback',
      name: 'AI output contract',
      goal: '분류 결과 전송',
      version: 1,
      trigger: { type: 'manual' },
      inputs: [],
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '분류',
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax' },
          bindings: { text: { from: 'classify', output: 'summary' } },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const notify = ir.steps[1]!;
    expect(
      applyStepBindings(
        notify as Extract<WorkflowIR['steps'][number], { type: 'action' }>,
        ir,
        { channel: '#ax' },
        { classify: { conclusion: '암묵 요약' } },
        {},
      ).text,
    ).toBeUndefined();
  });

  it('resolves an AI output binding to the declared field', () => {
    const ir: WorkflowIR = {
      id: 'wf-ai',
      name: 'AI output',
      goal: '분류 결과 전송',
      version: 1,
      trigger: { type: 'manual' },
      inputs: [],
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '분류',
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax', text: '' },
          bindings: { text: { from: 'classify', output: 'riskLevel' } },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const step = ir.steps[1]!;
    expect(
      applyStepBindings(
        step as Extract<WorkflowIR['steps'][number], { type: 'action' }>,
        ir,
        step.type === 'action' ? step.params : {},
        { classify: { riskLevel: 'high' } },
        {},
      ).text,
    ).toBe('high');
  });

  const folderToSlack: WorkflowIR = {
    id: 'wf',
    name: 'PDF to Slack',
    goal: '요약 후 전송',
    version: 1,
    trigger: { type: 'local_folder.new_file', folderId: 'folder-1', extensions: ['.pdf'] },
    steps: [
      {
        type: 'action',
        id: 'ingest',
        connector: 'document',
        action: 'ingest',
        params: {},
        sideEffect: 'NONE',
      },
      {
        type: 'action',
        id: 'summarize',
        connector: 'transform',
        action: 'document_to_text',
        params: {},
        sideEffect: 'NONE',
      },
      {
        type: 'action',
        id: 'send',
        connector: 'slack',
        action: 'message.send',
        params: { channel: '#ax' },
        sideEffect: 'EXTERNAL',
      },
    ],
    inputs: ['folderId', 'filePath'],
    permissions: {},
    approval: [],
    allowExternalAuto: true,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
  };

  it('binds trigger file to document ingest and chains text to slack', () => {
    const ir = inferWorkflowBindings(folderToSlack);
    expect(ir.steps[0]?.type === 'action' && ir.steps[0].bindings).toEqual({
      source: { from: 'trigger', output: 'file' },
    });
    expect(ir.steps[1]?.type === 'action' && ir.steps[1].bindings).toEqual({
      document: { from: 'ingest', output: 'document' },
    });
    expect(ir.steps[2]?.type === 'action' && ir.steps[2].bindings).toEqual({
      text: { from: 'summarize', output: 'text' },
    });
  });

  it('replaces a legacy static ingest path with the current folder event file', () => {
    const legacy = {
      ...folderToSlack,
      steps: folderToSlack.steps.map((step) =>
        step.id === 'ingest' && step.type === 'action'
          ? { ...step, params: { path: 'D:/old/removed.pdf' } }
          : step,
      ),
    } satisfies WorkflowIR;

    const ir = inferWorkflowBindings(legacy);
    const ingest = ir.steps.find((step) => step.id === 'ingest');
    if (!ingest || ingest.type !== 'action') throw new Error('missing ingest step');

    expect(ingest.bindings).toMatchObject({
      source: { from: 'trigger', output: 'file' },
    });

    const params = applyStepBindings(
      ingest,
      ir,
      ingest.params,
      {},
      {
        fileRef: {
          sourceId: 'local_folder',
          folderId: 'folder-1',
          path: 'D:/connected/incoming.pdf',
          name: 'incoming.pdf',
        },
      },
    );

    expect(params.path).toBeUndefined();
    expect(params.file).toMatchObject({ path: 'D:/connected/incoming.pdf' });
  });

  it('applies bindings to runtime params', () => {
    const ir = inferWorkflowBindings(folderToSlack);
    const send = ir.steps.find((step) => step.id === 'send');
    if (!send || send.type !== 'action') throw new Error('missing send step');

    const params = applyStepBindings(
      send,
      ir,
      send.params,
      {
        summarize: { text: '요약 결과', kind: 'TextArtifact' },
      },
      {},
    );

    expect(params.text).toBe('요약 결과');
  });

  it('binds gmail trigger message to messages.read messageId', () => {
    const ir = inferWorkflowBindings({
      id: 'wf',
      name: 'Gmail summary',
      goal: '요약',
      version: 1,
      trigger: { type: 'gmail.new_message', accountId: 'primary' },
      steps: [
        {
          type: 'action',
          id: 'read-mail',
          connector: 'gmail',
          action: 'messages.read',
          params: {},
          sideEffect: 'NONE',
        },
      ],
      inputs: ['messageId', 'from', 'subject', 'snippet', 'sender'],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });

    const read = ir.steps.find((step) => step.id === 'read-mail');
    if (!read || read.type !== 'action') throw new Error('missing read step');

    const params = applyStepBindings(
      read,
      ir,
      read.params,
      {},
      {
        messageId: 'gmail-msg-1',
        from: 'naver@mail.com',
        subject: '네이버 메일',
        snippet: '본문 미리보기',
      },
    );

    expect(params.messageId).toBe('gmail-msg-1');
    expect(params.message).toMatchObject({ id: 'gmail-msg-1', messageId: 'gmail-msg-1' });
  });
});

describe('coercePortBinding', () => {
  it('parses step.output shorthand strings', () => {
    expect(coercePortBinding('summarize.summary')).toEqual({
      from: 'summarize',
      output: 'summary',
    });
    expect(coercePortBinding('trigger.filePath')).toEqual({
      from: 'trigger',
      output: 'filePath',
    });
  });

  it('parses ref objects and JSON-encoded bindings', () => {
    expect(coercePortBinding({ ref: 'summarize-mails.summary' })).toEqual({
      from: 'summarize-mails',
      output: 'summary',
    });
    expect(parseBindingsRecord({ text: 'summarize.summary', body: '{"from":"draft","output":"body"}' })).toEqual({
      text: { from: 'summarize', output: 'summary' },
      body: { from: 'draft', output: 'body' },
    });
  });
});
