import { MAX_BLOCK_CHARS } from '@interviewly/ai';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

const MAX_LABEL_CHARS = 300;

const schema = z.object({
  externalJobId: z.string().trim().min(1).max(MAX_LABEL_CHARS),
  jobTitle: z.string().trim().min(1).max(MAX_LABEL_CHARS),
  jobCompany: z.string().trim().min(1).max(MAX_LABEL_CHARS),
  jobText: z.string().trim().min(1),
});

export const captureJobListing: RequestHandler = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
  const { externalJobId, jobTitle, jobCompany, jobText } = parsed.data;

  const userId = req.user!.id;
  const traceId = req.traceId;

  if (jobText.length > MAX_BLOCK_CHARS) {
    logger.info(
      { traceId, userId, externalJobId, chars: jobText.length, kept: MAX_BLOCK_CHARS },
      'LISTING_TRUNCATED',
    );
  }

  const listing = await prisma.jobListing.upsert({
    where: { user_id_external_job_id: { user_id: userId, external_job_id: externalJobId } },
    create: {
      user_id: userId,
      external_job_id: externalJobId,
      job_title: jobTitle,
      job_company: jobCompany,
      job_text: jobText.slice(0, MAX_BLOCK_CHARS),
    },
    update: {
      job_title: jobTitle,
      job_company: jobCompany,
      job_text: jobText.slice(0, MAX_BLOCK_CHARS),
    },
    select: { id: true },
  });

  logger.info({ traceId, userId, jobListingId: listing.id, externalJobId }, 'JOB_LISTING_CAPTURED');

  res.status(204).end();
};
