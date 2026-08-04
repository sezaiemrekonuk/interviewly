---
task: W04
author: Sezai
sessions: [2026-08-04]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 4
tools: [superpowers:systematic-debugging, cavecrew-investigator]
---

## Session 1 — 2026-08-04

### What I asked for / what came back
- Asked for the three onboarding cards over A06. Found A06 had already shipped a raw-`fetch`
  version of the page, so the task became "rewire + close the gaps", not "create".
- Read the A06 handlers before trusting the page: `getMyProfile` really does return
  `{ profile, onboardingCompletedAt, cvUploadId }`, and the route is `PATCH`, not `POST`.
  The pre-existing page called `apiPost('/me/profile')` — a 404 in the running stack.

### Methodology trace
W04 non-negotiable "a failed save keeps the draft, does not advance" → `page.test.tsx:101`
→ red (the page ignored the PATCH result and `router.push`ed anyway) → green via `saveError`.
"pre-completed redirects off step 1" → red twice: first the redirect never fired, then it
fired but the card still rendered → `leaving` guard returns `null`.

### Friction
- All four specs hung at 5 s. Not the page: the `useRouter` mock returned a **new object per
  call**, so `useRequireAuth`'s `[router]` effect refetched `/me` forever and `act` never
  settled. One hoisted object fixed it. Minimised it in a throwaway `scratch.test.tsx` rather
  than guessing — deleted after.
- Root `npm run lint` passed; husky's `eslint --config frontend/eslint.config.mjs` then
  rejected the commit — `react-hooks/set-state-in-effect` on the hydration effect. The root
  config does not carry the React-Compiler rules, so "lint is green" was true and useless.
- `use(params)` never resumes under RTL's sync `act`; it needs
  `await act(async () => { render(...) })`. Both traps are now in the task Notes for W05.
- `POST /uploads` accepts `kind='cv'` but nothing writes `users.cv_upload_id` — A06 step 5 was
  deferred waiting on I11. Out of a `W` task's scope; logged as a STATE blocker for Ahmet
  rather than patched from here.

### What I rejected and rewrote by hand
- Rejected the task's `components/onboarding/step-{basics,cv,confirm}.tsx` split: three
  branches in one file, or eight draft fields threaded through props for zero reuse. Kept one
  file.
- Rejected the generated `firstUnfilledStep` redirect living only in the effect — a redirect
  is a navigation, and rendering the card meanwhile flashes a form the user is being moved off.
  Hand-wrote the `leaving` render guard.
- Rejected the copy-server-state-into-useState pattern twice: first the effect (lint), then
  the render-phase-setState workaround (same class of bug). Rewrote as derived values with a
  `draft` of touched fields only — no sync to get wrong, and the post-save refetch stops
  being a hazard.
- Rejected duplicating the profile shape in the page: moved `AccountProfile`/`ProfileResponse`
  into `lib/query.ts` so W05–W08 have one source.
