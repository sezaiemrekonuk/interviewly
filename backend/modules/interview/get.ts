import type { RequestHandler } from 'express';

import { prisma } from '../../src/lib/db';

/**
 * `GET /interviews/:id` (R01, AC-20 "I fetch GET /interviews/:id ... contains the ready
 * report"). Not owned by any dependency task — PLAN.md's topology names "interview-core" but
 * no interview-core task builds it, and I12 (which mounts the adjacent `/report/download`)
 * is not an R01 dependency — so this task adds the minimal read the acceptance scenario needs.
 *
 * `req.interview` is attached by `resolveInterview` (ownership.ts); a non-owned or deleted id
 * never reaches this handler (404 `INTERVIEW_NOT_FOUND`).
 */
export const getInterview: RequestHandler = async (req, res) => {
  const interview = req.interview!;
  // `status: 'ready'` (issue #123). A row now exists from the moment the job is enqueued, and
  // an in-flight one has no payload — so answering with it would tell the client a report had
  // arrived when none had. The report surface polls on this field's presence and renders on it,
  // so presence has to keep meaning "finished". Surfacing `queued`/`generating` to the room is
  // a UI change, not a serialisation one, and belongs with that work.
  const report = await prisma.report.findFirst({
    where: { interview_id: interview.id, status: 'ready' },
  });

  res.status(200).json({
    interviewId: interview.id,
    state: interview.state,
    report: report ? { status: report.status, payload: report.payload } : null,
  });
};

export default getInterview;
