import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Its own project (mirrors `frontend/vitest.config.mts`): discovered automatically when
// Vitest runs from this directory (`npm run -w worker test`, cwd=worker) and composed into
// the root config's `projects` array for the unified `npm test` / CI `unit` job.
//
// Both aliases point at source, not `dist/`: `@interviewly/backend`'s barrel
// (`worker-exports.ts`) imports `@interviewly/ai` internally, and the CI `unit` job never
// builds either package first — same reasoning as the root config's `@interviewly/ai` alias.
// `*.integration.test.ts` needs a reachable Postgres and Redis. The CI `unit` job that runs
// `npm test` has neither, and `.env.example` names compose-internal hosts (`db:5432`,
// `cache:6379`) that resolve nowhere else — so those files are excluded by default and this
// flag is the only way to run them. `npm run test:integration` sets it; the CI `acceptance`
// job runs that script, being the one job that already stands both services up.
const integration = process.env.INTEGRATION === '1';

export default defineConfig({
  resolve: {
    alias: {
      '@interviewly/ai': fileURLToPath(new URL('../packages/ai/src/index.ts', import.meta.url)),
      '@interviewly/backend': fileURLToPath(new URL('../backend/src/worker-exports.ts', import.meta.url)),
    },
  },
  test: {
    name: 'worker',
    root: fileURLToPath(new URL('.', import.meta.url)),
    environment: 'node',
    // Same forcing as cucumber.js, for the same reason: `consumer.integration.test.ts` drives
    // the real `runReport`, and a developer's `.env` with `AI_ENABLED=true` would bill live
    // providers and make the assertions non-deterministic. Overrides the file, which is
    // loaded by the `--env-file-if-exists` in the `test` script.
    env: { AI_ENABLED: 'false' },
    // Under INTEGRATION=1 this project is *only* the integration files: they are the ring
    // being asked for, and the unit ring already ran in the `unit` job.
    include: [integration ? 'src/**/*.integration.test.ts' : 'src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...(integration ? [] : ['**/*.integration.test.ts']),
    ],
  },
});
