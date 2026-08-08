import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// One `npm test` over the whole tree, which is what the CI `unit` job runs. The two rings
// need different environments — the packages are plain node, the frontend needs jsdom and
// the React transform — so they are separate projects rather than one merged config.

// The same INTEGRATION gate `worker/vitest.config.mts` carries, for the same reason: a
// `backend/**/*.integration.test.ts` needs a reachable Postgres, and the CI `unit` job that
// runs `npm test` has one only for the migrate check — `.env` names `db:5432`, which resolves
// nowhere outside the compose network. So those files are excluded by default and this flag
// is the only way to run them. `npm run test:integration` sets it; the CI `acceptance` job
// runs that script, being the one job that already stands Postgres up and migrates it.
const integration = process.env.INTEGRATION === '1';

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
          // Same forcing as `worker/vitest.config.mts`: the backend integration ring drives a
          // real answer submit, whose K4 hook calls a provider. A developer's `.env` with
          // AI_ENABLED=true would bill it and make the run non-deterministic. Overrides the
          // file, which the `test` script loads with `--env-file-if-exists`.
          env: { AI_ENABLED: 'false' },
          // `worker` is its own project (below): it needs a `@interviewly/backend` alias too,
          // and duplicating that alias here would run the same files under two project names.
          //
          // Under INTEGRATION=1 this project is *only* the backend integration files — the
          // unit ring already ran in the `unit` job, and `packages/*` has nothing to integrate.
          include: [
            integration ? 'backend/**/*.integration.test.ts' : '{packages/*,backend}/**/*.test.ts',
          ],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            ...(integration ? [] : ['**/*.integration.test.ts']),
          ],
        },
      },
      './frontend/vitest.config.mts',
      './worker/vitest.config.mts',
    ],
  },
});
