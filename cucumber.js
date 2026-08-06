// Acceptance runner (IDEA.md §5.3). Runs from the repo root.
//
// `paths` is a deliberate ALLOW-LIST, not a glob over .agents/features. Every feature file
// in that directory was authored in Stage 2, but a scenario only becomes runnable when the
// task that owns its behaviour has wired its step definitions. Globbing would make every
// unwired feature an undefined-step failure forever; listing them one at a time makes the
// acceptance suite grow exactly as fast as the implementation does.
//
// The feature files are read where they were authored — there is no second copy under
// backend/. One file, one source of truth, so the spec and the runnable test cannot drift.
//
// TWO PROFILES, because the two rings cannot share a cucumber World (ADR-A04-3):
//
//  - `default` — the interview-core rings. Their steps run against `AiWorld`, an in-memory
//    world with no HTTP server and no database.
//  - `auth` — the auth rings. Their steps run against `AuthWorld`, which boots the Express
//    app on an ephemeral port and talks to Postgres and Redis.
//
// cucumber allows exactly one `setWorldConstructor` per process, and both rings define
// `the response status is {int}` over their own world, so loading both `require` trees in
// one run is an ambiguous-step failure before any assertion executes. Profiles keep each
// ring's steps with the world they were written against.
//
// Each task appends its own feature file to its own profile as it wires the steps. I07 wired
// interview_flow.feature @AC-16; next up, I08 wires @AC-11.
//
// I05 hit the case the file-level allow-list cannot express: interview_flow.feature is owned
// by four tasks, and only @AC-15 is I05's. Keeping the file out of `paths` would make I05's
// own Verification match zero scenarios and pass vacuously — the false green EXECUTE.md §7
// warns about. Putting it in unfiltered would leave the BLOCKING `acceptance` job undefined
// on five scenarios until I08 lands, on everyone's PRs, which is how a red job starts being
// ignored. So the allow-list gained a second axis: `not @unwired` below skips scenarios
// whose steps do not exist yet, and the owning task deletes its own tag when it writes them.
// `strict` still fails anything unwired that forgot the tag. I06 (ADR-I26): a CLI `--tags` is
// **ANDed** with this expression, it does NOT replace it — so a scoped Verification command
// matches `0 scenarios` and exits 0 while its scenarios are still tagged. Delete the tag
// first, then run it red.
//
// I04 is the first task whose scenarios drive generation through the app's own AiClient
// (POST /interviews/:id/profile), so the suite must never reach a real provider: the local
// .env carries live keys, and one accidental run would bill them and make every assertion
// non-deterministic. Forcing AI_ENABLED here — BEFORE loadEnvFile, whose semantics leave an
// already-set variable alone — puts the whole run in §5.5 stub mode whatever the file says.
// The provider chain itself is still covered: ai_provider.feature fakes ProviderTransport
// inside the World and never consults this flag.
process.env.AI_ENABLED = 'false';
//
// Same forcing, for the same reason, on NODE_ENV (A04+I03 merge): the auth ring's Google
// seam mounts only under NODE_ENV=test (app.ts), but loadEnvFile below would import
// .env's `development` before `tests/support/setup.ts`'s `??= 'test'` default ever runs.
// An acceptance run is a test run whatever the file says.
process.env.NODE_ENV = 'test';
//
// I03 is the first task whose steps import backend/src/app.ts, which loads env.ts's Zod
// schema at require time — every key must resolve or the process exits before a single
// scenario runs. Loaded here (once, before requireModule) rather than via a CLI flag so
// this file behaves the same whether it is invoked directly or through the npm script.
// Vars already in process.env (CI sets DATABASE_URL/SHADOW_DATABASE_URL/REDIS_URL itself)
// take precedence over the file (Node's loadEnvFile semantics) — this only fills the rest.
try {
  process.loadEnvFile(require('node:path').join(__dirname, '.env'));
} catch {
  // No .env at repo root: env.ts reports ENV_VALIDATION_FAILED with the missing keys,
  // which is a clearer failure than a silent skip.
}

const shared = {
  requireModule: ['tsx/cjs'],
  // Undefined, pending or ambiguous steps fail the run. Without this a scenario whose
  // steps were never written reports green.
  strict: true,
  format: ['progress'],
};

module.exports = {
  default: {
    ...shared,
    paths: [
      '.agents/features/security.feature',
      '.agents/features/ai_provider.feature',
      '.agents/features/question_generation.feature',
      '.agents/features/profiling.feature',
      '.agents/features/interview_flow.feature',
      '.agents/features/language_detection.feature',
      '.agents/features/voice_session.feature',
      '.agents/features/voice_webhook.feature',
      '.agents/features/voice_fallback.feature',
      '.agents/features/voice_reconciliation.feature',
      '.agents/features/adaptive_questions.feature',
      '.agents/features/admin_cost.feature',
      '.agents/features/schema_validation.feature',
      '.agents/features/report.feature',
      '.agents/features/upload.feature',
      '.agents/features/object_storage.feature',
      '.agents/features/rate_limits.feature',
      '.agents/features/reliability.feature',
      '.agents/features/config.feature',
      '.agents/features/speech_turn.feature',
    ],
    tags: 'not @unwired',
    require: ['backend/features/step_definitions/**/*.ts'],
  },
  auth: {
    ...shared,
    paths: [
      '.agents/features/auth.feature',
      '.agents/features/admin_auth.feature',
      '.agents/features/email_verification.feature',
      '.agents/features/password_reset.feature',
      '.agents/features/onboarding_profile.feature',
    ],
    // `support` first, and it stays first: `support/setup.ts` fills the env defaults that
    // `src/lib/env.ts` validates at import time, and a step-definition file loaded ahead of
    // it drags `env.ts` in early — `NODE_ENV` then defaults to `development` and the
    // acceptance-only Google seam never mounts.
    require: ['backend/tests/support/**/*.ts', 'backend/tests/step-definitions/**/*.ts'],
    // A01's filter, carried over: a scenario whose steps are not written yet stays out of
    // the green suite instead of failing it.
    //
    // `not @AC-29` is still a DEFERRAL, but a narrower one since the A04+I03 merge:
    // `requireVerifiedEmail` is now mounted on `POST /interviews` (interview/router.ts).
    // What remains missing is the auth ring's interview steps ("I set up an interview…",
    // "no interview exists for…") and `GET /me/interviews`, which no task has landed yet.
    // Whichever task ships that endpoint: wire the steps and delete `and not @AC-29`.
    //
    // A06's `not @AC-32` deferral is GONE (issue 62): I11's `POST /uploads` landed, and it
    // now performs the attach those scenarios describe — `users.cv_upload_id` plus the
    // truncated `cv_text` on the profile. `cv-upload.ts` wires them against the real endpoint
    // with only the bucket faked, so nothing about I11's validation is duplicated here.
    //
    // `not @AC-33 and not @AC-34` defer the interview-snapshot scenarios — both use
    // interview-core steps ("I set up an interview…") that live in AiWorld, and AuthWorld
    // cannot share a cucumber World with it (ADR-A04-3). `interview/profile.ts`'s
    // `mergeProfile` already implements the merge these two scenarios describe; only the
    // cross-ring step wiring is missing, not the behaviour.
    tags: 'not @wip and not @AC-29 and not @AC-33 and not @AC-34',
  },
};
