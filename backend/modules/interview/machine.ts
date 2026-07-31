/**
 * The K2 transition guard, skeletal (I06). I07 fills the rest of the table — pause/resume and
 * the terminal states — by adding rows, not by changing this shape.
 *
 * Every state change goes through `applyTransition`, so `INTERVIEW_STATE_CHANGED` cannot be
 * emitted without the edge having been checked, and an unlisted edge is a 409 rather than a
 * silently written column.
 */
import type { Interview, InterviewState } from '@prisma/client';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

const TRANSITIONS: Partial<Record<InterviewState, InterviewState[]>> = {
  // `hr_round → evaluating` is not a shortcut: the split can leave a short interview with
  // zero technical questions (target 2 → hr 2, tech 0), and that interview still ends.
  hr_round: ['tech_round', 'evaluating'],
  tech_round: ['evaluating'],
};

export function canTransition(from: InterviewState, to: InterviewState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export async function applyTransition(
  interview: Interview,
  to: InterviewState,
  ctx: { traceId: string },
): Promise<InterviewState> {
  if (!canTransition(interview.state, to)) throw new ApiError('INVALID_STATE_TRANSITION');

  await prisma.interview.update({ where: { id: interview.id }, data: { state: to } });
  logger.info(
    { traceId: ctx.traceId, interviewId: interview.id, from: interview.state, to },
    'INTERVIEW_STATE_CHANGED',
  );
  return to;
}
