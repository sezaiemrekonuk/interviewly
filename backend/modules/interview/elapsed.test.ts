import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  now: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('../../src/lib/clock', () => ({ clock: { now: m.now } }));
vi.mock('../../src/lib/db', () => ({
  prisma: { interview: { updateMany: m.updateMany, findUnique: m.findUnique } },
}));

import { activeSeconds, bankActiveTime, HEARTBEAT_GRACE_SECONDS } from './elapsed';

const now = new Date('2026-08-11T10:00:00.000Z');
const started_at = new Date('2026-08-11T09:00:00.000Z');
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  m.now.mockReturnValue(now);
  m.updateMany.mockResolvedValue({ count: 1 });
});

describe('activeSeconds', () => {
  it('is zero before the interview started, whatever the heartbeat columns hold', () => {
    expect(
      activeSeconds({ started_at: null, elapsed_seconds: 300, last_seen_at: ago(5) }, now),
    ).toBe(0);
  });

  it('is the bank alone when no session is open', () => {
    expect(activeSeconds({ started_at, elapsed_seconds: 180, last_seen_at: null }, now)).toBe(180);
  });

  it('adds the open stretch when the last beat is inside the grace window', () => {
    expect(activeSeconds({ started_at, elapsed_seconds: 180, last_seen_at: ago(10) }, now)).toBe(
      190,
    );
  });

  /**
   * The whole point of I16: an hour away is not an hour of interview. The room was left at
   * three minutes, and three minutes is what it reads on the way back in — the grace window is
   * long past, so the gap contributes nothing and the bank stands alone.
   */
  it('ignores a gap past the grace window entirely', () => {
    expect(activeSeconds({ started_at, elapsed_seconds: 180, last_seen_at: ago(3_600) }, now)).toBe(
      180,
    );
  });

  it('counts a stretch right up to the grace boundary and drops the one past it', () => {
    const at = (gap: number) =>
      activeSeconds({ started_at, elapsed_seconds: 0, last_seen_at: ago(gap) }, now);
    expect(at(HEARTBEAT_GRACE_SECONDS)).toBe(HEARTBEAT_GRACE_SECONDS);
    expect(at(HEARTBEAT_GRACE_SECONDS + 1)).toBe(0);
  });

  // A clock that stepped backwards between the beat and the read would otherwise subtract time
  // from the bank, which is the one direction the total must never move.
  it('never subtracts when last_seen_at is in the future', () => {
    const ahead = new Date(now.getTime() + 5_000);
    expect(activeSeconds({ started_at, elapsed_seconds: 180, last_seen_at: ahead }, now)).toBe(180);
  });
});

describe('bankActiveTime', () => {
  const row = { id: 'itv-1', started_at, elapsed_seconds: 180, last_seen_at: ago(12) };

  it('banks the open stretch and re-anchors, guarded on the anchor it read', async () => {
    expect(await bankActiveTime(row)).toBe(192);
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'itv-1', last_seen_at: row.last_seen_at },
      data: { elapsed_seconds: { increment: 12 }, last_seen_at: now },
    });
  });

  it('banks nothing across a gap past the grace window, but still re-anchors', async () => {
    const returning = { ...row, last_seen_at: ago(3_600) };

    expect(await bankActiveTime(returning)).toBe(180);
    expect(m.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { elapsed_seconds: { increment: 0 }, last_seen_at: now },
      }),
    );
  });

  it('banks nothing on the first beat of an interview that has never been seen', async () => {
    expect(await bankActiveTime({ ...row, elapsed_seconds: 0, last_seen_at: null })).toBe(0);
  });

  /**
   * Two tabs in the same room beat on their own timers. The guard means only one write lands per
   * anchor; the loser must report the winner's total rather than its own, or the room would
   * flicker between two figures depending on which tab answered last.
   */
  it('re-reads the row when another tab won the anchor', async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    m.findUnique.mockResolvedValue({ started_at, elapsed_seconds: 192, last_seen_at: now });

    expect(await bankActiveTime(row)).toBe(192);
  });
});
