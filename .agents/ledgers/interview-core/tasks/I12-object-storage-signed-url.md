# I12 — Object-storage signed-URL wrapper + report download endpoint
REPO: (this repo) · Depends: I03 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — owner-scoped, short-lived signed URLs for private objects (§7.2, K14). A TTL that is too long, a URL under the public route, or an ownership slip leaks another candidate's report.

## Goal
Owner's ask:

> "The object-storage wrapper (put/get/signed URL with a ≤ 300 s TTL) and the report
> download endpoint that hands the owner a short-lived signed URL, returns 404
> `INTERVIEW_NOT_FOUND` to a non-owner, and whose URL expires on the fixed clock. Scenario
> AC-6 in `object_storage.feature` green."
> — interview-core decomposition (§7.2, K14, ADR-I13)

This task builds `backend/src/lib/storage.ts` (the object-store wrapper) and the report
download endpoint. It does **not** render the report PDF — the `report` ledger renders it and
writes `reports.pdf_key`; this task signs whatever key that column holds. The acceptance
fixture seeds a report row + object key (per the boundary note).

## Security boundaries
- **A non-owner gets 404 `INTERVIEW_NOT_FOUND`, never 403, and no signed URL**
  (`object_storage.feature` @AC-6, ADR-I11). Ownership resolves through the I03 resolver.
- **The signed URL expires ≤ 300 s ahead of the clock** and is **not** under the public
  `/assets/` route. The wrapper takes a `Clock` seam so the fixed-clock scenario asserts TTL
  expiry deterministically; after the TTL a fetch is 403.
- **No signed URL is logged.** The URL grants object access; keep it out of every log line
  (§7.2).

## Non-negotiables
- **`storage.signedUrl(key, ttlSeconds)`** returns a URL whose expiry is `clock.now() +
  min(ttlSeconds, 300)` — never more than 300 s ahead. The target is a private-object URL,
  not the public `/assets/` path.
- **`GET /interviews/:id/report/download`** (behind `requireAuth` + ownership): owner → 200
  `{ url }` with a ≤ 300 s signed URL for `reports.pdf_key`; non-owner → 404
  `INTERVIEW_NOT_FOUND`.
- **TTL expiry is enforced by the store**: fetching the URL before expiry is 200; after the
  clock passes the TTL it is 403 (the store/`FakeStorage` honours the signature expiry).

## Context (anchors)
- `backend/src/lib/storage.ts` — **create** (or extend if I11 added a minimal `put`).
  `put(key, bytes, mime)`, `get(key)`, `signedUrl(key, ttlSeconds)` capped at 300 s using an
  injected `Clock`. S3-compatible client configured from env (I15: `S3_BUCKET`, endpoint,
  credentials). A `FakeStorage` + `Clock` seam backs the acceptance ring.
- `backend/modules/interview/download.ts` — **create.** `GET
  /interviews/:id/report/download`: ownership-resolved `req.interview`, load the `reports`
  row, `storage.signedUrl(report.pdf_key, 300)`, 200 `{ url }`. No report/`pdf_key` → treat
  as not found for the owner (report not ready) per the report ledger's contract; the
  acceptance fixture seeds a ready report.
- `backend/modules/interview/router.ts` — I03. Attach the `GET` download route at the marked
  slot behind ownership (no CSRF — it is a `GET`).
- `backend/modules/interview/ownership.ts` — I03 resolver → `INTERVIEW_NOT_FOUND` for a
  non-owner.
- `backend/src/lib/env.ts` — F03/I15. Bucket config (`S3_BUCKET`, endpoint, credentials).
- `backend/src/lib/error-codes.ts` — F01. `INTERVIEW_NOT_FOUND`.

  **The trap:** the 300 s cap is a **hard** ceiling in `signedUrl`, not a default a caller can
  override upward. `object_storage.feature` @AC-6 asserts the expiry is "no more than 300
  seconds ahead of the fixed clock" — `signedUrl(key, 600)` must still expire at 300 s. Cap
  with `min(ttlSeconds, 300)`.

