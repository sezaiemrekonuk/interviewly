# I11 — Upload validation (MIME/magic/size/pages/text) + `sha256` dedup
REPO: (this repo) · Depends: A01, F02 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — an uploaded PDF is untrusted input reaching text extraction (§7.2, K12). A MIME-only check, an unbounded page count, or an extraction that runs on a hostile file is a real vulnerability class.

## Goal
Owner's ask:

> "`POST /uploads`: reject > 10 MB (`UPLOAD_TOO_LARGE`), a non-PDF by MIME *and* magic
> bytes (`UNSUPPORTED_MEDIA_TYPE`), > 30 pages (`UPLOAD_TOO_MANY_PAGES`), and < 200
> extracted characters (`PDF_TEXT_TOO_SHORT`); extract with `unpdf` (no OCR); dedup a
> byte-identical re-upload by `sha256`. Scenario AC-14 (validation) and AC-3 (dedup) in
> `upload.feature` green."
> — interview-core decomposition (§7.2, K12, ADR-I10)

This task adds the upload endpoint, the validation pipeline, the text extraction, and the
dedup. It does **not** wire the object bucket's real credentials (infra) or the signed-URL
download (I12) — it stores bytes via the storage wrapper and returns an `uploadId`.

**Added 2026-07-30 — `kind ∈ {listing, cv}` (§3.3, K12).** The field is **required** and
Zod-validated; a missing or unknown value is `VALIDATION_ERROR` (422) (`upload.feature::The upload
kind is required and closed`). Every limit above is identical for both kinds — the only difference
is what references the row afterwards:

- `listing` → referenced by an interview (`interviews.upload_id`).
- `cv` → referenced by `users.cv_upload_id`, with the extracted text cached on
  `users.profile.cv_text`, truncated to 12 000 characters with a `CV_TRUNCATED` log line. **Auth
  A06 owns those two writes**; this task's job is to accept the `kind`, validate it, and store the
  object. If A06 has not landed, accept and validate `kind` anyway — the column exists in F02 and a
  later task filling the pointer must not require re-uploading.

**Both kinds are private objects.** A CV is the most personal document a user gives us; it is never
public-read, never routable through `/assets`, and reachable only by a 5-minute signed URL (I12,
K12). The dedup key stays the bytes (`sha256`), not `(sha256, kind)` — the same PDF sent once as a
listing and once as a CV is one stored object, and the referencing side records the role it played.

## Security boundaries
- **Validate MIME *and* magic bytes.** A `renamed-text-file.pdf` (text bytes, `.pdf` name,
  `application/pdf` header) is rejected `UNSUPPORTED_MEDIA_TYPE` (415) on the magic-byte
  check (`upload.feature` @AC-14). Never trust the declared MIME alone.
- **Bound every dimension before extraction.** Size ≤ 10 MB (`UPLOAD_TOO_LARGE` 413) and
  page count ≤ 30 (`UPLOAD_TOO_MANY_PAGES` 422) are checked before/around extraction so a
  hostile file cannot exhaust memory. `unpdf`, **no OCR** (K12).
- **No stored bytes for a rejected upload.** A rejected file returns no `uploadId` and
  writes no `uploads` row (@AC-14 asserts no `uploadId` for any rejected upload).

## Non-negotiables
- **The four rejections** with exact codes/status: `pdf-over-10mb.pdf` → 413
  `UPLOAD_TOO_LARGE`; `renamed-text-file.pdf` → 415 `UNSUPPORTED_MEDIA_TYPE`;
  `pdf-31-pages.pdf` → 422 `UPLOAD_TOO_MANY_PAGES`; `scanned-short-text.pdf` → 422
  `PDF_TEXT_TOO_SHORT`. A `valid-3-page-listing.pdf` → 201 `{ uploadId }`.
- **`sha256` dedup** (`upload.feature` @AC-3): a byte-identical re-upload returns the *same*
  `uploadId` and leaves exactly one `uploads` row for that `sha256`; a different valid PDF
  gets a new `uploadId` and a second row. `uploads.sha256` is `@unique` (F02).
- **`POST /uploads` is behind `requireAuth`** and the interview-start/upload rate limiter is
  not required here (I13 owns interview limits); a malformed multipart body is
  `VALIDATION_ERROR`.

## Context (anchors)
- `backend/modules/interview/uploads.ts` — **create.** `POST /uploads` (multipart): read the
  buffer, compute `sha256`, check the `uploads` table for an existing row (dedup → return its
  id), else validate size → magic bytes + MIME → page count → extract text (`unpdf`) → min
  chars, on any failure return the code with no write, on success `storage.put` the bytes and
  `prisma.upload.create`, 201 `{ uploadId }`.
- `backend/src/lib/storage.ts` — I12 creates the wrapper; if I12 has not landed, add a
  minimal `put(key, bytes, mime)` here and let I12 extend it (note the shared file in
  `## Notes`). The bucket credentials come from env (I15); in tests a `FakeStorage` seam is
  used.
- `backend/modules/auth/middleware.ts` — A01 `requireAuth`.
- `backend/src/lib/db.ts` — F02 `prisma`. `uploads`: `user_id`, `storage_key`, `mime`,
  `size_bytes`, `sha256` (`@unique`).
