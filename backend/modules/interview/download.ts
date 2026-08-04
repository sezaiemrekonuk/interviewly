import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { MAX_TTL_SECONDS, storage } from '../../src/lib/storage';

// GET /interviews/:id/report/download — ownership is already resolved by `router.param('id')`
// (I03/ownership.ts): a non-owner never reaches here, `resolveInterview` threw
// INTERVIEW_NOT_FOUND. No report row / no pdf_key means the report is not ready — the same
// 404 code, so "not ready" and "not yours" are indistinguishable from outside (ADR-I11).
// The signed URL is never logged: it grants object access on its own.
export const downloadReport: RequestHandler = async (req, res, next) => {
  try {
    const report = await prisma.report.findFirst({
      where: { interview_id: req.interview!.id, pdf_key: { not: null } },
      orderBy: { created_at: 'desc' },
    });
    if (!report?.pdf_key) throw new ApiError('INTERVIEW_NOT_FOUND');
    res.json({ url: await storage.signedUrl(report.pdf_key, MAX_TTL_SECONDS) });
  } catch (err) {
    next(err);
  }
};