## Steps
- [x] **1. Write `storage.ts`** — `put`/`get`/`signedUrl` with the 300 s hard cap and the
  injected `Clock`; the S3-compatible client from env; the `FakeStorage`/`Clock` seam.
- [x] **2. Write `download.ts`** — ownership-resolved, sign `reports.pdf_key`, 200 `{ url }`;
  non-owner → 404 `INTERVIEW_NOT_FOUND`.
- [x] **3. Attach the download route** behind ownership (GET, no CSRF).
- [x] **4. Wire acceptance step-defs** for `object_storage.feature` @AC-6 (owner → 200 with a
  signed URL ≤ 300 s ahead, not under `/assets/`; other candidate → 404 `INTERVIEW_NOT_FOUND`
  no URL; URL fetch 200 before TTL, 403 after the clock passes the TTL).
- [x] **5. Run the `## Verification` command.**

## Definition of done
- `storage.signedUrl` returns a private-object URL expiring ≤ 300 s ahead of the injected
  clock, never under `/assets/`.
- The download endpoint hands the owner a 200 `{ url }` signed URL and returns 404
  `INTERVIEW_NOT_FOUND` to a non-owner with no URL; the URL reads 200 before TTL and 403
  after.

## Verification
```bash
npm run test:acceptance -- --tags "@object-storage"
```

## Notes

**What exists now**

- `src/lib/storage.ts` — `Storage { put, get, signedUrl }`, plus exported `MAX_TTL_SECONDS`
  (300) and `cappedTtl(ttl) = max(1, min(ttl, 300))`. Real impl presigns with
  `@aws-sdk/s3-request-presigner`'s `getSignedUrl` and `signingDate: clock.now()` — the Clock
  seam the fixed-clock scenario needs. `setStorage` seam unchanged (I11).
- **New dependency:** `@aws-sdk/s3-request-presigner@^3.1098.0` in `backend/package.json`.
  `npm audit` findings are unchanged by it (pre-existing `tar` advisories only).
- `modules/interview/download.ts` — `GET /interviews/:id/report/download`, mounted in
  `router.ts` under `router.param('id', resolveInterview)`, so a non-owner 404s before the
  handler runs. Picks the newest `reports` row **with a non-null `pdf_key`**; none → the same
  `INTERVIEW_NOT_FOUND` (not-ready and not-yours are indistinguishable). Signs at
  `MAX_TTL_SECONDS`. Never logs the URL.
- `features/fixtures/fake-storage.ts` — `makeFakeStorage()` + `parseSignedExpiry(url)`. Signs
  SigV4-shaped URLs (`X-Amz-Date`/`X-Amz-Expires`/`X-Amz-Signature`) so the TTL assertions
  parse a real presigned URL byte-identically; `fetchSigned(url)` is 200 before the expiry and
  403 after, read off `clock.now()`.
- `features/step_definitions/object-storage.steps.ts` — the 11 new steps. Reuses
  `I am signed in as a candidate` (interview-setup), `another candidate is signed in` (admin),
  `the fixed clock is {string}` (answers), `the response status is {int}` (ai-provider),
  `the response error code is {string}` (interview-setup).
- `cucumber.js` default profile: `.agents/features/object_storage.feature` added.

**Deviations**

- `Storage` widened, so `uploads.steps.ts`'s put-only fake now spreads `makeFakeStorage()`.
  One line; the recording `put` those scenarios assert on is untouched.
- `FakeStorage` lives under `features/fixtures/`, not in `src/lib/storage.ts` — test-only code
  stays out of the shipped module.
- No `clock.now` restore hook here: `answers.steps.ts`'s global `After` already restores it
  for every scenario in the ring.

**Verification** — `npm run test:acceptance -- --tags "@object-storage"` → `2 scenarios (2
passed), 22 steps`. Full default ring 51/51, 144 unit, lint + typecheck clean. Local runs need
`DATABASE_URL`/`REDIS_URL`/`S3_ENDPOINT` on the published host ports (`5432`, `6380`, `9000`),
not `.env`'s compose hostnames.

**For R03** — sign `reports.pdf_key` through `storage.signedUrl`; do not build a URL. The cap
is enforced inside, so passing a larger TTL silently yields 300 s.
