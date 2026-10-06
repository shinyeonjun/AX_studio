import { describe, expect, it } from 'vitest';
import {
  executionErrorLabel,
  executionStatusLabel,
  isPersistentWork,
  isSingleExecution,
} from './work-display';

describe('work display classification', () => {
  it('keeps schedule and event-triggered work in the recurring section', () => {
    expect(isPersistentWork({ type: 'schedule', schedule: '0 9 * * *' })).toBe(true);
    expect(isPersistentWork({ type: 'gmail.new_message' })).toBe(true);
    expect(isPersistentWork({ type: 'manual' })).toBe(false);
    expect(isPersistentWork({ type: 'once', runAt: '2032-01-01T09:00:00.000Z' })).toBe(false);
  });

  it('uses the explicit ephemeral flag and supports older state payloads', () => {
    expect(isSingleExecution({ ephemeral: true, workflowId: 'saved-workflow' })).toBe(true);
    expect(isSingleExecution({ ephemeral: false })).toBe(false);
    expect(isSingleExecution({ workflowId: undefined })).toBe(true);
    expect(isSingleExecution({ workflowId: 'saved-workflow' })).toBe(false);
  });

  it('provides readable labels for execution states', () => {
    expect(executionStatusLabel('running')).toBe('실행 중');
    expect(executionStatusLabel('pending_approval')).toBe('승인 대기');
    expect(executionStatusLabel('success')).toBe('성공');
  });

  it('provides a project-venv recovery step for missing document-engine packages', () => {
    const message = executionErrorLabel('document_engine_dependency_missing');
    expect(message).toContain('AX_DOCUMENT_ENGINE_PYTHON');
    expect(message).toContain('npm run document-engine:setup');
  });

  it('maps runtime hardening error codes to Korean messages', () => {
    for (const code of [
      'workflow_already_running',
      'approval_expired',
      'template_non_primitive',
      'condition_ref_missing',
      'step_timeout',
    ]) {
      const message = executionErrorLabel(code);
      expect(message).not.toBe(code);
      expect(message).toMatch(/[가-힣]/u);
    }
    expect(executionErrorLabel('step_timeout')).toContain('확인');
  });
});
