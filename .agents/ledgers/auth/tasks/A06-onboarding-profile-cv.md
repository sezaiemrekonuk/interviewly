# A06 — Building the onboarding profile: three cards, CV upload, and first-run routing
REPO: (this repo) · Depends: A03 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — CRUD over one jsonb column plus three forms. The only subtle parts
(per-card persistence, the DOB exclusion, the snapshot boundary) are stated below, so moderate
reasoning is sufficient.

## Goal
Owner's ask:

> "Three 'get to know you' cards after registration — identity, education, interests — plus an
> optional CV upload. Saved per card so an abandoned flow loses nothing. It feeds question *and*
> report generation. The CV file is kept in storage."
> — IDEA.md §3.3 layer 1, K8.7, backend spec §8b, `onboarding_profile.feature`

Ships `GET /me/profile`, `PATCH /me/profile`, `POST /me/profile/complete`, the `kind='cv'` path on
`POST /uploads`, the three card screens at `/onboarding/[step]`, and the K8.7 first-run routing
that A03's sign-in success already calls.

## Non-negotiables
- **Each card persists on its own `PATCH`.** Card 2 saving must not require card 1 to be valid, and
  saving card 1 twice must not erase card 2's keys — merge into `users.profile`, never replace it.
  An all-or-nothing save on a three-step flow is a drop-off cliff, which is the whole reason the
  spec calls per-card saving out.
- **Resume comes from the server, not `localStorage`.** Mounting `/onboarding/[step]` reads
  `GET /me/profile` and redirects to the first unfilled step. Local storage would disagree with the
  database the moment a user switches device or clears it — and then "we lost your answers" is a
  bug we cannot reproduce.
- **Skip is a first-class success.** `POST /me/profile/complete` sets `onboarding_completed_at`
  whether or not any field is set. A partial profile is normal data and renders no error state.
- **`date_of_birth` never leaves toward a model and never enters a log.** It is stripped when
  `candidate_profile` is built (backend §8b) and it is not a field any log line names. Feeding an
  age into an evaluation invites age bias in the output.
- **The CV is untrusted text.** Its extracted text is truncated to 12 000 characters
  (`CV_TRUNCATED`) and reaches `ai` only inside the `<candidate_cv>` block with the same
  neutralisation the job listing gets (§7.1). A CV is a PDF a stranger wrote.
- **The CV object is private.** `uploads.kind = 'cv'`, private prefix, 5-minute signed URL only
  (K12). It is the most personal document in the bucket; a public-read CV is the worst leak the
  system could have.
- **The merge is a snapshot, and this task does not own it.** `candidate_profile` is written by
  interview-core at `POST /interviews/:id/profile`. A06 provides the account profile; it must not
  write to `interviews`.
- **Reuse `POST /uploads`.** Do not add a second upload endpoint for CVs — the validation (10 MB,
  magic bytes, 30 pages, `unpdf`) is identical and already exists.

## Context (anchors)
- `backend/prisma/schema.prisma` (:F02) — `users.profile`, `users.cv_upload_id`,
  `users.onboarding_completed_at`, `uploads.kind` already exist. **No structural migration here.**
- `backend/modules/auth/profile.ts` — **create.** The three handlers. Zod schema **per step**:
  card 1 `{ fullName?, jobTitle?, dateOfBirth? }`; card 2
  `{ education: [{ school, degree, field, graduationYear }] }` max **5** rows; card 3
  `{ hobbies: string[], interestsText? }`.
- `backend/modules/auth/me.ts` (:A01) — **edit**: `GET /me` additionally returns
  `emailVerifiedAt`, `onboardingCompletedAt` and `interviewCount` so first-run routing is one
  server answer (K8.7) rather than three screens guessing.
- `backend/modules/interview/uploads.ts` (:I11) — **edit**: accept and validate `kind`; on
  `kind='cv'` set `users.cv_upload_id` and write the truncated text to `users.profile.cv_text`.
  If I11 has not landed, implement the `kind` validation where the endpoint lives and note it.
- `frontend/app/(onboarding)/onboarding/[step]/page.tsx` — **create.** One centred card on the
  `--gradient-entry` ground, `1/3 · 2/3 · 3/3` progress, Continue + Back + **Skip for now**, one
  short friendly line above the fields, and the per-card mascot pose (`point`, `think`, `cheer` —
  `ui` §4.2.1).
- `frontend/src/lib/first-run.ts` — **create.** The K8.7 routing rule, used by A03's sign-in
  success, A04's verification success and the onboarding completion.
- `.agents/features/onboarding_profile.feature` — the acceptance scenarios; make them green
  without editing them.

## Steps
- [ ] **1. `GET /me/profile`** — returns `{ profile, onboardingCompletedAt, cvUploadId }`.
- [ ] **2. `PATCH /me/profile`** — `{ step, fields }`, per-step Zod, merge-not-replace, 60/hour/user
  rate limit.
- [ ] **3. `POST /me/profile/complete`** — sets `onboarding_completed_at`; idempotent.
- [ ] **4. `GET /me` extension** for the routing inputs.
- [ ] **5. CV path on `POST /uploads`** — `kind` validation, pointer write, truncation +
  `CV_TRUNCATED`, private storage class asserted.
- [ ] **6. The three card screens** with per-card save, server-driven resume, deep-link redirect to
  the first unfilled step, and the DOB "not sent to the interviewer AI" note (we collect it, so we
  say what we do with it).
- [ ] **7. `first-run.ts` routing** wired into every sign-in success path.
- [ ] **8. Log events** — `PROFILE_CARD_SAVED` (step only), `ONBOARDING_COMPLETED`, `CV_UPLOADED`
  (`uploadId`, size, pages), `CV_TRUNCATED`. **Never a field value, never the CV text, never the
  date of birth.**

## Definition of done
- `onboarding_profile.feature` is green, including the snapshot-immutability scenario (which
  depends on interview-core's merge; if that has not landed, mark the scenario pending in `## Notes`
  rather than weakening it).
- A card-2 body with 6 education rows returns `422 VALIDATION_ERROR` and leaves the stored 5 intact.
- A `cv` upload is unreadable anonymously and readable through a signed URL.
- No log line contains a profile field value or a date of birth (LogSink assertion).
- Signing in with an incomplete profile lands on the first unfilled card; with a complete profile
  and zero interviews, on `/interviews/new`; otherwise on `/dashboard`.

## Verification
```bash
npx cucumber-js .agents/features/onboarding_profile.feature
```
All scenarios pass (or the interview-snapshot scenario is explicitly pending with a reason). Then:
```bash
# a cv object must not be anonymously readable
curl -s -o /dev/null -w '%{http_code}\n' "$PUBLIC_ORIGIN/assets/$(cat /tmp/cv-key)"
```
Expected: `403` (or `404` — the point is that it is not `200`).

## Notes

(Empty until the task is done. Fill with: what actually happened, the cucumber output verbatim,
whether the CV path landed in I11's file or here, the truncation length observed, and a hand-off
line for interview-core stating that `users.profile` is ready to be snapshotted.)
