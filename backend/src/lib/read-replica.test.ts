/**
 * `adminRead`'s two branches, and the header contract every admin handler leans on. No live
 * database: `@prisma/client` and `./db` are mocked so this proves the routing/failover logic
 * itself, not that a real replica exists — `db/replica-entrypoint.sh` +
 * `scripts/verify-read-replica.sh` prove that part, against a real streaming standby.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PRIMARY_MARKER = { name: 'primary' } as const;

vi.mock('./db', () => ({ prisma: PRIMARY_MARKER }));
vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

describe('adminRead', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('./env');
    vi.doUnmock('@prisma/client');
  });

  it('routes straight to the primary when no replica is configured', async () => {
    vi.doMock('./env', () => ({ config: { DATABASE_REPLICA_URL: undefined } }));
    const { adminRead } = await import('./read-replica');

    const fn = vi.fn(async (client: unknown) => client);
    const result = await adminRead(fn);

    expect(fn).toHaveBeenCalledWith(PRIMARY_MARKER);
    expect(result).toEqual({ data: PRIMARY_MARKER, source: 'primary', lagSeconds: null });
  });

  it('reads the replica and reports its lag when one is configured', async () => {
    vi.doMock('./env', () => ({
      config: { DATABASE_REPLICA_URL: 'postgresql://replicator@db-replica:5432/interviewly' },
    }));
    const replicaMarker = { name: 'replica' };
    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {
        $queryRaw = vi.fn().mockResolvedValue([{ lag_seconds: 1.5 }]);
      },
    }));
    const { adminRead } = await import('./read-replica');

    const fn = vi.fn(async (client: unknown) =>
      // The class above has no other identity than "not the primary marker" — good enough to
      // prove the replica instance, not the primary, is what handlers receive.
      client === PRIMARY_MARKER ? 'wrong-client' : replicaMarker,
    );
    const result = await adminRead(fn);

    expect(result.source).toBe('replica');
    expect(result.lagSeconds).toBe(1.5);
    expect(result.data).toBe(replicaMarker);
  });

  it('falls back to the primary when the replica read throws', async () => {
    vi.doMock('./env', () => ({
      config: { DATABASE_REPLICA_URL: 'postgresql://replicator@db-replica:5432/interviewly' },
    }));
    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {
        $queryRaw = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      },
    }));
    const { adminRead } = await import('./read-replica');

    let calls = 0;
    const fn = vi.fn(async (client: unknown) => {
      calls += 1;
      if (calls === 1) throw new Error('replica connection refused');
      return client;
    });
    const result = await adminRead(fn);

    expect(result).toEqual({ data: PRIMARY_MARKER, source: 'primary', lagSeconds: null });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('applyReadHeaders sets X-Read-Source always, X-Replica-Lag-Seconds only when known', async () => {
    vi.doMock('./env', () => ({ config: { DATABASE_REPLICA_URL: undefined } }));
    const { applyReadHeaders } = await import('./read-replica');

    const set = vi.fn();
    applyReadHeaders({ set } as never, { data: null, source: 'primary', lagSeconds: null });
    expect(set).toHaveBeenCalledWith('X-Read-Source', 'primary');
    expect(set).not.toHaveBeenCalledWith('X-Replica-Lag-Seconds', expect.anything());

    set.mockClear();
    applyReadHeaders({ set } as never, { data: null, source: 'replica', lagSeconds: 2.25 });
    expect(set).toHaveBeenCalledWith('X-Read-Source', 'replica');
    expect(set).toHaveBeenCalledWith('X-Replica-Lag-Seconds', '2.250');
  });
});
