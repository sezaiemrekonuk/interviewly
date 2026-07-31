// Lives under `src/` on purpose: the root `tsconfig.json` includes `frontend/src` only,
// so a setup file outside it would leave jest-dom's matcher augmentation invisible to
// `npm run typecheck` and every `toBeInTheDocument()` would be a type error.
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom is reused across files in a worker, so a component left mounted by one test is
// still in the document for the next one.
afterEach(cleanup);
