#!/usr/bin/env node
// A03's `## Verification` block is written in Jest's dialect:
//
//   npm run -w frontend test -- --testPathPattern="(sign-in|register)"
//
// This repo runs Vitest, which rejects the flag outright — `CACError: Unknown option
// --testPathPattern`. EXECUTE.md § 6.5 fixes the verification command and moves the code,
// so this shim translates rather than rewriting the command: the value is treated as a
// regular expression, matched against the collected test-file paths, and the matches are
// handed to Vitest as positional filters. Every other argument passes through untouched.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = /\.test\.tsx?$/;

function collectTestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectTestFiles(full));
    else if (TEST_FILE.test(entry.name)) found.push(path.relative(frontendRoot, full));
  }
  return found;
}

const passthrough = [];
let pattern = null;

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--testPathPattern=')) pattern = arg.slice('--testPathPattern='.length);
  else if (arg === '--testPathPattern') pattern = process.argv[++i];
  else passthrough.push(arg);
}

const filters = [];
if (pattern !== null) {
  const matcher = new RegExp(pattern);
  filters.push(...collectTestFiles(path.join(frontendRoot, 'src')).filter((f) => matcher.test(f)));
  // Vitest treats "no files matched" as a hard error, which is the honest outcome here:
  // a verification command that selects nothing has verified nothing.
  if (filters.length === 0) {
    console.error(`No test files matched --testPathPattern="${pattern}"`);
    process.exit(1);
  }
}

const result = spawnSync(
  process.execPath,
  [
    path.join(frontendRoot, '..', 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    ...filters,
    ...passthrough,
  ],
  { cwd: frontendRoot, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
