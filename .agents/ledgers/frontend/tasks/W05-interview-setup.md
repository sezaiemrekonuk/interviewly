# W05 — Interview setup (screen 9): occupation/language + listing, mobile layout
REPO: (this repo) · Depends: W02, I03, I04, I11 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — a form that POSTs one create call and routes into the room. The one
sharp edge (the setup response is missing the detected summary) is a recorded gap, not a design
decision this task makes.

## Goal
Owner's ask (frontend spec screen 9):

> "Setup — the pre-interview form. Pick the occupation/language, optionally paste or upload a job
> listing, choose the round shape, and start. Starting creates the interview and enters the room."
> — frontend spec §Behaviour screen 9; PLAN_FRONTEND_LEDGER.md §3 phase 2

Build the setup route `/interviews/new` over `POST /interviews` (I03) and the listing upload (I11),
routing a created interview into `/interviews/:id/room` (or `/pre-join` when mode is voice).

## Security boundaries
- **Auth-gated** via `useRequireAuth()`; unauthenticated → sign-in preserving the path.
- **`DAILY_INTERVIEW_LIMIT` is a server verdict** — the client renders the inline localized message
  with retry context (REFERENCE error table) and does not itself count or gate creation.
- **The listing upload trusts the backend** (I11 magic-byte/size check). The client filters accept
  types and surfaces the response codes; it does not parse the PDF.

