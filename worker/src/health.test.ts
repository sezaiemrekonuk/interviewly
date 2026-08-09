/**
 * Issue 71. The point of the probe is that it goes RED when Redis is gone — a `/healthz`
 * that answers 200 unconditionally is the bug, not the fix. So both cases are pinned: a
 * live connection, and a connection whose PING never settles (which is what a real
 * disconnect looks like under `maxRetriesPerRequest: null` — the command queues offline
 * instead of rejecting).
 */
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { redisHealthy, startHealthServer } from './health';

vi.mock('./lib/logger', () => ({ logger: { info: vi.fn() } }));

const alive = { ping: () => Promise.resolve('PONG') };
const rejecting = { ping: () => Promise.reject(new Error('ECONNREFUSED')) };
/** Never settles — the offline-queue case the timeout exists for. */
const hanging = { ping: () => new Promise<string>(() => {}) };

async function get(port: number, path: string): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  await res.text();
  return res.status;
}

describe('redisHealthy', () => {
  it('is true when the connection answers', async () => {
    expect(await redisHealthy(alive)).toBe(true);
  });

  it('is false when the connection refuses', async () => {
    expect(await redisHealthy(rejecting)).toBe(false);
  });

  it('is false when the ping never comes back', async () => {
    vi.useFakeTimers();
    try {
      const verdict = redisHealthy(hanging);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await verdict).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GET /healthz', () => {
  it('answers 200 while Redis is reachable and 404 on anything else', async () => {
    const server = startHealthServer(0, alive);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      expect(await get(port, '/healthz')).toBe(200);
      expect(await get(port, '/')).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('answers 503 once Redis is unreachable', async () => {
    const server = startHealthServer(0, rejecting);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      expect(await get(port, '/healthz')).toBe(503);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
