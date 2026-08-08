/**
 * Issue 141: `.env.example` documented `NEXT_PUBLIC_ASSETS_PREFIX` and
 * `NEXT_PUBLIC_MASCOT_SHA256`; the live `.env` carried neither. Zero symptoms, because both
 * call sites fall back to values that match the seed — which is exactly what makes it a trap:
 * the day real artwork ships at a different digest, every mascot 404s and the fallback hides
 * why. `compose.yaml` now fails the build outright when either is unset, but that guard only
 * covers the three NEXT_PUBLIC_* keys, and the drift was never limited to them.
 *
 * So this pins the general contract instead: `.env` carries every key `.env.example`
 * documents. One direction only — extra local keys are an operator's business, a documented
 * key nobody set is a latent outage.
 *
 * This is worth nothing in CI and is not written for CI. `.env` is gitignored, and both jobs
 * that need one build it with `cp .env.example .env` — so the two files are byte-identical
 * there and this passes by construction, every time. Its whole value is local: it fails for
 * whoever pulls a branch that adds a key and keeps running against the `.env` they already
 * had, which is the only place the drift has ever appeared. Do not read a green CI run as
 * evidence that this assertion holds on anyone's machine.
 *
 * A missing `.env` is a hard failure with a message rather than a skip. Skipping would make
 * the no-op silent, and the repo already treats an absent `.env` as a broken setup — `env.ts`
 * calls `process.exit(1)` at import and `npm test` loads the file for that reason (AGENTS.md).
 *
 * The issue's own suggested check, `^[A-Z_]*=`, could not have caught its own headline
 * variable: `NEXT_PUBLIC_MASCOT_SHA256` contains digits and the class does not. Hence
 * `[A-Z0-9_]`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

const declaredKeys = (file: string): string[] => {
  const path = join(repoRoot, file);
  if (!existsSync(path)) {
    throw new Error(`${file} not found at the repo root — create it with \`cp .env.example .env\`.`);
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
};

describe('.env against .env.example', () => {
  it('sets every key the example documents', () => {
    const live = new Set(declaredKeys('.env'));
    const missing = [...new Set(declaredKeys('.env.example'))].filter((k) => !live.has(k));

    expect(missing).toEqual([]);
  });
});
