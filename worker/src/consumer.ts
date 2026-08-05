/**
 * The `report` queue processor (R01, ADR-R02). `runReport` (I09) owns the schema gate, the
 * `reports` row (created already `ready`, never a placeholder `queued`/`generating` row — see
 * the deviation note in the task's `## Notes`) and the `evaluating -> completed | failed`
 * transition. This file owns the job-lifecycle logging around that call plus R02's artifact
 * step (`finalizeReport`), which renders the stored payload to a PDF and writes `pdf_key`.
 *
 * A throw here fails the BullMQ job; R03 adds retry/dead-letter handling on top of that.
 */
import type { Job } from 'bullmq';
import { runReport } from '@interviewly/backend';

import { logger } from './lib/logger';

import { finalizeReport } from './finalize';

export interface ReportJobData {
  interviewId: string;
}

export async function processReportJob(job: Job<ReportJobData>): Promise<void> {
  const { interviewId } = job.data;
  const traceId = `worker-${job.id}`;

  logger.info({ interviewId, jobId: job.id }, 'REPORT_JOB_STARTED');
  await runReport(interviewId, { traceId });
  await finalizeReport(interviewId);
  logger.info({ interviewId, jobId: job.id }, 'REPORT_JOB_COMPLETED');
}
