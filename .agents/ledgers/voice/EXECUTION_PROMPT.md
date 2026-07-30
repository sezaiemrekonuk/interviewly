# Voice — Execution Prompt

Paste this verbatim as the prompt for each new session working the `.agents/ledgers/voice/`
ledger. One session = one task. The session has no memory of prior sessions — everything needed
lives in these files.

---

## Prompt (copy from here down)

You are executing one task from the Voice ledger in `.agents/ledgers/voice/`. Follow this protocol
exactly, in order. Do not skip steps, do not batch multiple tasks, do not improvise scope beyond
the task file.

1. **Read `.agents/ledgers/voice/STATE.md` in full** — ledger, statuses, cross-ledger
   dependencies, the "Current task" pointer, and the "Open blockers" (the CSP/SDK forks you must
   NOT resolve yourself).

2. **Check the cross-ledger gate.** The "Cross-ledger dependencies (blocks this ledger)" table in
   STATE.md lists the foundations/auth/interview-core tasks each voice task needs. If any listed
   dependency is not `done` in its ledger's STATE.md, **stop and report** — a voice task cannot run
   until its `Depends on` are green. (Voice blocks nothing; no other ledger waits on you.)

3. **Pick the task:**
   - If "Current task" names one, use it — unless the user's message this session names a different
     ID, in which case the user wins.
   - Otherwise take the first `todo` row whose `Depends on` is empty or all-`done`. Ties go to the
     earlier row (the table is dependency-sorted). V02 and V03 are independent — either is eligible
     once V01 is done.
   - If nothing is eligible, stop and report — don't invent work.

4. **Read `.agents/ledgers/voice/REFERENCE.md` once.** Trust it; patch it only if stale.

5. **Read only the current task's file** (e.g. `tasks/V01-*.md`). Other task files belong to other
   sessions.

6. **Check `.agents/ledgers/voice/MODELS.md`** for this task's recommended model. V02, V03 and V04
   require `claude-opus-4.8` (webhook auth, fallback, reconciliation are the invariants). If you are
   not running that model on those tasks, say so before proceeding.

7. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope — consume I06/I07/I08,
   never reimplement the state machine, the guarded advance, or the budget transaction. Note
   adjacent work in STATE.md's Backlog, don't fold it in.

8. **Run the `## Verification` command exactly as written.** Don't claim done without seeing the
   Cucumber scenarios (and, for V04, the worker-level test) pass. If they fail, fix the code —
   never the command. A silenced webhook test is a forged-webhook hole you hid.

9. **Mark it done:** fill the task file's `## Notes`; flip the STATE.md ledger row to `done`;
   repoint "Current task"; rewrite "Last session ended" with what landed, which files changed, and
   what the next task must know.

10. **Commit** as `{ID}: <title>`, e.g. `V02: ElevenLabs webhook authentication`. Include the
    `.agents/ledgers/voice/` file changes in the same commit.

11. **STOP.** The next task is the next session's job.

### If blocked mid-task

Set the row to `blocked`, write the blocker into STATE.md's "Open blockers" section (what's needed,
which tasks it unblocks), and stop. Do not guess at the ElevenLabs API key, the webhook secret, the
agent ids, or the CSP WSS origin — those are the owner's / `infra`'s to supply.

### Guardrails that apply regardless of task

- **The API key never reaches the browser.** The mint returns a short-lived signed token only; a
  payload or build exposing `ELEVENLABS_API_KEY` client-side is a defect (§3.5).
- **No `nonce`, session token, API key, or transcript text in any log line, error body, or test
  fixture** (K6, §7.2). `voice_webhook.feature` @AC-10 asserts this via the `LogSink` seam.
- **Every webhook passes all four gates before mutating anything** — signature, freshness, nonce
  authorisation, legality+expiry — in that order; a failure at any gate changes no state (§3.5).
- **Downgrade is one-directional.** `interviews.mode` goes `voice → text` only, never the reverse
  (§3.8). Consume the I07 transition; do not add a new state edge.
- **Reconciliation is one atomic, idempotent transaction.** The `llm_calls` insert and the
  `spent_usd` increment share the K13 transaction (I08); a redelivered post-call webhook writes
  nothing more (§7.3).
- **Consume, don't reimplement.** I06 owns answer persistence, I07 owns the transition table, I08
  owns the budget transaction. Extend them through their published surface only.
- **Migration rule (ADR-F02):** no new table, no column type change, no new enum value. Any index
  or nullable column is a new migration rebased on F02, never an edit to the existing migration SQL.
- **Verification is not negotiable.** `npm run test:acceptance -- --tags "@voice-…"` (and
  `npm run -w worker test` for V04) must exit 0 with the named scenarios passing.

---

## Why this file exists

`STATE.md`'s "Execution protocol" is the source of truth (keep them in sync). This file is the same
protocol shaped as a standalone pasteable prompt, and it front-loads the cross-ledger gate check
and the voice-specific guardrails (key-never-in-browser, secret redaction, four gates,
one-directional downgrade, atomic reconciliation) that apply to every voice task.
