import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads a `--token` out of the shipped `styles/tokens.css`.
 *
 * The metadata files — `manifest.ts`, `opengraph-image.tsx`, the icons — need real colour
 * values, and DESIGN.md §2 is explicit that a literal outside `tokens.css` is a defect rather
 * than a shortcut. `ui-checks/tokens.test.ts` enforces exactly that over `src/**`, so these
 * files read the registry instead of copying it.
 *
 * Server-only: every caller is a Next metadata route or an `ImageResponse`, all of which run
 * on the server, so `node:fs` is available and the CSS never reaches a client bundle.
 */
/**
 * The Next server runs with `frontend/` as its working directory; `npm test` runs from the
 * repo root. Two candidates rather than a build-time constant, because the alternative is a
 * path that is correct in production and unreadable in the test that guards it.
 */
const CANDIDATES = [
  join(process.cwd(), 'styles', 'tokens.css'),
  join(process.cwd(), 'frontend', 'styles', 'tokens.css'),
];

function read(): string {
  for (const path of CANDIDATES) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // Try the next one; failing to find it anywhere throws below with both paths named.
    }
  }
  throw new Error(`tokens.css not found — looked in ${CANDIDATES.join(', ')}`);
}

let cache: Map<string, string> | null = null;

function registry(): Map<string, string> {
  if (cache) return cache;
  const source = read();
  cache = new Map(
    [...source.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  );
  return cache;
}

export function token(name: string): string {
  const value = registry().get(name);
  // Loud, not a fallback: a silent default here would be the literal the lint forbids, and it
  // would ship as a wrong brand colour on the one surface nobody looks at twice.
  if (!value) throw new Error(`token ${name} not found in styles/tokens.css`);
  return value;
}
