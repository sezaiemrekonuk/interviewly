---
task: W07
author: Sezai
sessions: [2026-08-05]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 2
tools: [caveman, ponytail, cavecrew-investigator]
---

## Session 1 — 2026-08-05

### What I asked for / what came back
- Ask: screen 12 — report + transcript, `evaluating` wait beat, cut-short honesty.
- A previous sonnet pass left an untested sketch (page, `report-view`, `report-wait`, `useReport`,
  `report.*` copy) and a note saying "patch `backend/.../get.ts` first". Treated as scaffolding,
  not as code, per the task's own Notes.

### Methodology trace
- Step 1 (verify the route, the task's trap): `get.ts` **does** resolve — returns
  `{ interviewId, state, report }`, i.e. no `transcript`/`endedReason`. Not a stop condition.
- ATDD: `page.test.tsx` written first → 5 failed / 5 (`Cannot read properties of undefined
  (reading 'map')` in the sketch's `ReportView`) → implement → 5 passed.
- ACs: ready report + transcript; `evaluating` → SSE nudge → refetch → report (event body carried
  a contradicting `overall_score: 1`, screen renders the server's `4`); poll fallback fires and
  **stops** at the 60 s ceiling; `budget_exhausted` → early-end header; empty transcript → shell.
- Gates: `npm run lint`, `npm run typecheck`, `npm test` (280) all green.

### Friction
- Two of my own regressions caught by the existing ring, not by me: `use-interview-events.test.ts`
  (asserted the state key — contract changed on purpose, test updated) and `ui-checks/tokens.test.ts`
  (`font-size: 32px` off the type scale → 40px). The token lint W01 built paid for itself here.
- Acceptance (`cucumber`) needs a live stack; started it, did not block the frontend ring on it.

### What I rejected and rewrote by hand
- **The sketch's plan to patch `backend/modules/interview/get.ts`.** Another ledger's file, and it
  would have re-implemented `state.ts`'s hr→tech transcript ordering a second time. Read
  transcript/`endedReason` from room-state instead (ADR-W08).
- **The sketch's `useInterviewEvents(id, queryKey)` parameter.** Missing from the effect deps, and a
  caller passing a literal array per render would re-open the stream every render. Replaced with
  prefix invalidation on `['interview',id]` — one line, covers both callers, no parameter.
- **The sketch's `ReportPayload`** (`overallScore`, `dimensions[]`, `gaps[]`) — invented. Real shape
  is snake_case verbatim from `ReportPayloadSchema` (`packages/ai/src/schemas.ts`).
- **The sketch's `refetchInterval` gated on `state === 'evaluating'`** — unbounded, so a stuck
  interview polls forever. Bounded by `<ReportWait onTimeout>`'s 60 s ceiling instead.
- Wrote and deleted a `useStateOnce`/`useTimedOut` hook pair in `report-wait.tsx` on the first
  attempt — two hooks wrapping one `useState`. Plain `useState` + one `useEffect`.
