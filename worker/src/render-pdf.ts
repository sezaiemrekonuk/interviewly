/**
 * R02 (ADR-R03): `pdfkit` renders the report artifact. Pure — no database, no object store, no
 * wall clock. Everything variable is an argument, so two renders of one report are byte-equal
 * and a retry cannot produce a different object under the same key.
 */
import PDFDocument from 'pdfkit';

import type { ReportPayload } from '@interviewly/ai';

export interface ReportPdfMeta {
  interviewId: string;
  /** `reports.created_at`. Passed in rather than read, so the render stays deterministic. */
  createdAt: Date;
}

const H1 = 18;
const H2 = 13;
const BODY = 10;

export async function renderReportPdf(
  payload: ReportPayload,
  meta: ReportPdfMeta,
): Promise<Buffer> {
  const doc = new PDFDocument({
    margin: 50,
    info: {
      Title: `Interview report ${meta.interviewId}`,
      Author: 'Interviewly',
      CreationDate: meta.createdAt,
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const closed = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  const heading = (text: string, size = H2): void => {
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(size).text(text);
    doc.moveDown(0.3).font('Helvetica').fontSize(BODY);
  };
  const bullets = (items: string[]): void => {
    doc.list(items, { bulletRadius: 1.5, textIndent: 10 });
  };

  doc.font('Helvetica-Bold').fontSize(H1).text('Interview report');
  doc
    .font('Helvetica')
    .fontSize(BODY)
    .text(`Interview ${meta.interviewId}`)
    .text(`Generated ${meta.createdAt.toISOString()}`)
    .text(`Language ${payload.language}`);

  heading(`Overall — ${payload.overall_score}/5`);
  doc.text(payload.overall_impression);

  heading('Strengths');
  bullets(payload.strengths);

  heading('Improvements');
  bullets(payload.improvements);

  heading('Rounds');
  for (const round of payload.rounds) {
    doc.font('Helvetica-Bold').text(`${round.type} — ${round.score}/5`);
    doc.font('Helvetica').text(round.summary);
    if (round.note) doc.text(round.note);
    doc.moveDown(0.4);
  }

  heading('Questions');
  for (const question of payload.questions) {
    doc
      .font('Helvetica-Bold')
      .text(`${question.question_id} — ${question.score}/5 · STAR ${question.star_adherence}`);
    doc.font('Helvetica').text(question.reason);
    doc.moveDown(0.4);
  }

  doc.end();
  await closed;
  return Buffer.concat(chunks);
}
