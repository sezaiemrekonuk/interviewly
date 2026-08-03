import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';

import { applyTransition } from './machine';

const schema = z.object({
  mode: z.enum(['voice', 'text']),
  jobText: z.string().trim().min(1).optional(),
  uploadId: z.string().min(1).optional(),
  targetQuestionCount: z.coerce.number().int().min(1),
});

// Keyword → seeded occupation_clusters.key (prisma/seed.ts OCCUPATION_CLUSTERS). First
// matching keyword wins; unmatched listing leaves occupation_cluster_id null (valid).
// ponytail: flat keyword list, no scoring/ranking — promote if misclassification shows up.
const OCCUPATION_KEYWORDS: Array<[key: string, words: string[]]> = [
  ['software_engineering', ['engineer', 'developer', 'programmer', 'devops', 'sre']],
  ['product_management', ['product manager', 'product owner']],
  ['data_science', ['data scientist', 'data analyst', 'machine learning', 'analytics']],
  ['design', ['designer', 'ux', 'ui/', 'ui design']],
  ['marketing', ['marketing', 'growth', 'seo']],
  ['sales', ['sales', 'account executive', 'business development']],
  ['finance', ['finance', 'accountant', 'financial analyst', 'controller']],
  ['operations', ['operations', 'logistics', 'supply chain']],
  ['hr', ['human resources', 'recruiter', 'talent acquisition']],
];

function classify(jobText: string): { occupation: string; clusterKey: string | null } {
  const lower = jobText.toLowerCase();
  for (const [key, words] of OCCUPATION_KEYWORDS) {
    const hit = words.find((w) => lower.includes(w));
    if (hit) return { occupation: hit, clusterKey: key };
  }
  return { occupation: jobText.slice(0, 80), clusterKey: null };
}

// hrCount = max(2, round(target * 0.4)), techCount = target - hrCount (non-negotiable split).
function split(target: number): { hrCount: number; techCount: number } {
  const hrCount = Math.max(2, Math.round(target * 0.4));
  return { hrCount, techCount: target - hrCount };
}

export const setupInterview: RequestHandler = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
  const { mode, jobText, uploadId, targetQuestionCount } = parsed.data;

  if (!jobText && !uploadId) throw new ApiError('LISTING_REQUIRED');
  // ponytail: upload-derived text handoff (extracted text passed back from POST /uploads)
  // is I11's contract, not yet built. Until then an uploadId with no jobText has nothing to
  // store in the NOT NULL job_text column, so it is a malformed request today.
  if (!jobText) throw new ApiError('VALIDATION_ERROR');

  const { occupation, clusterKey } = classify(jobText);
  const cluster = clusterKey
    ? await prisma.occupationCluster.findUnique({ where: { key: clusterKey } })
    : null;
  const { hrCount, techCount } = split(targetQuestionCount);

  const interview = await prisma.interview.create({
    data: {
      user_id: req.user!.id,
      mode,
      job_text: jobText,
      job_source: uploadId ? 'upload' : 'paste',
      upload_id: uploadId ?? null,
      occupation,
      occupation_cluster_id: cluster?.id ?? null,
      language: req.user!.locale,
      target_question_count: targetQuestionCount,
      hr_question_count: hrCount,
      // Born `created`, moved by the guard in the same request. Inserting straight into
      // `profiling` would be one write fewer and the only state change in the system that
      // emits no `INTERVIEW_STATE_CHANGED` (@AC-16 lists this edge).
      state: 'created',
      current_index: 0,
    },
  });

  await applyTransition(interview, 'profiling', { traceId: req.traceId! });

  res.status(201).json({ interviewId: interview.id, hrCount, techCount });
};

export default setupInterview;
