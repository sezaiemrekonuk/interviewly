/**
 * Issue #70 — the API drains on SIGTERM instead of dying mid-request.
 *
 * There is no way to assert this in-process. `process.listenerCount('SIGTERM')` passes with an
 * empty handler, and a handler called directly proves nothing about a real signal reaching a
 * real listening socket. So this boots the actual entrypoint as a child process, holds a
 * request in flight across the signal, and asserts on what the client and the exit code saw.
 *
 * The in-flight request is a POST whose body arrives in two halves, the second one sent after
 * the signal. `express.json()` is mounted before every route, so the server is genuinely
 * parked on the socket waiting for the rest of the body — no artificial slow route needed, and
 * the 404 that comes back is proof enough that the connection was drained rather than dropped.
 *
 * NOT part of `npm test` — needs Postgres, Redis, and a free port. See answers.integration.test.ts.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { connect, createServer, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { SESSION_COOKIE, sessionExpiry } from './lib/session';
import { prisma } from './lib/db';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** The entrypoint's own ceiling is 10s; a passing drain is far under it. */
const GRACE_MS = 15_000;

let child: ChildProcessWithoutNullStreams | undefined;
const sockets: Socket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  child?.kill('SIGKILL');
  child = undefined;
});

/** A port the API can have to itself — the fixed API_PORT would collide with a running stack. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

interface Api {
  port: number;
  /** Everything the process has written to stdout/stderr so far. */
  output: () => string;
  /** Resolves with the exit code, or rejects if the process outlives the grace window. */
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

async function startApi(): Promise<Api> {
  const port = await freePort();
  // `node --import tsx`, never `npx tsx`: `npx` is a wrapper process, so the SIGTERM below
  // would kill the wrapper and leave the API orphaned — the test then reads the wrapper's
  // death as the API failing to drain. (It reproduced on CI and not locally, because whether
  // npx forwards the signal or execs depends on the platform.) `process.execPath` is the node
  // binary this suite is already running under, so the signal lands on the API itself.
  //
  // From source rather than the built image: this asserts the code in this diff, and the CI
  // job that runs it never builds `dist/`.
  const proc = spawn(process.execPath, ['--import', 'tsx', 'backend/src/index.ts'], {
    cwd: repoRoot,
    env: { ...process.env, API_PORT: String(port) },
  });
  child = proc;

  let output = '';
  proc.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  proc.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      proc.on('exit', (code, signal) => resolve({ code, signal }));
      setTimeout(() => reject(new Error(`API still alive after ${GRACE_MS}ms:\n${output}`)), GRACE_MS)
        .unref();
    },
  );

  const deadline = Date.now() + GRACE_MS;
  while (!output.includes('SERVER_STARTED')) {
    if (Date.now() > deadline) throw new Error(`API never started:\n${output}`);
    if (proc.exitCode !== null) throw new Error(`API exited during boot:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  return { port, output: () => output, exit };
}

/** A raw socket, because the point is to control exactly when the request finishes. */
function openSocket(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    sockets.push(socket);
    socket.on('error', reject);
    socket.on('connect', () => resolve(socket));
  });
}

/** Collects the response bytes as they arrive; the assertion reads it after the drain. */
function collect(socket: Socket): () => string {
  let received = '';
  socket.on('data', (chunk: Buffer) => (received += chunk.toString()));
  return () => received;
}

const waitFor = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A session cookie minted straight into the table — the login flow is not what is under test. */
async function authCookie(): Promise<{ cookie: string; interviewId: string }> {
  const user = await prisma.user.create({
    data: { email_lower: `i70-shutdown-${randomUUID()}@test.local` },
  });
  const session = await prisma.session.create({
    data: { user_id: user.id, expires_at: sessionExpiry() },
  });
  const interview = await prisma.interview.create({
    data: {
      user_id: user.id,
      mode: 'text',
      job_text: 'Backend engineer.',
      job_source: 'paste',
      occupation: 'Backend Engineer',
      language: 'en',
      target_question_count: 5,
      hr_question_count: 2,
      state: 'hr_round',
    },
  });
  return { cookie: `${SESSION_COOKIE}=${session.id}`, interviewId: interview.id };
}

describe('API graceful shutdown', () => {
  it('answers a request that was in flight when SIGTERM arrived', async () => {
    const api = await startApi();

    // Content-Length promises 14 bytes; only 7 are sent, so the server is parked in
    // `express.json()` with the request open when the signal lands.
    const socket = await openSocket(api.port);
    const response = collect(socket);
    socket.write(
      'POST /drain-probe HTTP/1.1\r\n' +
        `Host: 127.0.0.1:${api.port}\r\n` +
        'Content-Type: application/json\r\n' +
        'Content-Length: 14\r\n' +
        'Connection: close\r\n\r\n' +
        '{"half":',
    );
    await waitFor(300);

    api.exit.catch(() => undefined); // asserted below; this only stops an unhandled rejection
    child!.kill('SIGTERM');
    await waitFor(300);
    socket.write('true}');
    socket.write('\n');

    const { code, signal } = await api.exit;

    // The whole point: the client got its answer, and the process left on its own terms.
    expect(response()).toContain('HTTP/1.1');
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(api.output()).toContain('SERVER_STOPPING');
  }, 40_000);

  it('still exits within the grace window with an SSE stream open', async () => {
    const api = await startApi();
    const { cookie, interviewId } = await authCookie();

    const socket = await openSocket(api.port);
    const stream = collect(socket);
    socket.write(
      `GET /interviews/${interviewId}/events HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${api.port}\r\n` +
        `Cookie: ${cookie}\r\n` +
        'Accept: text/event-stream\r\n\r\n',
    );

    // The stream must actually be open, or this asserts nothing at all.
    const deadline = Date.now() + 10_000;
    while (!stream().includes('text/event-stream')) {
      if (Date.now() > deadline) throw new Error(`SSE never opened: ${stream()}`);
      await waitFor(100);
    }

    const startedAt = Date.now();
    api.exit.catch(() => undefined);
    child!.kill('SIGTERM');
    const { code, signal } = await api.exit;

    // A stream nothing closes would hold `server.close()` open until the 10s ceiling fired
    // and exited 1. Draining it is what makes this a clean, prompt exit.
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 40_000);
});
