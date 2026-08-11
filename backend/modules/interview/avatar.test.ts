/**
 * `change_avatar`'s only real logic: clamp to 1..3, and treat a repeat of the live expression
 * as a no-op — the contract the tool description promises ("if current avatar is 1, no
 * changes made"). Mocks `redis` and `eventChannel` so this stays a unit test, not an
 * integration one; `conductor.integration.test.ts` covers the tool wired into a real turn.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const get = vi.fn(async (key: string) => store.get(key) ?? null);
const set = vi.fn(async (key: string, value: string) => {
  store.set(key, value);
  return 'OK';
});
const publish = vi.fn(async () => 1);

vi.mock('../auth/rate-limit', () => ({ redis: { get, set, publish } }));
vi.mock('./sse', () => ({
  AVATAR_CHANGED: 'INTERVIEW_AVATAR_CHANGED',
  eventChannel: (id: string) => `interview:events:${id}`,
}));

const { applyAvatarChange, currentAvatar } = await import('./avatar');

beforeEach(() => {
  store.clear();
  get.mockClear();
  set.mockClear();
  publish.mockClear();
});

describe('currentAvatar', () => {
  it('defaults to 1 when nothing was ever set', async () => {
    expect(await currentAvatar('i1', 'p1')).toBe(1);
  });

  it('clamps a corrupt cached value back to 1', async () => {
    store.set('avatar:i1:p1', '99');
    expect(await currentAvatar('i1', 'p1')).toBe(1);
  });
});

describe('applyAvatarChange', () => {
  it('writes and publishes on a real change', async () => {
    await applyAvatarChange('i1', 'p1', 2);
    expect(await currentAvatar('i1', 'p1')).toBe(2);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the requested avatar is already live', async () => {
    await applyAvatarChange('i1', 'p1', 1); // default is 1
    expect(set).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('ignores an out-of-range id without writing or publishing', async () => {
    await applyAvatarChange('i1', 'p1', 7);
    expect(set).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
