/**
 * `upload.feature` — @AC-14 (validation + the required `kind`) and @AC-3 (sha256 dedup), I11.
 *
 * `the response status is {int}` and `the response error code is {string}` are defined in
 * ai-provider.steps.ts / interview-setup.steps.ts and reused here — cucumber is `strict`, so
 * redefining either would be an ambiguous-step failure, not a duplicate.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Before, DataTable, Then, When } from '@cucumber/cucumber';

import { prisma } from '../../src/lib/db';
import { setStorage } from '../../src/lib/storage';
import { makeFakeStorage } from '../fixtures/fake-storage';
import { fixtureBytes } from '../fixtures/pdf';

import { AiWorld } from './world';

interface Attempt {
  fixture: string;
  expectedStatus: number;
  expectedCode: string;
  status: number;
  body: Record<string, unknown> | undefined;
}

let attempts: Attempt[] = [];
let firstUploadId = '';
let lastUploadId = '';

const sha256Of = (fixture: string) =>
  createHash('sha256').update(fixtureBytes(fixture)).digest('hex');

/**
 * The acceptance ring starts no bucket (server.ts), so the object write is the one thing
 * faked — validation, extraction, dedup and the `uploads` row are all the real code paths.
 * A rejected upload must never reach this, which `no bytes were stored` asserts.
 */
const storedKeys: string[] = [];

Before({ tags: '@upload' }, function () {
  attempts = [];
  firstUploadId = '';
  lastUploadId = '';
  storedKeys.length = 0;
  // I12 widened `Storage` with `get`/`signedUrl`; neither is on an upload path, so the fake
  // supplies them and `put` stays the recording one these scenarios assert on.
  setStorage({
    ...makeFakeStorage(),
    put: async (key: string) => {
      storedKeys.push(key);
    },
  });
});

async function upload(world: AiWorld, fixture: string, kind?: string): Promise<void> {
  await world.httpUpload('/uploads', fixture, fixtureBytes(fixture), kind);
  const id = world.lastBody?.uploadId as string | undefined;
  if (id) {
    lastUploadId = id;
    if (!firstUploadId) firstUploadId = id;
  }
}

When(
  'I upload each file to POST {string}',
  async function (this: AiWorld, path: string, table: DataTable) {
    assert.equal(path, '/uploads');
    for (const row of table.hashes()) {
      await upload(this, row.fixture, 'listing');
      attempts.push({
        fixture: row.fixture,
        expectedStatus: Number(row.expectedStatus),
        expectedCode: row.expectedCode,
        status: this.lastStatus,
        body: this.lastBody,
      });
    }
  },
);

Then('each upload is rejected with its expected status and error code', function () {
  assert.ok(attempts.length > 0, 'no uploads were attempted');
  for (const a of attempts) {
    assert.equal(a.status, a.expectedStatus, `${a.fixture}: body ${JSON.stringify(a.body)}`);
    const error = a.body?.error as { code?: string } | undefined;
    assert.equal(error?.code, a.expectedCode, `${a.fixture}: body ${JSON.stringify(a.body)}`);
  }
});

Then('no uploadId is returned for any rejected upload', async function (this: AiWorld) {
  for (const a of attempts) {
    assert.equal(a.body?.uploadId, undefined, `${a.fixture} returned an uploadId`);
  }
  // Nor a row, nor stored bytes: a rejection leaves nothing behind.
  const rows = await prisma.upload.count({ where: { user_id: this.candidateId } });
  assert.equal(rows, 0, 'a rejected upload created an uploads row');
  assert.deepEqual(storedKeys, [], 'a rejected upload stored bytes');
});

When(
  'I upload {string} to POST {string}',
  async function (this: AiWorld, fixture: string, _path: string) {
    await upload(this, fixture, 'listing');
  },
);

When(
  'I upload {string} to POST {string} with no kind',
  async function (this: AiWorld, fixture: string, _path: string) {
    await upload(this, fixture);
  },
);

When(
  'I upload {string} to POST {string} with kind {string}',
  async function (this: AiWorld, fixture: string, _path: string, kind: string) {
    await upload(this, fixture, kind);
  },
);

When(
  'I upload the byte-identical file {string} again to POST {string}',
  async function (this: AiWorld, fixture: string, _path: string) {
    await upload(this, fixture, 'listing');
  },
);

When(
  'I upload a different valid PDF {string} to POST {string}',
  async function (this: AiWorld, fixture: string, _path: string) {
    await upload(this, fixture, 'listing');
  },
);

Then('the response contains an uploadId', function (this: AiWorld) {
  assert.ok(
    typeof this.lastBody?.uploadId === 'string' && this.lastBody.uploadId.length > 0,
    `body: ${JSON.stringify(this.lastBody)}`,
  );
});

Then(
  'the response carries an upload id with kind {string}',
  async function (this: AiWorld, kind: string) {
    const id = this.lastBody?.uploadId as string | undefined;
    assert.ok(id, `body: ${JSON.stringify(this.lastBody)}`);
    const row = await prisma.upload.findUniqueOrThrow({ where: { id } });
    assert.equal(row.kind, kind);
  },
);

// The fixture's own sentence, not merely a non-empty string: an endpoint answering with the
// filename, the storage key or `''` would satisfy a length check and still leave the setup
// form with nothing to put in `job_text`.
Then("the response carries the listing's own extracted text", function (this: AiWorld) {
  const text = this.lastBody?.text;
  assert.equal(typeof text, 'string', `no text in body: ${JSON.stringify(this.lastBody)}`);
  assert.match(text as string, /PostgreSQL-backed services/);
});

Then('the response carries no text', function (this: AiWorld) {
  assert.ok(this.lastBody?.uploadId, `body: ${JSON.stringify(this.lastBody)}`);
  assert.equal(this.lastBody?.text, undefined, `a cv answered with its text`);
});

Then('the returned uploadId equals the first uploadId', function () {
  assert.equal(lastUploadId, firstUploadId);
});

Then('the returned uploadId differs from the first uploadId', function () {
  assert.notEqual(lastUploadId, firstUploadId);
});

// Both counts are scoped to the acting candidate: `uploads` is unique per (owner, bytes), so
// the claim under test is "this candidate has one row for these bytes". Unscoped, they also
// counted every earlier scenario's candidate, who uploaded the same fixture — an assertion
// that passed only while dedup was global and would drift with the scenario order regardless.
Then(
  'exactly one uploads record exists for that sha256',
  async function (this: AiWorld) {
    const count = await prisma.upload.count({
      where: { user_id: this.candidateId, sha256: sha256Of('valid-3-page-listing.pdf') },
    });
    assert.equal(count, 1);
  },
);

Then('a second uploads record exists for the new sha256', async function (this: AiWorld) {
  const row = await prisma.upload.findFirstOrThrow({
    where: { user_id: this.candidateId, sha256: sha256Of('another-valid-listing.pdf') },
  });
  assert.equal(row.id, lastUploadId);
  assert.notEqual(row.id, firstUploadId);
});
