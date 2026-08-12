import { MAX_BLOCK_CHARS } from '@interviewly/ai';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  user_id: string;
  external_job_id: string;
  job_title: string;
  job_company: string;
  job_text: string;
}

let rows: Row[] = [];

const upsert = vi.fn(
  async ({
    where,
    create,
    update,
  }: {
    where: { user_id_external_job_id: { user_id: string; external_job_id: string } };
    create: Row;
    update: Partial<Row>;
  }) => {
    const key = where.user_id_external_job_id;
    const existing = rows.find(
      (r) => r.user_id === key.user_id && r.external_job_id === key.external_job_id,
    );
    if (existing) Object.assign(existing, update);
    else rows.push({ ...create });
    return { id: 'jbl_1' };
  },
);

vi.mock('../../src/lib/db', () => ({
  prisma: { jobListing: { upsert: (args: unknown) => upsert(args as never) } },
}));

const info = vi.fn();
vi.mock('../../src/lib/logger', () => ({ logger: { info: (...a: unknown[]) => info(...a) } }));

const { captureJobListing } = await import('./job-listing');

const BODY = {
  externalJobId: '4242',
  jobTitle: 'Backend Engineer',
  jobCompany: 'Acme',
  jobText: 'Backend engineer\n\nGo, Postgres',
};

function land(body: unknown, userId = 'usr_1') {
  const end = vi.fn();
  const status = vi.fn(() => ({ end }));
  const res = { status } as unknown as Response;
  const req = { body, user: { id: userId }, traceId: 'trace-1' } as unknown as Request;
  const handler = captureJobListing as unknown as (
    req: Request,
    res: Response,
    next: () => void,
  ) => Promise<void>;

  return { status, end, run: () => handler(req, res, vi.fn()) };
}

beforeEach(() => {
  rows = [];
  upsert.mockClear();
  info.mockClear();
});

describe('captureJobListing', () => {
  it('writes the landing and answers with no content', async () => {
    const { status, end, run } = land(BODY);

    await run();

    expect(rows).toEqual([
      {
        user_id: 'usr_1',
        external_job_id: '4242',
        job_title: 'Backend Engineer',
        job_company: 'Acme',
        job_text: 'Backend engineer\n\nGo, Postgres',
      },
    ]);
    expect(status).toHaveBeenCalledWith(204);
    expect(end).toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'usr_1', externalJobId: '4242', traceId: 'trace-1' }),
      'JOB_LISTING_CAPTURED',
    );
  });

  it('updates the one row a repeat landing on the same job already has', async () => {
    await land(BODY).run();
    await land({ ...BODY, jobTitle: 'Staff Engineer', jobText: 'Rewritten listing' }).run();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ job_title: 'Staff Engineer', job_text: 'Rewritten listing' });
  });

  it('keeps one row per user for the same job', async () => {
    await land(BODY).run();
    await land(BODY, 'usr_2').run();

    expect(rows).toHaveLength(2);
  });

  it.each(['externalJobId', 'jobTitle', 'jobCompany', 'jobText'])(
    'refuses a body with %s missing',
    async (field) => {
      const body: Record<string, unknown> = { ...BODY };
      delete body[field];

      await expect(land(body).run()).rejects.toThrow('VALIDATION_ERROR');
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it.each(['externalJobId', 'jobTitle', 'jobCompany', 'jobText'])(
    'refuses a body whose %s is blank',
    async (field) => {
      await expect(land({ ...BODY, [field]: '   ' }).run()).rejects.toThrow('VALIDATION_ERROR');
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it('refuses a body that is not an object at all', async () => {
    await expect(land(undefined).run()).rejects.toThrow('VALIDATION_ERROR');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('caps the stored text at the block ceiling and says so', async () => {
    const long = 'x'.repeat(MAX_BLOCK_CHARS + 500);

    await land({ ...BODY, jobText: long }).run();

    expect(rows[0].job_text).toHaveLength(MAX_BLOCK_CHARS);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ chars: long.length, kept: MAX_BLOCK_CHARS }),
      'LISTING_TRUNCATED',
    );
  });

  it('does not report a truncation that did not happen', async () => {
    await land(BODY).run();

    expect(info).not.toHaveBeenCalledWith(expect.anything(), 'LISTING_TRUNCATED');
  });
});
