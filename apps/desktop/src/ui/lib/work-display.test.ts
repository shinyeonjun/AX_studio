import { describe, expect, it } from 'vitest';
import {
  executionErrorLabel,
  executionStatusLabel,
  executionStepLabel,
  executionTriggerLabel,
  isPersistentWork,
  isSingleExecution,
  triggerLabel,
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

  it('explains a missing document reader without developer setup steps', () => {
    for (const code of ['document_engine_dependency_missing', 'document_engine_empty_response']) {
      const message = executionErrorLabel(code);
      expect(message).toContain('문서 읽기 기능이 준비되지 않았어요');
      expect(message).toContain('설정 > 진단 정보 내보내기');
      expect(message).not.toMatch(/AX_DOCUMENT_ENGINE_PYTHON|npm run|venv|Document Engine/u);
    }
  });

  it('never shows raw codes for unknown values', () => {
    expect(executionErrorLabel('some_new_code')).toBe('실행 중 문제가 생겼어요');
    expect(executionStatusLabel('some_new_status')).toBe('상태 확인 필요');
    expect(executionTriggerLabel('unknown.trigger')).toBe('자동 시작');
    expect(executionTriggerLabel('manual')).toBe('직접 실행');
    expect(executionTriggerLabel('once')).toBe('한 번 예약');
    expect(triggerLabel(undefined)).toBe('직접 실행');
    expect(triggerLabel({ type: 'once', runAt: '2032-01-01T09:00:00.000Z' })).toBe('한 번 예약');
  });

  it('labels steps by number without exposing internal ids', () => {
    expect(executionStepLabel(2)).toBe('2단계');
    expect(executionStepLabel(undefined)).toBe('진행 중인 단계');
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
