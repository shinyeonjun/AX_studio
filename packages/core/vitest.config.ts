import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fsModuleCache: true,
    pool: 'threads',
    // sql.js startup and file export are slow when the full suite shares the machine; 5s flakes.
    testTimeout: 15_000,
    include: ['src/**/*.test.ts'],
    exclude: ['src/eval/**'],
  },
});