- `backend/src/lib/error-codes.ts` — F01. Confirm/add `UPLOAD_TOO_LARGE`,
  `UNSUPPORTED_MEDIA_TYPE`, `UPLOAD_TOO_MANY_PAGES`, `PDF_TEXT_TOO_SHORT`, `VALIDATION_ERROR`.
- `backend/package.json` — add `unpdf` (extraction) and a multipart parser (e.g. `multer` or
  `busboy`).

  **The trap:** compute `sha256` and check dedup **before** running extraction — a
  byte-identical re-upload of an already-validated file must not re-run `unpdf` or re-store
  bytes. Order: hash → dedup short-circuit → validation → store. And the page-count check
  must happen before or bound the extraction so `pdf-31-pages.pdf` is rejected without
  extracting 31 pages of text.

## Steps
- [x] **1. Add deps** — `unpdf` + a multipart parser in `backend/package.json`.
- [x] **2. Write `uploads.ts`** — hash → dedup → size → magic+MIME → pages → extract → min
  chars → store → 201. Each failure returns its code with no write.
- [x] **3. Storage put** — via `storage.ts` (or the minimal `put` if I12 has not landed).
- [x] **4. Attach `POST /uploads`** behind `requireAuth`.
- [x] **5. Add the fixtures** the feature names (`pdf-over-10mb.pdf`, `renamed-text-file.pdf`,
  `pdf-31-pages.pdf`, `scanned-short-text.pdf`, `valid-3-page-listing.pdf`,
  `another-valid-listing.pdf`) — no PII in any fixture.
- [x] **6. Wire acceptance step-defs** for `upload.feature` @AC-14 (the four rejections + the
  valid 201) and @AC-3 (dedup: same `uploadId`, one row per `sha256`; different file, new row).
- [x] **7. Run the `## Verification` command.**

## Definition of done
- Each invalid fixture is rejected with its exact status/code and creates no `uploads` row;
  a valid PDF returns 201 `{ uploadId }`.
- A byte-identical re-upload returns the same `uploadId` with exactly one row per `sha256`; a
  different valid PDF gets a new id and row.
- Extraction uses `unpdf` with no OCR; `sha256` dedup precedes extraction.

## Verification
```bash
npm run test:acceptance -- --tags "@upload"
```

## Notes

**What exists now.** `POST /uploads` (app.ts, behind `requireAuth`, no CSRF check — it is not
on the interview router). `modules/interview/uploads.ts` exports `uploadMiddleware` (multer,
memory storage, `fileSize: 10 MB`, `files: 1`) and `createUpload`.

Pipeline order, all of it load-bearing: `kind` (Zod `listing|cv`) → `sha256` → dedup
short-circuit → MIME + `%PDF-` magic → `getDocumentProxy` (parse failure → 415) → `numPages`
→ `extractText` (unpdf, no OCR) → 200-char floor on whitespace-collapsed text →
`storage.put` → `prisma.upload.upsert`. Response is `{ uploadId }` only.

**Deviations from the task file.**
- Size is enforced twice: a `Content-Length > 10 MB + 4096` pre-check (refuses before
  buffering; the slack is multipart framing, so a file of exactly 10 MB still passes) and
  multer's own limit as the backstop, whose `MulterError` is mapped — `LIMIT_FILE_SIZE` →
  `UPLOAD_TOO_LARGE`, anything else → `VALIDATION_ERROR`. Unmapped it was a 500, which is
  what the first red run caught.
- `upsert` rather than `create`, keyed on the unique `sha256`: two identical uploads racing
  past the `findUnique` would otherwise make the second a P2002 instead of a dedup hit.
- Fixtures are **built, not committed** — `backend/features/fixtures/pdf.ts` emits an
  uncompressed PDF 1.4 with a real xref table (`buildPdf(pages, padBytes)`), so the 10 MB
  file costs no repo bytes. `fixtureBytes(name)` serves the six names the feature uses.

**Shared files touched.** `src/lib/storage.ts` is **I12's** — I11 created it with `put` +
the `setStorage` seam only; extend it with `get`/`signedUrl(key, ttl)` rather than reworking
it. `world.ts` gained `httpUpload(path, filename, bytes, kind?)`. `cucumber.js` `paths`
gained `upload.feature` (default profile). `backend/package.json` gained `multer`,
`@types/multer`, `unpdf`.

**Deliberate, spec'd, worth knowing.** `uploads.sha256` is globally `@unique` (F02, K12), so
dedup crosses users: an identical PDF returns the *first* uploader's row id and that row's
`kind` is whichever role it was first stored under. The bytes are identical, so nothing is
disclosed that the second uploader did not already hold.

**For A06.** `kind: 'cv'` is accepted and stored; nothing writes `users.cv_upload_id` or
`users.profile.cv_text` yet. `cucumber.js`'s auth profile can now drop `and not @AC-32`.

**Verification.** `npm run test:acceptance -- --tags "@upload"` → 3 scenarios, 29 steps,
all passing, from an empty `uploads` table. Full default profile 48/48, auth profile 23/23,
122 unit, lint + typecheck clean.
