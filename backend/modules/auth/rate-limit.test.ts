/**
 * `redis` used to be `new Redis(...)` at module load, so importing anything under
 * modules/auth/ — even a test that never touches rate limiting — opened a real socket the
 * moment this file was required. This pins the fix: no connection until the first property
 * access, and exactly one client after that (not one per access).
 */
import { describe, expect, it, vi } from 'vitest';

const RedisCtor = vi.fn(function FakeRedis(this: { ttl: () => string }) {
  this.ttl = vi.fn(async () => 'ok');
});

vi.mock('ioredis', () => ({ Redis: RedisCtor }));

describe('auth rate-limit redis client', () => {
  it('does not construct a client on import', async () => {
    await import('./rate-limit');
    expect(RedisCtor).not.toHaveBeenCalled();
  });

  it('constructs exactly one client, on first use', async () => {
    const { redis } = await import('./rate-limit');
    await redis.ttl('some-key');
    await redis.ttl('some-key');
    expect(RedisCtor).toHaveBeenCalledTimes(1);
  });
});
