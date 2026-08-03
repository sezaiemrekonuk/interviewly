import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Its own project (mirrors `frontend/vitest.config.mts`): discovered automatically when
// Vitest runs from this directory (`npm run -w worker test`, cwd=worker) and composed into
// the root config's `projects` array for the unified `npm test` / CI `unit` job.
//
// Both aliases point at source, not `dist/`: `@interviewly/backend`'s barrel
// (`worker-exports.ts`) imports `@interviewly/ai` internally, and the CI `unit` job never
// builds either package first — same reasoning as the root config's `@interviewly/ai` alias.
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
    // Same forcing as cucumber.js, for the same reason: `consumer.test.ts` drives the real
    // `runReport`, and a developer's `.env` with `AI_ENABLED=true` would bill live providers
    // and make the assertions non-deterministic. Overrides the file, which is loaded by the
    // `--env-file-if-exists` in the `test` script.
    env: { AI_ENABLED: 'false' },
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
