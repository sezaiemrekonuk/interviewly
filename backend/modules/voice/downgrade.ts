/**
 * `voice → text` downgrade (V03, §3.2/§3.8, ADR-V03).
 *
 * `mode` is not a K2 state, so `applyTransition` is deliberately not involved — it writes
 * `interviews.state` and nothing else. The guarded `updateMany` is the whole mechanism: it is
 * both the one-directional rule and the idempotency, in one write.
 */
import { Router, type RequestHandler } from 'express';

import type { Interview } from '@prisma/client';

import { requireAuth } from '../auth/middleware';
import { requirePublicOrigin } from '../interview/csrf';
import { ApiError } from '../../src/lib/api-error';
import { activeInterview, prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

/**
 * Continues the same interview in text. Touches `mode` only — `current_index` and every
 * recorded answer are left exactly as they are, so earlier voice answers keep
 * `input_mode='voice'` and no question is re-opened.
 *
 * Returns whether this call is the one that downgraded, so a caller can tell a real downgrade
 * from a repeat signal without re-reading the row.
 */
export async function downgradeToText(
  interview: Interview,
  ctx: { traceId: string },
): Promise<boolean> {
  // `mode: 'voice'` in the WHERE is what makes this idempotent and one-directional: a second
  // fatal signal matches no row, so it neither rewrites the column nor emits a second event.
  const { count } = await prisma.interview.updateMany({
    where: { id: interview.id, mode: 'voice' },
    data: { mode: 'text' },
  });
  if (count === 0) return false;

  interview.mode = 'text';

  logger.info({ traceId: ctx.traceId, interviewId: interview.id }, 'VOICE_DOWNGRADED_TO_TEXT');
  return true;
}

// V05: client-side microphone denial path. Moved here from `session.ts`, which S05 deleted
// with the mint — this is the only voice route that survived ADR-S01.
const preJoinDowngrade: RequestHandler = async (req, res) => {
  const interview = await activeInterview(String(req.params.id));
  if (!interview) throw new ApiError('INTERVIEW_NOT_FOUND');
  if (interview.user_id !== req.user!.id) throw new ApiError('FORBIDDEN');

  await downgradeToText(interview, { traceId: req.traceId! });
  res.status(200).json({});
};

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.use(requirePublicOrigin);
router.post('/:id/voice/downgrade', preJoinDowngrade);

export default router;
