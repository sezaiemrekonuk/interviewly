# W07 — Report + transcript (screen 12): the report-wait beat and the scored read-back — CLOSES THE DEMO PATH
REPO: (this repo) · Depends: W02, R01 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the screen that closes the loop and the one with the trickiest async
seam: the `evaluating`→ready wait (SSE-primary with a bounded poll fallback, < 60 s budget) and the
report render must degrade cleanly whether the report is already present, still generating, or the
budget cut the interview short. Judgement, not composition.

## Goal
Owner's ask (frontend spec screen 12):

> "The report — the score, the per-dimension breakdown, the strengths/gaps narrative, and the full
> transcript. If the interview just ended it shows the 'generating your report' beat and resolves to
> the report when it's ready (< 60 s)."
> — frontend spec §Behaviour screen 12; PLAN_FRONTEND_LEDGER.md §3 phase 4

Build the report + transcript route `/interviews/:id` over `GET /interviews/:id` (R01), including
the report-wait beat for a just-completed interview. **This is the task that closes the MVP demo
path** (land → register → onboard → setup → room → **report** → history).

## Security boundaries
- **Auth-gated + ownership is the backend's** — a non-owner gets `FORBIDDEN`/`INTERVIEW_NOT_FOUND`
  routed by W02's table; existence is never leaked.
- **No score is computed client-side.** The report is read entirely from `reports.payload` served by
  `GET /interviews/:id`; the client renders it, it does not derive or re-score anything.

## Non-negotiables
- **The read is `GET /interviews/:id` → `{ interview, transcript, report? }`** (R01). **This handler
  is a recorded STATE blocker** — R01's DoD assumes it but no backend task currently adds the route
  handler. This task `Depends on R01`; if `GET /interviews/:id` does not resolve when execution
  starts, **stop and flag R01**, do not build the screen against a phantom route (§5 of the planning
  prompt: never plan a frontend task against a route that does not exist).
- **The report-wait beat** — when `interview.state` is `evaluating` (or `report` is absent on a
  completed interview), show the "generating your report" beat and resolve via **SSE-primary**
  (`useInterviewEvents(id)` invalidating `['interview',id]`) with a **bounded poll fallback** if the
  stream is silent, within the **< 60 s** budget (§8.1). When `report` arrives, render it.
- **Cut-short honesty (§ report):** if `endedReason` is `cut_short`/`budget_exhausted`/
  `time_exhausted`/`abandoned`, the report header states the interview ended early and scores what
  was answered — it does not present a partial run as a complete one.
- **The transcript is the read-only W06 `<Transcript>`** — reuse it, do not fork a second transcript
  renderer.
- **The report is NOT an entry surface** — flat `--bg`, `--shadow-hairline`, no gradient, no mascot
  (a mascot on the report is a defect, ui). `--accent` may key section headers; it is never a CTA.
- **States (verbatim):** loading = the report skeleton while `['interview',id]` resolves; **wait** =
  the generating beat (distinct from loading) while `evaluating`; error = W02-routed (`BUDGET_
  EXCEEDED` lands here via `evaluating`; `INTERVIEW_NOT_FOUND` → not-found); empty = a completed
  interview with an empty transcript still renders the report shell, not a blank page.
- **Both locales** carry `report.*`.

## Context (anchors)
- `frontend/src/app/interviews/[id]/page.tsx` — **create.** The report host: `useReport(id)` over
  `GET /interviews/:id`; branch on `state`/`report?` into the wait beat vs. the report render; mount
  `useInterviewEvents(id)` (invalidating `['interview',id]`) for the wait; guard auth; route errors.
- `frontend/src/components/report/report-view.tsx` — **create.** The score, the per-dimension
  breakdown, the strengths/gaps narrative — all from `report.payload`; the cut-short header when
  `endedReason` is an early-end reason.
- `frontend/src/components/report/report-wait.tsx` — **create.** The "generating your report" beat:
  SSE-primary + bounded-poll fallback, a < 60 s ceiling, then the report or a timed-out fallback
  message.
- `frontend/src/components/room/transcript.tsx` (:W06) — **reuse** read-only for the transcript
  section. Do not create a second transcript component.
- `frontend/src/lib/query.ts` (:W02) — add `useReport(id)` on `['interview',id]` over `apiGet`
  (`GET /interviews/:id`); the poll fallback uses React Query `refetchInterval` gated to the wait.
- `frontend/messages/{en,tr}.json` — **modify.** `report.*` in both files.
- `frontend/src/app/interviews/[id]/page.test.tsx` — **create.** Use W02's `event-source-mock`.
  Assert: a ready `report` renders the score + transcript; an `evaluating` interview shows the wait
  beat, and an SSE event → refetch → the report renders (not from the event body); a `cut_short`
  interview shows the early-end header; the poll fallback fires when the stream stays silent.
