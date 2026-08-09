import { PROMPT_NAMES, loadPromptRegistry } from '@interviewly/ai';

import { prisma } from '../../src/lib/db';

/**
 * The report's row, opened when its job is enqueued (issue #123).
 *
 * `reports.status` was a four-value enum that only ever held `ready`: the row was created at
 * the very end of a successful run and the failure path wrote none at all, so an in-flight
 * report and a lost one were indistinguishable in the database. That is exactly why the stuck
 * `evaluating` interviews of issues 025/026 could only be found by querying Postgres and Redis
 * by hand — a row from enqueue onward makes "where did the report go" one query.
 *
 * Its own module, small on purpose: `sse.ts` owns the enqueue and `report-run.ts` owns the run,
 * and `report-run` already imports `machine.ts`, which imports `sse.ts`. Putting this in either
 * of them closes a cycle. This is a leaf both can import.
 *
 * `promptIdentity` is memoised the same way and for the same reason `report-run.ts` memoised
 * it: the registry resolution is filesystem work that does not change between calls.
 */
let promptIdentity: { uuid: string; version: number } | undefined;

export function reportPrompt(): { uuid: string; version: number } {
  return (promptIdentity ??= loadPromptRegistry().resolve(PROMPT_NAMES.generateReport));
}

/**
 * Idempotent, like the `jobId = interviewId` enqueue it accompanies: a requeue finds the row
 * and re-opens it, unless it is already `ready` — a finished report is a deliverable, not
 * something a retry may walk back.
 *
 * The prompt identity is knowable now and is the one this run *will* use, so it is written now
 * rather than left to a nullable column that would need a second story about when it is filled.
 */
export async function openReportRow(interviewId: string): Promise<void> {
  const { uuid, version } = reportPrompt();

  await prisma.report.upsert({
    where: { interview_id: interviewId },
    create: {
      interview_id: interviewId,
      status: 'queued',
      prompt_uuid: uuid,
      prompt_version: version,
    },
    // Left alone whatever its state, so `ready` survives; the reopen below is the narrower
    // statement, and says out loud which states a retry may walk back.
    update: {},
  });

  await prisma.report.updateMany({
    where: { interview_id: interviewId, status: { in: ['generating', 'failed'] } },
    data: { status: 'queued' },
  });
}
