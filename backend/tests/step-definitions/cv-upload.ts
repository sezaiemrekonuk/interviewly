/**
 * `onboarding_profile.feature` — @AC-32, the CV half of A06 (issue 62).
 *
 * These scenarios were deferred while `POST /uploads` did not exist; it does now, so they run
 * against the real endpoint. Only the bucket is faked (the acceptance ring starts none, same
 * as the interview ring's `upload.steps.ts`) — validation, extraction, truncation and both
 * writes to `users` are the shipping code paths.
 *
 * `the response status is {int}` lives in auth.ts and is reused: cucumber is `strict`, so
 * redefining it here would be an ambiguous-step failure rather than a duplicate.
 */
import { strict as assert } from 'node:assert';

import { MAX_BLOCK_CHARS } from '@interviewly/ai';
import { Before, Then, When } from '@cucumber/cucumber';

import { makeFakeStorage, type FakeStorage } from '../../features/fixtures/fake-storage';
import { fixtureBytes } from '../../features/fixtures/pdf';
import { prisma } from '../../src/lib/db';
import { setStorage } from '../../src/lib/storage';
import { capturedLines } from '../support/log-sink';
import type { AuthWorld } from '../support/world';

let store: FakeStorage;

/**
 * Held here rather than read back off `world.lastBody`: every "the profile …" step below
 * fetches `/me/profile`, which replaces the body the upload answered with, so by the time
 * the storage assertions run the id is three responses stale.
 */
let lastUploadId = '';

Before({ tags: '@AC-32' }, function () {
  store = makeFakeStorage();
  setStorage(store);
  lastUploadId = '';
});

function uploadedId(): string {
  assert.ok(lastUploadId, 'no upload has answered with an id in this scenario');
  return lastUploadId;
}

async function currentUser(world: AuthWorld) {
  await world.request('GET', '/me/profile', { useSession: true });
  return world.body<{ profile: Record<string, unknown>; cvUploadId: string | null }>();
}

async function upload(world: AuthWorld, kind: string, fixture: string): Promise<void> {
  await world.uploadFile(kind, fixture, fixtureBytes(fixture));
  lastUploadId = world.body<{ uploadId?: string }>()?.uploadId ?? '';
}

// -------------------------------------------------------------------------------- When

When('I upload a valid PDF with kind {string}', async function (this: AuthWorld, kind: string) {
  await upload(this, kind, 'valid-3-page-listing.pdf');
});

When(
  'I upload a valid PDF with kind {string} whose extracted text is {int} characters',
  async function (this: AuthWorld, kind: string, chars: number) {
    assert.equal(chars, 20_000, 'the only oversized CV fixture is the 20 000-character one');
    await upload(this, kind, 'cv-20000-chars.pdf');
  },
);

// -------------------------------------------------------------------------------- Then

Then(
  'the response carries an upload id with kind {string}',
  async function (this: AuthWorld, kind: string) {
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: uploadedId() } });
    assert.equal(row.kind, kind);
  },
);

Then("the current user's cv upload id is that upload", async function (this: AuthWorld) {
  const id = uploadedId();
  assert.equal((await currentUser(this)).cvUploadId, id);
});

Then('the profile carries cv text', async function (this: AuthWorld) {
  const { profile } = await currentUser(this);
  assert.equal(typeof profile.cv_text, 'string');
  assert.ok((profile.cv_text as string).length > 0, 'cv_text is empty');
});

Then(
  'the profile cv text is exactly {int} characters',
  async function (this: AuthWorld, chars: number) {
    const { profile } = await currentUser(this);
    assert.equal((profile.cv_text as string | undefined)?.length, chars);
    // The number in the feature file is the prompt builder's own ceiling, not a second
    // constant that could drift away from it.
    assert.equal(chars, MAX_BLOCK_CHARS);
  },
);

Then(
  'the stored object for that upload is not publicly readable',
  async function (this: AuthWorld) {
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: uploadedId() } });
    assert.ok(store.keys().includes(row.storage_key), 'the bytes were never stored');
    // K12: the private `uploads/` namespace, never the `/assets/` route Caddy serves openly.
    assert.ok(
      row.storage_key.startsWith('uploads/') && !row.storage_key.startsWith('assets/'),
      `stored under a publicly served key: ${row.storage_key}`,
    );
  },
);

Then('a signed URL for that upload reads the object', async function (this: AuthWorld) {
  const row = await prisma.upload.findUniqueOrThrow({ where: { id: uploadedId() } });
  const url = await store.signedUrl(row.storage_key, 300);
  assert.equal(store.fetchSigned(url).status, 200);
});

Then('a log event {string} was emitted', function (event: string) {
  assert.ok(
    capturedLines().some((line) => line.event === event),
    `no ${event} line was emitted`,
  );
});
