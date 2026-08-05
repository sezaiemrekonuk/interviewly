# Interviewly — Product Review, 2026-08-05

**Reviewer:** end-to-end PM walkthrough of the running stack (`http://localhost`, all 9 containers up) plus a five-track code audit.
**Method:** every claim below was reproduced in a live browser session or verified against a live API/DB/Redis/log. Speculation is marked as such.
**Scope:** landing → register → onboarding → interview setup → text room → report → history → admin, plus the voice path, SEO/i18n, accessibility, security and ops.

---

## 0. The one-paragraph verdict

The backend is, with a few exceptions, genuinely well engineered — the CAS-guarded state machine, the budget advisory lock, the webhook HMAC gates, the soft-delete invariants and the S3 scoping are all correct, tested, and better than most codebases at this stage. **The product does not work anyway**, because a single screen was never built: nothing in the frontend ever calls `POST /interviews/:id/profile`, which is the only transition out of state `profiling`. Every interview ever created through the UI — 18 rows in the live database — is frozen at "Preparing the next question…" forever. That one gap is also the direct cause of the reported voice 409. Behind it sit four more independent voice blockers, an OAuth button that renders raw JSON at the user, a font that cannot draw five Turkish letters, and no KVKK surface at all. Fix the one missing call and the product goes from "never worked" to "works"; the rest of this document is what stands between that and shippable.

---

## 1. Live reproduction: the interview does not work

### 1.1 What I saw

Signed in as an existing user, `/` listed one interview: **"developer · Getting ready · 4 hours ago"**. Clicking **Continue** landed on the room:

```
Question 0 of 8
Preparing the next question…
Answers so far — No answers yet.
```

No header. No footer. No back link. No error. No timeout. No retry. The only exit is the browser Back button.

I then created a brand-new interview through the UI (job listing pasted, Text, 8 questions, **Start**) and got the identical dead end within one second, where it stayed indefinitely.

### 1.2 Root cause — confirmed, single point of failure

`GET /api/interviews/{id}/state` returned:

```json
{"state":"profiling","currentIndex":0,"targetQuestionCount":8,"currentQuestion":null,"personas":[],"transcript":[]}
```

- `backend/modules/interview/setup.ts:83` — `POST /interviews` leaves the interview in **`profiling`**.
- `backend/modules/interview/machine.ts:19` — the **only** edge out of `profiling` is `→ hr_round`.
- `backend/modules/interview/profile.ts:121` — that edge is written by **exactly one** handler, `POST /interviews/:id/profile`, which then calls `generateRound(...)` at `:126` — the call that actually creates the questions.
- **`frontend/src` contains zero references to that endpoint.** Grepping the source *and* the built `.next` bundle inside `interviewly-web-1` returns only `/me/profile` (account onboarding), which is a different route.
- `frontend/src/app/interviews/new/page.tsx:67-71` navigates straight from create to `/interviews/{id}/pre-join` (voice) or `/interviews/{id}/room` (text). **Both branches skip the step.**
- `frontend/src/app/interviews/[id]/room/page.tsx` has branches for the report states (`:25`) and `paused` (`:163`) and **no branch for `profiling` or `created`** — so the missing step renders as the generic "AI is thinking" placeholder.

**Live DB:** every non-seed interview is `state=profiling, current_index=0, started_at=NULL`. The only rows that ever advanced are acceptance-test fixtures.

### 1.3 Proof the rest of the pipeline is healthy

I called the missing endpoint by hand against a fresh interview:

```
POST /api/interviews/{id}/profile  {"skip":true}   → 200 {"state":"hr_round"}
```

API log, same second:

```
INTERVIEW_STATE_CHANGED  profiling → hr_round
HR_BATCH_REQUESTED       roundType=hr count=3
LLM_CALL_STARTED         openai gpt-4.1-mini
LLM_CALL_COMPLETED       latencyMs=3725 costUsd=0.000366
```

Three real HR questions appeared. I then answered through the UI and via the API to the end:

```
hr_round idx=2 → 200      tech_round idx=5 → 200
hr_round idx=3 → 200      tech_round idx=6 → 200
tech_round idx=4 → 200    tech_round idx=7 → 200
tech_round idx=8 → 200 → state=evaluating → report rendered
```

