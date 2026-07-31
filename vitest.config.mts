import { defineConfig } from 'vitest/config';

// One `npm test` over the whole tree, which is what the CI `unit` job runs. The two rings
// need different environments — the packages are plain node, the frontend needs jsdom and
// the React transform — so they are separate projects rather than one merged config.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['{packages/*,backend,worker}/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
      './frontend/vitest.config.mts',
    ],
  },
});
