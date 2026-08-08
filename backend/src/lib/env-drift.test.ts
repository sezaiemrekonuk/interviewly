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
 * In CI this is near-tautological (`cp .env.example .env`, both jobs). It is not written for
 * CI. It fails on the machine of whoever pulls a branch that adds a key and keeps running
 * against the `.env` they already had, which is the only place the drift ever appears.
 *
 * The issue's own suggested check, `^[A-Z_]*=`, could not have caught its own headline
 * variable: `NEXT_PUBLIC_MASCOT_SHA256` contains digits and the class does not. Hence
 * `[A-Z0-9_]`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

const declaredKeys = (file: string): string[] =>
  readFileSync(join(repoRoot, file), 'utf8')
    .split('\n')
    .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);

describe('.env against .env.example', () => {
  it('sets every key the example documents', () => {
    const live = new Set(declaredKeys('.env'));
    const missing = [...new Set(declaredKeys('.env.example'))].filter((k) => !live.has(k));

    expect(missing).toEqual([]);
  });
});