The report was genuinely good: overall 3/5, per-round scores and coaching, strengths, areas to improve, per-question scores with STAR coverage, and it correctly caught that I had pasted the same answer into six different questions.

**The entire AI chain, the CAS advance, the round handover, the report worker and the report UI all work.** One missing frontend call is the whole outage.

### 1.4 The reported 409, reproduced

Owner's note: *"seste 409 conflict hatası var."*

```
POST /api/interviews/{voice-interview}/voice/session
→ 409 {"error":{"code":"INVALID_STATE_TRANSITION"}}
```

`backend/modules/voice/session.ts:19,57-59` — `VOICE_CAPABLE_STATES = {hr_round, tech_round}`. A `profiling` interview is refused. The 409 is **correct backend behaviour**; it is a symptom of §1.2, not an independent bug.

But `frontend/src/lib/use-voice-session.ts:98-104` never reads `minted.code`. It assumes any mint failure was already downgraded server-side, so it shows *"The voice connection dropped. Your interview is safe — reconnect to keep going."* — factually wrong, and the Reconnect button re-mints, gets 409 again, forever.

### 1.5 And behind that, four more voice blockers

After I unblocked the state, the very next mint attempt returned:

```
POST /api/interviews/{id}/voice/session → 503 {"error":{"code":"VOICE_UNAVAILABLE"}}
```

```
VOICE_PROVIDER_MINT_FAILED  interviewId=…      ← no status, no body, no reason
VOICE_DOWNGRADED_TO_TEXT    interviewId=…
GET /state → "mode":"text"                     ← irreversible, never shown to the user
```

The user picked Voice and silently, permanently got Text. Causes, all independent:

| # | Cause | Evidence |
|---|---|---|
| 1 | `ELEVENLABS_AGENT_ID_HR=` / `_TECH=` are empty; `agentId = HR ?? TECH ?? ''` uses `??`, and `''` is not nullish → mint sends `agent_id: ""` | `.env:40-41`, `backend/modules/voice/elevenlabs-session.ts:41` |
| 2 | Boot does not catch it — both are `.optional()` | `backend/src/lib/env.ts:40-41` |
| 3 | CSP `connect-src 'self'` blocks `wss://api.elevenlabs.io` outright | `frontend/src/middleware.ts:9` (enforcing, all pages) |
| 4 | Client dials the bare origin instead of the signed URL: `new WebSocket(wssOrigin)` where the credential lives in `token` | `frontend/src/lib/use-voice-session.ts:111-112` vs `backend/modules/voice/elevenlabs-session.ts:56-58` |
| 5 | `ELEVENLABS_WEBHOOK_SECRET=` is empty → every in-round webhook 401s; answers travel **only** over that webhook, so a connected call would record nothing | `.env:42`, `backend/modules/voice/webhook-auth.ts:57` |

Voice mode has **never** successfully run in this deployment: the entire API log contains zero `VOICE_SESSION_MINTED`.

### 1.6 A second, separate stuck-room bug

Even after `POST /profile` succeeded, the room stayed on "Preparing the next question…". It updated `Question 0 of 8 → Question 1 of 8` (so **SSE works** — see §2) but never showed the question until I reloaded.

`backend/modules/interview/profile.ts:121` publishes `INTERVIEW_STATE_CHANGED` **before** `:126` generates the questions. The client refetches on the nudge, finds `currentQuestion: null`, and no second event ever fires — question creation is not a state change.

This race is specific to `profiling → hr_round`. The `hr_round → tech_round` handover is *not* affected: `backend/modules/interview/answers.ts:118-120` pre-generates the tech batch during the HR round, before the transition at `:145`, which is exactly what ADR-I22 exists for. The `paused → hr_round` resume path is affected differently — it generates nothing at all (§1.7).

### 1.7 Two more ways an interview bricks itself

- **`POST /:id/resume` does nothing but flip the state.** `backend/modules/interview/resume.ts:23`. The only pause source is a failed generation, which throws before inserting anything. So Resume clears the paused card, generates nothing, and now the Resume button is gone and `POST /profile` 409s. Permanently dead.
- **`AI_OUTPUT_INVALID` during HR generation strands the interview in `hr_round` with zero questions.** `backend/modules/interview/generation.ts:127,149-161` — only `AI_PROVIDER_UNAVAILABLE` pauses. Both recovery paths then 409 (`profile.ts:94`, `resume.ts:18`), and the frontend treats 409 as a silent refetch (`frontend/src/lib/error-routing.ts:15-19`), so the user sees nothing at all.

