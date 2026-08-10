/**
 * R02's renderer is the one piece of this task with no I/O at all, so it is covered here
 * rather than in the integration ring: a `ReportPayload` in, PDF bytes out.
 */
import { describe, expect, it } from 'vitest';

import type { ReportPayload } from '@interviewly/ai';

import { renderReportPdf } from './render-pdf';

const payload: ReportPayload = {
  overall_impression: 'Solid backend fundamentals, thin on system design.',
  overall_score: 80,
  strengths: ['Clear STAR structure', 'Concrete Postgres examples'],
  improvements: ['Quantify impact', 'Name the trade-offs rejected'],
  rounds: [
    { type: 'hr', score: 80, summary: 'Motivated, specific about the team fit.' },
    { type: 'tech', score: 60, summary: 'Correct answers, shallow depth.', note: 'Ran short on time.' },
  ],
  questions: [
    { question_id: 'q-1', score: 80, reason: 'Named the index and why it helped.', star_adherence: 0.8 },
    { question_id: 'q-2', score: 60, reason: 'Result stated, action implied.', star_adherence: 0.5 },
  ],
  language: 'en',
};

const meta = { interviewId: 'int-1', createdAt: new Date('2026-08-04T10:00:00Z') };

describe('renderReportPdf', () => {
  it('renders the payload to PDF bytes', async () => {
    const pdf = await renderReportPdf(payload, meta);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('is deterministic for the same payload and meta', async () => {
    const [a, b] = await Promise.all([
      renderReportPdf(payload, meta),
      renderReportPdf(payload, meta),
    ]);

    // Bytewise, not just length: `pdfkit` stamps `CreationDate` from wall time unless it is
    // given one, which would make two renders of one report differ.
    expect(a.equals(b)).toBe(true);
  });

  it('renders a payload whose rounds carry no note', async () => {
    const pdf = await renderReportPdf(
      { ...payload, rounds: [{ type: 'hr', score: 95, summary: 'Strong.' }] },
      meta,
    );

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
