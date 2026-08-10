/**
 * C02's guards, tested without a database or a provider.
 *
 * These four functions are the whole reason the conductor is safe to run on candidate text:
 * everything the model asks for passes through `clampAction`, and the two predicates decide
 * what it is even allowed to ask. They are pure, so they are provable — which matters more
 * here than elsewhere, because the failure mode is silent. An interview that hands over one
 * question early, or ends on a first-turn injection, still returns 200 and still produces a
 * report; nothing goes red.
 */
import type { Interview } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { __testing } from './conductor';

const { trimHistory, mayHandOver, mayEnd, clampAction } = __testing;

/** Only the columns the guards read. Cast once here rather than in every case. */
function interview(over: Partial<Interview>): Interview {
  return {
    id: 'i1',
    state: 'hr_round',
    current_index: 1,
    hr_question_count: 4,
    target_question_count: 8,
    ...over,
  } as Interview;
}

const CLAMP_CTX = { turnsLeftOnQuestion: 3, traceId: 't1' };

describe('mayHandOver', () => {
  it('refuses until the round has met its floor', () => {
    // hr_question_count 4 → floor 2. current_index 3 means two answered.
    expect(mayHandOver(interview({ current_index: 1 }))).toBe(false);
    expect(mayHandOver(interview({ current_index: 2 }))).toBe(false);
    expect(mayHandOver(interview({ current_index: 3 }))).toBe(true);
  });

  it('keeps a floor of one even for a one-question round', () => {
    expect(mayHandOver(interview({ hr_question_count: 1, current_index: 1 }))).toBe(false);
    expect(mayHandOver(interview({ hr_question_count: 1, current_index: 2 }))).toBe(true);
  });

  it('is never available from the technical round — there is nothing to hand to', () => {
    expect(mayHandOver(interview({ state: 'tech_round', current_index: 8 }))).toBe(false);
  });
});

describe('mayEnd', () => {
  it('refuses on the opening exchange', () => {
    expect(mayEnd(interview({ current_index: 1 }), 1)).toBe(false);
  });

  it('allows it once a question has been answered', () => {
    expect(mayEnd(interview({ current_index: 2 }), 1)).toBe(true);
  });

  it('allows it once the candidate has spoken twice to the first question', () => {
    // The warn-then-end path: abuse on turn one is warned, abuse on turn two can end.
    expect(mayEnd(interview({ current_index: 1 }), 2)).toBe(true);
  });
});

describe('clampAction', () => {
  it('passes an action the interview allows', () => {
    const at = interview({ current_index: 3 });
    expect(clampAction(at, { action: 'next_question' }, CLAMP_CTX)).toBe('next_question');
    expect(clampAction(at, { action: 'handover' }, CLAMP_CTX)).toBe('handover');
  });

  it('downgrades a handover below the round floor', () => {
    expect(clampAction(interview({ current_index: 1 }), { action: 'handover' }, CLAMP_CTX)).toBe(
      'continue',
    );
  });

  it('downgrades an end with no reason and a widget with no widget', () => {
    const at = interview({ current_index: 3 });
    expect(clampAction(at, { action: 'end_interview' }, CLAMP_CTX)).toBe('continue');
    expect(clampAction(at, { action: 'show_widget' }, CLAMP_CTX)).toBe('continue');
  });

  it('drifts when the per-question ceiling is spent and the interviewer wants to stay', () => {
    const spent = { turnsLeftOnQuestion: 0, traceId: 't1' };
    expect(clampAction(interview({ current_index: 3 }), { action: 'continue' }, spent)).toBe('drift');
  });

  it('does not drift over an action that is already leaving the question', () => {
    // Drift exists to stop an interviewer circling one question. Rewriting an end or a
    // handover into a forced advance would override a decision that already moves on — and
    // would resurrect an interview the interviewer had just ended.
    const spent = { turnsLeftOnQuestion: 0, traceId: 't1' };
    const at = interview({ current_index: 3 });
    expect(clampAction(at, { action: 'next_question' }, spent)).toBe('next_question');
    expect(clampAction(at, { action: 'handover' }, spent)).toBe('handover');
    expect(clampAction(at, { action: 'end_interview', endReason: 'cut_short' }, spent)).toBe(
      'end_interview',
    );
  });
});

describe('trimHistory', () => {
  const row = (content: string) => ({ role: 'user' as const, content, question_id: null });

  it('keeps a short conversation whole and unmarked', () => {
    const out = trimHistory([row('a'), row('b')]);
    expect(out.map((r) => r.content)).toEqual(['a', 'b']);
  });

  it('drops the OLDEST turns, not the newest', () => {
    // The trap this exists for: the prompt builder truncates with `slice(0, MAX)`, which keeps
    // the opening of an interview and throws away the exchange the interviewer has to reply to.
    const out = trimHistory([row('x'.repeat(9_000)), row('y'.repeat(9_000)), row('recent')]);
    const kept = out.map((r) => r.content);
    expect(kept).toContain('recent');
    expect(kept.some((c) => c.startsWith('x'))).toBe(false);
  });

  it('marks the gap so the interviewer knows it is missing the start', () => {
    const out = trimHistory([row('z'.repeat(11_000)), row('recent')]);
    expect(out[0]).toEqual({ role: 'system', content: '[earlier turns omitted]' });
  });

  it('never trims away the last turn, however long it is', () => {
    const out = trimHistory([row('q'.repeat(50_000))]);
    expect(out).toHaveLength(1);
  });
});
