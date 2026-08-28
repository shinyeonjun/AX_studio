import { describe, expect, it } from 'vitest';
import {
  defaultSideEffectForHttpMethod,
  isPlainChatSideEffectAllowed,
  DEFAULT_SAVED_WORKFLOW_ACTIVE,
  workflowLifecycleFromActive,
  isTriggerArmed,
} from './index.js';

describe('platform lifecycle', () => {
  it('separates workflow document state from run state', () => {
    expect(workflowLifecycleFromActive(false, false)).toBe('draft');
    expect(workflowLifecycleFromActive(false, true)).toBe('disabled');
    expect(workflowLifecycleFromActive(true, true)).toBe('enabled');
    expect(isTriggerArmed('enabled')).toBe(true);
    expect(isTriggerArmed('disabled')).toBe(false);
    expect(DEFAULT_SAVED_WORKFLOW_ACTIVE).toBe(false);
  });
});

describe('platform sideEffect policy', () => {
  it('allows plain chat only NONE and REVERSIBLE', () => {
    expect(isPlainChatSideEffectAllowed('NONE')).toBe(true);
    expect(isPlainChatSideEffectAllowed('REVERSIBLE')).toBe(true);
    expect(isPlainChatSideEffectAllowed('EXTERNAL')).toBe(false);
    expect(isPlainChatSideEffectAllowed('EXTERNAL_HIGH')).toBe(false);
  });

  it('uses HTTP method only as ingest default', () => {
    expect(defaultSideEffectForHttpMethod('GET')).toBe('NONE');
    expect(defaultSideEffectForHttpMethod('head')).toBe('NONE');
    expect(defaultSideEffectForHttpMethod('post')).toBe('EXTERNAL');
  });
});