---

## 2. Verdict on the owner's handwritten notes

| # | Note | Verdict | Detail |
|---|---|---|---|
| 1 | Ana sayfa CTA "Giriş" değil → "Mülakata başla" | **Kısmen doğru** | No CTA literally says "Giriş", but all three landing links (`Hesap oluştur`, `Giriş yap`, `Pratiğe başla`) lead to an auth form. Zero go into the product. |
| 2 | Kart yok, kurulum yok, çok esnaf gibi | **Doğru** | 3 sections, 160 EN / 123 TR words total. No how-it-works, no FAQ, no social proof, no screenshots. Footer has zero links by design. |
| 3 | SEO için daha çok içerik lazım | **Doğru, ve daha kötüsü** | There is effectively no SEO infrastructure at all — see §5. |
| 4 | Header'e Giriş Yap + scroll linkleri | **Doğru** | `frontend/src/components/chrome/header-nav.tsx:33` — `if (!signedIn) return null`. For an anonymous visitor the header is a wordmark and an EN/TR pill. |
| 5 | `/sign-in` değil `/login` | **Doğru** | `/sign-in` → 200, `/login` → 404. Note: `/sign-in` was a written spec decision (`.agents/specs/2026-07-29-frontend.md:65`); a 3-line redirect page is the cheap answer. |
| 6 | Google logosu yok | **Doğru, ve altında bir P0 var** | `frontend/src/components/auth/google-button.tsx:20-22` is a bare `<a>` with a text node. And clicking it today replaces the whole app with `{"error":{"code":"NOT_READY"}}` — screenshot below. |
| 7 | KVKK yok | **Doğru** | No consent checkbox, no privacy policy, no terms, no account deletion. `/privacy` → 404, `/terms` → 404. Zero legal keys in either message file. |
| 8 | Ünvan/isim zorunlu olmamalı | **Yanlış (ama his doğru)** | Nothing is required — client, server and DB all accept empty, and there is a "Şimdilik atla". It *feels* mandatory because of the refresh trap in note 9's neighbour: F5 on `/onboarding/2` bounces you to step 1. Reproduced live. |
| 9 | Eğitim zorunlu olmamalı | **Yanlış (aynı sebep)** | `backend/modules/auth/profile.ts:31-33` accepts `education: []`. Same refresh trap. |
| 10 | Dashboard'da çıkış yok | **Doğru** | `POST /auth/logout` exists and works (`backend/modules/auth/router.ts:18`) with **zero callers**. `frontend/src/components/chrome/header-nav.tsx:16-18` carries a comment claiming the endpoint doesn't exist. It does. |
| 11 | Profil yok | **Doğru** | `/profile` → 404. Once onboarding completes, the user can never edit their name, title, education, interests or language again. |
| 12 | EN/TR profilden seçilsin, header'dan değil | **Doğru, ve switcher'ın kendisi de yarım** | It's a cookie only — `users.locale` is **never written**, so every verification/reset mail and **every interview** is forced to English. |
| 13 | Font: 4./5. harf ve "i" sorunlu | **Doğru — kök neden bulundu** | Both `public/fonts/*-latin.woff2` are the Google **latin** subset. `İ ğ Ğ ş Ş` are absent from the cmap (they live in `latin-ext`). `ı` works, which is why it looked like "some letters". Visible in every screenshot: *Gerçeğinden*, *yapıştır*, *oluştur*, *Şifre*, *başla*. |
| 14 | İş ilanı PDF okuma (OCR) yok | **Kısmen doğru** | PDF **text extraction** exists (`unpdf`) and is well built. OCR is a documented deliberate exclusion. The real bug: the extracted text has **nowhere to go** — `model Upload` (`backend/prisma/schema.prisma:371-385`) has no text column at all, so `uploads.ts:97` extracts it purely to validate, `:107-118` writes a row without it, and `:120` returns only `{ uploadId }`. `setup.ts:55` then refuses an upload-only body — so you upload a listing, it's accepted, and you're told "Add a job listing to start an interview". |
| 15 | Kayıt sonrası mail onayı bekleniyor mu? | **Hayır** | Register → 201 + session → `/onboarding/1`. No inbox wall. `EMAIL_VERIFICATION_REQUIRED=false` gates only `POST /interviews`. This one is designed correctly. |
| 16 | Meslek ve dil işlevsiz | **Doğru** | The setup form's own helper text admits it: *"These two shape this screen only."* Neither is sent — comment at `frontend/src/app/interviews/new/page.tsx:97-98`, payload at `:60-65`. |
| 17 | Mod hep ses olsun, ses yoksa metine otomatik fallback | **Bugün tersi** | Default is `text` (`new/page.tsx:35`), chosen manually. Auto-fallback exists for exactly one failure class out of five — see §3.2. |
| 18 | Sesli seçenek elle seçilebilir olsun (max-capped) | **Yok** | The cap machinery already exists and is enforced in three places; only the user-facing knob is missing. |
| 19 | Interview direkt çalışmıyor | **Doğru** | §1. |
| 20 | Yazıda SSE yok | **Yanlış** | SSE exists, is wired, is consumed unconditionally, and survives Caddy. I verified the stream end to end with `redis-cli PUBLISH` and watched the room update live. It looks absent because the interview is frozen and there is nothing to publish. |
| 21 | Seste 409 conflict | **Doğru** | Reproduced. §1.4. |

