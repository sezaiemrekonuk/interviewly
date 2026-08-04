/**
 * I15 — boots the API as its own OS process with a mutated environment.
 *
 * `env.ts` validates at import time and calls `process.exit(1)`, so "startup fails before
 * serving" cannot be observed from inside the cucumber process: it would take the runner
 * down with it. Lives here rather than in a step file because `config.feature` and
 * `ai_provider.feature` share three step texts (`the API starts`, `startup fails before
 * serving`, `the boot error code is`) over two different boots — the in-process provider-key
 * check and this one — and cucumber allows exactly one definition per text.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');

/** Valid values the feature restores a key to, taken from the run's own environment. */
const VALID: Record<string, string> = {
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  S3_BUCKET: process.env.S3_BUCKET ?? 'interviewly',
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ?? 'http://localhost',
  DATABASE_URL: process.env.DATABASE_URL ?? '',
};

export interface Boot {
  exitCode: number | null;
  output: string;
  port: number;
  serving: boolean;
}

/** `undefined` means "delete this key from the child's environment". */
export const envBoot: {
  active: boolean;
  overrides: Record<string, string | undefined>;
  result?: Boot;
} = { active: false, overrides: {} };

export function reset(): void {
  envBoot.active = true;
  envBoot.overrides = {};
  envBoot.result = undefined;
}

export function validValue(key: string): string {
  return VALID[key] ?? 'valid';
}

// Every child, not just the last: a scenario boots twice (invalid, then valid) and a
// surviving one keeps its stdio pipes open, which keeps cucumber's event loop alive — the
// run then hangs after printing its summary instead of exiting.
const children: ChildProcess[] = [];

export function killApi(): void {
  for (const proc of children.splice(0)) {
    // The whole group: tsx's loader can put the server in a grandchild, and killing only
    // the direct child leaves it listening.
    try {
      if (proc.pid) process.kill(-proc.pid, 'SIGKILL');
    } catch {
      proc.kill('SIGKILL');
    }
  }
  envBoot.active = false;
}

// ponytail: TOCTOU — the port is free when we look and could be taken before the child
// binds it. A retry loop is the upgrade if this ever flakes.
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

export async function isServing(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/healthz`)).status === 200;
  } catch {
    return false;
  }
}

export async function startApi(): Promise<Boot> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, API_PORT: String(port) };
  for (const [key, value] of Object.entries(envBoot.overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  const proc = spawn(process.execPath, ['--import', 'tsx', 'backend/src/index.ts'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  children.push(proc);

  let output = '';
  proc.stdout?.on('data', (c: Buffer) => (output += c.toString()));
  proc.stderr?.on('data', (c: Buffer) => (output += c.toString()));

  // Two terminal states: the process exits (env.ts rejected a key), or it logs
  // SERVER_STARTED (it got past env.ts and is listening).
  const exitCode = await new Promise<number | null>((resolve) => {
    const finish = (code: number | null) => {
      clearTimeout(giveUp);
      clearInterval(listening);
      resolve(code);
    };
    const giveUp = setTimeout(() => finish(null), 20_000);
    const listening = setInterval(() => {
      if (output.includes('SERVER_STARTED')) finish(null);
    }, 50);
    proc.once('exit', finish);
  });

  return { exitCode, output, port, serving: exitCode === null && (await isServing(port)) };
}
