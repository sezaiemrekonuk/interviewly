import type { RequestHandler } from 'express';

import { recordAudit } from '../../src/lib/audit';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

// Soft delete (db spec §1): an UPDATE setting deleted_at, never a row removal. `spent_usd`
// and the llm_calls rows are untouched, which is what lets the admin audit read the cost
// back unchanged. Ownership was already settled by I03's `:id` resolver — a non-owner never
// reaches this handler, it got 404 INTERVIEW_NOT_FOUND.
export const deleteInterview: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.interview!;
    // Issue 86: one transaction, so the deletion and the record of who requested it cannot
    // disagree. Before this the only trace was the pino line below, on stdout, discarded the
    // next time the container was recreated — `deleted_at` knew the when and never the who.
    await prisma.$transaction(async (tx) => {
      await tx.interview.update({ where: { id }, data: { deleted_at: new Date() } });
      await recordAudit(tx, {
        actorUserId: req.user!.id,
        action: 'interview.soft_deleted',
        subjectType: 'interview',
        subjectId: id,
        traceId: req.traceId,
      });
    });
    logger.info(
      { traceId: req.traceId, interviewId: id, userId: req.user!.id },
      'INTERVIEW_SOFT_DELETED',
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
