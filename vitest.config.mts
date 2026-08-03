import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// One `npm test` over the whole tree, which is what the CI `unit` job runs. The two rings
// need different environments — the packages are plain node, the frontend needs jsdom and
// the React transform — so they are separate projects rather than one merged config.
export default defineConfig({
  test: {
    projects: [
      {
        // `@interviewly/ai` now publishes `dist/` as its entry point, so that its consumers
        // are loadable by plain `node` in the production image. Tests must NOT follow that:
        // resolving through `main` would run them against whatever `dist/` happened to be
        // built last, and the CI `unit` job never builds it at all. Alias back to source, the
        // same mapping the root tsconfig `paths` gives tsc and tsx.
        resolve: {
          alias: {
            '@interviewly/ai': fileURLToPath(new URL('./packages/ai/src/index.ts', import.meta.url)),
          },
        },
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
