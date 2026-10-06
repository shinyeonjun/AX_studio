import { describe, expect, it } from 'vitest';
import {
  enrichManualRunInput,
  validateManualRunInput,
  workflowNeedsFilePath,
  workflowNeedsGmailMessageId,
} from '../manual-run-input.js';
import type { Connector, ConnectorResult } from '../../connectors/types.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { folderWorkflow } from './fixtures.js';
import type { ConditionExpr } from '../../workflow/condition-expr/schema.js';

describe('validateManualRunInput', () => {
  it('requires filePath when document ingest uses trigger placeholders', () => {
    const ir = folderWorkflow({ type: 'manual' });
    expect(workflowNeedsFilePath(ir)).toBe(true);
    expect(validateManualRunInput(ir, {})).toEqual({
      ok: false,
      errorCode: 'manual_run_input_missing',
      message: expect.stringContaining('연결된 폴더'),
    });
  });

  it('requires messageId for gmail trigger workflows that read mail', () => {
    const ir: WorkflowIR = {
      id: 'wf-gmail',
      name: '네이버 메일 Slack 요약',
      goal: '요약',
      version: 1,
      inputs: [],
      trigger: { type: 'gmail.new_message', accountId: 'primary' },
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
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
    };

    expect(workflowNeedsGmailMessageId(ir)).toBe(true);
    expect(validateManualRunInput(ir, {})).toEqual({
      ok: false,
      errorCode: 'manual_run_input_missing',
      message: expect.stringContaining('받은편지함'),
    });
  });
});

describe('enrichManualRunInput', () => {
  it.each(['legacy', 'page'] as const)('fills latest inbox message id from the %s Gmail response', async (shape) => {
    const ir: WorkflowIR = {
      id: 'wf-gmail',
      name: '네이버 메일 Slack 요약',
      goal: '요약',
      version: 1,
      inputs: [],
      trigger: { type: 'gmail.new_message', accountId: 'primary' },
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
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
    };

    const gmail: Connector = {
      name: 'gmail',
      async execute(action, _params, _ctx): Promise<ConnectorResult> {
        if (action === 'messages.search') {
          const messages = [{ id: 'latest-msg' }];
          return { ok: true, data: shape === 'legacy' ? messages : { messages, truncated: true, nextPageToken: 'next' } };
        }
        return { ok: false, error: 'unexpected' };
      },
    };

    const enriched = await enrichManualRunInput(ir, { gmail }, {});
    expect(enriched.messageId).toBe('latest-msg');
    expect(validateManualRunInput(ir, enriched)).toEqual({ ok: true });
  });
});

describe('enrichManualRunInput trigger payload', () => {
  const baseIr = (filter?: ConditionExpr): WorkflowIR => ({
    id: 'wf-gmail', name: 'mail', goal: '요약', version: 1, inputs: [],
    trigger: { type: 'gmail.new_message', accountId: 'primary', ...(filter ? { filter } : {}) },
    permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
    steps: [{ type: 'action', id: 'read-mail', connector: 'gmail', action: 'messages.read', params: {}, sideEffect: 'NONE' }],
  });
  const gmailWith = (messages: unknown[], seen: Array<Record<string, unknown>> = []): Connector => ({
    name: 'gmail',
    async execute(action, params): Promise<ConnectorResult> {
      seen.push(params);
      return action === 'messages.search' ? { ok: true, data: { messages } } : { ok: false, error: 'unexpected' };
    },
  });

  it('takes sender and subject from the fetched message and leaves missing fields undefined', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const enriched = await enrichManualRunInput(baseIr(), {
      gmail: gmailWith([{ id: 'm1', from: 'boss@example.com', subject: '보고' }], seen),
    }, {});
    expect(seen[0]).toMatchObject({ includeMetadata: true, limit: 1 });
    expect(enriched).toEqual({ messageId: 'm1', from: 'boss@example.com', sender: 'boss@example.com', subject: '보고' });
    expect('snippet' in enriched).toBe(false);
  });

  it('never fills missing fields with empty strings', async () => {
    const enriched = await enrichManualRunInput(baseIr(), { gmail: gmailWith([{ id: 'm1', from: '', subject: '  ' }]) }, {});
    expect(enriched).toEqual({ messageId: 'm1' });
  });

  it('applies the trigger filter and picks the first matching message', async () => {
    const filter = { op: 'eq', left: { ref: 'subject' }, right: { lit: '보고' } } as const;
    const seen: Array<Record<string, unknown>> = [];
    const enriched = await enrichManualRunInput(baseIr(filter), {
      gmail: gmailWith([{ id: 'm1', subject: '광고' }, { id: 'm2', subject: '보고' }], seen),
    }, {});
    expect(seen[0]).toMatchObject({ limit: 10 });
    expect(enriched.messageId).toBe('m2');
  });

  it('fails clearly when no fetched message matches the trigger filter', async () => {
    const filter = { op: 'eq', left: { ref: 'subject' }, right: { lit: '보고' } } as const;
    await expect(enrichManualRunInput(baseIr(filter), { gmail: gmailWith([{ id: 'm1', subject: '광고' }]) }, {}))
      .rejects.toMatchObject({ code: 'manual_run_filter_no_match' });
  });
});