**Score: 15 confirmed, 3 partially confirmed, 3 refuted.**

---

## 3. Voice mode

### 3.1 Would voice work if the state were right?

No — four more blockers stack behind it (§1.5). Estimated ~1 day to take voice from "never worked" to "working", in this order: state fix → env vars + `??` → CSP + signed URL → error branching.

### 3.2 Auto-fallback coverage

| Failure class | Automatic? | Today |
|---|---|---|
| Provider mint fails (4xx/5xx, timeout, empty agent id) | **Yes** | `session.ts:81` downgrades server-side before throwing 503. Correct — but the client shows "connection dropped / Reconnect" instead of the correct, already-translated `VOICE_UNAVAILABLE` copy that exists at `messages/en.json:273`. |
| Mic permission **denied** at pre-join | No | Dead end. Button disabled, no alternative. |
| **No microphone on the device** | No | Worse — the CTA is removed entirely. |
| WS drops mid-interview | No | Manual "Reconnect" only. No retry budget, no eventual downgrade. |
| Wrong state / not owner (409, 403) | No, deliberately | Backend reasoning is sound; client mishandles it. |

`frontend/src/lib/voice/downgrade.ts` exists, is tested, has a doc comment reading *"Call when microphone permission is denied before any mint occurs"* — and **zero callers**. So do `voice/device-check.ts` (which already implements camera permission and a preview stream) and `voice/active-speaker.ts` (amplitude-driven speaking detection). Three finished modules, never imported.

### 3.3 "Make it look like a Zoom meeting"

The room is a document, not a call: `room.module.css:4-14` is a centred `max-width: 880px` vertical column. The design system says this on purpose — `room.module.css:1-2`: *"flat --bg, --shadow-hairline only, no gradient, no mascot, near-zero motion."* **This is a spec conflict, not an oversight, and needs your decision before anyone builds.**

| Zoom element | Status |
|---|---|
| Participant tiles | Partial — 2 small avatar cards, and only 1 renders for the whole HR round |
| Active-speaker ring | Present and well done (never colour-alone) |
| Mic mute + level meter | Present, 44px target, `aria-pressed` |
| Connection status | Present |
| **Self-view / camera** | **Missing** — `previewStream` already written in `device-check.ts:9`, unused |
| **Camera on/off** | **Missing** |
| **Leave / end-call button** | **Missing — nothing in the room can end an interview.** `machine.ts` has no edge to `abandoned` at all |
| **Timer / time remaining** | **Missing** — `expires_at` exists server-side and is not returned by `/state`; the user is simply cut off |
| In-room device switching | Missing (picker exists on pre-join only) |
| Full-bleed dark stage | Missing |

---

