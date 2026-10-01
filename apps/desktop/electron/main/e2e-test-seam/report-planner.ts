import type { AxStudioCoreOptions } from '@ax-studio/core';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Load the benchmark planner only from the unpackaged desktop E2E startup path.
 * The dynamic file URL keeps benchmark fixtures out of packaged application bundles.
 */
export async function loadE2EBenchmarkReportPlanner(
  caseId: string,
): Promise<NonNullable<AxStudioCoreOptions['reportPlanner']>> {
  const root = process.cwd();
  const plannerUrl = pathToFileURL(join(root, 'test', 'report-generation-e2e', 'planner.mjs')).href;
  const casesUrl = pathToFileURL(join(root, 'test', 'report-generation-e2e', 'cases.mjs')).href;
  const [plannerModule, caseModule] = await Promise.all([
    import(plannerUrl) as Promise<{ createBenchmarkPlanner(input: unknown): unknown }>,
    import(casesUrl) as Promise<{ caseById(id: string): unknown }>,
  ]);
  const benchmarkCase = caseModule.caseById(caseId);
  if (!benchmarkCase) throw new Error('e2e_report_case_unknown:' + caseId);
  return plannerModule.createBenchmarkPlanner(benchmarkCase) as NonNullable<AxStudioCoreOptions['reportPlanner']>;
}