## Non-negotiables
- **Create is a single `POST /interviews`.** No optimistic room entry — the room is entered only
  after the create resolves with an `interviewId`, then navigate to the room (text) / pre-join
  (voice) route (§ Data layer: mutations don't retry, truth comes from the create response).
- **The detected-summary gap is honoured, not invented (STATE blocker / I03 gap).** `POST
  /interviews` currently returns `{ interviewId, hrCount, techCount }` only — no occupation,
  language or cluster. Setup renders the **round split from `hrCount`/`techCount`** and shows the
  occupation/language the user *chose* (client-side), and marks the "detected summary, editable"
  affordance as **pending on I03 widening its response** — do not fabricate a detected occupation
  from a field the API does not return.
- **Setup is an entry surface** — gradient ground + `--shadow-soft` (W01 constants); `point` mascot
  (ui). One `--primary` "Start" CTA.
- **States (verbatim):** loading = the create button shows a pending state while `POST /interviews`
  is in flight (inputs locked); error = mapped `errors.<CODE>` inline, form re-enabled, no navigate;
  empty = a first-time user sees the blank form (no prior-listing prefill).
- **Mobile layout** — the form is single-column and reachable at ≤ 375 px (spec mobile note); the
  CTA is not clipped below the fold.
- **Both locales** carry `setup.*`.

## Context (anchors)
- `frontend/src/app/interviews/new/page.tsx` — **create.** The setup form: occupation + language
  selects, the round-shape control, the listing paste/upload, the `--primary` Start CTA; on submit
  `POST /interviews`, then route by mode.
- `frontend/src/components/setup/listing-upload.tsx` — **create.** Paste-or-upload; upload via
  `POST /uploads` (`kind=listing`, I11) with progress + error-code mapping; passes the resulting
  `uploadId` into the create body.
- `frontend/src/lib/query.ts` (:W02) — add a `POST /interviews` mutation (no retry) that on success
  seeds `['interview',id,'state']` from a follow-up `GET /interviews/:id/state` (I03) or lets the
  room fetch it; and the round-shape options the create accepts (per I03's body).
- `frontend/messages/{en,tr}.json` — **modify.** `setup.*` in both files.
- `frontend/src/app/interviews/new/page.test.tsx` — **create.** RTL over mocked fetch: a valid
  submit calls `POST /interviews` once and navigates to `/interviews/:id/room`; a
  `DAILY_INTERVIEW_LIMIT` response shows the inline message and does not navigate; the round split
  renders `hrCount`+`techCount`; the "detected summary" affordance is marked pending, not populated.
- REFERENCE §backend-surface (`POST /interviews`, `POST /uploads`, `GET /interviews/:id/state`),
  `use-require-auth.ts`, `auth-redirect.ts`, the W01 entry constants — reuse.

  **The trap:** do not render an occupation/language "detected from the CV/listing" — the create
  response does not carry it (the I03 gap in STATE). Show the user's own choices and split the
  rounds from the counts; leave the editable detected-summary affordance visibly pending on I03.

## Steps
- [x] **1. `POST /interviews` mutation** in `query.ts` (no retry).
- [x] **2. `new/page.tsx`** — occupation/language, round shape, Start CTA, `point` mascot,
  entry ground; route by mode on success.
- [x] **3. `listing-upload.tsx`** — paste/upload via `POST /uploads` (`kind=listing`), error
  mapping, `uploadId` into the create body.
- [x] **4. Round split from `hrCount`/`techCount`; mark the detected-summary affordance pending.**
- [x] **5. `setup.*` copy** in both files; mobile single-column at ≤ 375 px.
- [x] **6. `page.test.tsx`** — one create call + navigate, limit-error inline no-navigate, round
  split rendered, detected-summary pending.
- [x] **7. Run the `## Verification` command.**

## Definition of done
- Submitting `/interviews/new` calls `POST /interviews` once and, on success, navigates to
  `/interviews/:id/room` (text) or `/pre-join` (voice) — never optimistically before the response.
- `DAILY_INTERVIEW_LIMIT`/`RATE_LIMITED` render inline localized messages with no navigation.
- The round split renders from `hrCount`+`techCount`; no fabricated detected occupation appears;
  the editable-summary affordance is visibly pending on I03.
- The form is single-column and usable at ≤ 375 px; copy resolves EN + TR.

## Verification
```bash
npm run -w frontend test -- src/app/interviews/new/page.test.tsx
```
Expected: the setup suite passes — single create + mode-routed navigation, limit-error inline
handling, the round split, and the pending detected-summary affordance.

## Notes

**Shipped.** `/interviews/new` — occupation/language/mode/round-shape + paste-or-upload listing,
one `POST /interviews`, mode-routed nav. `setup.module.css` carries the entry ground
(`--gradient-entry` + `--shadow-soft` card); the form is a flex column at every width, so 375/390 px
needs no branch.

**Contract facts (verified against `backend/modules/interview/setup.ts`, not assumed):**
- Body is `{ mode, jobText?, uploadId?, targetQuestionCount }` — **no occupation, no language.**
  I03 classifies `occupation` from `jobText` and takes `language` from `req.user.locale`.
  The two selects are therefore client-side only and say so via `setup.choiceNotSent`.
- **`uploadId` with no `jobText` is `VALIDATION_ERROR`, not a valid create** (`setup.ts:55`) —
  the extracted-text handoff is I11's unbuilt contract. The form requires pasted text even when a
  PDF uploaded cleanly, and refuses locally with `LISTING_REQUIRED` rather than spending a round
  trip on a message that does not name the real problem. **Delete that guard once I11 returns
  extracted text.**
- 201 is `{ interviewId, hrCount, techCount }` only. Confirmed gap; nothing claims detection.

**Deviation — the round split is a client preview, not the response.** The task says render the
split from `hrCount`/`techCount`, but setup navigates away the moment the create resolves, so the
201's counts can never be on screen. `splitRounds()` in `page.tsx` mirrors I03's deterministic
`max(2, round(target*0.4))`. **This is duplicated server logic** — if I03's split changes, this
drifts silently. Collapse it when the create response can be shown (or I03 exposes the split
pre-create).

**For W06:** the room is entered only after the create resolves; no state is seeded into
`['interview',id,'state']`, so the room fetches its own truth. `useCreateInterview()` in
`lib/query.ts` (retry off) — reuse, do not redeclare `CreateInterviewBody`/`CreateInterviewResponse`.

**Verification:** `npm run -w frontend test -- src/app/interviews/new/page.test.tsx` → 9 passed.
Ring: frontend 150, root 258. lint + typecheck clean. `test:acceptance` **not run** — it needs a
composed Postgres/Redis and hangs without one; this diff touches no backend behaviour.