## 4. Screens, one by one

### 4.1 Landing (`/`)

Sections: hero (h1, subhead, 2 links, mascot, fake transcript card), 3 prop cards, one closing band, link-less footer. That is the entire indexable corpus.

- Header for an anonymous visitor: wordmark + EN/TR pill. Nothing else.
- Primary CTA → `/register`. Closing CTA promises "Pratiğe başla" and delivers a signup form.
- `<header>` and `<footer>` are nested **inside `<main>`** (`frontend/src/app/page.tsx:20-90`), so they are not `banner`/`contentinfo` landmarks. No skip link anywhere in the app.
- The mascot's real artwork does not exist — the seeded objects are 34-byte 1×1 placeholders, so the LCP element does a wasted round-trip, measures `naturalWidth < 10`, and swaps to an inline SVG after hydration (`frontend/src/components/mascot.tsx:200-229`). It also `<link rel=preload>`s the asset it always throws away.
- 2× `GET /api/me` → 401 in the console on every anonymous load (HeaderNav and HomeSwitch each fetch it).

### 4.2 Register / sign-in

- No Google mark on the OAuth button.
- **Clicking it navigates to `/api/auth/google` and renders `{"error":{"code":"NOT_READY"}}` as the whole page.** Full browser navigation, so `useErrorMessage` is bypassed; the only way back is the Back button. `GOOGLE_CLIENT_ID`/`SECRET` are empty and the button is never hidden.
- No KVKK/consent checkbox, no privacy or terms links.
- No locale switcher on any auth screen — a Turkish user cannot switch to Turkish *before* registering unless they first find the landing page.
- Fields stay editable while submitting (spec requires them locked).
- `AUTH_LOGIN_FAILED` logs the raw email address on every failed login (`backend/modules/auth/login.ts:27`), against the logger's own stated no-PII contract.

### 4.3 Onboarding

- Register → `/onboarding/1` directly. No mail wall. Correct.
- **F5 on `/onboarding/2` bounces to `/onboarding/1`.** Reproduced live. `session-steps.ts:11` keeps `passedSteps` in a module-level `Set`, which a full page load re-evaluates to empty. This is what makes the whole flow feel mandatory.
- `/onboarding/9` renders step 1 while the URL still says 9.
- Education rows can be added (max 5) but never removed, and five identical `School` labels give a screen reader nothing to distinguish them.
- **The CV upload is a no-op.** The upload id is held in React state and **no code path anywhere writes `users.cv_upload_id`**. The user sees "CV received", refreshes, and it's gone — the S3 object and `Upload` row are orphaned and the CV never reaches a single question.
- Once complete, onboarding is unreachable — and there is no profile page — so every field is write-once.

### 4.4 Interview setup (`/interviews/new`)

- **Occupation and Language are decorative.** The helper text says so out loud. The user picks Türkçe and gets an English interview.
- The PDF upload says *"we cannot read it out of the file yet"*, and even a successfully parsed PDF can't start an interview (§2 note 14).
- Mode defaults to Text.
- No duration control.
- `targetQuestionCount` is `min(1)` with **no max** and the HR generation is **not** wrapped in `withBudget` (the tech batch is) — `{"targetQuestionCount": 10000}` is accepted by the API.
- `uploadId` is stored with no existence and no ownership check — a garbage id becomes a 500, a valid foreign id permanently attaches your interview to someone else's upload.

### 4.5 Room

Everything in §1, plus:

- No app chrome at all: no header, no footer, no exit, no timer, no progress beyond "Question N of M".
- The three structurally different failures (never-profiled, generation-failed, genuinely-waiting) render identically, which is exactly why this was hard to diagnose.
- Only one persona tile for the whole HR round; the second pops in mid-interview.
- `AvatarPreload` (mounted by the room at `frontend/src/app/interviews/[id]/room/page.tsx:137`, and only there) preloads 10 images — 2 personas × 5 avatar states — of which at most 2 are ever rendered. Chrome then warns on each unused one. I counted 27 warnings in the console after a room→report navigation; the attribution in that dump is to the report URL, but the preloads are issued by the room.
- `overflow-x: hidden` on `html, body` (`globals.css:9-13`) makes `body` a scroll container, which **breaks every `position: sticky` in the app** — including the room's sticky composer and the admin table's sticky header, both of which the design spec requires.

