import { describe, expect, it } from 'vitest';
import {
  enrichManualRunInput,
  validateManualRunInput,
  workflowNeedsFilePath,
  workflowNeedsGmailMessageId,
} from '../manual-run-input.js';
import type { Connector, ConnectorResult } from '../../modules/types.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { folderWorkflow } from './fixtures.js';

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
  it('fills latest inbox message id for gmail trigger manual runs', async () => {
    const ir: WorkflowIR = {
      id: 'wf-gmail',
      name: '네이버 메일 Slack 요약',
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
    };

    const gmail: Connector = {
      name: 'gmail',
      async execute(action, _params, _ctx): Promise<ConnectorResult> {
        if (action === 'messages.search') {
          return { ok: true, data: [{ id: 'latest-msg' }] };
        }
        return { ok: false, error: 'unexpected' };
      },
    };

    const enriched = await enrichManualRunInput(ir, { gmail }, {});
    expect(enriched.messageId).toBe('latest-msg');
    expect(validateManualRunInput(ir, enriched)).toEqual({ ok: true });
  });
});
