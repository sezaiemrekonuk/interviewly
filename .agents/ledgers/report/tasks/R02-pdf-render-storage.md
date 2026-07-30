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
- [ ] **1. Add `pdfkit`** to `worker/package.json` deps; `npm install` at the repo root.
- [ ] **2. Write `render-pdf.ts`** — `renderReportPdf(payload): Buffer`, the deterministic
  `pdfkit` layout above. Unit-assert it returns a non-empty `Buffer` whose first bytes are the
  `%PDF` magic for a valid `ReportPayload` sample.
- [ ] **3. Write `finalize.ts`** — load payload, render, `storage.put`, write `pdf_key`,
  denormalise `report_questions` (delete-then-insert for idempotency), log `REPORT_PDF_RENDERED`.
- [ ] **4. Call `finalizeReport` from `consumer.ts`** on the success path, before
  `reports.status = 'ready'`.
- [ ] **5. Wire the worker test** — enqueue a job for a seeded `evaluating` interview whose
  `runReport` (stubbed AI) yields a valid payload; assert after the job: `reports.pdf_key` is
  set, `storage.get(pdf_key)` returns the PDF bytes, `report_questions` has one row per
  `payload.questions[]` with matching `question_id`/`score`/`star_adherence`, and a second run of
  the same job leaves exactly one `report_questions` row per question (idempotency).
- [ ] **6. Confirm end-to-end delivery via I12** — using I12's `storage.signedUrl(pdf_key, 300)`
  (or the `GET /interviews/:id/report/download` endpoint), the rendered object is retrievable and
  the URL expires ≤ 300 s ahead. (This reuses I12's wrapper — assert, don't rebuild.)
- [ ] **7. Run the `## Verification` command.**

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

(Empty until the task is done. Fill with: what actually happened, the `pdfkit` layout decisions,
the worker-suite output verbatim, the private key scheme used for `storage.put`, how idempotency
of `report_questions` was enforced, any FK gotcha with `question_id`, whether I12's `signedUrl`
was exercised directly or via the download endpoint, and a "For R03" note if finalise touches any
state R03's dead-letter path must also unwind.)
