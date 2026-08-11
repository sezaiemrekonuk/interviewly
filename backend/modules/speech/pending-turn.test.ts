/**
 * The take must be one round trip. The fake below is built so that a split `get` + `del` is
 * *observably* different from a `MULTI`: every command resolves on its own macrotask, so two
 * takes started together interleave the way two uploads racing on one interview would. Replace
 * the MULTI in `takePendingTurn` with a `get` then a `del` and `consumed exactly once` goes red.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn(),
}));

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Cmd = ['get' | 'del', string];

class FakeRedis {
  store = new Map<string, string>();
  ttls = new Map<string, number | undefined>();
  down = false;

  private guard(): void {
    if (this.down) throw new Error('ECONNREFUSED');
  }

  async get(key: string): Promise<string | null> {
    await tick();
    this.guard();
    return this.store.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    await tick();
    this.guard();
    return this.store.delete(key) ? 1 : 0;
  }

  async set(key: string, value: string, mode?: string, seconds?: number): Promise<'OK'> {
    await tick();
    this.guard();
    this.store.set(key, value);
    this.ttls.set(key, mode === 'EX' ? seconds : undefined);
    return 'OK';
  }

  multi() {
    const cmds: Cmd[] = [];
    const chain = {
      get: (key: string) => {
        cmds.push(['get', key]);
        return chain;
      },
      del: (key: string) => {
        cmds.push(['del', key]);
        return chain;
      },
      // The whole point: one await, then every queued command applied without a gap.
      exec: async (): Promise<[Error | null, unknown][]> => {
        await tick();
        this.guard();
        return cmds.map(([cmd, key]) =>
          cmd === 'get'
            ? [null, this.store.get(key) ?? null]
            : [null, this.store.delete(key) ? 1 : 0],
        );
      },
    };
    return chain;
  }
}

const redis = new FakeRedis();

vi.mock('../auth/rate-limit', () => ({ redis }));
vi.mock('../../src/lib/logger', () => ({
  logger: { warn: m.loggerWarn, debug: m.loggerDebug },
}));

const {
  dropPendingTurn,
  holdPendingTurn,
  MAX_PENDING_CHARS,
  MAX_PROBES_PER_TURN,
  PENDING_TURN_TTL_SECONDS,
  takePendingTurn,
} = await import('./pending-turn');

const KEY = 'interview:itv_1:pending-turn';
const HELD = { text: 'I worked on a payments service', questionId: 'q_1', probes: 1 };

/** K6: no log line may carry candidate speech. Checked against every call, not a chosen one. */
const loggedText = (): string => JSON.stringify([m.loggerWarn.mock.calls, m.loggerDebug.mock.calls]);

beforeEach(() => {
  redis.store.clear();
  redis.ttls.clear();
  redis.down = false;
  m.loggerWarn.mockReset();
  m.loggerDebug.mockReset();
});

describe('caps', () => {
  it('exports the two caps T03 imports rather than restates', () => {
    expect(MAX_PROBES_PER_TURN).toBe(8);
    expect(MAX_PENDING_CHARS).toBe(6_000);
  });
});

describe('hold / take round trip', () => {
  it('returns what was held, under a server-derived key', async () => {
    await holdPendingTurn('itv_1', HELD);
    expect([...redis.store.keys()]).toEqual([KEY]);
    await expect(takePendingTurn('itv_1')).resolves.toEqual(HELD);
  });

  it('returns null on a second take', async () => {
    await holdPendingTurn('itv_1', HELD);
    await takePendingTurn('itv_1');
    await expect(takePendingTurn('itv_1')).resolves.toBeNull();
  });

  it('returns null when nothing is held', async () => {
    await expect(takePendingTurn('itv_1')).resolves.toBeNull();
  });

  it('sets the TTL on every write, not only the first', async () => {
    await holdPendingTurn('itv_1', HELD);
    expect(redis.ttls.get(KEY)).toBe(PENDING_TURN_TTL_SECONDS);
    redis.ttls.set(KEY, undefined);
    await holdPendingTurn('itv_1', { ...HELD, probes: 2 });
    expect(redis.ttls.get(KEY)).toBe(PENDING_TURN_TTL_SECONDS);
  });

  it('keeps one interview out of another interview key', async () => {
    await holdPendingTurn('itv_1', HELD);
    await expect(takePendingTurn('itv_2')).resolves.toBeNull();
    await expect(takePendingTurn('itv_1')).resolves.toEqual(HELD);
  });
});

describe('concurrency', () => {
  it('is consumed exactly once when two takes race', async () => {
    await holdPendingTurn('itv_1', HELD);
    const [a, b] = await Promise.all([takePendingTurn('itv_1'), takePendingTurn('itv_1')]);
    expect([a, b].filter(Boolean)).toEqual([HELD]);
  });
});

describe('drop', () => {
  it('discards without consuming', async () => {
    await holdPendingTurn('itv_1', HELD);
    await dropPendingTurn('itv_1');
    await expect(takePendingTurn('itv_1')).resolves.toBeNull();
  });
});

describe('malformed value', () => {
  it.each([
    ['not json', 'nonsense{'],
    ['json but not an object', '"a string"'],
    ['object missing questionId', JSON.stringify({ text: 'x', probes: 1 })],
    ['object with a non-numeric probes', JSON.stringify({ text: 'x', questionId: 'q', probes: 'x' })],
  ])('returns null and warns without content: %s', async (_name, raw) => {
    redis.store.set(KEY, raw);
    await expect(takePendingTurn('itv_1')).resolves.toBeNull();
    expect(m.loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggedText()).not.toContain('nonsense');
  });

  it('still consumes the malformed value so it cannot be re-read', async () => {
    redis.store.set(KEY, 'nonsense{');
    await takePendingTurn('itv_1');
    expect(redis.store.has(KEY)).toBe(false);
  });
});

describe('redis down', () => {
  beforeEach(() => {
    redis.down = true;
  });

  it('take behaves as nothing held', async () => {
    await expect(takePendingTurn('itv_1')).resolves.toBeNull();
    expect(m.loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('hold is a no-op', async () => {
    await expect(holdPendingTurn('itv_1', HELD)).resolves.toBeUndefined();
    expect(m.loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('drop is a no-op', async () => {
    await expect(dropPendingTurn('itv_1')).resolves.toBeUndefined();
    expect(m.loggerWarn).toHaveBeenCalledTimes(1);
  });
});

describe('logging', () => {
  it('never carries the held text, only its shape', async () => {
    await holdPendingTurn('itv_1', HELD);
    await takePendingTurn('itv_1');
    redis.down = true;
    await takePendingTurn('itv_1');
    expect(loggedText()).not.toContain('payments service');
    expect(loggedText()).toContain('chars');
  });
});
