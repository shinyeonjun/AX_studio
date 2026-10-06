import { describe, expect, it } from 'vitest';
import type { AxCore } from '../../core-instance.js';
import { buildCorruptRowSummary, buildWorkflowAutomationHealth } from './diagnostics-state.js';

function coreWithSettings(settings: Record<string, unknown>, corrupt: unknown[] = []) {
  return {
    store: {
      getSetting: (key: string, fallback: unknown) => (key in settings ? settings[key] : fallback),
      listCorruptRows: () => corrupt,
    },
  } as unknown as AxCore;
}

describe('state diagnostics', () => {
  it('summarizes corrupt rows by table without payloads', () => {
    const summary = buildCorruptRowSummary(coreWithSettings({}, [
      { table: 'workflow_versions', id: 'wf@1', code: 'invalid_workflow_json', detectedAt: '2026-10-06T00:00:00.000Z' },
      { table: 'workflow_versions', id: 'wf@2', code: 'invalid_workflow_json', detectedAt: '2026-10-06T01:00:00.000Z' },
      { table: 'executions', id: 'e1', code: 'x', detectedAt: '2026-10-05T00:00:00.000Z' },
    ]));
    expect(summary.total).toBe(3);
    expect(summary.byTable).toEqual({ workflow_versions: 2, executions: 1 });
    expect(summary.rows[0]?.id).toBe('wf@2');
  });

  it('groups dead letters and the last scheduler outcome per workflow, ignoring malformed entries', () => {
    const health = buildWorkflowAutomationHealth(coreWithSettings({
      'trigger.deadLetters': [
        { dedupeKey: 'wf-a:x:1', workflowId: 'wf-a', attempts: 5, reason: 'max_attempts_exceeded', at: '2026-10-01T00:00:00.000Z' },
        { dedupeKey: 'wf-b:x:1', workflowId: 'wf-b', attempts: 1, reason: 'external_effect_possible', at: '2026-10-02T00:00:00.000Z' },
        { workflowId: 'wf-a', bogus: true },
      ],
      'scheduler.lastOutcome:wf-a': { occurrenceKey: 'k', status: 'failed', reason: 'boom', at: '2026-10-03T00:00:00.000Z' },
      'scheduler.lastOutcome:wf-b': 'garbage',
    }), ['wf-a', 'wf-b', 'wf-c']);
    expect(health.get('wf-a')).toEqual({
      triggerDeadLetters: [{ dedupeKey: 'wf-a:x:1', attempts: 5, reason: 'max_attempts_exceeded', at: '2026-10-01T00:00:00.000Z' }],
      lastOutcome: { occurrenceKey: 'k', status: 'failed', reason: 'boom', at: '2026-10-03T00:00:00.000Z' },
    });
    expect(health.get('wf-b')?.lastOutcome).toBeUndefined();
    expect(health.get('wf-c')).toEqual({ triggerDeadLetters: [] });
  });
});
