/**
 * The acceptance scenarios walk the two edges I06 drives; this pins the *closed* half of the
 * table, which the answer endpoint never reaches — a guard that accidentally returned true
 * for everything would still pass @AC-8/@AC-9/@AC-10.
 *
 * Only edges that stay illegal once I07 fills the table are asserted here, so growing the
 * table is an addition and never an edit to this file.
 *
 * The second half pins `ended_at`, which no scenario can see: `/admin/stats.averageDurationMs`
 * averages over the column and reads 0 whether it is unwritten or genuinely empty, so the only
 * place the write is observable is the `updateMany` argument itself.
 */
import type { Interview } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Update = { where: Record<string, unknown>; data: Record<string, unknown> };
const updateMany = vi.fn(async (_args: Update) => ({ count: 1 }));

vi.mock('../../src/lib/db', () => ({ prisma: { interview: { updateMany } } }));
// Imported by machine.ts for the fan-out and the report enqueue; both construct Redis clients
// from `config` at import time, and this unit has no env.
vi.mock('./sse', () => ({ publishStateChanged: vi.fn(), enqueueReport: vi.fn() }));
vi.mock('./language', () => ({ clearLanguageStreak: vi.fn() }));

const { applyTransition, canTransition, deadEndsMissingFromTerminal } = await import('./machine');

describe('canTransition', () => {
  it('allows the round handover and the end of the interview', () => {
    expect(canTransition('hr_round', 'tech_round')).toBe(true);
    expect(canTransition('tech_round', 'evaluating')).toBe(true);
    // A split that leaves zero technical questions still has to end (target 2 → hr 2, tech 0).
    expect(canTransition('hr_round', 'evaluating')).toBe(true);
  });

  it('rejects a round going backwards', () => {
    expect(canTransition('tech_round', 'hr_round')).toBe(false);
    expect(canTransition('evaluating', 'tech_round')).toBe(false);
    expect(canTransition('evaluating', 'hr_round')).toBe(false);
  });

  it('rejects a state transitioning to itself', () => {
    expect(canTransition('hr_round', 'hr_round')).toBe(false);
    expect(canTransition('tech_round', 'tech_round')).toBe(false);
  });

  it('rejects an answer restarting the interview', () => {
    expect(canTransition('hr_round', 'created')).toBe(false);
    expect(canTransition('tech_round', 'profiling')).toBe(false);
  });

  // I07 additions. The acceptance walk drives each of these once; these pin the closed half
  // around them, which no scenario reaches.
  it('opens and closes the interview', () => {
    expect(canTransition('created', 'profiling')).toBe(true);
    expect(canTransition('profiling', 'hr_round')).toBe(true);
    expect(canTransition('evaluating', 'completed')).toBe(true);
    expect(canTransition('evaluating', 'failed')).toBe(true);
    expect(canTransition('created', 'hr_round')).toBe(false);
  });

  // Issue 081 reopened the two edges this file used to pin shut: a report job lost after the
  // interview left `evaluating` has no other way back, because `runReport` uses
  // `evaluating → completed` as its CAS. `POST /admin/interviews/:id/report/requeue` is the
  // only caller, and the duplicate-report guard lives there rather than here.
  it('lets an admin requeue re-enter evaluation from a terminal state', () => {
    expect(canTransition('completed', 'evaluating')).toBe(true);
    expect(canTransition('failed', 'evaluating')).toBe(true);
    // Recovery, not a restart: the requeue re-runs the report, never the interview.
    expect(canTransition('completed', 'hr_round')).toBe(false);
    expect(canTransition('completed', 'tech_round')).toBe(false);
    expect(canTransition('failed', 'hr_round')).toBe(false);
    expect(canTransition('failed', 'completed')).toBe(false);
    expect(canTransition('abandoned', 'evaluating')).toBe(false);
    expect(canTransition('evaluating', 'evaluating')).toBe(false);
  });

  it('pauses and resumes the HR round only', () => {
    expect(canTransition('hr_round', 'paused')).toBe(true);
    expect(canTransition('paused', 'hr_round')).toBe(true);
    // The only pause source is a failed generation, and ADR-I22 puts both batches in the HR
    // round — a `tech_round` pause would have no trigger and no way back.
    expect(canTransition('tech_round', 'paused')).toBe(false);
    expect(canTransition('paused', 'tech_round')).toBe(false);
    expect(canTransition('paused', 'evaluating')).toBe(false);
  });

  it('allows stale interview states to end as abandoned', () => {
    expect(canTransition('profiling', 'abandoned')).toBe(true);
    expect(canTransition('hr_round', 'abandoned')).toBe(true);
    expect(canTransition('paused', 'abandoned')).toBe(true);
  });

  it('keeps abandoned closed from non-stale or terminal states', () => {
    expect(canTransition('created', 'abandoned')).toBe(false);
    expect(canTransition('tech_round', 'abandoned')).toBe(false);
    expect(canTransition('evaluating', 'abandoned')).toBe(false);
    expect(canTransition('completed', 'abandoned')).toBe(false);
    expect(canTransition('failed', 'abandoned')).toBe(false);
    expect(canTransition('abandoned', 'abandoned')).toBe(false);
  });
});

