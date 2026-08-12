/**
 * `GET /admin/queue` — the console's "Queue" section (issue 095: no queue-depth or
 * dead-letter observability).
 *
 * One queue, `report`, because it is the only real one: question generation and scoring run
 * inline on the request, and the mail producer is wrapped behind an interface the acceptance
 * ring swaps out (`auth/mail-queue.ts`), so there is no BullMQ handle for it to read. Listing
 * a second queue that cannot be counted would be worse than listing one that can.
 *
 * The `failed` set is the dead letter. `REPORT_JOB_OPTIONS.removeOnFail` keeps it for seven
 * days on purpose — with `LOG_TRANSPORT=stdout` it is the only durable trace of an interview
 * that never produced a report, and this endpoint is what finally surfaces it.
 */
import type { RequestHandler } from 'express';

import { recordAudit } from '../../src/lib/audit';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { REPORT_QUEUE, reportQueue } from '../../src/lib/queue';

/** Enough to see what is stuck without paging a set that is usually empty. */
const DEAD_LETTER_SAMPLE = 20;

export const getQueueStatus: RequestHandler = async (req, res, next) => {
  try {
    const [counts, failed] = await Promise.all([
      reportQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
      reportQueue.getFailed(0, DEAD_LETTER_SAMPLE - 1),
    ]);

    await recordAudit(prisma, {
      actorUserId: req.user!.id,
      action: 'admin.queue_read',
      subjectType: 'queue',
      subjectId: REPORT_QUEUE,
      traceId: req.traceId,
    });

    logger.info({ traceId: req.traceId, counts }, 'ADMIN_QUEUE_READ');

    res.status(200).json({
      queues: [
        {
          name: REPORT_QUEUE,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
        },
      ],
      // R01 sets `jobId = interviewId`, so the job id IS the interview to requeue — which is
      // what makes this list actionable rather than only alarming: every row here has a
      // matching `POST /admin/interviews/:id/report/requeue`.
      deadLetter: failed.map((job) => ({
        id: String(job.id),
        interviewId: String(job.id),
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason ?? null,
        failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      })),
    });
  } catch (err) {
    next(err);
  }
};
