export type E2EEnvironment = Readonly<Record<string, string | undefined>>;

export function isE2ERuntimeEnabled(isPackaged: boolean, env: E2EEnvironment): boolean {
  return !isPackaged && env.AX_E2E === '1';
}

export function shouldLoadE2EBenchmarkReportPlanner(isPackaged: boolean, env: E2EEnvironment): boolean {
  return isE2ERuntimeEnabled(isPackaged, env) && env.AX_E2E_REPORT_PLANNER === 'benchmark';
}

export function shouldUseE2EFakeAgent(isPackaged: boolean, env: E2EEnvironment): boolean {
  return isE2ERuntimeEnabled(isPackaged, env) && env.AX_E2E_FAKE_AGENT === '1';
}

export function e2EReportPhase(
  isPackaged: boolean,
  env: E2EEnvironment,
  userMessage: string,
): 'failure' | 'retry' | undefined {
  if (!shouldUseE2EFakeAgent(isPackaged, env)) return undefined;
  if (userMessage === '__e2e:report-generate__') return 'failure';
  if (userMessage === '__e2e:report-retry__') return 'retry';
  return undefined;
}
