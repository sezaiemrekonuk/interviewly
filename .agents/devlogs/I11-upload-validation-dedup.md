---
task: I11
author: Sezai
sessions: [2026-08-03]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 1
tools: [superpowers:test-driven-development, caveman, ponytail]
---

## Session 1 — 2026-08-03

Two agents. A sonnet session did the kickstart (deps + a sketch of `uploads.ts` and
`storage.ts`, explicitly labelled "not done" in a `ponytail:` header) and stopped because
`MODELS.md` puts I11 on opus. This opus session finished it and was told not to trust the
sketch. `model` ≠ `model_recommended` because opus-5 is the current opus tier, not because
the tier was overridden — MODELS.md's `claude-opus-4.8` is the same tier.

### What I asked for / what came back
- Sketch was ~80% structurally right: pipeline order and the dedup-before-extraction trap
  were both handled. Its two real defects were invisible without running it.
- Fixture question answered by generating PDFs in code rather than committing six binaries,
  one of them 11 MB. `buildPdf` writes an uncompressed PDF 1.4 with a real xref table.

### Methodology trace
task §Non-negotiables → `upload.feature` @AC-14/@AC-3 (Stage 2, already written) → wired
into `cucumber.js` + `uploads.steps.ts` → red #1: cucumber arity (`function has 1 arguments,
should have 2`) → red #2 against the sketch: `pdf-over-10mb.pdf` returned
`500 INTERNAL_ERROR`, expected `413` — `MulterError` was never mapped → green 3/3.
Re-ran from a truncated `uploads` table: the first green run had been short-circuiting on
rows the red run left behind, so extraction and `storage.put` were never re-entered.

### Friction
- `strict: true` + `not @unwired` means a scoped `--tags` run reports `0 scenarios` and
  exits 0 if the feature is not in `paths` — the false green EXECUTE.md §7 warns about. Adding
  the file to `paths` was step one, before any implementation.
- `new Blob([buffer])` fails `tsc --strict`: `Buffer` is typed over `ArrayBufferLike`, which
  may be a `SharedArrayBuffer`. `Uint8Array.from(bytes)` instead.
- A first attempt at the chunked-upload backstop check hung for three minutes — it was the
  missing `setEmailQueue` fake constructing a real BullMQ queue during register, not the
  upload path. With the fake, a 12 MB chunked body returns 413 with no hang.

### What I rejected and rewrote by hand
- **Sketch's size check.** `if (file.size > MAX_BYTES)` inside the handler is unreachable:
  multer aborts first and its `MulterError` reached the generic handler as a 500. Replaced
  with a Content-Length pre-check (refuses before buffering; +4096 slack so a file of exactly
  10 MB is still legal) plus an explicit `MulterError` → `UPLOAD_TOO_LARGE` mapping.
- **Sketch's `prisma.upload.create`.** Two identical uploads racing past the `findUnique`
  make the second a P2002 on the unique `sha256`, not the dedup hit it should be. `upsert`.
- **Sketch's `class S3Storage`** — one implementation, one method, wrapped in a class with a
  private field. Replaced with an object literal behind the same `setStorage` seam.
- **`region: 'auto'`** — copied from a Cloudflare R2 idiom; this project runs MinIO, and
  `prisma/seed.ts` already establishes `us-east-1` + `forcePathStyle`. Matched the seed.
- Considered and dropped: an `UPLOAD_ACCEPTED` log line (not in the ledger's event list, and
  nothing asserts it) and returning `kind` in the response body (REFERENCE's contract for this
  endpoint is `{ uploadId }`; the step reads the row instead).
