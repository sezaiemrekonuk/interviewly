/**
 * `POST /admin/interviews/:id/report/requeue` — the way back for a lost report job (issue 081).
 *
 * A report job is enqueued on exactly one edge, `→ evaluating`, and before this endpoint that
 * edge could not be re-entered. An interview whose job was lost to a worker crash, a Redis
 * blip, a deploy at the wrong moment or an exhausted retry budget therefore had no path to its
 * report at all — the deliverable was unreachable with the interview complete and every answer
 * recorded.
 *
 * Three things make the requeue actually land, and the ORDER of them is load-bearing — see the
 * comments at each step:
 *
 *  1. **The state, not just the queue.** `runReport` uses `evaluating → completed` as its CAS,
 *     so an interview already parked in `completed`/`failed` would have its job run and throw
 *     before writing a row. K2 gained `completed → evaluating` and `failed → evaluating` for
 *     exactly this caller (`machine.ts`). Moving it first also serialises concurrent requeues.
 *  2. **`reportQueue.remove` before the enqueue.** `jobId = interviewId` is the idempotency key
 *     (`sse.ts`), and the queue retains completed and failed jobs (issue 031), so BullMQ
 *     refuses an `add` for an id it still remembers. A bare re-add is a silent no-op against a
 *     job sitting in `bull:report:failed`.
 *  3. **The enqueue immediately after it.** A `remove` that is not followed by an `add` is how
 *     this endpoint would *create* the condition it repairs.
 */
import type { Interview } from '@prisma/client';
import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { reportQueue } from '../../src/lib/queue';
import { applyTransition } from '../interview/machine';
import { enqueueReport } from '../interview/sse';

/**
 * The states a report can still be owed from. `evaluating` is the job that never ran;
 * `completed`/`failed` are the ones that ran and left nothing behind, which the report-row
 * check below then narrows. Anything earlier has no transcript to evaluate yet, and
 * `abandoned` never will.
 */
const REQUEUEABLE: ReadonlySet<Interview['state']> = new Set(['evaluating', 'completed', 'failed']);

export const requeueReport: RequestHandler = async (req, res, next) => {
  try {
    const interviewId = String(req.params.id);

    // ADMIN AUDIT bypasses `userInterviews` elsewhere in this module, but not here: `runReport`
    // itself filters on `deleted_at: null`, so requeueing a deleted interview would enqueue a
    // job that can only throw — and a candidate who deleted an interview must not have a report
    // generated for it afterwards. 404, matching the interview router's resolver.
    const interview = await prisma.interview.findFirst({
      where: { id: interviewId, deleted_at: null },
    });
    if (!interview) throw new ApiError('INTERVIEW_NOT_FOUND');

    // Read now, reported below: `applyTransition` writes the new state back onto its argument
    // (the stale-copy note in `machine.ts`), so `interview.state` no longer says where the
    // requeue came from once it has run.
    const from = interview.state;
    if (!REQUEUEABLE.has(from)) throw new ApiError('INVALID_STATE_TRANSITION');

    // Not the integrity guard — `runReport`'s `evaluating → completed` CAS is, and no two jobs
    // can both win it. This refuses the *work*: re-running the model over a transcript that
    // already has a report costs money and would overwrite a finished deliverable.
    const existing = await prisma.report.findFirst({
      where: { interview_id: interviewId },
      select: { id: true },
    });
    if (existing) throw new ApiError('REPORT_ALREADY_EXISTS');

    // Read the job's state rather than inferring it from `remove`'s return code. Measured on
    // bullmq 6.0.2: `remove` answers 1 for a job that never existed, one retained in
    // `bull:report:failed`, AND one whose hash was deleted out from under the queue
    // (`redis-cli del bull:report:<id>`, the issue's own repro) — it answers 0 only for a
    // locked job. Reading `active` directly says what is meant and does not quietly change
    // meaning if that mapping ever does.
    const inflight = await reportQueue.getJob(interviewId);
    if (inflight && (await inflight.getState()) === 'active') {
      throw new ApiError('REPORT_JOB_RUNNING');
    }

    // The state moves FIRST, and the order is load-bearing in both directions.
    //
    // `applyTransition` is a CAS on the state column, which is what serialises two concurrent
    // requeues: the second one finds the terminal state gone and is refused here, before it can
    // reach the queue. With the queue touched first instead, that second request would remove
    // the job the first had just enqueued and then fail — leaving `evaluating` with no job at
    // all, which is the exact condition this endpoint exists to repair.
    //
    // `evaluating → evaluating` is not an edge and never will be, so an interview already there
    // skips the transition and is serialised by the `remove`/`add` pair below instead.
    if (from !== 'evaluating') {
      await applyTransition(interview, 'evaluating', { traceId: req.traceId! });
    }

    // Then the queue, as an inseparable pair, and never a `remove` without the `add` after it.
    // `jobId = interviewId` means BullMQ refuses an `add` for an id it still remembers, and the
    // queue retains completed and failed jobs forever (issue 031) — so a bare re-add is a
    // silent no-op, including the one `applyTransition` just fired on its way into
    // `evaluating`. The retained job has to be cleared before the real enqueue lands.
    await reportQueue.remove(interviewId);
    await enqueueReport(interviewId, { traceId: req.traceId! });

    // `warn`, not `info`: every one of these is an operator reaching in to repair something the
    // system could not finish on its own, and there is no `audit_logs` table for it to land in.
    logger.warn(
      { traceId: req.traceId, interviewId, adminId: req.user!.id, from },
      'REPORT_JOB_REQUEUED',
    );

    res.status(202).json({ interviewId, state: 'evaluating', requeuedFrom: from });
  } catch (err) {
    next(err);
  }
};

export default requeueReport;
