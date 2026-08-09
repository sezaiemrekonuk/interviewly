/**
 * Occupation title + cluster classification (issue #149). The `occupation` field is the
 * interview's label everywhere, so it must be a readable title in both languages — never a
 * bare keyword, never a mid-word slice — and a Turkish software listing must resolve to a
 * cluster, not fall through to null (which made the admin perOccupation chart blind to the
 * primary market).
 *
 * The second half covers the `uploadId` ownership check (issue #73), which no acceptance
 * scenario reaches: it needs two users and an upload id belonging to the other one. Asserted
 * over real HTTP because the properties under test are a status code and the absence of a
 * write — a thrown `ApiError` alone would not prove either.
 */
import type { User } from '@prisma/client';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const UPLOADS = [
  { id: 'upl_a_listing', user_id: 'usr_a', kind: 'listing' },
  { id: 'upl_b_listing', user_id: 'usr_b', kind: 'listing' },
  { id: 'upl_b_cv', user_id: 'usr_b', kind: 'cv' },
];

/** Every `interview.create` the handler reached — length 0 is "no row was written". */
const created: Array<Record<string, unknown>> = [];

/**
 * What the next `interview.create` rejects with, for the TOCTOU tests. The shape is the one
 * Prisma 6 actually produced against the real table for a dangling `upload_id` — probed, not
 * guessed — so a Prisma upgrade that renames `meta.constraint` fails here rather than in
 * production, where it would silently go back to being a 500.
 */
let createRejectsWith: unknown;

const updated: Array<Record<string, unknown>> = [];

let titleResult: () => Promise<{ title: string }>;

vi.mock('../ai', () => ({
  aiClient: () => ({ generateInterviewTitle: () => titleResult() }),
}));

vi.mock('../../src/lib/db', () => ({
  prisma: {
    upload: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        UPLOADS.find((u) => Object.entries(where).every(([k, v]) => u[k as keyof typeof u] === v)) ??
        null,
      ),
    },
    occupationCluster: { findUnique: vi.fn(async () => ({ id: 'ocl_1' })) },
    interview: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (createRejectsWith) throw createRejectsWith;
        created.push(data);
        return { id: 'itw_1', ...data };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updated.push(data);
        return { id: 'itw_1', ...data };
      }),
    },
  },
}));

vi.mock('./machine', () => ({ applyTransition: vi.fn(async () => 'profiling') }));

const { config } = await import('../../src/lib/env');
const { ApiError, httpStatusFor } = await import('../../src/lib/api-error');
const { classify, setupInterview } = await import('./setup');

