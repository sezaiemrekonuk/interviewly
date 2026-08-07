// Lives under `src/` on purpose: the root `tsconfig.json` includes `frontend/src` only,
// so a setup file outside it would leave jest-dom's matcher augmentation invisible to
// `npm run typecheck` and every `toBeInTheDocument()` would be a type error.
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom is reused across files in a worker, so a component left mounted by one test is
// still in the document for the next one.
afterEach(cleanup);

// jsdom ships no matchMedia, and any component that honours `prefers-reduced-motion` calls it.
// The stub answers *reduce*, which is the deterministic branch by construction: every authored
// motion in this app resolves instantly under it, so a test asserting content never has to wait
// out an animation it does not care about. A test about motion itself overrides this per case.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: /prefers-reduced-motion:\s*reduce/.test(query),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom ships no ResizeObserver, and recharts' ResponsiveContainer constructs one on mount.
// A no-op is enough: jsdom reports zero-size elements anyway, so the charts render empty and
// every assertion lands on the text beside them.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