### 4.6 Report

Content quality is genuinely good. Around it:

- **No PDF download button anywhere.** `GET /interviews/:id/report/download` and the whole R02 render→S3 chain exist and produce objects no user can ever reach.
- No branch for `state === 'failed'` — a dead-lettered report shows "Generating your report…" forever, then a timeout message that tells the user to refresh, which can never help.
- **A report job that is lost is unrecoverable.** 4 interviews sit in `evaluating` with no job in Redis; the enqueue only fires on the `→ evaluating` edge, which cannot repeat. There is no retry endpoint and no admin requeue.
- **`completed` interviews with no report row** — 8 in total, of which **4 are soft-deleted, so 4 are user-visible**. The transition and the report write are in separate transactions (the hazard is named in a `ponytail:` comment starting at `report-run.ts:155`; transition at `:142`, report tx at `:159-178`). Those users see an infinite spinner on an interview labelled "Completed".
- The Q&A is rendered twice (Question-by-question, then the full transcript again).
- No CTA out of the report — no back, no "start another", no job title or date for context.
- The PDF, when reachable, is English-only regardless of interview language.

### 4.7 History

**Two competing surfaces exist.** `/` (the real one: confirm-before-delete, correct state chips, relative time) and `/dashboard` (orphaned duplicate: **delete fires immediately with no confirmation**, shows a `completed` interview as "In progress", no header/footer/locale/focus rings). `/dashboard` is unreachable from any link — the codebase asserts in **four** places that it doesn't exist (`auth-redirect.ts:6`, `auth-redirect.test.ts:6`, `authed-home.tsx:24`, `grounds.test.ts:24`) — **but Google OAuth still redirects every successful sign-in straight to it**, which also means first-time Google users skip onboarding entirely.

The "In progress" mislabel is the common case, not an edge case: 17 of 22 live `completed` interviews have `ended_reason = NULL`, which is what `outcomeKey()` falls back on.

Rows in `failed` / `abandoned` render only a Delete button — no link to the report page at all.

### 4.8 Admin

Role gate is **correct on both sides** (client renders a not-authorized card in place; `requireAdmin` mounted router-wide). Verified: a non-admin gets the card, `curl` gets 401.

- **There is no `audit_logs` table.** `N01` is titled "role gate, soft delete, audit" and the only record of a soft delete is a pino line to stdout, with `LOG_TRANSPORT=stdout` — gone on `docker compose down`.
- `/admin/stats` runs **two unbounded `findMany` full-table scans** and aggregates in JS, on an endpoint with no rate limit. `averageDurationMs` is one `AVG()`; `perOccupation` is one `groupBy`.
- Weakest-questions sorts an unindexed column and renders raw cuids as the operator-facing label.

---

## 5. SEO, i18n and typography

- **Metadata is two hardcoded English lines.** `frontend/src/app/layout.tsx:22-25` is the entire metadata surface of the app. A repo-wide grep for `openGraph|twitter|canonical|metadataBase|generateMetadata|alternates` returns exactly that one hit. Sharing the link renders a bare grey box.
- **No `robots.txt`, no `sitemap.xml`, no manifest, no apple-touch-icon, no OG image.** `frontend/public/` contains `fonts/` and `.gitkeep`. `/admin`, `/dashboard` and `/interviews/*` are all crawlable.
- **Turkish has no URL.** Locale is a `NEXT_LOCALE` cookie with no path segment and no `hreflang`. Googlebot arrives cookieless and always gets English, so the Turkish copy is invisible to search — **this half is broken now**. The missing `Vary: Cookie` is a latent second half: `/` currently answers `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` with `Vary: rsc, next-router-state-tree, …, Accept-Encoding` (no `Cookie`), so nothing can cache the wrong language *today*. It becomes live the moment any CDN or caching layer lands. `NEXT_PUBLIC_DEFAULT_LOCALE=en` also means a Turkish job seeker's first page load is always English.
- **The font bug, root cause:** both `frontend/public/fonts/inter-latin.woff2` and `outfit-latin.woff2` are the Google **latin** subset. Decoded cmaps: 230 and 223 glyphs, both containing `i I ı ç Ç ö Ö ü Ü` and both **missing `İ ğ Ğ ş Ş`**. Those five live in `latin-ext`, which the Google→local migration dropped. With `display: swap` and per-glyph fallback, those letters render in the OS UI font *inside* words set in Inter/Outfit — permanently, not as a flash. Every *İK*, *başla*, *değerlendir*, *Giriş*, *oluştur* is affected.
- **i18n key coverage is excellent** — 297 EN / 304 TR keys, zero missing from Turkish, zero ICU placeholder mismatches, and essentially no hardcoded strings outside the brand wordmark. The problems are all in the message files: 7 error keys mis-nested under `dashboard` in `tr.json` (and the misfiled versions are the *correct* informal copy, while the ones that actually render are the wrong formal ones), and ~14 strings mixing `siz` into a spec that says `sen` everywhere, including `görüşme` where the one-term rule says `mülakat`.