const row = (over: Partial<Interview> = {}): Interview =>
  ({ id: 'itv_1', state: 'evaluating', ended_reason: null, ended_at: null, ...over }) as Interview;

/** The `data` the one write was called with — the only place `ended_at` is observable. */
const written = () => updateMany.mock.calls[0][0].data;

describe('applyTransition', () => {
  beforeEach(() => updateMany.mockClear());

  it('stamps ended_at entering each terminal state', async () => {
    for (const [from, to] of [
      ['evaluating', 'completed'],
      ['evaluating', 'failed'],
      ['hr_round', 'abandoned'],
    ] as const) {
      updateMany.mockClear();
      await applyTransition(row({ state: from }), to, { traceId: 't' });
      expect(written().ended_at, `${from} → ${to}`).toBeInstanceOf(Date);
    }
  });

  it('leaves ended_at alone on a transition that is not the end', async () => {
    await applyTransition(row({ state: 'hr_round' }), 'tech_round', { traceId: 't' });
    expect(written()).not.toHaveProperty('ended_at');
  });

  // The retry case: a terminal row re-transitioned would otherwise move the end of the
  // interview forward, inflating averageDurationMs by however long the retry took.
  it('does not overwrite an ended_at that is already set', async () => {
    const interview = row({ ended_at: new Date('2026-01-01T00:00:00.000Z') });
    await applyTransition(interview, 'completed', { traceId: 't' });

    expect(written()).not.toHaveProperty('ended_at');
    expect(interview.ended_at).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  // The WHERE is the CAS that makes concurrent transitions safe (ADR-I06); `ended_at` must ride
  // in `data` and never narrow it, or a re-stamp becomes a spurious 409.
  it('keeps the concurrency guard on state alone', async () => {
    await applyTransition(row(), 'completed', { traceId: 'trace-1' });
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'itv_1', state: 'evaluating' });
  });

  it('writes the end reason and the end time together', async () => {
    const interview = row({ state: 'hr_round' });
    await applyTransition(interview, 'abandoned', { traceId: 't', endedReason: 'abandoned' });

    expect(written()).toMatchObject({ state: 'abandoned', ended_reason: 'abandoned' });
    expect(written().ended_at).toBeInstanceOf(Date);
    // The caller's copy is refreshed for the same reason `state` is: a second transition in
    // one request would otherwise re-stamp off a stale null.
    expect(interview.ended_at).toEqual(written().ended_at);
  });

  // The half of the old derivation worth keeping. `TERMINAL` is a list now, because
  // `completed → evaluating` (the report-requeue edge) made "no outgoing edge" the wrong
  // definition — but a *new* state added with no way out must still be added to the list, and
  // forgetting is exactly how `ended_at` stopped being written the first time.
  it('has no dead-end state missing from the terminal list', () => {
    expect(deadEndsMissingFromTerminal()).toEqual([]);
  });
});
