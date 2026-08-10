import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The component ring for the frontend (A03). Kept as its own config so the root
// `vitest.config.ts` can compose it as a project alongside the node-environment
// packages — one `npm test` at the root runs both rings, which is what the CI
// `unit` job invokes.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'frontend',
    root: fileURLToPath(new URL('.', import.meta.url)),
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // `next` ships no `exports` map, so `next/navigation` only resolves under CommonJS
    // extension guessing. Vitest leaves node_modules external and loads them as native ESM,
    // where that guessing does not happen — so next-intl's own `import … from 'next/navigation'`
    // fails to resolve. Inlining routes it through Vite's resolver, which does guess.
    server: { deps: { inline: ['next-intl'] } },
  },
});
