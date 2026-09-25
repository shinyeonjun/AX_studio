import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fsModuleCache: true,
    pool: 'threads',
    include: ['src/**/*.test.ts'],
    exclude: ['src/eval/**'],
  },
});
