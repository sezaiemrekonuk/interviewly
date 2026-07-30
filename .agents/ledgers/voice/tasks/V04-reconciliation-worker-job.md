# V04 — Post-call usage reconciliation worker job (idempotent `spent_usd` + `llm_calls` transaction)
REPO: (this repo) · Depends: V02, I08 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the reconciliation transaction is the cost invariant (§7.3, K13). A non-atomic write splits `spent_usd` from its `llm_calls` row; a non-idempotent redelivery double-charges. Both are subtle and both are exactly what `voice_reconciliation.feature` asserts.

## Goal
Owner's ask:

> "ElevenLabs' post-call webhook delivers the voice duration; `worker` writes exactly one
> `llm_calls` row (`provider='elevenlabs'`, `unit_kind='second'`, `units` = seconds) and increments
> `interviews.spent_usd` by the reconciled cost **in one transaction** (the K13/I08 contract). A
> redelivery of the same webhook writes no additional row and leaves `spent_usd` unchanged. Emit
> `VOICE_USAGE_RECONCILED`. Scenarios in `voice_reconciliation.feature` green, plus the worker-level
> test."
> — voice ledger decomposition (§3.5, §7.3, K10, K13, ADR-V04)

This task adds the post-call webhook (`reconcile-webhook.ts`, reusing V02's signature/freshness
verifiers) that enqueues a BullMQ job, and the worker job (`worker/src/jobs/voice-reconcile.ts`)
that performs the single idempotent transaction. It **consumes** the I08 `spent_usd`/`llm_calls`
transaction contract; it does **not** reimplement it or change the text-path budget logic.

## Security boundaries
- **The post-call webhook is authenticated** — HMAC-SHA256 signature + timestamp freshness (V02
  gates 1–2, reused). It legitimately arrives after the live session is consumed, so it authorises
  by `interview_id` against the *completed* session and is **not** held to gate 3's
  unexpired-unconsumed check (ADR-V04). A bad signature → `WEBHOOK_SIGNATURE_INVALID` (401); a stale
  timestamp → `WEBHOOK_REPLAY_REJECTED` (401); neither enqueues a job.
- **The `llm_calls` insert and the `spent_usd` increment share one transaction** (the K13/I08
  contract). Never write the row and increment `spent_usd` in two statements — a crash between them
  splits the ledger from the balance.
- **The job is idempotent.** Before writing, it checks for an existing
  `(interview_id, provider='elevenlabs')` `llm_calls` row and no-ops if one exists. ElevenLabs may
  deliver the post-call webhook more than once; a redelivery must write nothing and leave
  `spent_usd` unchanged.
- **No transcript, nonce, or key in a log line.** `VOICE_USAGE_RECONCILED` logs `{ traceId,
  interviewId, units, spentUsd }` — the seconds and the reconciled balance, never a secret.

## Context (anchors)
- `backend/modules/voice/reconcile-webhook.ts` — **create.** `POST /webhooks/elevenlabs/post_call`:
  run V02's `verifySignature` + `checkFreshness` (gates 1–2 only); on pass, extract
  `{ interviewId, seconds }`, enqueue a BullMQ job keyed by `interviewId` on the Redis already in
  the stack, return `202`. On gate failure return the 401 code. Do **not** do the DB write here —
  that is the worker's (K10).
- `backend/modules/voice/webhook-auth.ts` — V02. Reuse `verifySignature` and `checkFreshness`; do
  not re-derive the HMAC logic.
- `worker/src/jobs/voice-reconcile.ts` — **create.** The BullMQ consumer:
  1. `prisma.$transaction` (the I08/K13 contract): inside it, check for an existing
     `(interview_id, provider='elevenlabs')` `llm_calls` row → if present, no-op and return
     (idempotent).
  2. Else insert one `llm_calls` row: `provider='elevenlabs'`, `unit_kind='second'`,
     `units = seconds`, `cost_usd` = seconds × the ElevenLabs per-second rate (from
     `@interviewly/ai` `model-prices.yaml`; a missing rate → `cost_usd = null`, matching I02's
     rule), `trace_id` from the job.
  3. Increment `interviews.spent_usd` by the reconciled `cost_usd` **in the same transaction**.
  4. Log `VOICE_USAGE_RECONCILED` with `{ traceId, interviewId, units, spentUsd }`.
  The job is idempotent by `interviewId` (K10) and by the existence check.
