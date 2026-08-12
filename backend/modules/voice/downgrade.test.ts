import type { Interview } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Update = { where: Record<string, unknown>; data: Record<string, unknown> };
const updateMany = vi.fn(async (_args: Update) => ({ count: 1 }));

vi.mock('../../src/lib/db', () => ({
  prisma: { interview: { updateMany } },
  activeInterview: vi.fn(),
}));

const publishStateChanged = vi.fn(async () => {});

vi.mock('../interview/sse', () => ({ publishStateChanged }));

const { downgradeToText } = await import('./downgrade');

const row = (over: Partial<Interview> = {}): Interview =>
  ({ id: 'itv_1', mode: 'voice', state: 'hr_round', ...over }) as Interview;

describe('downgradeToText', () => {
  beforeEach(() => {
    updateMany.mockClear();
    publishStateChanged.mockClear();
  });

  it('publishes the state-changed event once when the downgrade flips a voice interview', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });

    const flipped = await downgradeToText(row(), { traceId: 'trc_1' });

    expect(flipped).toBe(true);
    expect(publishStateChanged).toHaveBeenCalledTimes(1);
    expect(publishStateChanged).toHaveBeenCalledWith(
      expect.objectContaining({ interviewId: 'itv_1' }),
    );
  });

  it('publishes nothing when the interview is already in text mode', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });

    const flipped = await downgradeToText(row(), { traceId: 'trc_1' });

    expect(flipped).toBe(false);
    expect(publishStateChanged).not.toHaveBeenCalled();
  });

  it('still reports a successful downgrade when the publish rejects', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    publishStateChanged.mockRejectedValueOnce(new Error('redis down'));

    await expect(downgradeToText(row(), { traceId: 'trc_1' })).resolves.toBe(true);
  });
});
