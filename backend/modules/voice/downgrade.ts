/**
 * `voice → text` downgrade (V03, §3.2/§3.8, ADR-V03).
 *
 * `mode` is not a K2 state, so `applyTransition` is deliberately not involved — it writes
 * `interviews.state` and nothing else. The guarded `updateMany` is the whole mechanism: it is
 * both the one-directional rule and the idempotency, in one write.
 */
import type { Interview } from '@prisma/client';

import { prisma } from '../../src/lib/db';
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
