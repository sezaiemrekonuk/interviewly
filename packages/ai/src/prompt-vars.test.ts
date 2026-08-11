/**
 * `allowedActions` is a hint, never a check — `conductor.ts` re-derives every action from the
 * interview row (ADR-C02). What it *is* responsible for is not offering the interviewer a move
 * the server is about to overrule, which is a different failure from letting one through.
 */
import { describe, expect, it } from 'vitest';

import { conductVars } from './prompt-vars';
import type { ConductTurnArgs } from './AiClient';

const args = (over: Partial<ConductTurnArgs> = {}): ConductTurnArgs =>
  ({
    personaBrief: 'brief',
    personaName: 'Ada',
    roundType: 'hr',
    language: 'en',
    jobListing: 'Backend engineer',
    candidateProfile: null,
    candidateCv: null,
    currentQuestion: 'Tell me about a conflict.',
    currentIntent: 'find out how they handle disagreement',
    remainingTopics: ['motivation'],
    conversation: [{ role: 'assistant', content: 'Tell me about a conflict.' }],
    turnsLeftOnQuestion: 3,
    mayHandOver: false,
    mayEnd: false,
    ctx: { interviewId: 'itv_1', traceId: 'trc_1' },
    ...over,
  }) as ConductTurnArgs;

const allowed = (over: Partial<ConductTurnArgs> = {}): string[] =>
  String(conductVars(args(over)).allowedActions)
    .split(', ')
    .filter(Boolean);

describe('allowedActions', () => {
  it('offers the full set with turns to spare', () => {
    expect(allowed({ turnsLeftOnQuestion: 3 })).toEqual([
      'continue',
      'next_question',
      'show_widget',
    ]);
  });

  /**
   * The regression this exists for: on the last turn the drift guard rewrites `continue` into
   * an advance and writes "the interviewer was moved on automatically" into the transcript.
   * Offering `continue` there bought one more clarification and spent it on being overruled,
   * which the candidate reads as being cut off mid-answer.
   */
  it.each([1, 0])('takes continue away with %i turns left, so the round closes itself', (left) => {
    expect(allowed({ turnsLeftOnQuestion: left })).toEqual(['next_question']);
  });

  // The two conditional actions are the server's own guards and are unaffected by the budget:
  // a round at its floor may still be handed over on the last turn of its last question.
  it('still offers handover and end_interview on the last turn when they are permitted', () => {
    expect(allowed({ turnsLeftOnQuestion: 1, mayHandOver: true, mayEnd: true })).toEqual([
      'next_question',
      'handover',
      'end_interview',
    ]);
  });
});
