# R02 — Render `ReportPayload` to PDF, write `reports.pdf_key` via I12 storage, denormalise `report_questions`
REPO: (this repo) · Depends: R01, I12 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — PDF template + a mechanical payload→rows denormalisation over a validated `ReportPayload`; no trust boundary, no state machine. If the storage-key or idempotency handling turns out subtler than an upsert, code-review the diff with `claude-opus-4.8`.

## Goal
Owner's ask:

> "Render the completed `ReportPayload` to a PDF, store it via I12's object-storage wrapper,
> write `reports.pdf_key`, and denormalise the payload's per-question scores into
> `report_questions`. The PDF must then be retrievable through I12's existing signed-URL
> download endpoint."
> — report ledger decomposition (K15, ADR-R03)

This task adds the artifact-finalisation step to the R01 consumer's success path: it renders the
persisted `reports.payload` to PDF bytes with `pdfkit`, `storage.put`s them, writes
`reports.pdf_key`, and denormalises `payload.questions[]` into `report_questions` (the admin
weakest-question query reads these). It does **not** add a download route — I12 already owns
`GET /interviews/:id/report/download`, which signs whatever `pdf_key` this task writes. PDF
export is a §12 bonus (K15), so this task is separable — if the deadline squeezes, R01 (the
`payload` report) and R03 (reliability) stand without it.

## Non-negotiables
- **Render only a payload I09 persisted.** `renderReportPdf` takes the `reports.payload` that
  `runReport` already validated against the `ReportPayload` schema (I09/I01). Do not re-validate
  or re-generate — read the persisted row. A report row without a payload (the `failed` branch)
  is never rendered.
- **`pdf_key` and `report_questions` are written idempotently.** A retry re-runs the processor;
  finalise must be safe to run twice — `reports.pdf_key` set by upsert, `report_questions`
  cleared-and-reinserted (or upserted by `(report_id, question_id)`), never a blind insert that
  duplicates rows.
- **Store as a private object; never under `/assets/`.** The PDF is a private report object
  (K12) — `storage.put` under a private key (e.g. `reports/<interviewId>.pdf`). I12's
  `signedUrl` (≤ 300 s) is the only way it is handed out; the worker signs nothing and logs no
  URL.
- **No `payload` or PDF bytes in any log line.** Log `REPORT_PDF_RENDERED` with
  `{ interviewId, pdfKey, bytes }` only — the key and size, never the content (K6).

## Context (anchors)
- `worker/src/render-pdf.ts` — **create.** `renderReportPdf(payload: ReportPayload): Buffer` — a
  pure function, no I/O. Uses `pdfkit` to lay out: header (interview id / date), `overall_score`
  + `overall_impression`, `strengths[]`, `improvements[]`, a per-`rounds[]` section
  (`type`, `score`, `summary`, optional `note`), and a per-`questions[]` table
  (`question_id`, `score`, `reason`, `star_adherence`). Deterministic output; unit-testable
  without Redis or the store.
- `worker/src/finalize.ts` — **create.** `finalizeReport(interviewId)`:
  1. Load the `reports` row (`payload`, `id`) via `prisma`.
  2. `const pdf = renderReportPdf(report.payload)`.
  3. `const key = \`reports/${interviewId}.pdf\`; await storage.put(key, pdf, 'application/pdf')`.
  4. `await prisma.report.update({ where: { interview_id: interviewId }, data: { pdf_key: key } })`.
  5. Denormalise: delete existing `report_questions` for `report.id`, then insert one row per
     `payload.questions[]` (`question_id`, `score`, `reason`, `star_adherence`).
  6. `logger.info({ interviewId, pdfKey: key, bytes: pdf.length }, "REPORT_PDF_RENDERED")`.
- `worker/src/consumer.ts` — R01. Call `finalizeReport(interviewId)` on the success path,
  **between** `runReport` returning and setting `reports.status = 'ready'`.
- `backend/src/lib/storage.ts` — I12. `put(key, bytes, mime)` and `signedUrl(key, ttl≤300)`.
  Import and reuse; do not construct a second S3 client.
- `packages/ai/src/schemas.ts` — I01. `ReportPayload` type — the shape `renderReportPdf` consumes
  (`overall_impression`, `overall_score`, `strengths`, `improvements`, `rounds`, `questions`,
  `language`; per K15/I01).
- `backend/src/lib/db.ts` — F02. `prisma`; `reports`, `report_questions`.
- `backend/src/lib/env.ts` — F03/I15. `S3_BUCKET` + endpoint/creds (used by `storage.ts`).

  **The trap:** `report_questions.question_id` is a FK to `questions.id`. The payload's
  `questions[].question_id` values must be real question ids from this interview — they are,
  because I09's report prompt scores the interview's own questions. If a stub payload in a test
  uses fake ids, the FK insert fails; seed the test's `report_questions` denormalisation against
  the interview's actual `questions` rows.

## Steps
- [x] **1. Add `pdfkit`** to `worker/package.json` deps; `npm install` at the repo root.
- [x] **2. Write `render-pdf.ts`** — `renderReportPdf(payload): Buffer`, the deterministic
  `pdfkit` layout above. Unit-assert it returns a non-empty `Buffer` whose first bytes are the
  `%PDF` magic for a valid `ReportPayload` sample.