---

## 6. Security

No IDOR found. I traced every route handler: `router.param('id', resolveInterview)` covers all eight `:id` routes with one resolver that returns **404, not 403**, for a non-owner. Voice routes check inline. S3 scoping verified live — `/assets/reports/*.pdf` → 403, `/assets/uploads/*.pdf` → 403, `/assets/mascot/*` → 200. Signed-URL TTL is a hard ceiling, not a default. The webhook HMAC gates are the best-built code in the repo.

Real gaps:

| Severity | Finding |
|---|---|
| P1 | **CSRF origin enforcement covers only 2 of 6 state-changing routers.** `requirePublicOrigin` is mounted on the interview and voice routers only. Uncovered: `POST /uploads`, `PATCH /me/profile`, `POST /me/profile/complete`, `POST /auth/logout`, `POST /auth/verify-email/request`, register/login. Proven live with a foreign `Origin`: `PATCH /api/me/profile` → **200** (wrote to the profile), `POST /api/interviews` → 403 (control). |
| P1 | **Every IP rate limit is one global bucket.** Live Redis key: `ratelimit:register:::ffff:172.18.0.9` — that's the Caddy container. `app.set('trust proxy')` is never called. So registration is capped at 3/hour *for the entire internet*, and the limit neither slows nor localises an attacker. |
| P2 | `POST /interviews` accepts an unowned, unvalidated `uploadId`. |
| P2 | `SESSION_COOKIE_SECURE` and `SESSION_TTL_DAYS` are declared, documented, set in `.env` — and **never read**. `session.ts:19` keys off `NODE_ENV` instead. `.env` claims `Secure=true`; the live cookie has no `Secure` flag. |
| P2 | `.env` ships `SESSION_SECRET=change-me-…` and `SEED_ADMIN_PASSWORD=AdminDemo1!` byte-identical to `.env.example`, and `admin@demo.com` exists with `role=admin` in the live DB. (`SESSION_SECRET` is at least dead code — sessions are 32 random bytes, nothing is signed with it.) |
| P2 | Rate-limit gaps: `POST /uploads` (10 MB + PDF parse + S3 write — the most expensive endpoint in the system), both token-confirm endpoints (unlimited guessing, one of which rotates a password), `/admin/stats`, and `GET /:id/events` which opens **one Redis connection per stream** with no per-user cap. |
| P3 | Raw email logged on failed login; client IPs logged on rate-limit hits (currently masked by the `trust proxy` bug). |

---

## 7. Ops

