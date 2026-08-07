/**
 * `upload.feature` @AC-73 — the `uploadId` a `POST /interviews` body may reference (issue #73).
 *
 * These run against the real Postgres because the two things under test cannot be reached
 * without it: the foreign-upload case needs a second registered user with a real `uploads`
 * row, and the pre-fix failure was a Prisma foreign-key violation surfacing as a 500 — a
 * mocked client produces neither. `no interview is created` (interview-setup.steps.ts) counts
 * rows rather than reading the response, so a rejected request is asserted to have written
 * nothing, not merely to have said so.
 *
 * The bucket is the only fake, installed by `uploads.steps.ts`'s `@upload` hook; every
 * validation, dedup and row-writing path is the production one.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Before, Given, Then, When } from '@cucumber/cucumber';

import { prisma } from '../../src/lib/db';
import { uniqueListingBytes } from '../fixtures/pdf';

import { AiWorld } from './world';

/** Upload ids the scenario has established, by the name its steps refer to them by. */
let uploadIds: Record<string, string> = {};
/** Responses kept for the "indistinguishable" comparison. */
let responses: Record<string, { status: number; body: unknown }> = {};

Before({ tags: '@upload-ownership' }, function () {
  uploadIds = { nonexistent: `upl_${randomUUID()}` };
  responses = {};
});

/** Registers a candidate and uploads one file as them, leaving the caller's session restored. */
async function uploadAs(
  world: AiWorld,
  kind: 'listing' | 'cv',
  asSelf: boolean,
): Promise<{ uploadId: string; ownerId: string }> {
  const mine = { cookie: world.cookie, candidateId: world.candidateId };

  if (!asSelf) {
    world.cookie = '';
    const email = `other-candidate-${randomUUID()}@example.com`;
    await world.httpPost('/auth/register', {
      email,
      password: 'correct-horse-battery',
      consent: true,
    });
    assert.equal(world.lastStatus, 201, `register failed: ${JSON.stringify(world.lastBody)}`);
  }

  const ownerId = asSelf
    ? mine.candidateId
    : ((world.lastBody?.user as { id: string } | undefined)?.id ?? '');
  assert.ok(ownerId, `no ownerId in register response: ${JSON.stringify(world.lastBody)}`);
  await world.httpUpload(
    '/uploads',
    `${kind}-${randomUUID()}.pdf`,
    uniqueListingBytes(randomUUID()),
    kind,
  );
  assert.equal(world.lastStatus, 201, `upload failed: ${JSON.stringify(world.lastBody)}`);
  const uploadId = (world.lastBody?.uploadId as string | undefined) ?? '';
  assert.ok(uploadId, `no uploadId in ${JSON.stringify(world.lastBody)}`);

  // The bytes are nonced precisely so the global sha256 dedup cannot hand this call somebody
  // else's row. If it ever does, the scenario below would assert ownership against the wrong
  // owner and pass for the wrong reason — so it is checked here rather than assumed.
  const row = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  assert.equal(row.user_id, ownerId, 'the upload was deduped onto another user’s row');

  world.cookie = mine.cookie;
  world.candidateId = mine.candidateId;
  return { uploadId, ownerId };
}

Given('another candidate has uploaded a job listing', async function (this: AiWorld) {
  const { uploadId, ownerId } = await uploadAs(this, 'listing', false);
  assert.notEqual(ownerId, this.candidateId, 'the second candidate is the first one');
  uploadIds["other candidate's listing"] = uploadId;
});

Given('I have uploaded a job listing', async function (this: AiWorld) {
  uploadIds['own listing'] = (await uploadAs(this, 'listing', true)).uploadId;
});

Given('I have uploaded my CV', async function (this: AiWorld) {
  uploadIds['own CV'] = (await uploadAs(this, 'cv', true)).uploadId;
});

When(
  'I start an interview with the {string} uploadId',
  async function (this: AiWorld, which: string) {
    const uploadId = uploadIds[which];
    assert.ok(uploadId, `no uploadId named "${which}" in this scenario`);
    await this.httpPost('/interviews', {
      mode: 'text',
      jobText: 'Backend Developer — remote, full-time. We are hiring a backend developer.',
      uploadId,
      targetQuestionCount: 8,
    });
    responses[which] = { status: this.lastStatus, body: this.lastBody };
    if (this.lastStatus === 201) {
      this.interviewId = (this.lastBody?.interviewId as string | undefined) ?? '';
    }
  },
);

/**
 * The existence oracle: a 500 for an id that is absent and a 201 for one that exists told a
 * caller which upload ids are real. Both answers must now be the same answer.
 */
Then(
  'that response is identical to the {string} uploadId response',
  function (this: AiWorld, which: string) {
    const earlier = responses[which];
    assert.ok(earlier, `the "${which}" response was never recorded`);
    assert.deepEqual({ status: this.lastStatus, body: this.lastBody }, earlier);
  },
);

Then('the interview jobSource is {string}', async function (this: AiWorld, source: string) {
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  assert.equal(interview.job_source, source);
});

Then('the interview references my own upload', async function (this: AiWorld) {
  const interview = await prisma.interview.findUniqueOrThrow({ where: { id: this.interviewId } });
  assert.equal(interview.upload_id, uploadIds['own listing']);
  const upload = await prisma.upload.findUniqueOrThrow({
    where: { id: interview.upload_id ?? '' },
  });
  assert.equal(upload.user_id, this.candidateId);
  assert.equal(upload.kind, 'listing');
});
