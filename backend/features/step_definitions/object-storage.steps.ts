/**
 * `object_storage.feature` @AC-6 — I12: the report download hands the owner a short-lived
 * signed URL and a non-owner a bare 404.
 *
 * `I am signed in as a candidate`, `another candidate is signed in`, `the fixed clock is
 * {string}`, `the response status is {int}` and `the response error code is {string}` are
 * defined elsewhere in this ring and reused — cucumber is `strict`, redefining any of them is
 * an ambiguous-step failure.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Before, Given, Then, When } from '@cucumber/cucumber';

import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';
import { setStorage } from '../../src/lib/storage';
import { makeFakeStorage, parseSignedExpiry, type FakeStorage } from '../fixtures/fake-storage';

import { AiWorld } from './world';

let store: FakeStorage;
let signedUrl = '';
let objectFetchStatus = 0;

Before({ tags: '@object-storage' }, function () {
  store = makeFakeStorage();
  signedUrl = '';
  objectFetchStatus = 0;
  setStorage(store);
});

Given('I own an interview with a generated report PDF', async function (this: AiWorld) {
  this.actors.owner = this.cookie;

  const cluster = await prisma.occupationCluster.upsert({
    where: { key: 'software' },
    update: {},
    create: { key: 'software', label: 'Software' },
  });

  const interview = await prisma.interview.create({
    data: {
      user_id: this.candidateId,
      mode: 'text',
      job_text: 'We are hiring a backend engineer.',
      job_source: 'paste',
      occupation: 'Backend Engineer',
      occupation_cluster_id: cluster.id,
      language: 'en',
      target_question_count: 8,
      hr_question_count: 3,
      state: 'completed',
    },
  });
  this.interviewId = interview.id;

  // The report ledger renders the PDF and writes `pdf_key`; I12 only signs whatever that
  // column holds, so the fixture seeds both the row and the object.
  const key = `reports/${interview.id}.pdf`;
  await store.put(key, Buffer.from('%PDF-1.4 acceptance report'), 'application/pdf');
  await prisma.report.create({
    data: {
      interview_id: interview.id,
      status: 'ready',
      pdf_key: key,
      prompt_uuid: randomUUID(),
      prompt_version: 1,
    },
  });
});

async function requestDownload(world: AiWorld): Promise<void> {
  await world.httpGet(`/interviews/${world.interviewId}/report/download`);
  signedUrl = (world.lastBody?.url as string | undefined) ?? '';
}

When('I request the report download for that interview', async function (this: AiWorld) {
  this.cookie = this.actors.owner;
  await requestDownload(this);
});

When(
  'the other candidate requests the report download for that interview',
  async function (this: AiWorld) {
    this.cookie = this.actors.other;
    await requestDownload(this);
  },
);

Then('the response contains a signed URL for the private object', function (this: AiWorld) {
  assert.ok(signedUrl.startsWith('http'), `body: ${JSON.stringify(this.lastBody)}`);
  assert.ok(
    new URL(signedUrl).searchParams.has('X-Amz-Signature'),
    `not a signed URL: ${signedUrl}`,
  );
});

Then(
  'the signed URL carries an expiry no more than {int} seconds ahead of the fixed clock',
  function (max: number) {
    const { signedAt, expiresIn } = parseSignedExpiry(signedUrl);
    const aheadSeconds = (signedAt.getTime() - clock.now().getTime()) / 1000 + expiresIn;
    assert.ok(
      aheadSeconds > 0 && aheadSeconds <= max,
      `expiry is ${aheadSeconds}s ahead of the fixed clock, cap is ${max}s`,
    );
  },
);

Then(
  'the signed URL target is not under the public {string} route',
  function (publicPrefix: string) {
    assert.ok(
      !new URL(signedUrl).pathname.startsWith(publicPrefix),
      `signed URL is under the public route: ${signedUrl}`,
    );
  },
);

Then('no signed URL is returned to the other candidate', function (this: AiWorld) {
  assert.equal(this.lastBody?.url, undefined, `body: ${JSON.stringify(this.lastBody)}`);
  assert.equal(signedUrl, '');
});

When('I fetch the returned signed URL before its TTL expires', function () {
  objectFetchStatus = store.fetchSigned(signedUrl).status;
});

When('the fixed clock moves past the signed URL TTL', function () {
  const { signedAt, expiresIn } = parseSignedExpiry(signedUrl);
  const past = new Date(signedAt.getTime() + (expiresIn + 1) * 1000);
  clock.now = () => past;
});

When('I fetch the same signed URL again', function () {
  objectFetchStatus = store.fetchSigned(signedUrl).status;
});

Then('the object fetch status is {int}', function (expected: number) {
  assert.equal(objectFetchStatus, expected);
});
