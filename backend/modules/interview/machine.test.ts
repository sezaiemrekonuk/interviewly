/**
 * The acceptance scenarios walk the two edges I06 drives; this pins the *closed* half of the
 * table, which the answer endpoint never reaches — a guard that accidentally returned true
 * for everything would still pass @AC-8/@AC-9/@AC-10.
 *
 * Only edges that stay illegal once I07 fills the table are asserted here, so growing the
 * table is an addition and never an edit to this file.
 */
import { describe, expect, it } from 'vitest';

import { canTransition } from './machine';

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
    expect(canTransition('completed', 'evaluating')).toBe(false);
    expect(canTransition('created', 'hr_round')).toBe(false);
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