- `backend/modules/interview/budget.ts` — I08. The `spent_usd`/`llm_calls` single-transaction
  contract. Reuse its transaction helper (or replicate its exact atomicity); do not open a second
  connection or a second transaction.
- `worker/src/lib/logger.ts`, `worker/src/lib/env.ts` — F03. The worker's pino factory and env
  subset (`DATABASE_URL`, `REDIS_URL`, the ElevenLabs rate if configured).
- `packages/ai/config/model-prices.yaml` — I01. The `(provider, model) → price` table; the
  ElevenLabs per-second rate lives here. A missing row → `cost_usd = null` (I02 rule), not an error.
- `backend/src/lib/error-codes.ts` — F01. `WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_REPLAY_REJECTED`.
- `worker/package.json` — add a `test` script (Vitest) if F03 did not; the worker-level test drives
  `voice-reconcile.ts` directly with a stubbed queue payload and a live/ephemeral Postgres.

  **The trap:** the `ended_reason = 'time_exhausted'` set on ceiling exit is V02's job (gate 4),
  **not** this task's. Reconciliation only writes the usage row and the `spent_usd` increment; it
  does not change `state` or `ended_reason`. And the idempotency check must be **inside** the
  transaction — checking existence outside it reopens the double-write race a redelivery causes.

## Steps
- [ ] **1. Create `reconcile-webhook.ts`** — `POST /webhooks/elevenlabs/post_call`: reuse V02
  gates 1–2, enqueue a BullMQ job keyed by `interviewId`, return `202`; mount it on
  `webhook-router` / `app.ts` with the same raw-body capture V02 added.
- [ ] **2. Create `worker/src/jobs/voice-reconcile.ts`** — the idempotent single transaction:
  existence check → insert `llm_calls` (`elevenlabs`/`second`/`units`) → increment `spent_usd` →
  `VOICE_USAGE_RECONCILED`, all inside one `$transaction`.
- [ ] **3. Register the job** with the worker's BullMQ consumer set; ensure the queue name matches
  the enqueue in step 1.
- [ ] **4. Add the worker `test` script** to `worker/package.json` if absent, and a worker-level
  test that runs the job twice with the same payload and asserts exactly one `llm_calls` row and
  one `spent_usd` increment.
- [ ] **5. Wire acceptance step-defs** for `voice_reconciliation.feature` @AC-7: a 240-second voice
  round → the worker writes exactly one `llm_calls` row (`provider='elevenlabs'`,
  `unit_kind='second'`, `units 240`), `spent_usd` increases by the reconciled cost, row + increment
  commit in one transaction, `VOICE_USAGE_RECONCILED` emitted; a redelivered webhook → no additional
  row, `spent_usd` unchanged.
- [ ] **6. Run both `## Verification` commands.**

## Definition of done
- The post-call webhook (HMAC + freshness verified) enqueues a job; `worker` writes exactly one
  `llm_calls` row (`provider='elevenlabs'`, `unit_kind='second'`, `units = seconds`) and increments
  `interviews.spent_usd` by the reconciled cost in **one** transaction.
- A redelivered post-call webhook writes no additional `llm_calls` row and leaves `spent_usd`
  unchanged (idempotent by the in-transaction existence check).
- `VOICE_USAGE_RECONCILED` is emitted with `interviewId` + `units` + `spentUsd`; no transcript,
  nonce, or key appears in any log line. `state` and `ended_reason` are untouched by this task.

## Verification
```bash
npm run test:acceptance -- --tags "@voice-reconciliation"
```
Then the worker-level test (idempotent double-delivery):
```bash
npm run -w worker test
```

Expected: `voice_reconciliation.feature` passes, and the worker test asserts exactly one
`llm_calls` row and one `spent_usd` increment after two deliveries. Zero failures, zero pending.

## Notes

(Empty until done. Fill with: what actually happened, every deviation, both command outputs
verbatim, how the single transaction was shared with I08's helper, how the in-transaction
idempotency existence check was written, where the ElevenLabs per-second rate came from
(`model-prices.yaml` or `cost_usd = null`), whether `worker/package.json` needed a `test` script,
and a closing note that voice reconciliation blocks no other ledger.)
