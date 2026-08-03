---
task: I12
author: Sezai
sessions: [2026-08-03]
model: claude-opus-5
model_recommended: claude-opus-4.8
iterations: 2
tools: [caveman:caveman, ponytail:ponytail]
---

## Session 1 — 2026-08-03

`model` is `claude-opus-5` where MODELS.md recommends `claude-opus-4.8` — same opus tier, so
EXECUTE.md § 5 passes; the row was written before Opus 5 existed.

### What I asked for / what came back
- Picked up a half-finished sketch from a prior session (uncommitted `download.ts`, extended
  `storage.ts`, router mount) rather than starting clean. Sketch was sound in shape, wrong in
  three details — see below.

### Methodology trace
spec §7.2 K14 → `object_storage.feature` @AC-6 (2 scenarios) → wired steps → forced red by
lifting the cap (`expiry is 600s ahead of the fixed clock, cap is 300s`) → green 2/2, 22 steps.

### Friction
- Acceptance run against `.env` dies in `BeforeAll`: `getaddrinfo ENOTFOUND cache`. `.env`
  carries compose hostnames; a host run needs the published ports (`6380` for redis, not 6379).
- `@aws-sdk/s3-request-presigner` was not installed — the sketch imported it anyway. Installed
  at the client-s3 version; lockfile diff is that one package.
- Widening `Storage` broke `uploads.steps.ts`'s put-only fake. Fixed at the shared fake rather
  than by making `get`/`signedUrl` optional.

### What I rejected and rewrote by hand
- **The sketch's `FakeStorage` URL shape** (`?sig=fake-sig-0`, expiry held in a side Map). The
  TTL assertion then reads the fake's bookkeeping, not the URL — it would pass against a real
  presigned URL only by accident. Rewrote to emit SigV4 query params and parse the expiry off
  the URL for both stores (ADR-I36).
- **`FakeStorage` exported from `src/lib/storage.ts`.** Test-only code in a shipped module.
  Moved to `features/fixtures/fake-storage.ts`.
- **`getSignedUrl` without `signingDate`.** The task's whole point is a Clock seam; without it
  the real path signs off wall time and the seam is decorative.
- **`findFirst({ where: { interview_id } })`** in the sketch — no ordering, no `pdf_key` filter,
  so a queued report row shadows a ready one. Now newest row with a non-null `pdf_key`.
- Sketch's `fetch(url)` key extraction used `pathname.split('/').pop()`; keys carry slashes
  (`reports/<id>.pdf`). Slices past the base path instead.
