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
// Each task appends its own feature file here as it wires the steps. Next up: I07 wires
// interview_flow.feature @AC-16 and I08 wires @AC-11.
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

module.exports = {
  default: {
    paths: [
      '.agents/features/security.feature',
      '.agents/features/ai_provider.feature',
      '.agents/features/question_generation.feature',
      '.agents/features/profiling.feature',
      '.agents/features/interview_flow.feature',
    ],
    tags: 'not @unwired',
    require: ['backend/features/step_definitions/**/*.ts'],
    requireModule: ['tsx/cjs'],
    // Undefined, pending or ambiguous steps fail the run. Without this a scenario whose
    // steps were never written reports green.
    strict: true,
    format: ['progress'],
  },
};
