import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Suites that write real SQLite files and fsync every commit. Run beside each other they wait on
 * the same disk: on hosted Windows (4 CPUs) each took 2-3x longer in parallel than alone, 13-17 s
 * instead of 5-7 s, and parallel was slower than one after the other, which is how they passed
 * 30 s deadlines only some of the time (issue #162, CI runs 38277183493, 38526015735, 38537839542).
 * They run after the other suites, one file at a time.
 */
const REAL_FILE_DB_SUITES = [
  'electron/main/ipc/runtime-handlers/approval-history.test.ts',
  'electron/main/ipc/state-handlers/preview-resume-failure.test.ts',
];

export default defineConfig({
  test: {
    fsModuleCache: true,
    pool: 'threads',
    projects: [
      {
        extends: true,
        test: { name: 'desktop', exclude: [...configDefaults.exclude, ...REAL_FILE_DB_SUITES], sequence: { groupOrder: 0 } },
      },
      {
        extends: true,
        test: { name: 'desktop-real-db', include: REAL_FILE_DB_SUITES, fileParallelism: false, sequence: { groupOrder: 1 } },
      },
    ],
  },
});