- REFERENCE §backend-surface (`GET /interviews/:id` row + its STATE-blocker note), §error table —
  the authorities.

  **The trap:** two of them. (1) `GET /interviews/:id` may not exist yet — verify it resolves before
  building, else stop and flag R01. (2) The wait beat must be SSE-primary with the poll only as a
  fallback; a naive fixed-interval poll alone can blow the < 60 s feel and hammers the API — nudge
  first, poll only if silent.

## Steps
- [x] **1. Confirm `GET /interviews/:id` resolves** (R01). If not, stop and flag R01 in STATE.
- [x] **2. `useReport(id)`** on `['interview',id]` (+ gated `refetchInterval` for the fallback).
- [x] **3. `report-wait.tsx`** — SSE-primary via `useInterviewEvents` invalidating `['interview',id]`,
  bounded poll fallback, < 60 s ceiling.
- [x] **4. `report-view.tsx`** — score, per-dimension, narrative from `report.payload`; cut-short
  header on an early `endedReason`.
- [x] **5. `[id]/page.tsx`** — branch wait vs. report; reuse `<Transcript>`; flat `--bg`, no mascot;
  guard auth; route errors.
- [x] **6. `report.*` copy** in both files.
- [x] **7. `page.test.tsx`** — ready-report render, evaluating→SSE→report, cut-short header, poll
  fallback. Run the `## Verification` command.

## Definition of done
- `/interviews/:id` renders the report (score, per-dimension breakdown, narrative) + the reused
  read-only transcript from `GET /interviews/:id`.
- An `evaluating` interview shows the distinct generating beat and resolves to the report via an SSE
  nudge → refetch (proven in the test — not from the event body), with a bounded poll fallback under
  the < 60 s budget.
- An early `endedReason` (`cut_short`/`budget_exhausted`/`time_exhausted`/`abandoned`) renders the
  early-end header; no score is computed client-side.
- The screen is flat `--bg`/`--shadow-hairline` with no mascot; copy resolves EN + TR; and the
  demo path land→…→report→history is closed by this screen.

## Verification
```bash
npm run -w frontend test -- "src/app/interviews/[id]/page.test.tsx"
```
Expected: the report suite passes — ready-report render, evaluating→SSE-refetch→report (not from the
event body), the cut-short header, and the bounded poll fallback.

## Notes

**Done.** `/interviews/:id` renders the report + the reused read-only `<Transcript>`.

**The read is two calls, not one (ADR-W08).** `GET /interviews/:id` (`backend/modules/interview/
get.ts`) resolves but is thin — `{ interviewId, state, report }`, no `transcript`, no
`endedReason`. Both come from `GET /interviews/:id/state`, which already derives them (ADR-W06).
`get.ts` was NOT patched: it is another ledger's file, and re-deriving the transcript there would
duplicate `state.ts`'s hr→tech ordering. If R01 ever thickens `get.ts`, delete the state read here.

**`useInterviewEvents` changed contract (breaking, one call site):** it now invalidates
`queryKeys.interview(id)` — the *prefix* of both `['interview',id]` and `['interview',id,'state']`
— instead of the state key. One nudge refreshes a screen that mounts both reads. The room is
unaffected (prefix match still hits its key); `use-interview-events.test.ts` was updated to assert
the prefix. The sketch's `queryKey` parameter was dropped — it was missing from the effect deps and
a caller passing a fresh array per render would have re-opened the stream.

**`ReportPayload` is snake_case, verbatim `reports.payload`** — `overall_impression`,
`overall_score`, `strengths[]`, `improvements[]`, `rounds[]{type,score,summary,note?}`,
`questions[]{question_id,score,reason,star_adherence}`, `language`. Gated by `ReportPayloadSchema`
(`packages/ai/src/schemas.ts`); every score is an **integer 0..5** (copy renders `{score} / 5`).
The sketch's camelCase `dimensions`/`gaps` stub was wrong and is gone.

**Poll fallback:** `useReport(id, poll)` — `refetchInterval` 5 s, off unless `poll` and no report
yet. `<ReportWait onTimeout>` owns the 60 s ceiling (§8.1) and switches `poll` off at it; SSE still
resolves the screen after the ceiling.

**Per-question rows join `payload.questions` to the transcript by `question_id`** and drop ids the
transcript does not know — a model-invented id renders nothing, never an unattached scored row.

**For W08:** the room already `router.replace`s here on `evaluating|completed|failed|abandoned`
(`room/page.tsx:22`), so history only needs to link `/interviews/:id`.

**Still open (not W07):** the Download-PDF slot is unbuilt — R02/I12 own the rendered PDF (STATE
Backlog).
