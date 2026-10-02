import type { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { buildAxDataPaths } from '@ax-studio/core';
import { migrateAxDataIfNeeded, type DataMigrationDependencies } from './data-migrate.js';

export interface MigrationTestEnvironment {
  readonly home: string;
  readonly legacyUserData: string;
}

export function createMigrationTestFixture(scope: AsyncLocalStorage<MigrationTestEnvironment>) {
  const temporaryRoot = tmpdir();
  const root = mkdtempSync(join(temporaryRoot, 'ax-data-migrate-'));
  const environment = Object.freeze({ home: join(root, 'home'), legacyUserData: join(root, 'legacy-user-data') });
  mkdirSync(environment.home);
  const paths = buildAxDataPaths(root);
  Object.freeze(paths.generated);
  Object.freeze(paths.cache);
  Object.freeze(paths);
  const operations: Promise<unknown>[] = [];
  let closing = false;
  let cleanup: Promise<void> | undefined;

  function own<T>(operation: () => Promise<T>): Promise<T> {
    if (closing) throw new Error('Migration fixture is closing; new operations are forbidden');
    const pending = scope.run(environment, operation);
    operations.push(pending);
    return pending;
  }

  return Object.freeze({
    root,
    paths,
    ...environment,
    inScope<T>(operation: () => T): T { return scope.run(environment, operation); },
    runTest(operation: () => void | Promise<void>): Promise<void> {
      // Vitest can finish its timeout wrapper while this callback continues.
      // Keep its immutable owner and wait for the callback itself as well.
      return own(() => Promise.resolve().then(operation));
    },
    migrate(dependencies?: DataMigrationDependencies): Promise<void> {
      return own(() => migrateAxDataIfNeeded(paths, dependencies));
    },
    cleanup(): Promise<void> {
      closing = true;
      // Seal registration before capturing this generation's operations. A
      // rejected operation is still reported to its caller; a pending one keeps
      // only this root alive, even after the runner's cleanup deadline expires.
      return cleanup ??= Promise.allSettled([...operations]).then(() => {
        const ownedRelative = relative(temporaryRoot, root);
        if (!ownedRelative || ownedRelative.startsWith('..') || isAbsolute(ownedRelative)) {
          throw new Error('Migration fixture escaped its owned temporary directory');
        }
        rmSync(root, { recursive: true, force: true });
      });
    },
  });
}

export type MigrationTestFixture = ReturnType<typeof createMigrationTestFixture>;
