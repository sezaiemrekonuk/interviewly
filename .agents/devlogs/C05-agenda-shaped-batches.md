---
task: C05
author: Sezai
sessions: [2026-08-10]
model: claude-opus-5
model_recommended: claude-sonnet-5
iterations: 1
tools: [claude-code, subagents]
---

## Session 1 — 2026-08-10

### What I asked for / what came back
- `QuestionSchema` gains an optional `intent`; `questions` gains a nullable `intent` column;
  generation prompt bumped to v3 emitting `intent` alongside `text` (same uuid, v2 left on disk).
- `generation.ts` persists `intent: q.intent ?? null` in the existing `createMany`; the count
  guard, the pause-on-failure branch and the `order_index` numbering are untouched.
- `StubAiClient` emits an intent per question so the stub exercises the same shape.

### Methodology trace
- The shape was argued before it was built (ADR-C05). Three candidates: delete the batch, keep
  verbatim questions, or carry intent *plus* a fallback sentence. The third won on three
  concrete dependencies the first would have broken — topic coverage from the listing and CV,
  the #89 pause/resume repair which regenerates a round and needs something to regenerate into,
  and ADR-I22's pre-warm which exists so a handover is never a loading screen.
- `intent` is optional in the Zod schema on purpose: v1 and v2 of the prompt are still on disk
  and still resolvable by explicit version, and they must keep validating.

### Friction
- The temptation was to make `text` optional once `intent` exists. Left required, and the
  comment says why: it is what an interview falls back to when the conductor cannot be reached
  mid-round. An agenda with no sentences turns a provider outage into a room with nothing to ask
  — which is the exact failure the fallback path in `conductor.ts` is written to survive.

### What I rejected and rewrote by hand
- Rejected a separate `agenda` table. The row already exists, is already ordered, already
  carries topic and difficulty, and is already what the report's question spine points at.

### Verification (verbatim)
- `npm run prisma:generate` → `✔ Generated Prisma Client (v6.19.3)`.
- `npm test -- --project node generation` → `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- `npm test -- --project node packages/ai` → `Test Files 5 passed (5)`, `Tests 50 passed (50)`.

### Follow-up left for the ledger (non-blocking)
- Existing rows have `intent = NULL` and fall back to `topic` in `remainingTopics`. Correct, and
  it means an interview created before this migration is conducted slightly blinder than one
  created after. No backfill is possible — the intent was never generated.