describe('classify', () => {
  it('titles a Turkish listing from its first line and clusters it', () => {
    const { occupation, clusterKey } = classify(
      'Kıdemli Frontend Geliştirici (React) — Hibrit / İstanbul\n\nEkibimize katılacak, k',
    );
    expect(occupation).toBe('Kıdemli Frontend Geliştirici (React) — Hibrit / İstanbul');
    expect(clusterKey).toBe('software_engineering');
  });

  it('titles an English listing with the job title, not the matched keyword', () => {
    const { occupation, clusterKey } = classify('Senior Software Developer\nWe are hiring...');
    expect(occupation).toBe('Senior Software Developer');
    expect(clusterKey).toBe('software_engineering');
  });

  it('clusters a caps-lock Turkish listing despite Turkish-i casing', () => {
    // "YAZILIM".toLowerCase() is "yazilim" (dotted i) and "GELİŞTİRİCİ" folds through a
    // combining dot — neither matches the dotless-ı keyword without the fold (issue #149 §1).
    expect(classify('YAZILIM GELİŞTİRİCİ ARANIYOR').clusterKey).toBe('software_engineering');
    expect(classify('KIDEMLI YAZILIM MÜHENDİSİ').clusterKey).toBe('software_engineering');
  });

  it('does not fire "veri" on ordinary words that merely contain it', () => {
    // "verilen"/"verimli" must not drag a listing into data_science (issue #149 §4).
    const { clusterKey } = classify('Pazarlama uzmanı: müşterilere verilen sözleri takip eder');
    expect(clusterKey).toBe('marketing');
    expect(classify('Veri Bilimci aranıyor').clusterKey).toBe('data_science');
  });

  it('matches Turkish inflected suffixes via keyword stems', () => {
    // Turkish is suffixing: "Mühendisi"/"Geliştiricisi"/"Tasarımcısı" must match "mühendis*"
    // etc., which a whole-word keyword would miss (issue #149 stem support).
    expect(classify('Kıdemli Makine Mühendisi').clusterKey).toBe('software_engineering'); // §5 known limit, accepted
    expect(classify('Yazılım Geliştiricisi').clusterKey).toBe('software_engineering');
    expect(classify('KIDEMLİ YAZILIM MÜHENDİSİ').clusterKey).toBe('software_engineering');
    expect(classify('Ürün Tasarımcısı').clusterKey).toBe('design');
    expect(classify('Veri Mühendisi').clusterKey).toBe('data_science'); // ordering: data before software
    expect(
      classify('Verilen hedefler doğrultusunda çalışacak satış temsilcisi').clusterKey,
    ).toBe('sales');
  });

  it('does not let a stem over-match a longer unrelated word', () => {
    // The negatives that prove the `*` tolerance is safe: "salesforce" is not "sales*", and
    // "database" is not "data*" (issue #149 §4).
    expect(classify('Salesforce Developer').clusterKey).toBe('software_engineering');
    expect(classify('Database Administrator').clusterKey).not.toBe('data_science');
  });

  it('truncates a very long first line at a word boundary with an ellipsis', () => {
    const long =
      'Kıdemli Frontend ve Backend Yazılım Geliştirici Uzman Mühendis Aranıyor Hibrit İstanbul Ankara';
    const { occupation } = classify(long);
    expect(occupation.endsWith('…')).toBe(true);
    expect(occupation.length).toBeLessThanOrEqual(81); // 80 cap + ellipsis
    expect(occupation).not.toContain('\n');
    // cut at a space, so the last visible token is whole
    expect(occupation.slice(0, -1).endsWith(' ')).toBe(false);
    expect(long.startsWith(occupation.slice(0, -1))).toBe(true);
  });

  it('leaves an unmatched listing uncategorised but still titled', () => {
    const { occupation, clusterKey } = classify('Zamboni Technician\nIce rink maintenance.');
    expect(occupation).toBe('Zamboni Technician');
    expect(clusterKey).toBeNull();
  });

  it('still clusters when the first line is a company header, not a title', () => {
    // Known ceiling: the title is only as good as the first line (a company name here), but a
    // keyword anywhere in the body still resolves the cluster (issue #149 §3).
    const { occupation, clusterKey } = classify(
      'ACME Teknoloji A.Ş.\nKıdemli Backend Yazılım Geliştirici arıyoruz.',
    );
    expect(occupation).toBe('ACME Teknoloji A.Ş.');
    expect(clusterKey).toBe('software_engineering');
  });
});

