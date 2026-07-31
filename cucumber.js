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
// Each task appends its own feature file to its own profile as it wires the steps.
// Next up: I03/I04 add question_generation.feature and profiling.feature to `default`.
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
    paths: ['.agents/features/security.feature', '.agents/features/ai_provider.feature'],
    require: ['backend/features/step_definitions/**/*.ts'],
  },
  auth: {
    ...shared,
    paths: [
      '.agents/features/auth.feature',
      '.agents/features/admin_auth.feature',
      '.agents/features/email_verification.feature',
    ],
    // `support` first, and it stays first: `support/setup.ts` fills the env defaults that
    // `src/lib/env.ts` validates at import time, and a step-definition file loaded ahead of
    // it drags `env.ts` in early — `NODE_ENV` then defaults to `development` and the
    // acceptance-only Google seam never mounts.
    require: ['backend/tests/support/**/*.ts', 'backend/tests/step-definitions/**/*.ts'],
    // A01's filter, carried over: a scenario whose steps are not written yet stays out of
    // the green suite instead of failing it.
    //
    // `not @AC-29` is A04's, and it is a DEFERRAL, not a pass: the two excluded scenarios
    // are the verification gate on `POST /interviews`, an endpoint I03 has not landed.
    // The middleware they will exercise exists (`requireVerifiedEmail`). **I03: mount it
    // and delete `and not @AC-29` from this line** — nothing else here needs to change.
    tags: 'not @wip and not @AC-29',
  },
};