- **The API has no graceful shutdown.** No `SIGTERM` handler anywhere in `backend/src`. On `docker stop`, in-flight `POST /answers` can die between the CAS index advance and the answer insert — losing the answer with the index already moved. The worker does this correctly; the API doesn't.
- **The worker has no healthcheck** and no liveness surface — it's the only app service in `compose.yaml` without one. A worker that has silently lost Redis reports healthy forever, which is precisely the failure class the 4 stuck `evaluating` interviews are evidence of.
- **The report queue retains completed and failed jobs forever** (no `removeOnComplete`/`removeOnFail`), and Redis is `maxmemory:0 / noeviction`, so it grows until writes start failing. Careful: the retained job id is what makes the `jobId = interviewId` dedup work — retention and retry must be solved together.
- **No queue-depth or dead-letter observability.** The 4 dead-lettered jobs and 4 stuck interviews in this stack were invisible until I queried Redis and Postgres by hand.
- The acceptance suite writes to the **production** Redis instance (its 4 dead-lettered jobs are sitting there now, stack frames pointing at `features/step_definitions/`).
- Env drift: `NEXT_PUBLIC_ASSETS_PREFIX` and `NEXT_PUBLIC_MASCOT_SHA256` are in `.env.example` and missing from `.env` — harmless today because both fall back correctly, but they are **build-time** inlines, so the moment real mascot artwork ships at a different digest every mascot 404s. `VOICE_WEBHOOK_FRESHNESS_SECONDS` is genuinely harmless (`.default(300)`). `S3_REGION` is read via raw `process.env`, bypassing the validated config. `SIGNED_URL_TTL`, `MAX_INTERVIEWS_PER_USER_PER_DAY` and `BUDGET_USD_TEXT` are all declared and read by nobody — editing them does nothing.
- Edge logs every normal SSE disconnect as a `warn` ("aborting with incomplete response"), which will bury real proxy warnings.
- Caddy's `handle /events/*` block with `flush_interval -1` guards a path the app never uses; SSE works only because Caddy auto-flushes `text/event-stream`. Dead config that looks like protection.

---

## 8. What is genuinely good

Worth stating so the fix list doesn't read as a rewrite.

- The CAS-guarded advance (`answers.ts:65-69`) and state write (`machine.ts:48-52`) are real compare-and-swaps, not read-then-write. Concurrent requests cannot double-advance.
- The budget ceiling holds a `pg_advisory_xact_lock` across the provider call, closing the check-then-call race properly, and an exhausted budget *ends* the interview while keeping the answer that tripped it.
- The voice webhook auth is exemplary: HMAC over raw bytes with the raw-body middleware correctly scoped, length check before `timingSafeEqual`, fails closed on a missing secret, bidirectional freshness window, gates complete before anything mutates, and the webhook's transcript is re-validated through the *same* schema as the HTTP route.
- Upload validation: Content-Length pre-check, multer bounds on size/files/fields/parts, declared MIME distrusted in favour of magic bytes, page cap before text extraction, sha256 dedup, upsert to survive the race.
- Soft delete is enforced structurally — every FK is `ON DELETE RESTRICT`, the shared query helpers bake in `deleted_at IS NULL`, admin reads bypass them with a comment at every call site, and there is a runnable self-check that fails loudly if the filter is ever dropped.
- Error localisation is complete: every error code has EN and TR copy, and `useErrorMessage` falls back rather than leaking a code. **No raw codes reach the UI.**
- Password reset revokes every session in the same transaction as the password write, and responds *before* the lookup so enumeration can't leak through latency.
- `date_of_birth` is stripped twice on independent paths before anything reaches a model.
- The design token system is real and enforced by tests — 17 pinned contrast pairs all clear 4.5:1, `prefers-reduced-motion` handled once at the token level.
- Mutations are never retried, so a retried answer submit can't double-write.
- `zBoolean` correctly avoids `z.coerce.boolean()`, with a comment naming the acceptance run that caught it.

---

## 9. Recommended order

**Ship-blocking, in this exact order:**

1. `POST /interviews/:id/profile` from the frontend — one call unblocks the entire product.
2. Generate before transitioning (§1.6), so the room doesn't need a manual reload.
3. Voice: fill the two agent IDs + the webhook secret, fix `??` → `||`, add the WSS origin to `connect-src`, connect to `token` not `wssOrigin`.
4. Hide the Google button when unconfigured — 1 line, kills a P0.
5. Font subset — one file swap, fixes the most visible defect for every Turkish user on every screen.
6. Wire the PDF download button.
7. `app.set('trust proxy', 1)` and hoist `requirePublicOrigin` to `app.ts` — 2 lines, closes both security gaps.

**Then:** sign-out, profile page, KVKK pages, the report `failed` branch + retry, delete `/dashboard`, onboarding refresh trap, CV persistence, listing-text handoff.

**Then, as product work:** landing content + header nav + SEO files, the Zoom-style room (needs your call on the DESIGN.md conflict first), voice-first mode with real auto-fallback, duration selection.
