# I09 — Report generation + `ReportPayload` schema gate + completion
REPO: (this repo) · Depends: I07, I02 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — AI-trust layer 2 (§5.5). A malformed report that reaches the caller or lands in the DB is the exact failure the schema gate exists to stop; the completed/failed branch on a Zod result is correctness-critical.

## Goal
Owner's ask:

> "`AiClient.generateReport` plus the Zod `ReportPayload` gate: a valid payload transitions
> `evaluating → completed` and is stored; a malformed one transitions `evaluating → failed`,
> stores no payload, and emits `AI_OUTPUT_SCHEMA_INVALID`. Scenario AC-11 in
> `schema_validation.feature` green."
> — interview-core decomposition (§5.5, ADR-I12, K15)

**Added 2026-07-30 — the report call carries the CV (§3.3, K15).** `generateReport` receives
`candidateProfile` **and** `candidateCv`, both read from the interview's `candidate_profile`
snapshot (`account` / `cvText`, written by I04) — never re-read from `users` at report time, because
the snapshot is what the report must be attributable to (ADR-A07). The CV is what lets the
evaluation compare a claim on paper against the answer given for it. Rules that follow from it:

- `candidateCv` is a **separate** argument, not concatenated into the profile; `ai` gives it its own
  `<candidate_cv>` block, neutralised and truncated (§7.1).
- Absent CV → pass `null`; the builder emits `no cv provided` and the report reasons from the
  transcript alone. It must never invent CV content.
- The snapshot carries **no `dateOfBirth`** (stripped in I04); nothing here re-introduces it.

This task builds the in-process report-generation path off the `evaluating` state: it calls
`AiClient.generateReport`, validates against the `ReportPayload` schema (I01), and branches
to `completed` (store payload) or `failed` (no payload). It provides the runnable
`report job` the acceptance step-def invokes. It does **not** run the real BullMQ job, render
the PDF, or serve the finished report end-to-end — the `report` ledger runs this path inside
its worker job and adds rendering on top.

## Security boundaries
- **A malformed report never reaches the caller and never persists.** Validation runs
  before any write to `reports.payload`; a failure stores nothing and sets `failed`
  (`schema_validation.feature` @AC-11 asserts no payload stored, state `failed`).
- **The gate is the I01 `ReportPayload` Zod schema**, not an ad-hoc check. `overall_score`
  and every `rounds[].score`/`questions[].score` are integers in 0..5;
  `strengths`/`improvements` have 2..5 items; `star_adherence ∈ [0,1]`. A report with
  `overall_score 7` fails the gate.

## Non-negotiables
- **Valid → `completed`, store payload.** `applyTransition(evaluating → completed)` (I07),
  write the validated payload to `reports.payload`, record `prompt_uuid`/`prompt_version`.
- **Invalid → `failed`, no payload, `AI_OUTPUT_SCHEMA_INVALID` event.**
  `applyTransition(evaluating → failed)`, no partial write, log
  `AI_OUTPUT_SCHEMA_INVALID`. The `report` ledger's retry/dead-letter builds on `failed`.
- **The path runs from `evaluating`** — reached by the last technical answer (I06/I07) or
  budget exhaustion (I08). It is a function the report job (report ledger) calls; here it is
  invoked in-process by the acceptance step-def and by the I07 enqueue hook.

## Context (anchors)
- `backend/modules/interview/report-run.ts` — **create.** `runReport(interviewId)`: load the
  interview + transcript (answers + questions), call
  `aiClient.generateReport({ interview, ctx })`, validate the result with the `ReportPayload`
  schema, on success `applyTransition(→ completed)` + upsert the `reports` row with the
  payload, on failure `applyTransition(→ failed)` + log `AI_OUTPUT_SCHEMA_INVALID` + no
  payload. `generateReport` already validates inside `AiClient` (I01/I02); this task adds the
  transition + persistence branch and treats a thrown `AI_OUTPUT_INVALID` as the failed path.
- `backend/modules/interview/sse.ts` — I07. The `enqueueReport` hook fires on `→ evaluating`;
  in interview-core the step-def calls `runReport` directly (the report ledger wires the real
  BullMQ consumer to `runReport`).
- `packages/ai/src/schemas.ts` — I01 `ReportPayload`. Reuse it; do not redefine the shape.
- `backend/modules/ai/index.ts` — I02 `AiClient` singleton + `recordLlmCall`.
- `backend/src/lib/db.ts` — F02 `prisma`. `reports` row: `interview_id`, `status`,
  `payload` (Json), `prompt_uuid`, `prompt_version`. `pdf_key` stays null here (report
  ledger renders and signs it via I12's wrapper).
- `backend/src/lib/error-codes.ts` — F01. `AI_OUTPUT_INVALID` (thrown by `AiClient` on a
  chain-exhausted schema failure); `AI_OUTPUT_SCHEMA_INVALID` is a log event, not an API
  error code returned to a caller.

  **The trap:** `schema_validation.feature` @AC-11 drives the path via "the report job runs",
  not an HTTP request. Expose `runReport(interviewId)` as a plain function the step-def (and
  later the BullMQ worker) can call directly; do not couple the schema gate to an Express
  handler.

## Steps
- [ ] **1. Write `report-run.ts`** — `runReport(interviewId)`: load transcript, call
  `generateReport`, branch on validity, transition + persist or transition + log.
- [ ] **2. Reuse the I01 `ReportPayload` schema** for the gate; treat a thrown
  `AI_OUTPUT_INVALID` (chain-exhausted schema failure) as the `failed` branch.
- [ ] **3. Wire the enqueue hook** (I07) to `runReport` for in-process invocation; the real
  BullMQ binding is the report ledger's.
- [ ] **4. Wire acceptance step-defs** for `schema_validation.feature` @AC-11 (stub returns
  `overall_score 7` → no payload stored, state `failed`, `AI_OUTPUT_SCHEMA_INVALID` emitted;
  stub returns a valid `ReportPayload` → state `completed`, payload stored with the asserted
  integer/range constraints).
- [ ] **5. Run the `## Verification` command.**

## Definition of done
- A malformed report (e.g. `overall_score 7`) transitions the interview to `failed`, stores
  no payload, and emits `AI_OUTPUT_SCHEMA_INVALID`.
- A schema-valid `ReportPayload` transitions to `completed` and is stored with every asserted
  constraint (integer scores 0..5, 2..5 strengths/improvements, `star_adherence ∈ [0,1]`).
- `runReport` is a plain callable function (not an Express handler) the report ledger's
  worker can invoke.

## Verification
```bash
npm run test:acceptance -- --tags "@schema-validation"
```

## Notes
_(fill in when the task is done)_
