import { describe, expect, it } from 'vitest';
import {
  e2EReportPhase,
  isE2ERuntimeEnabled,
  shouldLoadE2EBenchmarkReportPlanner,
  shouldUseE2EFakeAgent,
} from './gates.js';

describe('Electron E2E report seams', () => {
  const allFlags = {
    AX_E2E: '1',
    AX_E2E_FAKE_AGENT: '1',
    AX_E2E_REPORT_PLANNER: 'benchmark',
  };

  it('keeps benchmark planner and fake agent disabled in packaged builds', () => {
    expect(isE2ERuntimeEnabled(true, allFlags)).toBe(false);
    expect(shouldLoadE2EBenchmarkReportPlanner(true, allFlags)).toBe(false);
    expect(shouldUseE2EFakeAgent(true, allFlags)).toBe(false);
    expect(e2EReportPhase(true, allFlags, '__e2e:report-generate__')).toBeUndefined();
  });

  it('keeps test seams disabled in ordinary unpackaged runs without the E2E flag', () => {
    const strayFeatureFlags = { AX_E2E_FAKE_AGENT: '1', AX_E2E_REPORT_PLANNER: 'benchmark' };
    expect(isE2ERuntimeEnabled(false, strayFeatureFlags)).toBe(false);
    expect(shouldLoadE2EBenchmarkReportPlanner(false, strayFeatureFlags)).toBe(false);
    expect(shouldUseE2EFakeAgent(false, strayFeatureFlags)).toBe(false);
    expect(e2EReportPhase(false, strayFeatureFlags, '__e2e:report-retry__')).toBeUndefined();
  });

  it('requires the full E2E flag set and exact test messages for report phases', () => {
    expect(shouldLoadE2EBenchmarkReportPlanner(false, { AX_E2E: '1' })).toBe(false);
    expect(shouldUseE2EFakeAgent(false, { AX_E2E: '1' })).toBe(false);
    expect(shouldLoadE2EBenchmarkReportPlanner(false, allFlags)).toBe(true);
    expect(shouldUseE2EFakeAgent(false, allFlags)).toBe(true);
    expect(e2EReportPhase(false, allFlags, '__e2e:report-generate__')).toBe('failure');
    expect(e2EReportPhase(false, allFlags, '__e2e:report-retry__')).toBe('retry');
    expect(e2EReportPhase(false, allFlags, 'please generate a report')).toBeUndefined();
  });
});