- [x] **3. Write `finalize.ts`** — load payload, render, `storage.put`, write `pdf_key`,
  denormalise `report_questions` (delete-then-insert for idempotency), log `REPORT_PDF_RENDERED`.
  *(Denormalisation dropped — I09 already owns it; ADR-R06 and `## Notes`.)*
- [x] **4. Call `finalizeReport` from `consumer.ts`** on the success path, before
  `reports.status = 'ready'`.
- [x] **5. Wire the worker test** — enqueue a job for a seeded `evaluating` interview whose
  `runReport` (stubbed AI) yields a valid payload; assert after the job: `reports.pdf_key` is
  set, `storage.get(pdf_key)` returns the PDF bytes, `report_questions` has one row per
  `payload.questions[]` with matching `question_id`/`score`/`star_adherence`, and a second run of
  the same job leaves exactly one `report_questions` row per question (idempotency).
- [x] **6. Confirm end-to-end delivery via I12** — using I12's `storage.signedUrl(pdf_key, 300)`
  (or the `GET /interviews/:id/report/download` endpoint), the rendered object is retrievable and
  the URL expires ≤ 300 s ahead. (This reuses I12's wrapper — assert, don't rebuild.)
- [x] **7. Run the `## Verification` command.**

## Definition of done
- After a successful report job, `reports.pdf_key` points at a stored `application/pdf` object
  that `storage.get` returns and `storage.signedUrl` hands out with a ≤ 300 s TTL.
- `report_questions` holds exactly one row per `payload.questions[]` item
  (`question_id`, `score`, `reason`, `star_adherence`); re-running the job does not duplicate
  rows.
- `renderReportPdf` is pure (no I/O) and returns a valid PDF `Buffer`; no `payload` or PDF bytes
  appear in any log line.

## Verification
```bash
docker compose up -d db cache
npm run -w worker test
```

Expected: the finalise suite passes (`pdf_key` set, object retrievable via I12's `signedUrl`,
`report_questions` denormalised one-per-question, idempotent on re-run). Then confirm no content
leaks:
```bash
docker compose logs worker | grep -E "%PDF|overall_impression|strengths"
# Must print nothing
```

## Notes

**Deviation — `finalize.ts` does not denormalise `report_questions` (ADR-R06).** I09 already
does, inside the same transaction that creates the `reports` row (`report-run.ts:159-178`), and
it filters `payload.questions[]` down to ids that exist in `questions` first
(`report-run.ts:144-153`, logs `REPORT_QUESTION_ID_UNKNOWN`) — the FK trap this task's Context
warns about is already closed there. A delete-then-insert in finalise would be a second owner of
one table plus a second copy of that filter; drift means a model-invented id crashes the job into
a retry loop. Finalise is render + `storage.put` + `pdf_key` only. The DoD invariant is still
asserted, in `consumer.integration.test.ts`.

**Deviations — signatures.** `renderReportPdf(payload, meta): Promise<Buffer>`, not
`(payload): Buffer`. Async because `pdfkit` is a stream (bytes arrive on `data`, complete on
`end`). `meta = { interviewId, createdAt }` because the header needs the interview id and
`ReportPayload` has no date; `createdAt` is `reports.created_at`, passed in so the render stays
pure and byte-deterministic — `pdfkit` otherwise stamps `info.CreationDate` from wall time and a
retry would write different bytes under the same key.

**Key scheme.** `reports/<interviewId>.pdf` (`pdfKeyFor`, exported for the tests). Private —
never `config.S3_PUBLIC_PREFIX` (`/assets`). Idempotent by construction: derived from the id, so a
re-run overwrites one object and rewrites one column. No `pdf_key` upsert-by-`interview_id` is
possible — `reports` has no unique on `interview_id`; finalise updates by the row `id` it read
(latest by `created_at`, same selection `download.ts` uses).

**Order matters.** `storage.put` before the `pdf_key` update. Reversed, a crash between them
leaves `pdf_key` naming an object that does not exist and I12 signs a URL to nothing.

**No-op branches.** No `reports` row, or a row with `payload: null` → finalise returns silently.
That is the I09 schema-gate branch (interview `failed`, no row at all), not an error.

**`worker-exports.ts` grew** `storage`, `setStorage`, `Storage`, `MAX_TTL_SECONDS` — subpath
imports of `backend` are not resolvable from the worker's built package.

**Verification (2026-08-04).** `npm run -w worker test` 4 files / 18 tests. `npm run
test:integration` 5/5 (needs published ports; a host-native Postgres owns `localhost:5432`, so
`db` must be republished — `15432`/`16380` per R01's note). `npm test` 40 files / 286 tests.
`lint`, `typecheck`, `npm run -w worker build` (after `-w @interviewly/ai` + `-w backend build` —
worker resolves backend's `dist`) clean. `npm run test:acceptance` 79/79.
`docker compose logs worker | grep -E "%PDF|overall_impression|strengths"` printed nothing.
Step 6 against real MinIO: requested TTL 600 → signed 300, fetch 200, bytes identical, key not
under `/assets/`.

**For R03.** Finalise adds no state to unwind: it writes one column and one object, both derived
from `interviewId`, both overwrite-safe. The real retry hazard is upstream — `runReport` throws on
a second run (its `applyTransition(→ completed)` is the CAS), so a crash *between* `runReport` and
`finalizeReport` means the retry dies before finalise ever runs and `pdf_key` stays null. If R03
wants that recovered, its transient branch must reach finalise directly rather than re-running the
whole processor.
