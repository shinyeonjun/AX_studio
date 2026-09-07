import { describe, expect, it } from 'vitest';
import {
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
});
