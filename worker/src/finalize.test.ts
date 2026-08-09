/**
 * `@interviewly/backend` is mocked whole for the same reason `consumer.test.ts` does it: its
 * barrel builds a `PrismaClient` and a BullMQ `Queue` at import time. The real store is
 * exercised in `consumer.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportPayload } from '@interviewly/ai';
import { prisma, storage } from '@interviewly/backend';

import { logger } from './lib/logger';

import { finalizeReport } from './finalize';

vi.mock('@interviewly/backend', () => ({
  prisma: { report: { findFirst: vi.fn(), update: vi.fn() } },
  storage: { put: vi.fn(), get: vi.fn(), signedUrl: vi.fn() },
}));
vi.mock('./lib/logger', () => ({ logger: { info: vi.fn() } }));

const findFirst = vi.mocked(prisma.report.findFirst);
const update = vi.mocked(prisma.report.update);
const put = vi.mocked(storage.put);
const infoMock = vi.mocked(logger.info);

const payload: ReportPayload = {
  overall_impression: 'Solid backend fundamentals.',
  overall_score: 80,
  strengths: ['Clear STAR structure', 'Concrete examples'],
  improvements: ['Quantify impact', 'Name the trade-offs'],
  rounds: [{ type: 'hr', score: 80, summary: 'Motivated.' }],
  questions: [
    { question_id: 'q-1', score: 80, reason: 'Named the index.', star_adherence: 0.8 },
  ],
  language: 'en',
};

const reportRow = {
  id: 'rep-1',
  payload,
  created_at: new Date('2026-08-04T10:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(reportRow as never);
});

describe('finalizeReport', () => {
  it('stores the rendered PDF under a private key and writes it to reports.pdf_key', async () => {
    await finalizeReport('int-1');

    expect(put).toHaveBeenCalledOnce();
    const [key, bytes, mime] = put.mock.calls[0];
    expect(key).toBe('reports/int-1.pdf');
    expect(mime).toBe('application/pdf');
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    expect(update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'rep-1' },
      data: { pdf_key: 'reports/int-1.pdf' },
    });
  });

  it('keys the object outside the public /assets route (K12)', async () => {
    await finalizeReport('int-1');

    expect(put.mock.calls[0][0].startsWith('assets/')).toBe(false);
    expect(put.mock.calls[0][0]).not.toContain('/assets/');
  });

  it('stores the object before the row points at it', async () => {
    const order: string[] = [];
    put.mockImplementationOnce(async () => void order.push('put'));
    update.mockImplementationOnce((async () => void order.push('update')) as never);

    await finalizeReport('int-1');

    // The other way round leaves `pdf_key` naming an object that does not exist, which I12's
    // download endpoint hands out as a signed URL to nothing.
    expect(order).toEqual(['put', 'update']);
  });

  it('logs the key and the size, never the payload or the bytes (K6)', async () => {
    await finalizeReport('int-1');

    expect(infoMock).toHaveBeenCalledOnce();
    const [fields, event] = infoMock.mock.calls[0];
    expect(event).toBe('REPORT_PDF_RENDERED');
    expect(Object.keys(fields as object).sort()).toEqual(['bytes', 'interviewId', 'pdfKey']);
    expect(JSON.stringify(fields)).not.toContain('overall_impression');
  });

  it('is a no-op when runReport took the failed branch and stored no report row', async () => {
    findFirst.mockResolvedValue(null);

    await expect(finalizeReport('int-1')).resolves.toBeUndefined();

    expect(put).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(infoMock).not.toHaveBeenCalled();
  });

  it('is a no-op when the report row carries no payload', async () => {
    findFirst.mockResolvedValue({ ...reportRow, payload: null } as never);

    await finalizeReport('int-1');

    expect(put).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('re-runs to the same key and the same pdf_key, never a second object', async () => {
    await finalizeReport('int-1');
    await finalizeReport('int-1');

    expect(put.mock.calls.map(([key]) => key)).toEqual([
      'reports/int-1.pdf',
      'reports/int-1.pdf',
    ]);
    expect(update.mock.calls.map(([arg]) => arg.data.pdf_key)).toEqual([
      'reports/int-1.pdf',
      'reports/int-1.pdf',
    ]);
  });
});
