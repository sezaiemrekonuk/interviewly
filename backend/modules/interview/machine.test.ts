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
});
