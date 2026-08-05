/**
 * R02: the artifact half of a finished report. `runReport` (I09) has already gated the payload,
 * written the `reports` row and denormalised `report_questions` inside its own transaction —
 * this file renders that persisted payload and stores the object, nothing else (ADR-R06).
 *
 * Safe to run twice: the key is derived from `interviewId`, so a retry overwrites one object
 * and rewrites one column.
 */
import type { ReportPayload } from '@interviewly/ai';
import { prisma, storage } from '@interviewly/backend';

import { logger } from './lib/logger';

import { renderReportPdf } from './render-pdf';

const PDF_MIME = 'application/pdf';

/** Private prefix — never `config.S3_PUBLIC_PREFIX`. Only I12's signed URL hands this out (K12). */
export const pdfKeyFor = (interviewId: string): string => `reports/${interviewId}.pdf`;

export async function finalizeReport(interviewId: string): Promise<void> {
  const report = await prisma.report.findFirst({
    where: { interview_id: interviewId },
    orderBy: { created_at: 'desc' },
  });
  // The schema-gate branch transitions the interview `failed` and stores no row at all, so
  // "nothing to render" is the normal outcome there, not an error.
  if (!report?.payload) return;

  // Not re-validated: I09 stored it through `ReportPayloadSchema`, and re-gating here would put
  // a second copy of that decision on the retry path.
  const pdf = await renderReportPdf(report.payload as unknown as ReportPayload, {
    interviewId,
    createdAt: report.created_at,
  });

  const pdfKey = pdfKeyFor(interviewId);
  await storage.put(pdfKey, pdf, PDF_MIME);
  await prisma.report.update({ where: { id: report.id }, data: { pdf_key: pdfKey } });

  logger.info({ interviewId, pdfKey, bytes: pdf.length }, 'REPORT_PDF_RENDERED');
}