describe('setupInterview uploadId ownership (issue #73)', () => {
  const app = express();
  app.use(express.json());
  // Stands in for `requireAuth`: the caller is whoever the header says, so one app serves both
  // seeded users. Everything else `setupInterview` reads off the request is filled in here too.
  app.use((req, _res, next) => {
    req.user = { id: req.header('x-test-user') ?? 'usr_a', locale: 'tr' } as User;
    req.traceId = 'trc_test';
    next();
  });
  app.post('/interviews', setupInterview);
  app.use(((err, _req, res, _next) => {
    const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
    res.status(err instanceof ApiError ? httpStatusFor(err.code) : 500).json({ error: { code } });
  }) satisfies express.ErrorRequestHandler);

  let baseUrl = '';
  let server: ReturnType<typeof app.listen>;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve(null))));
  });

  beforeEach(() => {
    created.length = 0;
    updated.length = 0;
    createRejectsWith = undefined;
    titleResult = async () => ({ title: 'Kıdemli Backend Geliştirici' });
  });

  async function setup(body: Record<string, unknown>, user = 'usr_a') {
    const res = await fetch(`${baseUrl}/interviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': user },
      body: JSON.stringify({ mode: 'text', jobText: 'Backend Developer', targetQuestionCount: 4, ...body }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, never> };
  }

  it('refuses a non-existent uploadId with 422, not the FK violation 500', async () => {
    const res = await setup({ uploadId: 'not-a-real-upload-id' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR' } });
    expect(created).toHaveLength(0);
  });

  it("refuses another user's uploadId and writes no interview row", async () => {
    const res = await setup({ uploadId: 'upl_b_listing' }, 'usr_a');
    expect(res.status).toBe(422);
    expect(created).toHaveLength(0);
  });

  it('answers identically for a foreign id and a missing one, so neither is an oracle', async () => {
    const foreign = await setup({ uploadId: 'upl_b_listing' }, 'usr_a');
    const missing = await setup({ uploadId: 'upl_does_not_exist' }, 'usr_a');
    // The TOCTOU branch is in this set too: it raises the same ApiError, so a race must not
    // be distinguishable from a foreign id either.
    createRejectsWith = {
      code: 'P2003',
      meta: { modelName: 'Interview', constraint: 'interviews_upload_id_fkey' },
    };
    const raced = await setup({ uploadId: 'upl_a_listing' }, 'usr_a');
    expect(foreign).toEqual(missing);
    expect(raced).toEqual(missing);
    expect(foreign.status).toBe(422);
  });

  it("refuses the caller's own CV — a CV is not a job listing", async () => {
    const res = await setup({ uploadId: 'upl_b_cv' }, 'usr_b');
    expect(res.status).toBe(422);
    expect(created).toHaveLength(0);
  });

  it("accepts the caller's own listing upload and records job_source 'upload'", async () => {
    const res = await setup({ uploadId: 'upl_a_listing' }, 'usr_a');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ interviewId: 'itw_1', hrCount: 2, techCount: 2 });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      user_id: 'usr_a',
      upload_id: 'upl_a_listing',
      job_source: 'upload',
    });
  });

  it('replaces the first-line heuristic title with the model-written one', async () => {
    const res = await setup({ jobText: 'ACME A.Ş.\nKıdemli Backend Yazılım Geliştirici' });
    expect(res.status).toBe(201);
    expect(created[0]).toMatchObject({ occupation: 'ACME A.Ş.' });
    expect(updated).toEqual([{ occupation: 'Kıdemli Backend Geliştirici' }]);
  });

  it('keeps the heuristic title and still answers 201 when the title call fails', async () => {
    titleResult = async () => {
      throw new Error('provider down');
    };
    const res = await setup({ jobText: 'Zamboni Technician\nIce rink maintenance.' });
    expect(res.status).toBe(201);
    expect(created[0]).toMatchObject({ occupation: 'Zamboni Technician' });
    expect(updated).toHaveLength(0);
  });

  it("still accepts a pasted listing with no uploadId as job_source 'paste'", async () => {
    const res = await setup({});
    expect(res.status).toBe(201);
    expect(created[0]).toMatchObject({ upload_id: null, job_source: 'paste' });
  });

  // Issue #117: `BUDGET_USD_TEXT` was declared, documented and set in `.env` while the real
  // ceiling was the column default, so editing it changed nothing. The row now carries the
  // configured value explicitly; the column default stays the floor for rows written outside
  // the API (seeds, fixtures).
  it('writes the configured text budget onto the interview', async () => {
    const res = await setup({});
    expect(res.status).toBe(201);
    expect(created[0]).toMatchObject({ budget_usd: config.BUDGET_USD_TEXT });
    expect(created[0].budget_usd).toBeTypeOf('number');
  });

  it('takes an explicit hrQuestionCount instead of the 40/60 split', async () => {
    const res = await setup({ targetQuestionCount: 12, hrQuestionCount: 3 });
    expect(res.status).toBe(201);
    // The split would have made this 5 + 7 — the caller's own shape wins.
    expect(res.body).toMatchObject({ hrCount: 3, techCount: 9 });
    expect(created[0]).toMatchObject({ target_question_count: 12, hr_question_count: 3 });
  });

  it('refuses an hrQuestionCount that leaves the technical round empty', async () => {
    for (const hrQuestionCount of [6, 7]) {
      const res = await setup({ targetQuestionCount: 6, hrQuestionCount });
      expect({ hrQuestionCount, status: res.status }).toEqual({ hrQuestionCount, status: 422 });
    }
    expect(created).toHaveLength(0);
  });

  // Issue #176. `split()` floors the HR half at 2, so a target below that made `techCount`
  // negative — stored on the row, and then handed to the generator as a batch size.
  it('refuses a target below the HR floor the split assumes', async () => {
    for (const targetQuestionCount of [1, 0, -1]) {
      const res = await setup({ targetQuestionCount });
      expect({ targetQuestionCount, status: res.status }).toEqual({
        targetQuestionCount,
        status: 422,
      });
    }
    expect(created).toHaveLength(0);
  });

  it('keeps target 2 legal — the shape machine.ts routes hr_round → evaluating for', async () => {
    const res = await setup({ targetQuestionCount: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ hrCount: 2, techCount: 0 });
  });

  it('never writes an hr_question_count above the target, for any accepted target', async () => {
    // The whole accepted domain, not a sample: the bug was one specific target at the edge of
    // it, and the constraint the migration adds has to hold for every row this handler writes.
    for (let targetQuestionCount = 2; targetQuestionCount <= 20; targetQuestionCount += 1) {
      created.length = 0;
      const res = await setup({ targetQuestionCount });
      expect({ targetQuestionCount, status: res.status }).toEqual({
        targetQuestionCount,
        status: 201,
      });
      const row = created[0] as { target_question_count: number; hr_question_count: number };
      expect({ targetQuestionCount, ...row }).toMatchObject({ target_question_count: targetQuestionCount });
      expect(row.hr_question_count).toBeGreaterThanOrEqual(0);
      expect(row.hr_question_count).toBeLessThanOrEqual(targetQuestionCount);
      expect(res.body.techCount as unknown as number).toBeGreaterThanOrEqual(0);
    }
  });

  it('answers 422 rather than 500 for every malformed body shape', async () => {
    // @AC "no request body can produce a 500 from setup.ts" — the ids are the new path, the
    // rest are the guards it was inserted between.
    for (const body of [
      { uploadId: 42 },
      { uploadId: '' },
      { jobText: undefined, uploadId: 'upl_a_listing' }, // uploadId with no text: #73 is not I11
      { targetQuestionCount: 999 },
      { hrQuestionCount: 0 },
      { hrQuestionCount: 999 },
      { mode: 'telepathy' },
    ]) {
      const res = await setup({ jobText: 'Backend Developer', ...body });
      expect({ body, status: res.status }).toEqual({ body, status: 422 });
    }
    expect(created).toHaveLength(0);
  });

  it('answers 422 when the upload is deleted between the check and the insert', async () => {
    // The residual TOCTOU: the ownership read passes, `delete-account.ts` removes the row, the
    // insert hits the foreign key. Without the catch this is the same 500 the fix set out to
    // remove, reachable by timing instead of by a bad id.
    createRejectsWith = {
      code: 'P2003',
      meta: { modelName: 'Interview', constraint: 'interviews_upload_id_fkey' },
    };
    const res = await setup({ uploadId: 'upl_a_listing' }, 'usr_a');
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('still fails loudly when a different foreign key is the one violated', async () => {
    // A missing user or cluster is not a malformed request body — turning every P2003 into a
    // 422 would hide a real bug behind a client error.
    createRejectsWith = {
      code: 'P2003',
      meta: { modelName: 'Interview', constraint: 'interviews_user_id_fkey' },
    };
    const res = await setup({ uploadId: 'upl_a_listing' }, 'usr_a');
    expect(res.status).toBe(500);
  });

  it('refuses a listing-less body with LISTING_REQUIRED before it looks anything up', async () => {
    const res = await setup({ jobText: undefined });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: { code: 'LISTING_REQUIRED' } });
  });
});
